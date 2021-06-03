// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol';
import '@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol';

/// @title Uniswap V3 Staker Interface
/// @notice Allows staking nonfungible liquidity tokens in exchange for reward tokens
interface IUniswapV3Staker {
    /// @notice Represents a staking incentive
    /// @param totalRewardUnclaimed The amount of reward token not yet claimed by users
    /// @param totalSecondsClaimedX128 Total liquidity-seconds claimed, represented as a UQ32.128
    /// @param rewardToken The address of the token being distributed as a reward
    struct Incentive {
        uint128 totalRewardUnclaimed;
        uint160 totalSecondsClaimedX128;
    }

    /// @notice Represents the deposit of a liquidity NFT
    /// @param owner The owner of the LP token
    /// @param numberOfStakes Counter of how many incentives for which the liquidity is staked
    struct Deposit {
        address owner;
        uint96 numberOfStakes;
    }

    /// @notice Represents a staked liquidity NFT
    /// @param secondsPerLiquidityInitialX128 secondsPerLiquidity represented as a UQ32.128
    /// @param liquidity The amount of liquidity staked
    /// @param exists Used to for truthiness checks
    struct Stake {
        uint160 secondsPerLiquidityInitialX128;
        uint128 liquidity;
    }

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
        uint64 startTime,
        uint64 endTime,
        uint64 claimDeadline,
        uint128 totalReward
    );

    /// @notice Event that can be emitted when a liquidity mining incentive has ended
    /// @param incentiveId The incentive which is ending
    /// @param refund The amount of reward tokens refunded
    event IncentiveEnded(bytes32 indexed incentiveId, uint256 refund);

    /// @notice Event emitted when a Uniswap V3 LP token has been deposited
    /// @param tokenId The unique identifier of an Uniswap V3 LP token
    /// @param owner The owner of the LP token
    event TokenDeposited(uint256 indexed tokenId, address indexed owner);

    /// @notice Event emitted when a Uniswap V3 LP token has been withdrawn
    /// @param tokenId The unique identifier of an Uniswap V3 LP token
    /// @param to The address that the token will be withdawn to
    event TokenWithdrawn(uint256 indexed tokenId, address to);

    /// @notice Event emitted when a Uniswap V3 LP token has been staked
    /// @param tokenId The unique identifier of an Uniswap V3 LP token
    /// @param liquidity The amount of liquidity staked
    /// @param incentiveId The incentive in which the token is staking
    event TokenStaked(
        uint256 indexed tokenId,
        uint128 liquidity,
        bytes32 indexed incentiveId
    );

    /// @notice Event emitted when a Uniswap V3 LP token has been unstaked
    /// @param tokenId The unique identifier of an Uniswap V3 LP token
    /// @param incentiveId The incentive in which the token is staking
    event TokenUnstaked(uint256 indexed tokenId, bytes32 indexed incentiveId);

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
        address rewardToken;
        address pool;
        uint64 startTime;
        uint64 endTime;
        uint64 claimDeadline;
        uint128 totalReward;
    }

    /// @notice Returns the address of the Uniswap V3 Factory
    function factory() external view returns (IUniswapV3Factory);

    /// @notice Returns the nonfungible position manager with which this staking contract is compatible
    function nonfungiblePositionManager()
        external
        view
        returns (INonfungiblePositionManager);

    /// @notice Creates a new liquidity mining incentive program.
    function createIncentive(CreateIncentiveParams memory params) external;

    /// @param creator The address that created this incentive
    /// @param pool The address of the Uniswap V3 pool
    /// @param rewardToken The address of the token being distributed as a reward
    /// @param startTime The time when the incentive program begins
    /// @param endTime The time when rewards stop accruing
    /// @param claimDeadline Time after which LPs can no longer claim rewards (and incentiveCreator can end the incentive and receive unclaimed rewards)
    struct EndIncentiveParams {
        address creator;
        address rewardToken;
        address pool;
        uint64 startTime;
        uint64 endTime;
        uint64 claimDeadline;
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
    struct UpdateStakeParams {
        address creator;
        address rewardToken;
        uint256 tokenId;
        uint64 startTime;
        uint64 endTime;
        uint64 claimDeadline;
    }

    /// @notice Stakes a Uniswap V3 LP token
    function stakeToken(UpdateStakeParams memory params) external;

    /// @notice Unstakes a Uniswap V3 LP token
    function unstakeToken(UpdateStakeParams memory params) external;

    /// @notice Transfers accrued `rewardToken` rewards from the contarct to the recipient `to`
    /// @param rewardToken The address of the token being distributed as a reward
    /// @param to The address where claimed rewards will be sent to
    function claimReward(address rewardToken, address to) external;
}
