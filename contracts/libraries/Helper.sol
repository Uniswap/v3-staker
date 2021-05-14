// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

library Helper {
    /// @notice Calculate the key for a staking incentive
    /// @param creator Address that created this incentive
    /// @param rewardToken Token being distributed as a reward
    /// @param pool The UniswapV3 pool this incentive is on
    /// @param startTime When the incentive begins
    /// @param endTime When the incentive ends
    /// @param claimDeadline Time by which incentive rewards must be claimed
    function getIncentiveId(
        address creator,
        address rewardToken,
        address pool,
        uint32 startTime,
        uint32 endTime,
        uint32 claimDeadline
    ) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    creator,
                    rewardToken,
                    pool,
                    startTime,
                    endTime,
                    claimDeadline
                )
            );
    }
}
