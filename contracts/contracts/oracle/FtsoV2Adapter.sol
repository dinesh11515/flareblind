// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

interface IFlareContractRegistry {
    function getContractAddressByName(string calldata name) external view returns (address);
}

interface IFtsoV2 {
    function getFeedById(bytes21 feedId)
        external
        payable
        returns (uint256 value, int8 decimals, uint64 timestamp);
}

/// @title FtsoV2Adapter
/// @notice Adapts an FTSOv2 feed (e.g. XRP/USD) to the venue's price
///         convention: quote-wei per base-wei, scaled by 1e18.
///
/// The FTSOv2 contract is resolved through the Flare contract registry on
/// every read, so protocol upgrades that redeploy FtsoV2 do not strand the
/// venue. The registry lives at the same address on all Flare networks
/// (0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019).
contract FtsoV2Adapter is IPriceOracle {
    IFlareContractRegistry public immutable registry;
    bytes21 public immutable feedId;
    uint8 public immutable baseDecimals;
    uint8 public immutable quoteDecimals;

    constructor(
        IFlareContractRegistry registry_,
        bytes21 feedId_,
        uint8 baseDecimals_,
        uint8 quoteDecimals_
    ) {
        registry = registry_;
        feedId = feedId_;
        baseDecimals = baseDecimals_;
        quoteDecimals = quoteDecimals_;
    }

    /// @inheritdoc IPriceOracle
    function latestPrice() external returns (uint256 price, uint256 timestamp) {
        IFtsoV2 ftso = IFtsoV2(registry.getContractAddressByName("FtsoV2"));
        (uint256 value, int8 dec, uint64 ts) = ftso.getFeedById(feedId);

        // Feed semantics: human price = value / 10^dec (USD per whole base).
        // Venue price   = value * 1e18 * 10^quoteDecimals
        //                 / (10^dec * 10^baseDecimals)
        uint256 numerator = value * 1e18 * (10 ** quoteDecimals);
        uint256 denominator = 10 ** baseDecimals;
        if (dec >= 0) {
            denominator *= 10 ** uint256(uint8(dec));
        } else {
            numerator *= 10 ** uint256(uint8(-dec));
        }
        return (numerator / denominator, ts);
    }
}
