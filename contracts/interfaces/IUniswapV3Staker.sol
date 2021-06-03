// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol';
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
import '@uniswap/v3-core/contracts/interfaces/IERC20Minimal.sol';

import '@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol';
import '../libraries/IncentiveId.sol';

/// @title Uniswap V3 Staker Interface
/// @notice Allows staking nonfungible liquidity tokens in exchange for reward tokens
interface IUniswapV3Staker {
    /// @notice The Uniswap V3 Factory
    function factory() external view returns (IUniswapV3Factory);

    /// @notice The nonfungible position manager with which this staking contract is compatible
    function nonfungiblePositionManager()
        external
        view
        returns (INonfungiblePositionManager);

    /// @notice Represents a staking incentive
    struct Incentive {
        uint128 totalRewardUnclaimed;
        uint160 totalSecondsClaimedX128;
    }

    /// @notice Represents a staking incentive
    /// @param incentiveId The ID of the incentive computed from its parameters
    /// @return totalRewardUnclaimed The amount of reward token not yet claimed by users
    /// @return totalSecondsClaimedX128 Total liquidity-seconds claimed, represented as a UQ32.128
    function incentives(bytes32 incentiveId)
        external
        view
        returns (uint128 totalRewardUnclaimed, uint160 totalSecondsClaimedX128);

    /// @notice Represents the deposit of a liquidity NFT
    struct Deposit {
        address owner;
        uint96 numberOfStakes;
    }

    /// @notice Returns information about a deposited NFT
    /// @return owner The owner of the deposited NFT
    /// @return numberOfStakes Counter of how many incentives for which the liquidity is staked
    function deposits(uint256 tokenId)
        external
        view
        returns (address owner, uint96 numberOfStakes);

    /// @notice Represents a staked liquidity NFT
    struct Stake {
        uint160 secondsPerLiquidityInitialX128;
        uint128 liquidity;
    }

    /// @notice Returns information about a staked liquidity NFT
    /// @param tokenId The ID of the staked token
    /// @param incentiveId The ID of the incentive for which the token is staked
    /// @return secondsPerLiquidityInitialX128 secondsPerLiquidity represented as a UQ32.128
    /// @return liquidity The amount of liquidity in the NFT as of the last time the rewards were computed
    function stakes(uint256 tokenId, bytes32 incentiveId)
        external
        view
        returns (uint160 secondsPerLiquidityInitialX128, uint128 liquidity);

    /// @notice Returns amounts of reward tokens owed to a given address according to the last time all stakes were updated
    /// @param rewardToken The token for which to check rewards
    /// @param owner The owner for which the rewards owed are checked
    /// @return rewardsOwed The amount of the reward token claimable by the owner
    function rewards(IERC20Minimal rewardToken, address owner)
        external
        view
        returns (uint256 rewardsOwed);

    /// @notice Creates a new liquidity mining incentive program
    /// @param key Details of the incentive to create
    /// @param reward The amount of reward tokens to be distributed
    function createIncentive(IncentiveId.Key memory key, uint128 reward)
        external;

    /// @notice Ends an incentive whose claimDeadline has passed.
    /// @param key Details of the incentive to end
    function endIncentive(IncentiveId.Key memory key) external;

    /// @notice Withdraws a Uniswap V3 LP token `tokenId` from this contract to the recipient `to`
    /// @param tokenId The unique identifier of an Uniswap V3 LP token
    /// @param to The address where the LP token will be sent
    function withdrawToken(uint256 tokenId, address to) external;

    /// @param rewardToken The token being distributed as a reward
    /// @param tokenId The ID of the staked NFT
    /// @param startTime The time when the incentive program begins
    /// @param endTime The time when rewards stop accruing
    /// @param claimDeadline Time after which anoyne can cause unaccounted-for rewards to be sent to the beneficiary
    /// @param beneficiary The address which receives any remaining reward tokens after the claimDeadline
    struct UpdateStakeParams {
        IERC20Minimal rewardToken;
        uint256 tokenId;
        uint256 startTime;
        uint256 endTime;
        uint256 claimDeadline;
        address beneficiary;
    }

    /// @notice Stakes a Uniswap V3 LP token
    function stakeToken(UpdateStakeParams memory params) external;

    /// @notice Unstakes a Uniswap V3 LP token
    function unstakeToken(UpdateStakeParams memory params) external;

    /// @notice Transfers accrued `rewardToken` rewards from the contarct to the recipient `to`
    /// @param rewardToken The token being distributed as a reward
    /// @param to The address where claimed rewards will be sent to
    function claimReward(IERC20Minimal rewardToken, address to) external;

    /// @notice Event emitted when a liquidity mining incentive has been created
    /// @param rewardToken The token being distributed as a reward
    /// @param pool The Uniswap V3 pool
    /// @param startTime The time when the incentive program begins
    /// @param endTime The time when rewards stop accruing
    /// @param claimDeadline Time after which anoyne can cause unaccounted-for rewards to be sent to the beneficiary
    /// @param beneficiary The address which receives any remaining reward tokens after the claimDeadline
    /// @param reward The amount of reward tokens to be distributed
    event IncentiveCreated(
        IERC20Minimal indexed rewardToken,
        IUniswapV3Pool indexed pool,
        uint256 startTime,
        uint256 endTime,
        uint256 claimDeadline,
        address beneficiary,
        uint128 reward
    );

    /// @notice Event that can be emitted when a liquidity mining incentive has ended
    /// @param incentiveId The incentive which is ending
    /// @param refund The amount of reward tokens refunded
    event IncentiveEnded(bytes32 indexed incentiveId, uint128 refund);

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
}
