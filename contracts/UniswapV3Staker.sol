// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import './interfaces/IUniswapV3Staker.sol';
import './libraries/IncentiveHelper.sol';
import './base/BlockTimestamp.sol';

import '@uniswap/v3-core/contracts/libraries/FixedPoint96.sol';
import '@uniswap/v3-core/contracts/libraries/FixedPoint128.sol';
import '@uniswap/v3-core/contracts/libraries/FullMath.sol';
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol';
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
import '@uniswap/v3-core/contracts/interfaces/IERC20Minimal.sol';

import '@uniswap/v3-periphery/contracts/libraries/PoolAddress.sol';
import '@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol';
import '@uniswap/v3-periphery/contracts/base/Multicall.sol';

import '@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol';
import '@openzeppelin/contracts/math/Math.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

/**
@title Uniswap V3 canonical staking interface
*/
contract UniswapV3Staker is
    BlockTimestamp,
    IUniswapV3Staker,
    IERC721Receiver,
    ReentrancyGuard,
    Multicall
{
    struct Incentive {
        uint128 totalRewardUnclaimed;
        uint160 totalSecondsClaimedX128;
        address rewardToken;
    }

    struct Deposit {
        address owner;
        uint128 liquidity;
        uint32 numberOfStakes;
    }

    struct Stake {
        uint160 secondsPerLiquidityInitialX128;
        bool exists;
    }

    IUniswapV3Factory public immutable factory;
    INonfungiblePositionManager public immutable nonfungiblePositionManager;

    /// @dev bytes32 refers to the return value of IncentiveHelper.getIncentiveId
    mapping(bytes32 => Incentive) public incentives;

    /// @dev deposits[tokenId] => Deposit
    mapping(uint256 => Deposit) public deposits;

    /// @dev stakes[tokenId][incentiveHash] => Stake
    mapping(uint256 => mapping(bytes32 => Stake)) public stakes;

    /// @dev rewards[rewardToken][msg.sender] => uint128
    mapping(address => mapping(address => uint128)) public rewards;

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
            _blockTimestamp() > params.claimDeadline,
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

        (, , , uint128 liquidity) = _getPositionDetails(tokenId);
        deposits[tokenId] = Deposit(from, liquidity, 0);
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

        nonfungiblePositionManager.safeTransferFrom(address(this), to, tokenId);

        emit TokenWithdrawn(tokenId, to);
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
        require(
            deposits[params.tokenId].owner == msg.sender,
            'NOT_YOUR_DEPOSIT'
        );

        deposits[params.tokenId].numberOfStakes -= 1;

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

        Incentive memory incentive = incentives[incentiveId];
        Stake memory stake = stakes[params.tokenId][incentiveId];

        require(stake.exists == true, 'Stake does not exist');

        require(incentive.rewardToken != address(0), 'BAD INCENTIVE');

        uint160 secondsInPeriodX128 =
            uint160(
                SafeMath.mul(
                    secondsPerLiquidityInsideX128 -
                        stake.secondsPerLiquidityInitialX128,
                    liquidity
                )
            );

        // TODO: double-check for overflow risk here
        uint160 totalSecondsUnclaimedX128 =
            uint160(
                SafeMath.mul(
                    Math.max(params.endTime, _blockTimestamp()) -
                        params.startTime,
                    FixedPoint128.Q128
                ) - incentive.totalSecondsClaimedX128
            );

        // TODO: Make sure this truncates and not rounds up
        uint256 rewardRate =
            FullMath.mulDiv(
                incentive.totalRewardUnclaimed,
                FixedPoint128.Q128,
                totalSecondsUnclaimedX128
            );

        // TODO: make sure casting is ok here
        uint128 reward =
            uint128(
                FullMath.mulDiv(
                    secondsInPeriodX128,
                    rewardRate,
                    FixedPoint128.Q128
                )
            );

        incentives[incentiveId].totalSecondsClaimedX128 += secondsInPeriodX128;

        // TODO: is SafeMath necessary here? Could we do just a subtraction?
        incentives[incentiveId].totalRewardUnclaimed = uint128(
            SafeMath.sub(incentive.totalRewardUnclaimed, reward)
        );

        rewards[incentive.rewardToken][msg.sender] = uint128(
            SafeMath.add(rewards[incentive.rewardToken][msg.sender], reward)
        );

        emit TokenUnstaked(params.tokenId);
    }

    /// @inheritdoc IUniswapV3Staker
    function claimReward(address rewardToken, address to) external override {
        uint128 reward = rewards[rewardToken][msg.sender];
        rewards[rewardToken][msg.sender] = 0;

        require(
            IERC20Minimal(rewardToken).transfer(to, reward),
            'REWARD_TRANSFER_FAILED'
        );

        emit RewardClaimed(to, reward);
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

        require(
            incentives[incentiveId].rewardToken != address(0),
            'non-existent incentive'
        );
        require(
            stakes[params.tokenId][incentiveId].exists != true,
            'already staked'
        );

        (, uint160 secondsPerLiquidityInsideX128, ) =
            pool.snapshotCumulativesInside(tickLower, tickUpper);
        stakes[params.tokenId][incentiveId] = Stake(
            secondsPerLiquidityInsideX128,
            true
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
