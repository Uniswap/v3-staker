// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import './interfaces/IUniswapV3Staker.sol';
import './libraries/IncentiveHelper.sol';

import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol';
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
import '@uniswap/v3-core/contracts/interfaces/IERC20Minimal.sol';
import '@uniswap/v3-periphery/contracts/libraries/PoolAddress.sol';
import '@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol';
import '@uniswap/v3-core/contracts/libraries/FixedPoint128.sol';
import '@uniswap/v3-core/contracts/libraries/FullMath.sol';
import '@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol';
import '@openzeppelin/contracts/math/Math.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

/**
@title Uniswap V3 canonical staking interface
*/
contract UniswapV3Staker is IUniswapV3Staker, IERC721Receiver, ReentrancyGuard {
    struct Incentive {
        uint128 totalRewardUnclaimed;
        uint160 totalSecondsClaimedX128;
        address rewardToken;
    }

    struct Deposit {
        address owner;
        uint32 numberOfStakes;
    }

    struct Stake {
        uint160 secondsPerLiquidityInitialX128;
        address pool;
    }

    IUniswapV3Factory public immutable factory;
    INonfungiblePositionManager public immutable nonfungiblePositionManager;

    /// @dev bytes32 refers to the return value of IncentiveHelper.getIncentiveId
    mapping(bytes32 => Incentive) public incentives;

    /// @dev deposits[tokenId] => Deposit
    mapping(uint256 => Deposit) public deposits;

    /// @dev stakes[tokenId][incentiveHash] => Stake
    mapping(uint256 => mapping(bytes32 => Stake)) public stakes;

    /// @param _factory the Uniswap V3 factory
    /// @param _nonfungiblePositionManager the NFT position manager contract address
    constructor(address _factory, address _nonfungiblePositionManager) {
        factory = IUniswapV3Factory(_factory);
        nonfungiblePositionManager = INonfungiblePositionManager(
            _nonfungiblePositionManager
        );
    }

    /// @inheritdoc IUniswapV3Staker
    function createIncentive(CreateIncentiveParams memory params)
        external
        override
    {
        require(
            params.claimDeadline >= params.endTime,
            'claimDeadline_not_gte_endTime'
        );
        require(params.endTime > params.startTime, 'endTime_not_gte_startTime');

        bytes32 key =
            IncentiveHelper.getIncentiveId(
                msg.sender,
                params.rewardToken,
                params.pool,
                params.startTime,
                params.endTime,
                params.claimDeadline
            );

        require(incentives[key].rewardToken == address(0), 'INCENTIVE_EXISTS');
        require(params.rewardToken != address(0), 'INVALID_REWARD_ADDRESS');
        require(params.totalReward > 0, 'INVALID_REWARD_AMOUNT');

        require(
            IERC20Minimal(params.rewardToken).transferFrom(
                msg.sender,
                address(this),
                params.totalReward
            ),
            'REWARD_TRANSFER_FAILED'
        );

        incentives[key] = Incentive(params.totalReward, 0, params.rewardToken);

        emit IncentiveCreated(
            params.rewardToken,
            params.pool,
            params.startTime,
            params.endTime,
            params.claimDeadline,
            params.totalReward
        );
    }

    /// @inheritdoc IUniswapV3Staker
    function endIncentive(EndIncentiveParams memory params)
        external
        override
        nonReentrant
    {
        require(
            block.timestamp > params.claimDeadline,
            'TIMESTAMP_LTE_CLAIMDEADLINE'
        );
        bytes32 key =
            IncentiveHelper.getIncentiveId(
                msg.sender,
                params.rewardToken,
                params.pool,
                params.startTime,
                params.endTime,
                params.claimDeadline
            );

        Incentive memory incentive = incentives[key];
        require(incentive.rewardToken != address(0), 'INVALID_INCENTIVE');
        delete incentives[key];

        // TODO: check for possible failures
        IERC20Minimal(params.rewardToken).transfer(
            msg.sender,
            incentive.totalRewardUnclaimed
        );

        emit IncentiveEnded(
            params.rewardToken,
            params.pool,
            params.startTime,
            params.endTime
        );
    }

    /// @inheritdoc IUniswapV3Staker
    function depositToken(uint256 tokenId) external override {
        nonfungiblePositionManager.safeTransferFrom(
            msg.sender,
            address(this),
            tokenId
        );
    }

    function onERC721Received(
        address,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external override returns (bytes4) {
        require(
            msg.sender == address(nonfungiblePositionManager),
            'uniswap v3 nft only'
        );

        deposits[tokenId] = Deposit(from, 0);
        emit TokenDeposited(tokenId, from);

        if (data.length > 0) {
          _stakeToken(abi.decode(data, (StakeTokenParams)));
        }
        return this.onERC721Received.selector;
    }

    /// @inheritdoc IUniswapV3Staker
    function withdrawToken(uint256 tokenId, address to) external override {
        Deposit memory deposit = deposits[tokenId];
        require(deposit.numberOfStakes == 0, 'NUMBER_OF_STAKES_NOT_ZERO');
        require(deposit.owner == msg.sender, 'NOT_YOUR_NFT');

        // TODO: do we have to check for a failure here? Also double-check
        // if safeTransferFrom is right.
        nonfungiblePositionManager.safeTransferFrom(address(this), to, tokenId);

        emit TokenWithdrawn(tokenId);
    }

    /// @inheritdoc IUniswapV3Staker
    function stakeToken(StakeTokenParams memory params) external override {
        require(
            deposits[params.tokenId].owner == msg.sender,
            'NOT_YOUR_DEPOSIT'
        );

        _stakeToken(params);
    }

    /// @inheritdoc IUniswapV3Staker
    function unstakeToken(UnstakeTokenParams memory params)
        external
        override
        nonReentrant
    {
        /*
        Check:
        * It checks that you are the owner of the Deposit,
        * It checks that there exists a Stake for the provided key
            (with non-zero secondsPerLiquidityInitialX128).
        */
        require(
            deposits[params.tokenId].owner == msg.sender,
            'NOT_YOUR_DEPOSIT'
        );

        /*
        Effects:
        deposit.numberOfStakes -= 1 - Make sure this decrements properly
        */
        deposits[params.tokenId].numberOfStakes -= 1;

        // TODO: Zero-out the Stake with that key.
        // stakes[tokenId]
        /*
        * It computes secondsPerLiquidityInPeriodX128 by computing
            secondsPerLiquidityInsideX128 using the Uniswap v3 core contract
            and subtracting secondsPerLiquidityInitialX128.
        */

        // TODO: make sure not null
        (
            address poolAddress,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        ) = _getPositionDetails(params.tokenId);

        require(poolAddress != address(0), 'INVALID_POSITION');

        IUniswapV3Pool pool = IUniswapV3Pool(poolAddress);

        (, uint160 secondsPerLiquidityInsideX128, ) =
            pool.snapshotCumulativesInside(tickLower, tickUpper);

        bytes32 incentiveId =
            IncentiveHelper.getIncentiveId(
                params.creator,
                params.rewardToken,
                poolAddress,
                params.startTime,
                params.endTime,
                params.claimDeadline
            );

        require(
            incentives[incentiveId].rewardToken != address(0),
            'BAD INCENTIVE'
        );

        uint160 secondsInPeriodX128 =
            (secondsPerLiquidityInsideX128 -
                stakes[params.tokenId][incentiveId]
                    .secondsPerLiquidityInitialX128) * liquidity;

        /*
        * It looks at the liquidity on the NFT itself and multiplies
            that by secondsPerLiquidityInRangeX96 to get secondsX96.
        * It computes reward rate for the Program and multiplies that
            by secondsX96 to get reward.
        * totalRewardsUnclaimed is decremented by reward. totalSecondsClaimed
            is incremented by seconds.
        */

        // TODO: check for overflows and integer types
        // uint160 secondsX96 = FullMath.mulDiv(secondsPerLiquidityInStakingPeriodX128, , denominator);
        //     SafeMath.mul(secondsPerLiquidityInStakingPeriodX128, liquidity);

        incentives[incentiveId].totalSecondsClaimedX128 += secondsInPeriodX128;

        uint160 totalSecondsUnclaimedX128 =
            uint32(Math.max(params.endTime, block.timestamp)) -
                params.startTime -
                incentives[incentiveId].totalSecondsClaimedX128;

        // This is probably wrong
        uint160 rewardRate =
            uint160(
                SafeMath.div(
                    incentives[incentiveId].totalRewardUnclaimed,
                    totalSecondsUnclaimedX128
                )
            );

        uint256 reward = SafeMath.mul(secondsInPeriodX128, rewardRate);

        // TODO: Before release: wrap this in try-catch properly
        // try {
        // TODO: incentive.rewardToken or rewardToken?

        IERC20Minimal(incentives[incentiveId].rewardToken).transfer(
            params.to,
            reward
        );
        // } catch {}
        emit TokenUnstaked(params.tokenId);
    }

    function _stakeToken(StakeTokenParams memory params) internal {
        (address poolAddress, int24 tickLower, int24 tickUpper, ) =
            _getPositionDetails(params.tokenId);
        IUniswapV3Pool pool = IUniswapV3Pool(poolAddress);

        bytes32 incentiveId =
            IncentiveHelper.getIncentiveId(
                params.creator,
                params.rewardToken,
                poolAddress,
                params.startTime,
                params.endTime,
                params.claimDeadline
            );

        (, uint160 secondsPerLiquidityInsideX128, ) =
            pool.snapshotCumulativesInside(tickLower, tickUpper);
        stakes[params.tokenId][incentiveId] = Stake(
            secondsPerLiquidityInsideX128,
            poolAddress
        );
        deposits[params.tokenId].numberOfStakes += 1;
        emit TokenStaked(params.tokenId);
    }

    function _getPositionDetails(uint256 tokenId)
        internal
        view
        returns (
            address,
            int24,
            int24,
            uint128
        )
    {
        (
            ,
            ,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            ,
            ,
            ,

        ) = nonfungiblePositionManager.positions(tokenId);

        PoolAddress.PoolKey memory poolKey =
            PoolAddress.getPoolKey(token0, token1, fee);

        // Could do this via factory.getPool or locally via PoolAddress.
        // TODO: what happens if this is null
        return (
            PoolAddress.computeAddress(address(factory), poolKey),
            tickLower,
            tickUpper,
            liquidity
        );
    }
}
