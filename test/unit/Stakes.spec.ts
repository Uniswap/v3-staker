import { Wallet } from 'ethers'
import { LoadFixtureFunction } from '../types'
import { TestERC20 } from '../../typechain'
import {
  uniswapFixture,
  mintPosition,
  UniswapFixtureType,
} from '../shared/fixtures'
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
} from '../shared'
import { createFixtureLoader, provider } from '../shared/provider'
import { HelperCommands, ERC20Helper } from '../helpers'

import { ContractParams } from '../../types/contractParams'
import { createTimeMachine } from '../shared/time'
import { HelperTypes } from '../helpers/types'

let loadFixture: LoadFixtureFunction

describe('unit.Stakes', async () => {
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

  before('loader', async () => {
    loadFixture = createFixtureLoader(provider.getWallets(), provider)
  })

  beforeEach('create fixture loader', async () => {
    context = await loadFixture(uniswapFixture)
    helpers = HelperCommands.fromTestContext(context, actors, provider)
  })

  /**
   * lpUser0 stakes and unstakes
   */
  let tokenId: string

  describe('#stakeToken', () => {
    let incentiveId: string
    let subject: (_tokenId: string, _actor?: Wallet) => Promise<any>
    let timestamps: ContractParams.Timestamps

    beforeEach(async () => {
      /* We will be doing a lot of time-testing here, so leave some room between
        and when the incentive starts */
      timestamps = makeTimestamps(1_000 + (await blockTimestamp()))

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

      await context.nft
        .connect(lpUser0)
        ['safeTransferFrom(address,address,uint256)'](
          lpUser0.address,
          context.staker.address,
          tokenId
        )
      const incentiveParams: HelperTypes.CreateIncentive.Args = {
        rewardToken: context.rewardToken,
        totalReward,
        poolAddress: context.poolObj.address,
        ...timestamps,
      }

      incentiveId = await helpers.getIncentiveId(
        await helpers.createIncentiveFlow(incentiveParams)
      )

      subject = (_tokenId: string, _actor: Wallet = lpUser0) =>
        context.staker.connect(_actor).stakeToken(
          {
            refundee: incentiveCreator.address,
            pool: context.pool01,
            rewardToken: context.rewardToken.address,
            ...timestamps,
          },
          _tokenId
        )
    })

    describe('works and', async () => {
      // Make sure the incentive has started
      beforeEach(async () => {
        await Time.set(timestamps.startTime + 100)
      })

      it('emits the stake event', async () => {
        const { liquidity } = await context.nft.positions(tokenId)
        await expect(subject(tokenId))
          .to.emit(context.staker, 'TokenStaked')
          .withArgs(tokenId, incentiveId, liquidity)
      })

      it('sets the stake struct properly', async () => {
        const liquidity = (await context.nft.positions(tokenId)).liquidity

        const stakeBefore = await context.staker.stakes(tokenId, incentiveId)
        const nStakesBefore = (await context.staker.deposits(tokenId))
          .numberOfStakes
        await subject(tokenId)
        const stakeAfter = await context.staker.stakes(tokenId, incentiveId)

        expect(stakeBefore.secondsPerLiquidityInsideInitialX128).to.eq(0)
        expect(stakeBefore.liquidity).to.eq(0)
        expect(stakeAfter.secondsPerLiquidityInsideInitialX128).to.be.gt(0)
        expect(stakeAfter.liquidity).to.eq(liquidity)
        expect((await context.staker.deposits(tokenId)).numberOfStakes).to.eq(
          nStakesBefore.add(1)
        )
      })

      it('increments the number of stakes on the deposit')
      it('increments the number of stakes on the incentive')

      it('has gas cost', async () => {
        await snapshotGasCost(subject(tokenId))
      })
    })

    describe('fails when', () => {
      it('deposit is already staked in the incentive', async () => {
        await Time.set(timestamps.startTime + 500)
        await subject(tokenId)
        await expect(subject(tokenId)).to.be.revertedWith('already staked')
      })

      it('you are not the owner of the deposit', async () => {
        await Time.set(timestamps.startTime + 500)
        await expect(subject(tokenId, actors.lpUser2())).to.be.revertedWith(
          'only owner can stake token'
        )
      })

      it('token id is for a different pool than the incentive')
      it('incentive key does not exist')

      it('is past the end time', async () => {
        await Time.set(timestamps.endTime + 100)
        await expect(subject(tokenId)).to.be.revertedWith('incentive ended')
      })

      it('is before the start time', async () => {
        if (timestamps.startTime < (await blockTimestamp())) {
          throw new Error('no good')
        }
        await Time.set(timestamps.startTime - 2)
        await expect(subject(tokenId)).to.be.revertedWith(
          'incentive not started'
        )
      })
    })
  })

  describe('#getRewardAmount', async () => {
    let incentiveId: string
    let stakeIncentiveKey: ContractParams.IncentiveKey

    beforeEach('set up incentive and stake', async () => {
      timestamps = makeTimestamps((await blockTimestamp()) + 1_000)

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

      await context.nft
        .connect(lpUser0)
        ['safeTransferFrom(address,address,uint256)'](
          lpUser0.address,
          context.staker.address,
          tokenId
        )

      stakeIncentiveKey = {
        refundee: incentiveCreator.address,
        rewardToken: context.rewardToken.address,
        pool: context.pool01,
        ...timestamps,
      }

      incentiveId = await helpers.getIncentiveId(
        await helpers.createIncentiveFlow({
          rewardToken: context.rewardToken,
          totalReward,
          poolAddress: context.poolObj.address,
          ...timestamps,
        })
      )

      await Time.set(timestamps.startTime)
      await context.staker
        .connect(lpUser0)
        .stakeToken(stakeIncentiveKey, tokenId)
      await context.staker.stakes(tokenId, incentiveId)
    })

    it('returns correct rewardAmount and secondsInPeriodX128 for the position', async () => {
      const pool = context.poolObj.connect(actors.lpUser0())

      await provider.send('evm_mine', [timestamps.startTime + 100])

      const reward = await context.staker
        .connect(lpUser0)
        .getRewardAmount(stakeIncentiveKey, tokenId)

      const { tickLower, tickUpper } = await context.nft.positions(tokenId)
      await pool.snapshotCumulativesInside(tickLower, tickUpper)

      // const expectedSecondsInPeriod = secondsPerLiquidityInsideX128
      //   .sub(stake.secondsPerLiquidityInsideInitialX128)
      //   .mul(stake.liquidity)

      // @ts-ignore
      expect(reward).to.be.closeTo(BNe(1, 19), BN(1))
    })

    it('returns nonzero for incentive after end time', async () => {
      await Time.setAndMine(timestamps.endTime + 1)

      const reward = await context.staker
        .connect(lpUser0)
        .getRewardAmount(stakeIncentiveKey, tokenId)

      expect(reward, 'reward is nonzero').to.not.equal(0)
    })

    it('reverts if stake does not exist')
  })

  describe('#claimReward', () => {
    let subject: (token: string, to?: string) => Promise<any>

    beforeEach('setup', async () => {
      const { token0, token1, rewardToken } = context
      timestamps = makeTimestamps(await blockTimestamp())
      const tokensToStake = [token0, token1] as [TestERC20, TestERC20]

      await erc20Helper.ensureBalancesAndApprovals(
        lpUser0,
        tokensToStake,
        amountDesired,
        context.nft.address
      )

      const createIncentiveResult = await helpers.createIncentiveFlow({
        rewardToken: context.rewardToken,
        totalReward,
        poolAddress: context.poolObj.address,
        ...timestamps,
      })
      await Time.setAndMine(timestamps.startTime + 1)
      const { tokenId } = await helpers.mintDepositStakeFlow({
        lp: lpUser0,
        tokensToStake,
        ticks: [
          getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        ],
        amountsToStake: [amountDesired, amountDesired],
        createIncentiveResult,
      })

      await context.staker.connect(lpUser0).unstakeToken(
        {
          refundee: incentiveCreator.address,
          rewardToken: rewardToken.address,
          pool: context.pool01,
          ...timestamps,
        },
        tokenId
      )

      subject = (_token: string, _to: string = lpUser0.address) =>
        context.staker.connect(lpUser0).claimReward(_token, _to)
    })

    it('emits RewardClaimed event', async () => {
      const { rewardToken } = context
      const claimable = await context.staker.rewards(
        rewardToken.address,
        lpUser0.address
      )
      await expect(subject(rewardToken.address))
        .to.emit(context.staker, 'RewardClaimed')
        .withArgs(lpUser0.address, claimable)
    })

    it('transfers the correct reward amount to destination address', async () => {
      const { rewardToken } = context
      const claimable = await context.staker.rewards(
        rewardToken.address,
        lpUser0.address
      )
      const balance = await rewardToken.balanceOf(lpUser0.address)
      await subject(rewardToken.address)
      expect(await rewardToken.balanceOf(lpUser0.address)).to.equal(
        balance.add(claimable)
      )
    })

    it('sets the claimed reward amount to zero', async () => {
      const { rewardToken } = context
      expect(
        await context.staker.rewards(rewardToken.address, lpUser0.address)
      ).to.not.equal(0)

      await subject(rewardToken.address)

      expect(
        await context.staker.rewards(rewardToken.address, lpUser0.address)
      ).to.equal(0)
    })

    it('has gas cost', async () =>
      await snapshotGasCost(subject(context.rewardToken.address)))
  })

  describe('#unstakeToken', () => {
    let incentiveId: string
    let subject: () => Promise<any>
    let createIncentiveResult: HelperTypes.CreateIncentive.Result

    beforeEach('create the incentive and nft and stake it', async () => {
      timestamps = makeTimestamps(await blockTimestamp())

      createIncentiveResult = await helpers.createIncentiveFlow({
        rewardToken: context.rewardToken,
        totalReward,
        poolAddress: context.poolObj.address,
        ...timestamps,
      })

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

      await context.nft
        .connect(lpUser0)
        ['safeTransferFrom(address,address,uint256)'](
          lpUser0.address,
          context.staker.address,
          tokenId
        )

      await Time.setAndMine(timestamps.startTime + 1)
      await context.staker.connect(lpUser0).stakeToken(
        {
          refundee: incentiveCreator.address,
          rewardToken: context.rewardToken.address,
          pool: context.pool01,
          ...timestamps,
        },
        tokenId
      )

      incentiveId = await helpers.getIncentiveId(createIncentiveResult)

      subject = () =>
        context.staker.connect(lpUser0).unstakeToken(
          {
            refundee: incentiveCreator.address,
            pool: context.pool01,
            rewardToken: context.rewardToken.address,
            ...timestamps,
          },
          tokenId
        )
    })

    describe('works and', () => {
      it('decrements deposit numberOfStakes by 1', async () => {
        const { numberOfStakes: stakesPre } = await context.staker.deposits(
          tokenId
        )
        await subject()
        const { numberOfStakes: stakesPost } = await context.staker.deposits(
          tokenId
        )
        expect(stakesPre).to.not.equal(stakesPost.sub(1))
      })

      it('decrements incentive numberOfStakes by 1', async () => {
        const { numberOfStakes: stakesPre } = await context.staker.incentives(
          incentiveId
        )
        await subject()
        const { numberOfStakes: stakesPost } = await context.staker.incentives(
          incentiveId
        )
        expect(stakesPre).to.not.equal(stakesPost.sub(1))
      })

      it('emits an unstaked event', async () => {
        await expect(subject())
          .to.emit(context.staker, 'TokenUnstaked')
          .withArgs(tokenId, incentiveId)
      })

      it('has gas cost', async () => {
        await snapshotGasCost(subject())
      })

      it('updates the reward available for the context.staker', async () => {
        const rewardsAccured = await context.staker.rewards(
          context.rewardToken.address,
          lpUser0.address
        )
        await subject()
        expect(
          await context.staker.rewards(
            context.rewardToken.address,
            lpUser0.address
          )
        ).to.be.gt(rewardsAccured)
      })

      it('updates the stake struct', async () => {
        const stakeBefore = await context.staker.stakes(tokenId, incentiveId)
        await subject()
        const stakeAfter = await context.staker.stakes(tokenId, incentiveId)

        expect(stakeBefore.secondsPerLiquidityInsideInitialX128).to.gt(0)
        expect(stakeBefore.liquidity).to.gt(0)
        expect(stakeAfter.secondsPerLiquidityInsideInitialX128).to.eq(0)
        expect(stakeAfter.liquidity).to.eq(0)
      })

      it('calculates the right secondsPerLiquidity')
      it('does not overflow totalSecondsUnclaimed')
      it('anyone can unstake after the end time')
      it('owner can unstake after the end time')
    })

    describe('fails if', () => {
      it('you have not staked', async () => {
        await subject()
        await expect(subject()).to.revertedWith('stake does not exist')
      })
      it('stake has already been unstaked')
      it('non-owner tries to unstake before the end time')
    })
  })
})
