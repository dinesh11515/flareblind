// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";

contract FlareblindPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Phase {
        Open,
        Sealing
    }

    struct Fill {
        address trader;
        bool isBuy;
        uint128 baseAmount;
    }

    uint256 public constant PRICE_SCALE = 1e18;

    uint256 public constant MAX_DEVIATION_BPS_CAP = 1000;
    uint256 public constant MAX_SEALED_ORDER_BYTES = 512;
    uint32 public constant MAX_ORDERS_PER_BATCH = 512;

    IERC20 public immutable base;
    IERC20 public immutable quote;

    IPriceOracle public oracle;
    uint256 public maxDeviationBps;
    uint256 public maxOracleAge;
    uint256 public batchDuration;

    address public teeSigner;

    bytes32 public teeAttestationDigest;

    bytes32 public enclaveEncryptionKey;

    uint64 public currentBatchId;
    uint256 public currentBatchEndsAt;
    Phase public phase;
    uint32 public orderCount;

    mapping(address => uint256) public baseBalanceOf;
    mapping(address => uint256) public quoteBalanceOf;

    uint256 public quoteDust;

    event Deposited(address indexed trader, bool indexed isBase, uint256 amount);
    event Withdrawn(address indexed trader, bool indexed isBase, uint256 amount);
    event OrderSubmitted(
        uint64 indexed batchId,
        address indexed trader,
        uint32 orderIndex,
        bytes sealedOrder
    );
    event BatchClosed(uint64 indexed batchId, uint32 orderCount);
    event BatchSettled(
        uint64 indexed batchId,
        uint256 clearingPrice,
        uint256 matchedBase,
        uint32 fillCount
    );
    event TeeSignerRotated(address indexed signer, bytes32 attestationDigest);
    event EnclaveEncryptionKeySet(bytes32 publicKey);
    event ParamsUpdated(uint256 maxDeviationBps, uint256 maxOracleAge, uint256 batchDuration);
    event OracleUpdated(address oracle);

    error WrongPhase();
    error BatchStillOpen();
    error BatchIdMismatch();
    error NotTeeSigner();
    error DepositRequired();
    error ZeroAmount();
    error SealedOrderTooLarge();
    error TooManyOrders();
    error InsufficientVenueBalance(address trader);
    error VolumeNotConserved(uint256 buyBase, uint256 sellBase);
    error PriceOutOfBounds(uint256 clearingPrice, uint256 oraclePrice);
    error StaleOraclePrice(uint256 priceTimestamp);
    error NonZeroPriceForEmptyBatch();
    error DeviationCapExceeded();

    constructor(
        IERC20 base_,
        IERC20 quote_,
        IPriceOracle oracle_,
        uint256 batchDuration_,
        uint256 maxDeviationBps_,
        uint256 maxOracleAge_,
        address owner_
    ) Ownable(owner_) {
        if (maxDeviationBps_ > MAX_DEVIATION_BPS_CAP) revert DeviationCapExceeded();
        base = base_;
        quote = quote_;
        oracle = oracle_;
        batchDuration = batchDuration_;
        maxDeviationBps = maxDeviationBps_;
        maxOracleAge = maxOracleAge_;

        currentBatchId = 1;
        currentBatchEndsAt = block.timestamp + batchDuration_;
        phase = Phase.Open;
    }

    function deposit(bool isBase, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IERC20 token = isBase ? base : quote;
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (isBase) baseBalanceOf[msg.sender] += amount;
        else quoteBalanceOf[msg.sender] += amount;
        emit Deposited(msg.sender, isBase, amount);
    }

    function withdraw(bool isBase, uint256 amount) external nonReentrant {
        if (phase != Phase.Open) revert WrongPhase();
        if (amount == 0) revert ZeroAmount();
        if (isBase) {
            uint256 bal = baseBalanceOf[msg.sender];
            if (bal < amount) revert InsufficientVenueBalance(msg.sender);
            baseBalanceOf[msg.sender] = bal - amount;
            base.safeTransfer(msg.sender, amount);
        } else {
            uint256 bal = quoteBalanceOf[msg.sender];
            if (bal < amount) revert InsufficientVenueBalance(msg.sender);
            quoteBalanceOf[msg.sender] = bal - amount;
            quote.safeTransfer(msg.sender, amount);
        }
        emit Withdrawn(msg.sender, isBase, amount);
    }

    function submitOrder(bytes calldata sealedOrder) external {
        if (phase != Phase.Open) revert WrongPhase();
        if (sealedOrder.length == 0 || sealedOrder.length > MAX_SEALED_ORDER_BYTES) {
            revert SealedOrderTooLarge();
        }
        if (baseBalanceOf[msg.sender] == 0 && quoteBalanceOf[msg.sender] == 0) {
            revert DepositRequired();
        }
        uint32 index = orderCount;
        if (index >= MAX_ORDERS_PER_BATCH) revert TooManyOrders();
        orderCount = index + 1;
        emit OrderSubmitted(currentBatchId, msg.sender, index, sealedOrder);
    }

    function closeBatch() external {
        if (phase != Phase.Open) revert WrongPhase();
        if (block.timestamp < currentBatchEndsAt) revert BatchStillOpen();

        uint64 batchId = currentBatchId;
        uint32 count = orderCount;
        emit BatchClosed(batchId, count);

        if (count == 0) {
            emit BatchSettled(batchId, 0, 0, 0);
            _openNextBatch();
        } else {
            phase = Phase.Sealing;
        }
    }

    function settleBatch(
        uint64 batchId,
        uint256 clearingPrice,
        Fill[] calldata fills
    ) external nonReentrant {
        if (msg.sender != teeSigner) revert NotTeeSigner();
        if (phase != Phase.Sealing) revert WrongPhase();
        if (batchId != currentBatchId) revert BatchIdMismatch();

        uint256 matchedBase = 0;

        if (fills.length == 0) {
            if (clearingPrice != 0) revert NonZeroPriceForEmptyBatch();
        } else {
            _checkPriceAgainstOracle(clearingPrice);

            uint256 buyBase = 0;
            uint256 sellBase = 0;
            uint256 quoteIn = 0;
            uint256 quoteOut = 0;

            for (uint256 i = 0; i < fills.length; i++) {
                Fill calldata f = fills[i];
                if (f.baseAmount == 0) revert ZeroAmount();

                if (f.isBuy) {

                    uint256 cost =
                        (uint256(f.baseAmount) * clearingPrice + PRICE_SCALE - 1) / PRICE_SCALE;
                    uint256 qb = quoteBalanceOf[f.trader];
                    if (qb < cost) revert InsufficientVenueBalance(f.trader);
                    quoteBalanceOf[f.trader] = qb - cost;
                    baseBalanceOf[f.trader] += f.baseAmount;
                    buyBase += f.baseAmount;
                    quoteIn += cost;
                } else {
                    uint256 bb = baseBalanceOf[f.trader];
                    if (bb < f.baseAmount) revert InsufficientVenueBalance(f.trader);
                    baseBalanceOf[f.trader] = bb - f.baseAmount;
                    uint256 proceeds = (uint256(f.baseAmount) * clearingPrice) / PRICE_SCALE;
                    quoteBalanceOf[f.trader] += proceeds;
                    sellBase += f.baseAmount;
                    quoteOut += proceeds;
                }
            }

            if (buyBase != sellBase) revert VolumeNotConserved(buyBase, sellBase);
            matchedBase = buyBase;

            quoteDust += quoteIn - quoteOut;
        }

        emit BatchSettled(batchId, clearingPrice, matchedBase, uint32(fills.length));
        _openNextBatch();
    }

    function _openNextBatch() internal {
        currentBatchId += 1;
        currentBatchEndsAt = block.timestamp + batchDuration;
        orderCount = 0;
        phase = Phase.Open;
    }

    function _checkPriceAgainstOracle(uint256 clearingPrice) internal {
        (uint256 oraclePrice, uint256 ts) = oracle.latestPrice();
        if (block.timestamp > ts + maxOracleAge) revert StaleOraclePrice(ts);
        uint256 diff =
            clearingPrice > oraclePrice ? clearingPrice - oraclePrice : oraclePrice - clearingPrice;
        if (diff * 10_000 > oraclePrice * maxDeviationBps) {
            revert PriceOutOfBounds(clearingPrice, oraclePrice);
        }
    }

    function setTeeSigner(address signer, bytes32 attestationDigest) external onlyOwner {
        teeSigner = signer;
        teeAttestationDigest = attestationDigest;
        emit TeeSignerRotated(signer, attestationDigest);
    }

    function setEnclaveEncryptionKey(bytes32 publicKey) external onlyOwner {
        enclaveEncryptionKey = publicKey;
        emit EnclaveEncryptionKeySet(publicKey);
    }

    function setOracle(IPriceOracle oracle_) external onlyOwner {
        oracle = oracle_;
        emit OracleUpdated(address(oracle_));
    }

    function setParams(
        uint256 maxDeviationBps_,
        uint256 maxOracleAge_,
        uint256 batchDuration_
    ) external onlyOwner {
        if (maxDeviationBps_ > MAX_DEVIATION_BPS_CAP) revert DeviationCapExceeded();
        maxDeviationBps = maxDeviationBps_;
        maxOracleAge = maxOracleAge_;
        batchDuration = batchDuration_;
        emit ParamsUpdated(maxDeviationBps_, maxOracleAge_, batchDuration_);
    }

    function withdrawDust(address to) external onlyOwner {
        uint256 amount = quoteDust;
        quoteDust = 0;
        quote.safeTransfer(to, amount);
    }

    function balancesOf(address trader) external view returns (uint256, uint256) {
        return (baseBalanceOf[trader], quoteBalanceOf[trader]);
    }

    function batchInfo()
        external
        view
        returns (uint64 id, Phase phase_, uint256 endsAt, uint32 orders)
    {
        return (currentBatchId, phase, currentBatchEndsAt, orderCount);
    }
}
