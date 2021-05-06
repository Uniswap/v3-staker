// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.7.6;

import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol';
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
import '@uniswap/v3-core/contracts/interfaces/IERC20Minimal.sol';

import '@uniswap/v3-periphery/contracts/libraries/PoolAddress.sol';
import '@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol';

/**
@title Uniswap V3 canonical staking interface
@author Omar Bohsali <omar.bohsali@gmail.com>
@author Dan Robinson <dan@paradigm.xyz>
*/
contract UniswapV3Staker {
    // TODO(DEV): Make sure these are correct.
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    address public immutable creator;
    IUniswapV3Factory public immutable factory;
    INonFungiblePositionManager public immutable nonFungiblePositionManager;

    /// @param _factory the Uniswap V3 factory
    /// @param _nonFungiblePositionManager the NFT position manager contract address
    constructor(address _factory, address _nonFungiblePositionManager) {
        factory = IUniswapV3Factor(_factory);
        nonFungiblePositionManager = INonFungiblePositionManager(
            _nonFungiblePositionManager
        );
        creator = msg.sender;
    }

    //
    // Part 1: Incentives
    //

    /// @notice Represents a staking incentive.
    struct Incentive {
        uint128 totalRewardUnclaimed;
        uint160 totalSecondsClaimedX128;
        uint32 endTime;
        // TODO: Had to add incentiveId
        address rewardToken;
    }

    /// @notice Calculate the key for a staking incentive
    /// @param creator Address that created this incentive
    /// @param rewardToken Token being distributed as a reward
    /// @param pair The UniswapV3 pair this incentive is on
    /// @param startTime When the incentive begins
    /// @param claimDeadline Time by which incentive rewards must be claimed
    function _getIncentiveId(
        address creator,
        address rewardToken,
        address pair,
        uint32 startTime,
        uint32 claimDeadline
    ) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(creator, rewardToken, pair, startTime, claimDeadline)
            );
    }

    /// @notice bytes32 refers to the return value of _getIncentiveId
    mapping(bytes32 => Incentive) public incentives;

    event IncentiveCreated(
        address indexed rewardToken,
        address indexed pair,
        address startTime,
        address endTime,
        uint32 claimDeadline,
        uint128 indexed totalReward
    );

    /**
    @notice Creates a new liquidity mining incentive program.
    @param rewardToken The token being distributed as a reward
    @param pair The Uniswap V3 pair
    @param startTime When rewards should begin accruing
    @param endTime When rewards stop accruing
    @param claimDeadline
    @param totalReward Total reward to be distributed
    */
    function create(
        address rewardToken,
        address pair,
        uint32 startTime,
        uint32 endTime,
        uint32 claimDeadline,
        uint128 totalReward
    ) {
        /*
        Check:
        * Make sure this incentive does not already exist
        * claimDeadline must be no earlier than endTime, which must be later than startTime
        * Possibly: check that pair is a uniswap v3 pair?

        Effects:
        * Transfers totalRewardsUnclaimed of token from the caller to itself

        Interactions:
        * emit IncentiveCreated()
        */
        require(claimDeadline >= endTime, 'claimDeadline_not_gte_endTime');
        require(endTime < startTime, 'endTime_not_gte_startTime');

        // TODO: Do I need any security checks around msg.sender?
        bytes32 memory key =
            _getIncentiveId(
                msg.sender,
                rewardToken,
                pair,
                startTime,
                claimDeadline
            );

        // Check: this incentive does not already exist
        require(!incentives[key], 'INCENTIVE_EXISTS');

        // Check + Effect: transfer reward token
        require(
            IERC20Minimal(rewardToken).transferFrom(
                msg.sender,
                address(this),
                totalReward
            ),
            'REWARD_TRANSFER_FAILED'
        );

        incentives[key] = Incentive(totalReward, 0, endTime, rewardToken);

        emit IncentiveCreated(
            rewardToken,
            pair,
            startTime,
            endTime,
            claimDeadline,
            totalReward
        );
    }

    /**
    @notice Deletes an incentive whose claimDeadline has passed.
    */
    function end(
        address rewardToken,
        address pair,
        uint32 startTime,
        uint32 claimDeadline
    ) public {
        /*
        Check:
        * Only callable by creator (msg.sender is hashed)
        * Only works when claimDeadline has passed

        Effects:
        * Transfer totalRewardsUnclaimed of token back to creator
        * Delete Incentive

        Interaction:
        */
        require(block.timestamp > claimDeadline, 'TIMESTAMP_LTE_CLAIMDEADLINE');
        bytes32 memory key =
            _getIncentiveId(
                msg.sender,
                rewardToken,
                pair,
                startTime,
                claimDeadline
            );

        Incentive memory incentive = incentives[key];
        require(incentives[key], 'INVALID_INCENTIVE');

        // TODO: double-check .transfer

        IERC20Minimal.transfer(msg.sender, incentive.totalRewardUnclaimed);
        // TODO: Thinking if this should go before or after the transferFrom, maybe it doesnt matter.
        delete incentives[key];
    }

    //
    // Part 2: Deposits, Withdrawals
    //

    struct Deposit {
        address owner;
        uint32 numberOfStakes;
    }

    /// @notice deposits[tokenId] => Deposit
    mapping(uint256 => Deposit) deposits;

    event Deposited(uint256 tokenId);

    function deposit(uint256 tokenId) public {
        // TODO: Make sure the transfer succeeds and is a uniswap erc721
        require(
            nonFungiblePositionManager.safeTransferFrom(
                msg.sender,
                address(this),
                tokenId
            ),
            'ERC721_TRANSFER_FAILED'
        );
        deposits[tokenId] = Deposit(msg.sender, 0);
        emit Deposited(tokenId);
    }

    event Withdrawal(uint256 tokenId);

    function withdraw(uint256 tokenId, address to) {
        require(
            deposits[tokenId].numberOfStakes == 0,
            'NUMBER_OF_STAKES_NOT_ZERO'
        );

        // TODO: do we have to check for a failure here?
        nonFungiblePositionManager.transfer(to, tokenId);

        emit Withdrawal(tokenId);
    }

    //
    // Part 3: Staking, Unstaking
    //

    struct Stake {
        uint160 secondsPerLiquidityInitialX128;
        address pool;
    }

    /// @notice stakes[tokenId][incentiveHash] => Stake
    mapping(uint256 => mapping(bytes32 => Stake)) stakes;

    function _getPositionDetails(uint256 tokenId)
        internal
        pure
        returns (
            address,
            int24,
            int24,
            uint128
        )
    {
        // TODO: can I destruct like this?
        (
            ,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        ) = nonFungiblePositionManager.positions(tokenId);

        PoolAddress.PoolKey memory poolKey =
            PoolAddress.getPoolKey(token0, token1, fee);

        // Could do this via factory.getPool or locally via PoolAddress.
        // TODO: what happens if this is null
        return (
            PoolAddress.computeAddress(factory, poolKey),
            tickLower,
            tickUpper,
            liquidity
        );
    }

    function stake(
        uint256 tokenId,
        address creator,
        address rewardToken,
        uint32 startTime,
        uint32 endTime,
        uint32 claimDeadline
    ) {
        /*
        It then creates a stake in the stakes mapping. stakes is
        a mapping from th token ID and incentive ID to information about that stake.

        Check:
        * Make sure you are the owner

        Effects:
        * increments numberOfStakes
        */

        /*
        This looks up your Deposit, checks that you are the owner
        */
        require(deposits[tokenId].owner == msg.sender, 'NOT_YOUR_DEPOSIT');

        // TODO: Make sure destructuring and ignoring liquidity correctly
        (address poolAddress, int24 tickLower, int24 tickUpper, ) =
            _getPositionDetails(tokenId);
        IUniswapV3Pool pool = IUniswapV3Pool(poolAddress);

        bytes32 memory incentiveId =
            _getIncentiveId(
                creator,
                rewardToken,
                pool,
                startTime,
                claimDeadline
            );

        (
            int56 tickCumulativeInside,
            uint160 secondsPerLiquidityInsideX128,
            uint32 secondsInside
        ) = pool.snapshotCumulativesInside(tickLower, tickUpper);

        stakes[tokenId][incentiveId] = Stake(
            secondsPerLiquidityInsideX128,
            address(pool)
        );

        // TODO: make sure this writes to the struct
        deposits[tokenId].numberOfStakes += 1;
        // TODO: emit Stake event
    }

    function unstake(
        uint256 tokenId,
        address creator,
        address token,
        uint32 startTime,
        uint32 endTime,
        uint32 claimDeadline,
        address to
    ) {
        /*
        Check:
        * It checks that you are the owner of the Deposit,
        * It checks that there exists a Stake for the provided key
            (with non-zero secondsPerLiquidityInitialX128).
        */
        require(deposits[tokenId].owner == msg.sender, 'NOT_YOUR_DEPOSIT');

        /*
        Effects:
        deposit.numberOfStakes -= 1 - Make sure this decrements properly
        */
        deposits[tokenId].numberOfStakes -= 1;

        // TODO: Zero-out the Stake with that key.
        // stakes[tokenId]

        // Pool.snapshotCumulativesInside

        /*
        * It computes secondsPerLiquidityInPeriodX96 by computing
            secondsPerLiquidityInRangeX96 using the Uniswap v3 core contract
            and subtracting secondsPerLiquidityInRangeInitialX96.
        */
        uint160 secondsPerLiquidityInPeriodX96;

        // TODO: make sure not null
        (
            address poolAddress,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        ) = _getPositionDetails(tokenId);
        IUniswapV3Pool pool = IUniswapV3Pool(PoolAddress);

        (
            int56 tickCumulativeInside,
            uint160 secondsPerLiquidityInsideX128,
            uint32 secondsInside
        ) = pool.snapshotCumulativesInside(tickLower, tickUpper);

        bytes32 memory incentiveId =
            _getIncentiveId(
                creator,
                rewardToken,
                pool,
                startTime,
                claimDeadline
            );
        uint160 secondsPerLiquidityInStakingPeriodX128 =
            secondsPerLiquidityInsideX128 - stakes[tokenId][incentiveId];

        /*
        * It looks at the liquidity on the NFT itself and multiplies
            that by secondsPerLiquidityInRangeX96 to get secondsX96.
        * It computes reward rate for the Program and multiplies that
            by secondsX96 to get reward.
        * totalRewardsUnclaimed is decremented by reward. totalSecondsClaimed
            is incremented by seconds.
        */

        // TODO: check for overflows
        uint160 secondsX96 =
            SafeMath.mul(secondsPerLiquidityInStakingPeriodX128, liquidity);

        Incentive incentive = incentives[incentiveId];
        incentive.totalSecondsClaimed += secondsX96;
        uint256 reward = SafeMath.mul(secondsX96, rewardRate(incentiveId));

        // TODO: Before release: wrap this in try-catch properly
        // try {
        IERC20(incentive.rewardToken).transfer(to, reward);
        // } catch {}

        // TODO: emit unstake event
    }

    function rewardRate(bytes32 incentiveId) private returns (uint256) {
        // TODO: Make sure this is the right return type
        // totalRewardUnclaimed / totalSecondsUnclaimed
        Incentive incentive = incentives[incentiveId];

        uint32 totalSecondsUnclaimed =
            max(endTime, block.timestamp) -
                startTime -
                incentive.totalSecondsClaimed;

        return
            SafeMath.div(incentive.totalRewardUnclaimed, totalSecondsUnclaimed);
    }
}
