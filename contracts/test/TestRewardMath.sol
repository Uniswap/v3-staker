// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import '../interfaces/IUniswapV3Staker.sol';

import '../libraries/RewardMath.sol';

/// @dev Test contract for RewardMatrh
contract TestRewardMath {
    function computeRewardAmount(RewardMath.ComputeRewardAmountParams memory params) public pure returns (uint256 reward, uint256 maxReward, uint160 secondsInsideX128) {
        (reward, maxReward, secondsInsideX128) = RewardMath.computeRewardAmount(params);
    }
}
