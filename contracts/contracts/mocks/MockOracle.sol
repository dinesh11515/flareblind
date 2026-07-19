// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

contract MockOracle is IPriceOracle {
    uint256 public price;
    uint256 public timestamp;

    function set(uint256 price_, uint256 timestamp_) external {
        price = price_;
        timestamp = timestamp_;
    }

    function latestPrice() external view returns (uint256, uint256) {
        return (price, timestamp);
    }
}
