// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

library IncentiveHelper {
    /// @notice Calculate the key for a staking incentive
    /// @param creator The address that created this incentive
    /// @param rewardToken The address of the token being distributed as a reward
    /// @param pool The address of the Uniswap V3 pool
    /// @param startTime The time when the incentive begins
    /// @param endTime The time when rewards stop accruing
    /// @param claimDeadline -
    /// @return key Returns the identifier for the incentive
    function getIncentiveId(
        address creator,
        address rewardToken,
        address pool,
        uint32 startTime,
        uint32 endTime,
        uint32 claimDeadline
    ) internal pure returns (bytes32 key) {
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
