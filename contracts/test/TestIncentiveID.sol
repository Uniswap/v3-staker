// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;

import '../libraries/IncentiveHelper.sol';

contract TestIncentiveID {
    function getIncentiveId(
        address rewardToken,
        address pool,
        uint256 startTime,
        uint256 endTime,
        uint256 claimDeadline,
        address beneficiary
    ) public pure returns (bytes32) {
        return
            IncentiveHelper.getIncentiveId(
                rewardToken,
                pool,
                startTime,
                endTime,
                claimDeadline,
                beneficiary
            );
    }
}
