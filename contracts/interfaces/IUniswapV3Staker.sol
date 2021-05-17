// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

interface IUniswapV3Staker {
    event IncentiveCreated(
        address indexed rewardToken,
        address indexed pool,
        uint32 startTime,
        uint32 endTime,
        uint32 claimDeadline,
        uint128 indexed totalReward
    );
    event IncentiveEnded(
        address indexed rewardToken,
        address indexed pool,
        uint32 startTime,
        uint32 endTime
    );

    event TokenDeposited(uint256 tokenId, address indexed owner);
    event TokenWithdrawn(uint256 tokenId);

    event TokenStaked(uint256 tokenId);
    event TokenUnstaked(uint256 tokenId);

    /**
    @param rewardToken The token being distributed as a reward
    @param pool The Uniswap V3 pool
    @param startTime When rewards should begin accruing
    @param endTime When rewards stop accruing
    @param claimDeadline When program should expire
    @param totalReward Total reward to be distributed
    */

    struct CreateIncentiveParams {
        address pool;
        address rewardToken;
        uint128 totalReward;
        uint32 startTime;
        uint32 endTime;
        uint32 claimDeadline;
    }

    /**
    @notice Creates a new liquidity mining incentive program.
    */
    function createIncentive(CreateIncentiveParams memory params) external;

    struct EndIncentiveParams {
        address pool;
        address rewardToken;
        uint32 claimDeadline;
        uint32 endTime;
        uint32 startTime;
    }

    function depositToken(uint256 tokenId) external;

    function withdrawToken(uint256 tokenId, address to) external;

    /**
    @notice Deletes an incentive whose claimDeadline has passed.
    */
    function endIncentive(EndIncentiveParams memory params) external;

    struct StakeTokenParams {
        address creator;
        address rewardToken;
        uint256 tokenId;
        uint32 startTime;
        uint32 endTime;
        uint32 claimDeadline;
    }

    function stakeToken(StakeTokenParams memory params) external;

    struct UnstakeTokenParams {
        address creator;
        address rewardToken;
        uint256 tokenId;
        uint32 startTime;
        uint32 endTime;
        uint32 claimDeadline;
        address to;
    }

    function unstakeToken(UnstakeTokenParams memory params) external;
}
