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

    function latestPrice() external returns (uint256 price, uint256 timestamp) {
        IFtsoV2 ftso = IFtsoV2(registry.getContractAddressByName("FtsoV2"));
        (uint256 value, int8 dec, uint64 ts) = ftso.getFeedById(feedId);

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
