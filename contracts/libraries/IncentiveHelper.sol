// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;

library IncentiveHelper {
    /// @notice Calculate the key for a staking incentive
    /// @param rewardToken The address of the token being distributed as a reward
    /// @param pool The address of the Uniswap V3 pool
    /// @param startTime The time when the incentive program begins
    /// @param endTime The time when rewards stop accruing
    /// @param claimDeadline Time after which anoyne can cause unaccounted-for rewards to be sent to the beneficiary
    /// @param beneficiary The address which receives any remaining reward tokens after the claimDeadline
    /// @return incentiveId The identifier for the incentive
    function getIncentiveId(
        address rewardToken,
        address pool,
        uint256 startTime,
        uint256 endTime,
        uint256 claimDeadline,
        address beneficiary
    ) internal pure returns (bytes32 incentiveId) {
        return
            keccak256(
                abi.encode(
                    rewardToken,
                    pool,
                    startTime,
                    endTime,
                    claimDeadline,
                    beneficiary
                )
            );
    }
}
