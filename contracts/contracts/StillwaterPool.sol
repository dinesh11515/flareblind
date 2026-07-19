// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";

/// @title StillwaterPool — sealed-order batch trading venue
///
/// Traders hold venue balances of a base/quote pair (FXRP / USD stable) and
/// submit orders as ciphertexts encrypted to a key that only exists inside the
/// matching engine's TEE. Orders are cleared in discrete uniform-price batch
/// auctions computed by the enclave, then settled here.
///
/// The contract does not trust the enclave blindly. At settlement it enforces:
///   1. the caller is the registered (attested) enclave signer,
///   2. matched base volume is exactly conserved (sum buys == sum sells),
///   3. the clearing price sits within `maxDeviationBps` of the FTSO
///      reference price, so a compromised operator cannot clear at an
///      off-market price,
///   4. every fill is fully funded by the trader's frozen venue balance.
///
/// Balances are frozen (withdrawals blocked) only while a batch is Sealing,
/// i.e. between batch close and settlement.
contract StillwaterPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- types

    enum Phase {
        Open, // accepting sealed orders and withdrawals
        Sealing // batch closed, enclave computing; balances frozen
    }

    struct Fill {
        address trader;
        bool isBuy; // true: pays quote, receives base
        uint128 baseAmount; // matched amount in base-wei
    }

    // ------------------------------------------------------------ constants

    uint256 public constant PRICE_SCALE = 1e18;
    /// Hard cap on how loose the owner can set the oracle deviation bound.
    uint256 public constant MAX_DEVIATION_BPS_CAP = 1000; // 10%
    uint256 public constant MAX_SEALED_ORDER_BYTES = 512;
    uint32 public constant MAX_ORDERS_PER_BATCH = 512;

    // ------------------------------------------------------------ immutable

    IERC20 public immutable base;
    IERC20 public immutable quote;

    // -------------------------------------------------------------- config

    IPriceOracle public oracle;
    uint256 public maxDeviationBps;
    uint256 public maxOracleAge;
    uint256 public batchDuration;

    /// Address derived from the signing key generated inside the enclave.
    address public teeSigner;
    /// keccak256 of the Confidential Space attestation token binding
    /// `teeSigner` and `enclaveEncryptionKey` to a measured workload image.
    bytes32 public teeAttestationDigest;
    /// X25519 public key traders seal orders to. Private half never leaves
    /// the enclave.
    bytes32 public enclaveEncryptionKey;

    // --------------------------------------------------------------- state

    uint64 public currentBatchId;
    uint256 public currentBatchEndsAt;
    Phase public phase;
    uint32 public orderCount;

    mapping(address => uint256) public baseBalanceOf;
    mapping(address => uint256) public quoteBalanceOf;

    /// Rounding surplus: buyers pay ceil, sellers receive floor, so the
    /// venue can only accumulate dust, never owe it.
    uint256 public quoteDust;

    // -------------------------------------------------------------- events

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

    // -------------------------------------------------------------- errors

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

    // --------------------------------------------------------- constructor

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

    // ------------------------------------------------------------ balances

    function deposit(bool isBase, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IERC20 token = isBase ? base : quote;
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (isBase) baseBalanceOf[msg.sender] += amount;
        else quoteBalanceOf[msg.sender] += amount;
        emit Deposited(msg.sender, isBase, amount);
    }

    /// @notice Withdraw free venue balance. Blocked while a batch is Sealing
    ///         so the enclave can validate orders against stable balances.
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

    // -------------------------------------------------------------- orders

    /// @notice Submit a sealed order to the current batch.
    /// @dev The ciphertext lives only in calldata/logs; the contract stores
    ///      nothing per order. Requiring a nonzero venue balance is a cheap
    ///      spam brake — unfunded orders are dropped by the enclave anyway.
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

    // --------------------------------------------------------------- batch

    /// @notice Close the current batch once its window has elapsed.
    ///         Anyone may call. Empty batches roll over immediately.
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

    /// @notice Settle a sealed batch with the enclave's clearing result.
    /// @param batchId       Batch being settled; must match current.
    /// @param clearingPrice Uniform price (1e18-scaled quote per base), or 0
    ///                      for a batch with no crossing volume.
    /// @param fills         Matched legs. Buy legs pay ceil(base * price),
    ///                      sell legs receive floor(base * price).
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
                    // ceil so the venue never under-collects
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
            // ceil-vs-floor rounding surplus; provably non-negative
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

    // --------------------------------------------------------------- admin

    /// @notice Register the enclave's onchain signer together with the digest
    ///         of the attestation token that vouches for it.
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

    // --------------------------------------------------------------- views

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
