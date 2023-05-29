// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;

import '@uniswap/v3-core/contracts/libraries/FullMath.sol';
import '@openzeppelin/contracts/math/Math.sol';

/// @title Math for computing rewards
/// @notice Allows computing rewards given some parameters of stakes and incentives
library RewardMath {

    /// @param totalRewardUnclaimed The total amount of unclaimed rewards left for an incentive
    /// @param totalSecondsClaimedX128 How many full liquidity-seconds have been already claimed for the incentive
    /// @param startTime When the incentive rewards began in epoch seconds
    /// @param endTime When rewards are no longer being dripped out in epoch seconds
    /// @param vestingPeriod The minimal in range time after which full rewards are payed out
    /// @param liquidity The amount of liquidity, assumed to be constant over the period over which the snapshots are measured
    /// @param secondsPerLiquidityInsideInitialX128 The seconds per liquidity of the liquidity tick range as of the beginning of the period
    /// @param secondsPerLiquidityInsideX128 The seconds per liquidity of the liquidity tick range as of the current block timestamp
    /// @param currentTime The current block timestamp, which must be greater than or equal to the start time
    struct ComputeRewardAmountParams {
        uint256 totalRewardUnclaimed;
        uint160 totalSecondsClaimedX128;
        uint256 startTime;
        uint256 endTime;
        uint256 vestingPeriod;
        uint128 liquidity;
        uint160 secondsPerLiquidityInsideInitialX128;
        uint160 secondsPerLiquidityInsideX128;
        uint32 secondsInsideInitial;
        uint32 secondsInside;
        uint256 currentTime;
    }

    /// @notice Compute the amount of rewards owed given parameters of the incentive and stake
    /// @param params Params see struct
    /// @return reward The amount of rewards owed (considering vesting)
    /// @return maxReward The max amount of rewards owed 
    /// @return secondsInsideX128 The total liquidity seconds inside the position's range for the duration of the stake
    function computeRewardAmount(ComputeRewardAmountParams memory params) internal pure returns (uint256 reward, uint256 maxReward, uint160 secondsInsideX128) {
        // this should never be called before the start time
        assert(params.currentTime >= params.startTime);

        // this operation is safe, as the difference cannot be greater than 1/stake.liquidity
        secondsInsideX128 = (params.secondsPerLiquidityInsideX128 - params.secondsPerLiquidityInsideInitialX128) * params.liquidity;

        uint256 totalSecondsUnclaimedX128 =
            ((Math.max(params.endTime, params.currentTime) - params.startTime) << 128) - params.totalSecondsClaimedX128;

        maxReward = FullMath.mulDiv(params.totalRewardUnclaimed, secondsInsideX128, totalSecondsUnclaimedX128);

        if (params.vestingPeriod <= params.secondsInside - params.secondsInsideInitial) {
            reward = maxReward;
        } else {
            reward = maxReward * (params.secondsInside - params.secondsInsideInitial) / params.vestingPeriod;
        }
    }
}
