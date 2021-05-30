// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

interface IUniswapV3Staker {
    /// @notice Event emitted when a liquidity mining incentive has been created
    /// @param creator The address that created this incentive
    /// @param rewardToken The address of the token being distributed as a reward
    /// @param pool The address of the Uniswap V3 pool
    /// @param endTime The time when rewards stop accruing
    /// @param claimDeadline Time after which LPs can no longer claim rewards (and incentiveCreator can end the incentive and receive unclaimed rewards)
    /// @param totalReward The total amount of reward tokens to be distributed
    event IncentiveCreated(
        address creator,
        address indexed rewardToken,
        address indexed pool,
        uint32 startTime,
        uint32 endTime,
        uint32 claimDeadline,
        uint128 totalReward
    );

    /// @notice Event emitted when a liquidity mining incentive has ended
    /// @param creator The address that created this incentive
    /// @param rewardToken The address of the token being distributed as a reward
    /// @param pool The address of the Uniswap V3 pool
    /// @param startTime The time when the incentive program begins
    /// @param endTime The time when rewards stop accruing
    /// @param claimDeadline Time after which LPs can no longer claim rewards (and incentiveCreator can end the incentive and receive unclaimed rewards)
    event IncentiveEnded(
        address creator,
        address indexed rewardToken,
        address indexed pool,
        uint32 startTime,
        uint32 endTime,
        uint43 claimDeadline
    );

    /// @notice Event emitted when a Uniswap V3 LP token has been deposited
    /// @param tokenId The unique identifier of an Uniswap V3 LP token
    /// @param owner The owner of the LP token
    event TokenDeposited(uint256 tokenId, address indexed owner);

    /// @notice Event emitted when a Uniswap V3 LP token has been withdrawn
    /// @param tokenId The unique identifier of an Uniswap V3 LP token
    /// @param to The address that the token will be withdawn to
    event TokenWithdrawn(uint256 tokenId, address to);

    /// @notice Event emitted when a Uniswap V3 LP token has been staked
    /// @param tokenId The unique identifier of an Uniswap V3 LP token
    /// @param liquidity The amount of liquidity staked
    /// @param incentiveId The incentive in which the token is staking 
    event TokenStaked(uint256 tokenId, uint128 liquidity, bytes32 incentiveId);

    /// @notice Event emitted when a Uniswap V3 LP token has been unstaked
    /// @param tokenId The unique identifier of an Uniswap V3 LP token
    /// @param incentiveId The incentive in which the token is staking
    event TokenUnstaked(uint256 tokenId, bytes32 incentiveId);

    /// @notice Event emitted when a reward token has been claimed
    /// @param to The address where claimed rewards were sent to
    /// @param reward The amount of reward tokens claimed
    event RewardClaimed(address indexed to, uint256 reward);

    /// @param rewardToken The address of the token being distributed as a reward
    /// @param pool The address of the Uniswap V3 pool
    /// @param startTime The time when the incentive program begins
    /// @param endTime The time when rewards stop accruing
    /// @param claimDeadline Time after which LPs can no longer claim rewards (and incentiveCreator can end the incentive and receive unclaimed rewards)
    /// @param totalReward The total amount of reward tokens to be distributed
    struct CreateIncentiveParams {
        address pool;
        address rewardToken;
        uint128 totalReward;
        uint32 startTime;
        uint32 endTime;
        uint32 claimDeadline;
    }

    /// @notice Creates a new liquidity mining incentive program.
    function createIncentive(CreateIncentiveParams memory params) external;

    /// @param pool The address of the Uniswap V3 pool
    /// @param rewardToken The address of the token being distributed as a reward
    /// @param startTime The time when the incentive program begins
    /// @param endTime The time when rewards stop accruing
    /// @param claimDeadline
    struct EndIncentiveParams {
        address pool;
        address rewardToken;
        uint32 claimDeadline;
        uint32 endTime;
        uint32 startTime;
    }

    /// @notice Deposits a Uniswap V3 LP token `tokenId` from `msg.sender` to this contract
    /// @param tokenId The unique identifier of an Uniswap V3 LP token
    function depositToken(uint256 tokenId) external;

    /// @notice Withdraws a Uniswap V3 LP token `tokenId` from this contract to the recipient `to`
    /// @param tokenId The unique identifier of an Uniswap V3 LP token
    /// @param to The address where the LP token will be sent
    function withdrawToken(uint256 tokenId, address to) external;

    /// @notice Deletes an incentive whose claimDeadline has passed.
    function endIncentive(EndIncentiveParams memory params) external;

    /// @param creator The address that created this incentive
    /// @param rewardToken The address of the token being distributed as a reward
    /// @param tokenId The address of the Uniswap V3 pool
    /// @param startTime The time when the incentive program begins
    /// @param endTime The time when rewards stop accruing
    /// @param claimDeadline Time after which LPs can no longer claim rewards (and incentiveCreator can end the incentive and receive unclaimed rewards)
    struct StakeTokenParams {
        address creator;
        address rewardToken;
        uint256 tokenId;
        uint32 startTime;
        uint32 endTime;
        uint32 claimDeadline;
    }

    /// @notice Stakes a Uniswap V3 LP token
    function stakeToken(StakeTokenParams memory params) external;

    /// @param creator The address that created this incentive
    /// @param rewardToken The address of the token being distributed as a reward
    /// @param tokenId The address of the Uniswap V3 pool
    /// @param startTime The time when the incentive program begins
    /// @param endTime The time when rewards stop accruing
    /// @param claimDeadline Time after which LPs can no longer claim rewards (and incentiveCreator can end the incentive and receive unclaimed rewards)
    struct UnstakeTokenParams {
        address creator;
        address rewardToken;
        uint256 tokenId;
        uint32 startTime;
        uint32 endTime;
        uint32 claimDeadline;
    }

    /// @notice Unstakes a Uniswap V3 LP token
    function unstakeToken(UnstakeTokenParams memory params) external;

    /// @notice Transfers accrued `rewardToken` rewards from the contarct to the recipient `to`
    /// @param rewardToken The address of the token being distributed as a reward
    /// @param to The address where claimed rewards will be sent to
    function claimReward(address rewardToken, address to) external;
}
