// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import '../interfaces/IUniswapV3Staker.sol';

import '../libraries/IncentiveId.sol';

/// @dev Test contract for IncentiveId
contract TestIncentiveId {
    function compute(IUniswapV3Staker.IncentiveKey memory key) public pure returns (bytes32) {
        return IncentiveId.compute(key);
    }
}
