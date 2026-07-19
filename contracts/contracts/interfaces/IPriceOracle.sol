// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Reference price source used to bound clearing prices at settlement.
interface IPriceOracle {
    /// @notice Price of the base token in quote token terms.
    /// @dev Convention: quote-wei per base-wei, scaled by 1e18, so that
    ///      quoteAmount = baseAmount * price / 1e18 with both amounts in
    ///      their tokens' native decimals.
    ///      Not declared `view` because FTSOv2 read methods are `payable`
    ///      (fee hook); implementations must not actually require value.
    /// @return price     1e18-scaled quote-per-base price.
    /// @return timestamp Unix time the price was produced at.
    function latestPrice() external returns (uint256 price, uint256 timestamp);
}
