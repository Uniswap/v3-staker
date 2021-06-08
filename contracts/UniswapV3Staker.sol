// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import './interfaces/IUniswapV3Staker.sol';
import './libraries/IncentiveId.sol';
import './libraries/RewardMath.sol';
import './libraries/NFTPositionInfo.sol';

import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol';
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
import '@uniswap/v3-core/contracts/interfaces/IERC20Minimal.sol';

import '@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol';
import '@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol';
import '@uniswap/v3-periphery/contracts/base/Multicall.sol';

/// @title Uniswap V3 canonical staking interface
contract UniswapV3Staker is IUniswapV3Staker, Multicall {
    /// @notice Represents a staking incentive
    struct Incentive {
        uint256 totalRewardUnclaimed;
        uint160 totalSecondsClaimedX128;
        uint96 numberOfStakes;
    }

    /// @notice Represents the deposit of a liquidity NFT
    struct Deposit {
        address owner;
        uint48 numberOfStakes;
        int24 tickLower;
        int24 tickUpper;
    }

    /// @notice Represents a staked liquidity NFT
    struct Stake {
        uint160 secondsPerLiquidityInsideInitialX128;
        uint96 liquidityNoOverflow;
        uint128 liquidityIfOverflow;
    }

    /// @inheritdoc IUniswapV3Staker
    IUniswapV3Factory public immutable override factory;
    /// @inheritdoc IUniswapV3Staker
    INonfungiblePositionManager
        public immutable
        override nonfungiblePositionManager;

    uint256 immutable maxDuration;
    uint256 immutable maxTimeUntilStart;

    /// @dev bytes32 refers to the return value of IncentiveId.compute
    mapping(bytes32 => Incentive) public override incentives;

    /// @dev deposits[tokenId] => Deposit
    mapping(uint256 => Deposit) public override deposits;

    /// @dev stakes[tokenId][incentiveHash] => Stake
    mapping(uint256 => mapping(bytes32 => Stake)) private _stakes;

    /// @inheritdoc IUniswapV3Staker
    function stakes(uint256 tokenId, bytes32 incentiveId)
        public
        view
        override
        returns (
            uint160 secondsPerLiquidityInsideInitialX128,
            uint128 liquidity
        )
    {
        Stake storage stake = _stakes[tokenId][incentiveId];
        secondsPerLiquidityInsideInitialX128 = stake
            .secondsPerLiquidityInsideInitialX128;
        liquidity = stake.liquidityNoOverflow;
        if (liquidity == type(uint96).max) {
            liquidity = stake.liquidityIfOverflow;
        }
    }

    /// @inheritdoc IUniswapV3Staker
    /// @dev rewards[rewardToken][owner] => uint256
    mapping(IERC20Minimal => mapping(address => uint256))
        public
        override rewards;

    /// @param _factory the Uniswap V3 factory
    /// @param _nonfungiblePositionManager the NFT position manager contract address
    constructor(
        IUniswapV3Factory _factory,
        INonfungiblePositionManager _nonfungiblePositionManager,
        uint256 _maxTimeUntilStart,
        uint256 _maxDuration
    ) {
        factory = _factory;
        nonfungiblePositionManager = _nonfungiblePositionManager;
        maxTimeUntilStart = _maxTimeUntilStart;
        maxDuration = _maxDuration;
    }

    /// @inheritdoc IUniswapV3Staker
    function createIncentive(IncentiveKey memory key, uint256 reward)
        external
        override
    {
        require(
            reward > 0,
            'UniswapV3Staker::createIncentive: reward must be positive'
        );
        require(
            block.timestamp <= key.startTime,
            'UniswapV3Staker::createIncentive: start time must be now or in the future'
        );
        require(
            key.startTime - block.timestamp <= maxTimeUntilStart,
            'UniswapV3Staker::createIncentive: start time must be within maxTimeUntilStart'
        );
        require(
            key.startTime < key.endTime,
            'UniswapV3Staker::createIncentive: start time must be before end time'
        );
        require(
            key.endTime - key.startTime < maxDuration,
            'UniswapV3Staker::createIncentive: incentive duration must be less than maxDuration'
        );

        bytes32 incentiveId = IncentiveId.compute(key);

        // totalRewardUnclaimed cannot decrease until key.startTime has passed, meaning this check is safe
        require(
            incentives[incentiveId].totalRewardUnclaimed == 0,
            'UniswapV3Staker::createIncentive: incentive already exists'
        );

        incentives[incentiveId] = Incentive({
            totalRewardUnclaimed: reward,
            totalSecondsClaimedX128: 0,
            numberOfStakes: 0
        });

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
    function endIncentive(IncentiveKey memory key)
        external
        override
        returns (uint256 refund)
    {
        require(
            block.timestamp >= key.endTime,
            'UniswapV3Staker::endIncentive: cannot end incentive before end time'
        );

        bytes32 incentiveId = IncentiveId.compute(key);
        Incentive storage incentive = incentives[incentiveId];

        refund = incentive.totalRewardUnclaimed;

        require(refund > 0, 'no refund available');
        require(
            incentive.numberOfStakes == 0,
            'UniswapV3Staker::endIncentive: cannot end incentive while deposits are staked'
        );

        // issue the refund
        incentive.totalRewardUnclaimed = 0;
        TransferHelper.safeTransfer(
            address(key.rewardToken),
            key.refundee,
            refund
        );

        // note we never clear totalSecondsClaimedX128

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
            'UniswapV3Staker::onERC721Received: not a univ3 nft'
        );

        (, , , , , int24 tickLower, int24 tickUpper, , , , , ) =
            nonfungiblePositionManager.positions(tokenId);

        deposits[tokenId] = Deposit({
            owner: from,
            numberOfStakes: 0,
            tickLower: tickLower,
            tickUpper: tickUpper
        });
        emit DepositTransferred(tokenId, address(0), from);

        if (data.length > 0) {
            if (data.length == 160) {
                _stakeToken(abi.decode(data, (IncentiveKey)), tokenId);
            } else {
                IncentiveKey[] memory keys = abi.decode(data, (IncentiveKey[]));
                for (uint256 i = 0; i < keys.length; i++) {
                    _stakeToken(keys[i], tokenId);
                }
            }
        }
        return this.onERC721Received.selector;
    }

    /// @inheritdoc IUniswapV3Staker
    function transferDeposit(uint256 tokenId, address to) external override {
        require(
            to != address(0),
            'UniswapV3Staker::transferDeposit: invalid transfer recipient'
        );
        address owner = deposits[tokenId].owner;
        require(
            owner == msg.sender,
            'UniswapV3Staker::transferDeposit: can only be called by deposit owner'
        );
        deposits[tokenId].owner = to;
        emit DepositTransferred(tokenId, owner, to);
    }

    /// @inheritdoc IUniswapV3Staker
    function withdrawToken(uint256 tokenId, address to) external override {
        Deposit memory deposit = deposits[tokenId];
        require(
            deposit.numberOfStakes == 0,
            'UniswapV3Staker::withdrawToken: cannot withdraw token while staked'
        );
        require(
            deposit.owner == msg.sender,
            'UniswapV3Staker::withdrawToken: only owner can withdraw token'
        );

        delete deposits[tokenId];
        emit DepositTransferred(tokenId, deposit.owner, address(0));

        nonfungiblePositionManager.safeTransferFrom(address(this), to, tokenId);
    }

    /// @inheritdoc IUniswapV3Staker
    function stakeToken(IncentiveKey memory key, uint256 tokenId)
        external
        override
    {
        require(
            deposits[tokenId].owner == msg.sender,
            'UniswapV3Staker::stakeToken: only owner can stake token'
        );

        _stakeToken(key, tokenId);
    }

    /// @inheritdoc IUniswapV3Staker
    function unstakeToken(IncentiveKey memory key, uint256 tokenId)
        external
        override
    {
        Deposit memory deposit = deposits[tokenId];
        // anyone can call unstakeToken if the block time is after the end time of the incentive
        if (block.timestamp < key.endTime) {
            require(
                deposit.owner == msg.sender,
                'UniswapV3Staker::unstakeToken: only owner can withdraw token before incentive end time'
            );
        }

        bytes32 incentiveId = IncentiveId.compute(key);

        (uint160 secondsPerLiquidityInsideInitialX128, uint128 liquidity) =
            stakes(tokenId, incentiveId);

        require(
            liquidity != 0,
            'UniswapV3Staker::unstakeToken: stake does not exist'
        );

        Incentive storage incentive = incentives[incentiveId];

        deposits[tokenId].numberOfStakes--;
        incentive.numberOfStakes--;

        // if incentive still has rewards to claim
        if (incentive.totalRewardUnclaimed > 0) {
            (, uint160 secondsPerLiquidityInsideX128, ) =
                key.pool.snapshotCumulativesInside(
                    deposit.tickLower,
                    deposit.tickUpper
                );
            (uint256 reward, uint160 secondsInsideX128) =
                RewardMath.computeRewardAmount(
                    incentive.totalRewardUnclaimed,
                    incentive.totalSecondsClaimedX128,
                    key.startTime,
                    key.endTime,
                    liquidity,
                    secondsPerLiquidityInsideInitialX128,
                    secondsPerLiquidityInsideX128,
                    block.timestamp
                );

            incentive.totalSecondsClaimedX128 += secondsInsideX128;

            // TODO: verify that reward is never greater than totalRewardUnclaimed
            incentive.totalRewardUnclaimed -= reward;
            // this only overflows if a token has a total supply greater than type(uint256).max
            rewards[key.rewardToken][deposit.owner] += reward;
        }

        Stake storage stake = _stakes[tokenId][incentiveId];
        delete stake.secondsPerLiquidityInsideInitialX128;
        delete stake.liquidityNoOverflow;
        if (liquidity >= type(uint96).max) delete stake.liquidityIfOverflow;
        emit TokenUnstaked(tokenId, incentiveId);
    }

    /// @inheritdoc IUniswapV3Staker
    function claimReward(
        IERC20Minimal rewardToken,
        address to,
        uint256 amountRequested
    ) external override returns (uint256 reward) {
        reward = rewards[rewardToken][msg.sender];
        if (amountRequested != 0 && amountRequested < reward) {
            reward = amountRequested;
        }

        rewards[rewardToken][msg.sender] -= reward;
        TransferHelper.safeTransfer(address(rewardToken), to, reward);

        emit RewardClaimed(to, reward);
    }

    /// @inheritdoc IUniswapV3Staker
    function getRewardAmount(IncentiveKey memory key, uint256 tokenId)
        external
        view
        override
        returns (uint256 reward)
    {
        bytes32 incentiveId = IncentiveId.compute(key);

        (uint160 secondsPerLiquidityInsideInitialX128, uint128 liquidity) =
            stakes(tokenId, incentiveId);
        require(
            liquidity > 0,
            'UniswapV3Staker::getRewardAmount: stake does not exist'
        );

        Deposit memory deposit = deposits[tokenId];
        Incentive memory incentive = incentives[incentiveId];

        (, uint160 secondsPerLiquidityInsideX128, ) =
            key.pool.snapshotCumulativesInside(
                deposit.tickLower,
                deposit.tickUpper
            );

        (reward, ) = RewardMath.computeRewardAmount(
            incentive.totalRewardUnclaimed,
            incentive.totalSecondsClaimedX128,
            key.startTime,
            key.endTime,
            liquidity,
            secondsPerLiquidityInsideInitialX128,
            secondsPerLiquidityInsideX128,
            block.timestamp
        );
    }

    function _stakeToken(IncentiveKey memory key, uint256 tokenId) private {
        require(
            block.timestamp >= key.startTime,
            'UniswapV3Staker::stakeToken: incentive not started'
        );
        require(
            block.timestamp < key.endTime,
            'UniswapV3Staker::stakeToken: incentive ended'
        );

        bytes32 incentiveId = IncentiveId.compute(key);

        require(
            incentives[incentiveId].totalRewardUnclaimed > 0,
            'UniswapV3Staker::stakeToken: non-existent incentive'
        );
        require(
            _stakes[tokenId][incentiveId].liquidityNoOverflow == 0,
            'UniswapV3Staker::stakeToken: token already staked'
        );

        (
            IUniswapV3Pool pool,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        ) =
            NFTPositionInfo.getPositionInfo(
                factory,
                nonfungiblePositionManager,
                tokenId
            );

        require(
            pool == key.pool,
            'UniswapV3Staker::stakeToken: token pool is not the incentive pool'
        );
        require(
            liquidity > 0,
            'UniswapV3Staker::stakeToken: cannot stake token with 0 liquidity'
        );

        deposits[tokenId].numberOfStakes++;
        incentives[incentiveId].numberOfStakes++;

        (, uint160 secondsPerLiquidityInsideX128, ) =
            pool.snapshotCumulativesInside(tickLower, tickUpper);

        if (liquidity >= type(uint96).max) {
            _stakes[tokenId][incentiveId] = Stake({
                secondsPerLiquidityInsideInitialX128: secondsPerLiquidityInsideX128,
                liquidityNoOverflow: type(uint96).max,
                liquidityIfOverflow: liquidity
            });
        } else {
            _stakes[tokenId][incentiveId] = Stake({
                secondsPerLiquidityInsideInitialX128: secondsPerLiquidityInsideX128,
                liquidityNoOverflow: uint96(liquidity),
                liquidityIfOverflow: 0
            });
        }

        emit TokenStaked(tokenId, incentiveId, liquidity);
    }
}
