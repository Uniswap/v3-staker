// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import './interfaces/IUniswapV3Staker.sol';
import './libraries/IncentiveId.sol';

import '@uniswap/v3-core/contracts/libraries/FixedPoint96.sol';
import '@uniswap/v3-core/contracts/libraries/FixedPoint128.sol';
import '@uniswap/v3-core/contracts/libraries/FullMath.sol';
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol';
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
import '@uniswap/v3-core/contracts/interfaces/IERC20Minimal.sol';

import '@uniswap/v3-periphery/contracts/libraries/PoolAddress.sol';
import '@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol';
import '@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol';
import '@uniswap/v3-periphery/contracts/base/Multicall.sol';

import '@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol';
import '@openzeppelin/contracts/math/Math.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';

/// @title Uniswap V3 canonical staking interface
contract UniswapV3Staker is IUniswapV3Staker, IERC721Receiver, Multicall {
    /// @inheritdoc IUniswapV3Staker
    IUniswapV3Factory public immutable override factory;
    /// @inheritdoc IUniswapV3Staker
    INonfungiblePositionManager
        public immutable
        override nonfungiblePositionManager;

    /// @dev bytes32 refers to the return value of IncentiveId.compute
    mapping(bytes32 => Incentive) public override incentives;

    /// @dev deposits[tokenId] => Deposit
    mapping(uint256 => Deposit) public override deposits;

    /// @dev stakes[tokenId][incentiveHash] => Stake
    mapping(uint256 => mapping(bytes32 => Stake)) public override stakes;

    /// @inheritdoc IUniswapV3Staker
    /// @dev rewards[rewardToken][owner] => uint256
    mapping(IERC20Minimal => mapping(address => uint256))
        public
        override rewards;

    /// @param _factory the Uniswap V3 factory
    /// @param _nonfungiblePositionManager the NFT position manager contract address
    constructor(
        IUniswapV3Factory _factory,
        INonfungiblePositionManager _nonfungiblePositionManager
    ) {
        factory = _factory;
        nonfungiblePositionManager = _nonfungiblePositionManager;
    }

    /// @inheritdoc IUniswapV3Staker
    function createIncentive(CreateIncentiveParams memory params)
        external
        override
    {
        require(params.totalReward > 0, 'reward must be greater than 0');
        require(
            params.startTime < params.endTime,
            'start time must be before end time'
        );
        require(
            params.endTime <= params.claimDeadline,
            'end time must be at or before claim deadline'
        );
        require(
            params.startTime >= block.timestamp,
            'start time must be now or in the future'
        );
        // seconds per liquidity is not reliable over periods greater than 2**32-1 seconds
        require(
            params.claimDeadline - params.startTime <= type(uint32).max,
            'total duration of incentive must be less than 2**32 - 1'
        );

        bytes32 incentiveId =
            IncentiveId.compute(
                IncentiveId.Key(
                    msg.sender,
                    params.rewardToken,
                    params.pool,
                    params.startTime,
                    params.endTime,
                    params.claimDeadline
                )
            );

        // totalRewardUnclaimed cannot decrease until params.startTime has passed, meaning this check is safe
        require(
            incentives[incentiveId].totalRewardUnclaimed == 0,
            'incentive already exists'
        );

        incentives[incentiveId] = Incentive({
            totalRewardUnclaimed: params.totalReward,
            totalSecondsClaimedX128: 0
        });

        // this is effectively a validity check on params.rewardToken
        TransferHelper.safeTransferFrom(
            address(params.rewardToken),
            msg.sender,
            address(this),
            params.totalReward
        );

        emit IncentiveCreated(
            msg.sender,
            params.rewardToken,
            params.pool,
            params.startTime,
            params.endTime,
            params.claimDeadline,
            params.totalReward
        );
    }

    /// @inheritdoc IUniswapV3Staker
    function endIncentive(EndIncentiveParams memory params) external override {
        bytes32 incentiveId =
            IncentiveId.compute(
                IncentiveId.Key(
                    params.creator,
                    params.rewardToken,
                    params.pool,
                    params.startTime,
                    params.endTime,
                    params.claimDeadline
                )
            );

        uint128 refund = incentives[incentiveId].totalRewardUnclaimed;

        // if any unclaimed rewards remain, and we're at or past the claim deadline, issue a refund
        if (refund > 0 && params.claimDeadline <= block.timestamp) {
            incentives[incentiveId].totalRewardUnclaimed = 0;
            TransferHelper.safeTransfer(
                address(params.rewardToken),
                params.creator,
                refund
            );

            emit IncentiveEnded(incentiveId, refund);
        }
    }

    /// @inheritdoc IERC721Receiver
    function onERC721Received(
        address,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external override returns (bytes4) {
        require(
            msg.sender == address(nonfungiblePositionManager),
            'not a univ3 nft'
        );

        deposits[tokenId] = Deposit({owner: from, numberOfStakes: 0});
        emit TokenDeposited(tokenId, from);

        if (data.length > 0) {
            _stakeToken(abi.decode(data, (UpdateStakeParams)));
        }
        return this.onERC721Received.selector;
    }

    /// @inheritdoc IUniswapV3Staker
    function withdrawToken(uint256 tokenId, address to) external override {
        Deposit memory deposit = deposits[tokenId];
        require(deposit.numberOfStakes == 0, 'nonzero num of stakes');
        require(deposit.owner == msg.sender, 'sender is not nft owner');

        delete deposits[tokenId];
        nonfungiblePositionManager.safeTransferFrom(address(this), to, tokenId);
        emit TokenWithdrawn(tokenId, to);
    }

    /// @inheritdoc IUniswapV3Staker
    function stakeToken(UpdateStakeParams memory params) external override {
        require(
            deposits[params.tokenId].owner == msg.sender,
            'sender is not nft owner'
        );

        _stakeToken(params);
    }

    /// @inheritdoc IUniswapV3Staker
    function unstakeToken(UpdateStakeParams memory params) external override {
        require(
            deposits[params.tokenId].owner == msg.sender,
            'sender is not nft owner'
        );

        (IUniswapV3Pool pool, int24 tickLower, int24 tickUpper, ) =
            _getPositionDetails(params.tokenId);

        bytes32 incentiveId =
            IncentiveId.compute(
                IncentiveId.Key(
                    params.creator,
                    params.rewardToken,
                    pool,
                    params.startTime,
                    params.endTime,
                    params.claimDeadline
                )
            );

        Incentive memory incentive = incentives[incentiveId];
        Stake memory stake = stakes[params.tokenId][incentiveId];

        require(stake.liquidity != 0, 'nonexistent stake');

        deposits[params.tokenId].numberOfStakes -= 1;

        // if incentive still exists
        if (incentive.totalRewardUnclaimed > 0) {
            (uint256 reward, uint160 secondsInPeriodX128) =
                _getRewardAmount(
                    stake,
                    incentive,
                    params,
                    pool,
                    tickLower,
                    tickUpper
                );

            incentives[incentiveId]
                .totalSecondsClaimedX128 += secondsInPeriodX128;

            // TODO: is SafeMath necessary here? Could we do just a subtraction?
            incentives[incentiveId].totalRewardUnclaimed = uint128(
                SafeMath.sub(incentive.totalRewardUnclaimed, reward)
            );

            // Makes rewards available to claimReward
            rewards[params.rewardToken][msg.sender] = SafeMath.add(
                rewards[params.rewardToken][msg.sender],
                reward
            );
        }

        delete stakes[params.tokenId][incentiveId];
        emit TokenUnstaked(params.tokenId, incentiveId);
    }

    /// @inheritdoc IUniswapV3Staker
    function claimReward(IERC20Minimal rewardToken, address to)
        external
        override
    {
        uint256 reward = rewards[rewardToken][msg.sender];
        rewards[rewardToken][msg.sender] = 0;

        TransferHelper.safeTransfer(address(rewardToken), to, reward);

        emit RewardClaimed(to, reward);
    }

    function getRewardAmount(UpdateStakeParams memory params)
        public
        view
        returns (uint256 reward, uint160 secondsInPeriodX128)
    {
        (IUniswapV3Pool pool, int24 tickLower, int24 tickUpper, ) =
            _getPositionDetails(params.tokenId);

        bytes32 incentiveId =
            IncentiveId.compute(
                IncentiveId.Key(
                    params.creator,
                    params.rewardToken,
                    pool,
                    params.startTime,
                    params.endTime,
                    params.claimDeadline
                )
            );

        Incentive memory incentive = incentives[incentiveId];
        Stake memory stake = stakes[params.tokenId][incentiveId];
        return
            _getRewardAmount(
                stake,
                incentive,
                params,
                pool,
                tickLower,
                tickUpper
            );
    }

    function _getRewardAmount(
        Stake memory stake,
        Incentive memory incentive,
        UpdateStakeParams memory params,
        IUniswapV3Pool pool,
        int24 tickLower,
        int24 tickUpper
    ) private view returns (uint256 reward, uint160 secondsInPeriodX128) {
        (, uint160 secondsPerLiquidityInsideX128, ) =
            pool.snapshotCumulativesInside(tickLower, tickUpper);

        secondsInPeriodX128 = uint160(
            SafeMath.mul(
                secondsPerLiquidityInsideX128 -
                    stake.secondsPerLiquidityInitialX128,
                stake.liquidity
            )
        );

        // TODO: double-check for overflow risk here
        uint160 totalSecondsUnclaimedX128 =
            uint160(
                SafeMath.mul(
                    Math.max(params.endTime, block.timestamp) -
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

        reward = FullMath.mulDiv(
            secondsInPeriodX128,
            rewardRate,
            FixedPoint128.Q128
        );
    }

    function _stakeToken(UpdateStakeParams memory params) private {
        require(params.startTime <= block.timestamp, 'incentive not started');
        require(block.timestamp < params.endTime, 'incentive ended');

        (
            IUniswapV3Pool pool,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        ) = _getPositionDetails(params.tokenId);

        bytes32 incentiveId =
            IncentiveId.compute(
                IncentiveId.Key(
                    params.creator,
                    params.rewardToken,
                    pool,
                    params.startTime,
                    params.endTime,
                    params.claimDeadline
                )
            );

        require(
            incentives[incentiveId].totalRewardUnclaimed > 0,
            'non-existent incentive'
        );
        require(
            stakes[params.tokenId][incentiveId].liquidity == 0,
            'incentive already staked'
        );

        deposits[params.tokenId].numberOfStakes += 1;

        (, uint160 secondsPerLiquidityInsideX128, ) =
            pool.snapshotCumulativesInside(tickLower, tickUpper);

        stakes[params.tokenId][incentiveId] = Stake({
            secondsPerLiquidityInitialX128: secondsPerLiquidityInsideX128,
            liquidity: liquidity
        });

        emit TokenStaked(params.tokenId, liquidity, incentiveId);
    }

    /// @param tokenId The unique identifier of an Uniswap V3 LP token
    /// @return pool The address of the Uniswap V3 pool
    /// @return tickLower The lower tick of the Uniswap V3 position
    /// @return tickUpper The upper tick of the Uniswap V3 position
    /// @return liquidity The amount of liquidity staked
    function _getPositionDetails(uint256 tokenId)
        private
        view
        returns (
            IUniswapV3Pool pool,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        )
    {
        address token0;
        address token1;
        uint24 fee;
        (
            ,
            ,
            token0,
            token1,
            fee,
            tickLower,
            tickUpper,
            liquidity,
            ,
            ,
            ,

        ) = nonfungiblePositionManager.positions(tokenId);

        pool = IUniswapV3Pool(
            PoolAddress.computeAddress(
                address(factory),
                PoolAddress.PoolKey({token0: token0, token1: token1, fee: fee})
            )
        );
    }
}
