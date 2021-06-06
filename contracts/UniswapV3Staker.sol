// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import './interfaces/IUniswapV3Staker.sol';
import './libraries/IncentiveId.sol';
import './libraries/RewardMath.sol';

import '@uniswap/v3-core/contracts/libraries/FixedPoint96.sol';
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol';
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
import '@uniswap/v3-core/contracts/interfaces/IERC20Minimal.sol';

import '@uniswap/v3-periphery/contracts/libraries/PoolAddress.sol';
import '@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol';
import '@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol';
import '@uniswap/v3-periphery/contracts/base/Multicall.sol';

import '@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol';
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
    function createIncentive(IncentiveId.Key memory key, uint256 reward)
        external
        override
    {
        require(reward > 0, 'reward must be positive');
        require(
            block.timestamp <= key.startTime,
            'start time must be now or in the future'
        );
        require(
            key.startTime < key.endTime,
            'start time must be before end time'
        );

        bytes32 incentiveId = IncentiveId.compute(key);

        // totalRewardUnclaimed cannot decrease until key.startTime has passed, meaning this check is safe
        require(
            incentives[incentiveId].totalRewardUnclaimed == 0,
            'incentive already exists'
        );

        incentives[incentiveId] = Incentive({
            totalRewardUnclaimed: reward,
            totalSecondsClaimedX128: 0,
            numberOfStakes: 0
        });

        // this is effectively a validity check on key.rewardToken
        TransferHelper.safeTransferFrom(
            address(key.rewardToken),
            msg.sender,
            address(this),
            reward
        );

        emit IncentiveCreated(
            key.rewardToken,
            key.pool,
            key.startTime,
            key.endTime,
            key.refundee,
            reward
        );
    }

    /// @inheritdoc IUniswapV3Staker
    function endIncentive(IncentiveId.Key memory key) external override {
        bytes32 incentiveId = IncentiveId.compute(key);
        Incentive storage incentive = incentives[incentiveId];

        uint256 refund = incentive.totalRewardUnclaimed;

        require(refund > 0, 'no refund available');
        require(
            block.timestamp >= key.endTime,
            'cannot end incentive before end time'
        );
        require(
            incentive.numberOfStakes == 0,
            'cannot end incentive while deposits are staked'
        );

        // if any unclaimed rewards remain, and we're past the claim deadline, issue a refund
        incentive.totalRewardUnclaimed = 0;
        TransferHelper.safeTransfer(
            address(key.rewardToken),
            key.refundee,
            refund
        );

        emit IncentiveEnded(incentiveId, refund);
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
            if (data.length == 160) {
                _stakeToken(abi.decode(data, (IncentiveId.Key)), tokenId);
            } else {
                IncentiveId.Key[] memory keys =
                    abi.decode(data, (IncentiveId.Key[]));
                for (uint256 i = 0; i < keys.length; i++) {
                    _stakeToken(keys[i], tokenId);
                }
            }
        }
        return this.onERC721Received.selector;
    }

    /// @inheritdoc IUniswapV3Staker
    function withdrawToken(uint256 tokenId, address to) external override {
        Deposit memory deposit = deposits[tokenId];
        require(
            deposit.numberOfStakes == 0,
            'cannot withdraw token while staked'
        );
        require(deposit.owner == msg.sender, 'only owner can withdraw token');

        delete deposits[tokenId];
        nonfungiblePositionManager.safeTransferFrom(address(this), to, tokenId);
        emit TokenWithdrawn(tokenId, to);
    }

    /// @inheritdoc IUniswapV3Staker
    function stakeToken(IncentiveId.Key memory key, uint256 tokenId)
        external
        override
    {
        require(
            deposits[tokenId].owner == msg.sender,
            'only owner can stake token'
        );

        _stakeToken(key, tokenId);
    }

    /// @inheritdoc IUniswapV3Staker
    function unstakeToken(IncentiveId.Key memory key, uint256 tokenId)
        external
        override
    {
        address depositOwner = deposits[tokenId].owner;
        // anyone can call unstakeToken if the block time is after the end time of the incentive
        if (block.timestamp < key.endTime) {
            require(
                depositOwner == msg.sender,
                'only owner can withdraw token before incentive end time'
            );
        }

        bytes32 incentiveId = IncentiveId.compute(key);

        Incentive storage incentive = incentives[incentiveId];
        Stake storage stake = stakes[tokenId][incentiveId];

        require(stake.liquidity != 0, 'stake does not exist');

        (, , , , , int24 tickLower, int24 tickUpper, , , , , ) =
            nonfungiblePositionManager.positions(tokenId);

        incentive.numberOfStakes--;
        deposits[tokenId].numberOfStakes--;

        // if incentive still has rewards to claim
        if (incentive.totalRewardUnclaimed > 0) {
            (, uint160 secondsPerLiquidityInsideX128, ) =
                key.pool.snapshotCumulativesInside(tickLower, tickUpper);
            (uint256 reward, uint160 secondsInsideX128) =
                RewardMath.computeRewardAmount(
                    incentive.totalRewardUnclaimed,
                    incentive.totalSecondsClaimedX128,
                    key.startTime,
                    key.endTime,
                    stake.liquidity,
                    stake.secondsPerLiquidityInsideInitialX128,
                    secondsPerLiquidityInsideX128
                );

            incentive.totalSecondsClaimedX128 += secondsInsideX128;

            // TODO: verify that reward is never greater than totalRewardUnclaimed
            incentive.totalRewardUnclaimed -= reward;

            // Makes rewards available to claimReward
            rewards[key.rewardToken][depositOwner] = SafeMath.add(
                rewards[key.rewardToken][depositOwner],
                reward
            );
        }

        delete stakes[tokenId][incentiveId];
        emit TokenUnstaked(tokenId, incentiveId);
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

    /// @inheritdoc IUniswapV3Staker
    function getRewardAmount(IncentiveId.Key memory key, uint256 tokenId)
        external
        view
        override
        returns (uint256 reward)
    {
        (IUniswapV3Pool pool, int24 tickLower, int24 tickUpper, ) =
            _getPositionDetails(tokenId);

        bytes32 incentiveId = IncentiveId.compute(key);

        Incentive storage incentive = incentives[incentiveId];
        Stake storage stake = stakes[tokenId][incentiveId];

        (, uint160 secondsPerLiquidityInsideX128, ) =
            pool.snapshotCumulativesInside(tickLower, tickUpper);

        (reward, ) = RewardMath.computeRewardAmount(
            incentive.totalRewardUnclaimed,
            incentive.totalSecondsClaimedX128,
            key.startTime,
            key.endTime,
            stake.liquidity,
            stake.secondsPerLiquidityInsideInitialX128,
            secondsPerLiquidityInsideX128
        );
    }

    function _stakeToken(IncentiveId.Key memory key, uint256 tokenId) private {
        require(block.timestamp >= key.startTime, 'incentive not started');
        require(block.timestamp < key.endTime, 'incentive ended');

        bytes32 incentiveId = IncentiveId.compute(key);

        require(
            incentives[incentiveId].totalRewardUnclaimed > 0,
            'non-existent incentive'
        );
        require(
            stakes[tokenId][incentiveId].liquidity == 0,
            'token already staked'
        );

        (
            IUniswapV3Pool pool,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        ) = _getPositionDetails(tokenId);

        require(pool == key.pool, 'token pool is not the incentivized pool');

        deposits[tokenId].numberOfStakes++;
        incentives[incentiveId].numberOfStakes++;

        (, uint160 secondsPerLiquidityInsideX128, ) =
            pool.snapshotCumulativesInside(tickLower, tickUpper);

        stakes[tokenId][incentiveId] = Stake({
            secondsPerLiquidityInsideInitialX128: secondsPerLiquidityInsideX128,
            liquidity: liquidity
        });

        emit TokenStaked(tokenId, incentiveId, liquidity);
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
