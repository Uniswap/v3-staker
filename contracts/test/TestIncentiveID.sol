// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
import '../libraries/IncentiveHelper.sol';

/// @dev Test contract for getIncentiveId
contract TestIncentiveID {
    function getIncentiveId(
        address creator,
        address rewardToken,
        address pool,
        uint32 startTime,
        uint32 endTime,
        uint32 claimDeadline
    ) public pure returns (bytes32) {
        return
            IncentiveHelper.getIncentiveId(
                creator,
                rewardToken,
                pool,
                startTime,
                endTime,
                claimDeadline
            );
    }
}
