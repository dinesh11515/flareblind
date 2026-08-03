// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IPriceOracle {

    function latestPrice() external returns (uint256 price, uint256 timestamp);
}
