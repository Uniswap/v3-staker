import { BigNumber, constants, Wallet } from 'ethers'
import { LoadFixtureFunction } from '../types'
import { TestERC20 } from '../../typechain'
import { uniswapFixture, mintPosition, UniswapFixtureType } from '../shared/fixtures'
import {
  expect,
  getMaxTick,
  getMinTick,
  FeeAmount,
  TICK_SPACINGS,
  blockTimestamp,
  BN,
  BNe,
  BNe18,
  snapshotGasCost,
  ActorFixture,
  makeTimestamps,
  maxGas,
} from '../shared'
import { createFixtureLoader, provider } from '../shared/provider'
import { HelperCommands, ERC20Helper, incentiveResultToStakeAdapter } from '../helpers'
import { ContractParams } from '../../types/contractParams'
import { createTimeMachine } from '../shared/time'
import { HelperTypes } from '../helpers/types'

let loadFixture: LoadFixtureFunction

describe('unit/V3StakerNFT', () => {
  const actors = new ActorFixture(provider.getWallets(), provider)
  const incentiveCreator = actors.incentiveCreator()
  const lpUser0 = actors.lpUser0()
  const amountDesired = BNe18(10)
  const totalReward = BNe18(100)
  const erc20Helper = new ERC20Helper()
  const Time = createTimeMachine(provider)
  let helpers: HelperCommands
  let context: UniswapFixtureType
  let timestamps: ContractParams.Timestamps
  let tokenId: string
  let incentiveId: string
  let incentiveKey: ContractParams.IncentiveKey

  before('loader', async () => {
    loadFixture = createFixtureLoader(provider.getWallets(), provider)
  })

  beforeEach('create fixture loader', async () => {
    context = await loadFixture(uniswapFixture)
    helpers = HelperCommands.fromTestContext(context, actors, provider)

    timestamps = makeTimestamps((await blockTimestamp()) + 1_000)
    incentiveKey = {
      rewardToken: context.rewardToken.address,
      pool: context.pool01,
      startTime: timestamps.startTime,
      endTime: timestamps.endTime,
      refundee: incentiveCreator.address,
    }
    incentiveId = await context.testIncentiveId.compute(incentiveKey)

    await erc20Helper.ensureBalancesAndApprovals(
      lpUser0,
      [context.token0, context.token1],
      amountDesired,
      context.nft.address
    )

    tokenId = await mintPosition(context.nft.connect(lpUser0), {
      token0: context.token0.address,
      token1: context.token1.address,
      fee: FeeAmount.MEDIUM,
      tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      recipient: lpUser0.address,
      amount0Desired: amountDesired,
      amount1Desired: amountDesired,
      amount0Min: 0,
      amount1Min: 0,
      deadline: (await blockTimestamp()) + 1000,
    })

    await helpers.createIncentiveFlow({
      rewardToken: context.rewardToken,
      totalReward,
      poolAddress: context.poolObj.address,
      ...timestamps,
    })
  })

  describe('#storeIncentiveKey', () => {
    it('stores a key', async () => {
      const resultKey = [
        context.rewardToken.address,
        context.pool01,
        BN(timestamps.startTime),
        BN(timestamps.endTime),
        incentiveCreator.address,    
      ]

      await expect(context.stakerNFT.storeIncentiveKey(incentiveKey))
        .to.emit(context.stakerNFT, 'KeyStored')
        .withArgs(incentiveId, resultKey)

      expect(await context.stakerNFT.idToIncentiveKey(incentiveId)).to.deep.equal(resultKey)
    })
  })

  describe('#onERC721Received', () => {
    beforeEach(async () => {
      await Time.set(timestamps.startTime + 1)
      await context.stakerNFT.storeIncentiveKey(incentiveKey)
    })

    describe('receiving a UniswapV3Position NFT', () => {
      it('should deposit without any data', async () => {
        await expect(context.nft
          .connect(lpUser0)
          ['safeTransferFrom(address,address,uint256)'](lpUser0.address, context.stakerNFT.address, tokenId, {
            ...maxGas,
            from: lpUser0.address,
          })
        )
          .to.emit(context.stakerNFT, 'Transfer')
          .withArgs(constants.AddressZero, lpUser0.address, tokenId)

        expect(await context.nft.ownerOf(tokenId)).to.equal(context.staker.address)
        expect(await context.stakerNFT.ownerOf(tokenId)).to.equal(lpUser0.address)
        expect(await context.stakerNFT.stakedIncentiveIds(tokenId)).to.deep.equal([])
      })

      it('should deposit with a single incentive', async () => {
        await expect(context.nft
          .connect(lpUser0)
          ['safeTransferFrom(address,address,uint256,bytes)'](lpUser0.address, context.stakerNFT.address, tokenId, incentiveId, {
            ...maxGas,
            from: lpUser0.address,
          })
        )
          .to.emit(context.stakerNFT, 'Transfer')
          .withArgs(constants.AddressZero, lpUser0.address, tokenId)

        expect(await context.nft.ownerOf(tokenId)).to.equal(context.staker.address)
        expect(await context.stakerNFT.ownerOf(tokenId)).to.equal(lpUser0.address)
        expect(await context.stakerNFT.stakedIncentiveIds(tokenId)).to.deep.equal([incentiveId])
      })

      it('should deposit with multiple incentives')
    })

    describe('receiving a V3StakerNFT NFT', () => {
      beforeEach(async () => {
        await context.nft
          .connect(lpUser0)
          ['safeTransferFrom(address,address,uint256,bytes)'](lpUser0.address, context.stakerNFT.address, tokenId, incentiveId, {
            ...maxGas,
            from: lpUser0.address,
          })

        await Time.setAndMine(timestamps.startTime + 10)
      })

      it('should unstake the position and claim rewards', async () => {
        let rewardInfo = await context.staker.getRewardInfo(incentiveKey, tokenId)

        await expect(context.stakerNFT
          .connect(lpUser0)
          ['safeTransferFrom(address,address,uint256)'](lpUser0.address, context.stakerNFT.address, tokenId, {
            ...maxGas,
            from: lpUser0.address,
          })
        )
          .to.emit(context.stakerNFT, 'Transfer')
          .withArgs(context.stakerNFT.address, constants.AddressZero, tokenId)
          .to.emit(context.nft, 'Transfer')
          .withArgs(context.staker.address, lpUser0.address, tokenId)
          .to.emit(context.staker, 'RewardClaimed')

        expect((await context.rewardToken.balanceOf(lpUser0.address)).gte(rewardInfo.reward))
        expect(await context.nft.ownerOf(tokenId)).to.equal(lpUser0.address)
      })
    })

    describe('on invalid call', async () => {
      it('reverts when called by an unknown token', async () => {
        await expect(
          context.stakerNFT.connect(lpUser0).onERC721Received(incentiveCreator.address, lpUser0.address, 1, [])
        ).to.be.revertedWith('UniswapStakerNFT::onERC721Received: unknown NFT')
      })

      it('reverts when staking on invalid incentive')
    })
  })

  describe('#claimAndWithdraw', () => {
    beforeEach(async () => {
      await Time.set(timestamps.startTime + 1)
      await context.stakerNFT.storeIncentiveKey(incentiveKey)

      await context.nft
        .connect(lpUser0)
        ['safeTransferFrom(address,address,uint256,bytes)'](lpUser0.address, context.stakerNFT.address, tokenId, incentiveId, {
          ...maxGas,
          from: lpUser0.address,
        })

      await Time.setAndMine(timestamps.startTime + 10)
    })

    it('claim all rewards and withdraw', async () => {
      let rewardInfo = await context.staker.getRewardInfo(incentiveKey, tokenId)

      await expect(context.stakerNFT.connect(lpUser0).claimAndWithdraw(tokenId))
        .to.emit(context.stakerNFT, 'Transfer')
        .withArgs(lpUser0.address, constants.AddressZero, tokenId)
        .to.emit(context.nft, 'Transfer')
        .withArgs(context.staker.address, lpUser0.address, tokenId)
        .to.emit(context.staker, 'RewardClaimed')

      expect((await context.rewardToken.balanceOf(lpUser0.address)).gte(rewardInfo.reward))
      expect(await context.nft.ownerOf(tokenId)).to.equal(lpUser0.address)
    })
  })

  describe('#claimAll', () => {
    beforeEach(async () => {
      await Time.set(timestamps.startTime + 1)
      await context.stakerNFT.storeIncentiveKey(incentiveKey)

      await context.nft
        .connect(lpUser0)
        ['safeTransferFrom(address,address,uint256,bytes)'](lpUser0.address, context.stakerNFT.address, tokenId, incentiveId, {
          ...maxGas,
          from: lpUser0.address,
        })

      await Time.setAndMine(timestamps.startTime + 10)
    })

    it('claim all rewards', async () => {
      let rewardInfo = await context.staker.getRewardInfo(incentiveKey, tokenId)

      await expect(context.stakerNFT.connect(lpUser0).claimAll(tokenId))
        .to.emit(context.staker, 'RewardClaimed')

      expect((await context.rewardToken.balanceOf(lpUser0.address)).gte(rewardInfo.reward))
    })
  })

  describe('#stakeIncentive', () => {
    let incentiveId2: string
    let incentiveKey2: ContractParams.IncentiveKey

    beforeEach(async () => {
      await Time.set(timestamps.startTime + 1)
      await context.stakerNFT.storeIncentiveKey(incentiveKey)

      await context.nft
        .connect(lpUser0)
        ['safeTransferFrom(address,address,uint256,bytes)'](lpUser0.address, context.stakerNFT.address, tokenId, incentiveId, {
          ...maxGas,
          from: lpUser0.address,
        })

      const timestamps2 = makeTimestamps((await blockTimestamp()) + 1_000)

      const incentive = await helpers.createIncentiveFlow({
        rewardToken: context.rewardToken,
        totalReward,
        poolAddress: context.poolObj.address,
        ...timestamps2,
      })

      incentiveKey2 = {
        rewardToken: context.rewardToken.address,
        pool: context.pool01,
        startTime: timestamps2.startTime,
        endTime: timestamps2.endTime,
        refundee: incentiveCreator.address,
      }
      incentiveId2 = await context.testIncentiveId.compute(incentiveKey2)
      await context.stakerNFT.storeIncentiveKey(incentiveKey2)
      await Time.set(timestamps2.startTime + 1)
    })

    it('stake a new incentive', async () => {
      const [, liquidity] = await context.staker.stakes(tokenId, incentiveId)

      expect(await context.stakerNFT.stakedIncentiveIds(tokenId)).to.deep.equal([incentiveId])

      await expect(context.stakerNFT.connect(lpUser0).stakeIncentive(tokenId, incentiveId2))
        .to.emit(context.staker, 'TokenStaked')
        .withArgs(tokenId, incentiveId2, liquidity)

      expect(await context.stakerNFT.stakedIncentiveIds(tokenId)).to.deep.equal([incentiveId, incentiveId2])
    })
  })

  describe('#unstakeIncentive', () => {
    let incentiveId2: string
    let incentiveKey2: ContractParams.IncentiveKey

    beforeEach(async () => {
      await Time.setAndMine(timestamps.startTime + 1)
      await context.stakerNFT.storeIncentiveKey(incentiveKey)

      const timestamps2 = makeTimestamps((await blockTimestamp()) + 100)

      await helpers.createIncentiveFlow({
        rewardToken: context.rewardToken,
        totalReward,
        poolAddress: context.poolObj.address,
        ...timestamps2,
      })

      incentiveKey2 = {
        rewardToken: context.rewardToken.address,
        pool: context.pool01,
        startTime: timestamps2.startTime,
        endTime: timestamps2.endTime,
        refundee: incentiveCreator.address,
      }
      incentiveId2 = await context.testIncentiveId.compute(incentiveKey2)
      await context.stakerNFT.storeIncentiveKey(incentiveKey2)
      await Time.set(timestamps2.startTime + 1)
      
      const incentives = incentiveId + incentiveId2.substring(2)
      await context.nft
        .connect(lpUser0)
        ['safeTransferFrom(address,address,uint256,bytes)'](lpUser0.address, context.stakerNFT.address, tokenId, incentives, {
          ...maxGas,
          from: lpUser0.address,
        })
    })

    it('unstake and claim both incentives', async () => {
      expect(await context.stakerNFT.stakedIncentiveIds(tokenId)).to.deep.equal([incentiveId, incentiveId2])

      await expect(context.stakerNFT.connect(lpUser0).unstakeIncentive(tokenId, 0))
        .to.emit(context.staker, 'TokenUnstaked')
        .withArgs(tokenId, incentiveId)
        .to.emit(context.staker, 'RewardClaimed')

      expect(await context.stakerNFT.stakedIncentiveIds(tokenId)).to.deep.equal([incentiveId2])

      await expect(context.stakerNFT.connect(lpUser0).unstakeIncentive(tokenId, 0))
        .to.emit(context.staker, 'TokenUnstaked')
        .withArgs(tokenId, incentiveId2)
        .to.emit(context.staker, 'RewardClaimed')

      expect(await context.stakerNFT.stakedIncentiveIds(tokenId)).to.deep.equal([])
    })

    describe('on invalid call', () => {
      it('should revert if invalid index passed', async () => {
        await expect(context.stakerNFT.connect(lpUser0).unstakeIncentive(tokenId, 10))
          .to.be.revertedWith('UniswapStakerNFT::unstakeIncentive: invalid incentive ID')
      })
    })
  })

  describe('#eject', () => {
    beforeEach(async () => {
      await Time.set(timestamps.startTime + 1)
      await context.stakerNFT.storeIncentiveKey(incentiveKey)

      await context.nft
        .connect(lpUser0)
        ['safeTransferFrom(address,address,uint256,bytes)'](lpUser0.address, context.stakerNFT.address, tokenId, incentiveId, {
          ...maxGas,
          from: lpUser0.address,
        })
    })

    it('exect position from staker NFT', async () => {
      await expect(context.stakerNFT.connect(lpUser0).eject(tokenId))
        .to.emit(context.stakerNFT, 'Transfer')
        .withArgs(lpUser0.address, constants.AddressZero, tokenId)
        .to.emit(context.stakerNFT, 'PositionEjected')
        .withArgs(tokenId, lpUser0.address)
        .to.emit(context.staker, 'DepositTransferred')
        .withArgs(tokenId, context.stakerNFT.address, lpUser0.address)

      expect((await context.staker.deposits(tokenId))[0]).to.equal(lpUser0.address)
      expect(await context.nft.ownerOf(tokenId)).to.equal(context.staker.address)
    })
  })
})
