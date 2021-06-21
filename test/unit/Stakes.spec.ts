import { BigNumber, Wallet } from 'ethers'
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

describe('unit/Stakes', () => {
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

  before('loader', async () => {
    loadFixture = createFixtureLoader(provider.getWallets(), provider)
  })

  beforeEach('create fixture loader', async () => {
    context = await loadFixture(uniswapFixture)
    helpers = HelperCommands.fromTestContext(context, actors, provider)
  })

  describe('#stakeToken', () => {
    let incentiveId: string
    let incentiveArgs: HelperTypes.CreateIncentive.Args
    let subject: (_tokenId: string, _actor: Wallet) => Promise<any>

    beforeEach(async () => {
      context = await loadFixture(uniswapFixture)
      helpers = HelperCommands.fromTestContext(context, actors, provider)

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
        ['safeTransferFrom(address,address,uint256)'](lpUser0.address, context.staker.address, tokenId)

      incentiveArgs = {
        rewardToken: context.rewardToken,
        totalReward,
        poolAddress: context.poolObj.address,
        ...timestamps,
      }

      incentiveId = await helpers.getIncentiveId(await helpers.createIncentiveFlow(incentiveArgs))

      subject = (_tokenId: string, _actor: Wallet) =>
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

    describe('works and', () => {
      // Make sure the incentive has started
      beforeEach(async () => {
        await Time.set(timestamps.startTime + 100)
      })

      it('emits the stake event', async () => {
        const { liquidity } = await context.nft.positions(tokenId)
        await expect(subject(tokenId, lpUser0))
          .to.emit(context.staker, 'TokenStaked')
          .withArgs(tokenId, incentiveId, liquidity)
      })

      it('sets the stake struct properly', async () => {
        const liquidity = (await context.nft.positions(tokenId)).liquidity

        const stakeBefore = await context.staker.stakes(tokenId, incentiveId)
        const depositStakesBefore = (await context.staker.deposits(tokenId)).numberOfStakes
        await subject(tokenId, lpUser0)
        const stakeAfter = await context.staker.stakes(tokenId, incentiveId)
        const depositStakesAfter = (await context.staker.deposits(tokenId)).numberOfStakes

        expect(stakeBefore.secondsPerLiquidityInsideInitialX128).to.eq(0)
        expect(stakeBefore.liquidity).to.eq(0)
        expect(depositStakesBefore).to.eq(0)
        expect(stakeAfter.secondsPerLiquidityInsideInitialX128).to.be.gt(0)
        expect(stakeAfter.liquidity).to.eq(liquidity)
        expect(depositStakesAfter).to.eq(1)
      })

      it('increments the number of stakes on the deposit', async () => {
        const nStakesBefore: number = (await context.staker.deposits(tokenId)).numberOfStakes
        await subject(tokenId, lpUser0)

        expect((await context.staker.deposits(tokenId)).numberOfStakes).to.eq(nStakesBefore + 1)
      })

      it('increments the number of stakes on the incentive', async () => {
        const { numberOfStakes: stakesBefore } = await context.staker.incentives(incentiveId)

        await subject(tokenId, lpUser0)

        const { numberOfStakes: stakesAfter } = await context.staker.incentives(incentiveId)
        expect(stakesAfter.sub(stakesBefore)).to.eq(BN('1'))
      })

      it('has gas cost', async () => await snapshotGasCost(subject(tokenId, lpUser0)))
    })

    describe('fails when', () => {
      it('deposit is already staked in the incentive', async () => {
        await Time.set(timestamps.startTime + 500)
        await subject(tokenId, lpUser0)
        await expect(subject(tokenId, lpUser0)).to.be.revertedWith('UniswapV3Staker::stakeToken: token already staked')
      })

      it('you are not the owner of the deposit', async () => {
        await Time.set(timestamps.startTime + 500)
        // lpUser2 calls, we're using lpUser0 elsewhere.
        await expect(subject(tokenId, actors.lpUser2())).to.be.revertedWith(
          'UniswapV3Staker::stakeToken: only owner can stake token'
        )
      })

      it('has 0 liquidity in the position', async () => {
        await Time.set(timestamps.startTime + 500)
        await erc20Helper.ensureBalancesAndApprovals(
          lpUser0,
          [context.token0, context.token1],
          amountDesired,
          context.nft.address
        )

        const tokenId2 = await mintPosition(context.nft.connect(lpUser0), {
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

        await context.nft.connect(lpUser0).decreaseLiquidity({
          tokenId: tokenId2,
          liquidity: (await context.nft.positions(tokenId2)).liquidity,
          amount0Min: 0,
          amount1Min: 0,
          deadline: (await blockTimestamp()) + 1_000,
        })

        await context.nft
          .connect(lpUser0)
          ['safeTransferFrom(address,address,uint256)'](lpUser0.address, context.staker.address, tokenId2, {
            ...maxGas,
          })

        await expect(subject(tokenId2, lpUser0)).to.be.revertedWith(
          'UniswapV3Staker::stakeToken: cannot stake token with 0 liquidity'
        )
      })

      it('token id is for a different pool than the incentive', async () => {
        const incentive2 = await helpers.createIncentiveFlow({
          ...incentiveArgs,
          poolAddress: context.pool12,
        })
        const { tokenId: otherTokenId } = await helpers.mintFlow({
          lp: lpUser0,
          tokens: [context.token1, context.rewardToken],
        })

        await Time.setAndMine(incentive2.startTime + 1)

        await helpers.depositFlow({
          lp: lpUser0,
          tokenId: otherTokenId,
        })

        await expect(
          context.staker.connect(lpUser0).stakeToken(
            {
              refundee: incentiveCreator.address,
              pool: context.pool01,
              rewardToken: context.rewardToken.address,
              ...timestamps,
            },
            otherTokenId
          )
        ).to.be.revertedWith('UniswapV3Staker::stakeToken: token pool is not the incentive pool')
      })

      it('incentive key does not exist', async () => {
        await Time.setAndMine(timestamps.startTime + 20)

        await expect(
          context.staker.connect(lpUser0).stakeToken(
            {
              refundee: incentiveCreator.address,
              pool: context.pool01,
              rewardToken: context.rewardToken.address,
              ...timestamps,
              startTime: timestamps.startTime + 10,
            },
            tokenId
          )
        ).to.be.revertedWith('UniswapV3Staker::stakeToken: non-existent incentive')
      })

      it('is past the end time', async () => {
        await Time.set(timestamps.endTime + 100)
        await expect(subject(tokenId, lpUser0)).to.be.revertedWith('UniswapV3Staker::stakeToken: incentive ended')
      })

      it('is before the start time', async () => {
        if (timestamps.startTime < (await blockTimestamp())) {
          throw new Error('no good')
        }
        await Time.set(timestamps.startTime - 2)
        await expect(subject(tokenId, lpUser0)).to.be.revertedWith('UniswapV3Staker::stakeToken: incentive not started')
      })
    })
  })

  describe('#getRewardInfo', () => {
    let incentiveId: string
    let stakeIncentiveKey: ContractParams.IncentiveKey

    beforeEach('set up incentive and stake', async () => {
      timestamps = makeTimestamps((await blockTimestamp()) + 1_000)

      const mintResult = await helpers.mintFlow({
        lp: lpUser0,
        tokens: [context.token0, context.token1],
      })
      tokenId = mintResult.tokenId

      await context.nft
        .connect(lpUser0)
        ['safeTransferFrom(address,address,uint256)'](lpUser0.address, context.staker.address, tokenId)

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
      await context.staker.connect(lpUser0).stakeToken(stakeIncentiveKey, tokenId)
      await context.staker.stakes(tokenId, incentiveId)
    })

    it('returns correct rewardAmount and secondsInsideX128 for the position', async () => {
      const pool = context.poolObj.connect(actors.lpUser0())

      await provider.send('evm_mine', [timestamps.startTime + 100])

      const rewardInfo = await context.staker.connect(lpUser0).getRewardInfo(stakeIncentiveKey, tokenId)

      const { tickLower, tickUpper } = await context.nft.positions(tokenId)
      const { secondsPerLiquidityInsideX128 } = await pool.snapshotCumulativesInside(tickLower, tickUpper)
      const stake = await context.staker.stakes(tokenId, incentiveId)

      const expectedSecondsInPeriod = secondsPerLiquidityInsideX128
        .sub(stake.secondsPerLiquidityInsideInitialX128)
        .mul(stake.liquidity)

      // @ts-ignore
      expect(rewardInfo.reward).to.be.closeTo(BNe(1, 19), BN(1))
      expect(rewardInfo.secondsInsideX128).to.equal(expectedSecondsInPeriod)
    })

    it('returns nonzero for incentive after end time', async () => {
      await Time.setAndMine(timestamps.endTime + 1)

      const rewardInfo = await context.staker.connect(lpUser0).getRewardInfo(stakeIncentiveKey, tokenId)

      expect(rewardInfo.reward, 'reward is nonzero').to.not.equal(0)
      expect(rewardInfo.secondsInsideX128, 'reward is nonzero').to.not.equal(0)
    })

    it('reverts if stake does not exist', async () => {
      await Time.setAndMine(timestamps.endTime + 1)

      await expect(context.staker.connect(lpUser0).getRewardInfo(stakeIncentiveKey, '100')).to.be.revertedWith(
        'UniswapV3Staker::getRewardInfo: stake does not exist'
      )
    })
  })

  describe('#claimReward', () => {
    let createIncentiveResult: HelperTypes.CreateIncentive.Result
    let subject: (token: string, to: string, amount: BigNumber) => Promise<any>
    // The amount the user should be able to claim
    let claimable: BigNumber

    beforeEach('setup', async () => {
      timestamps = makeTimestamps(await blockTimestamp())
      const tokensToStake = [context.token0, context.token1] as [TestERC20, TestERC20]

      await erc20Helper.ensureBalancesAndApprovals(lpUser0, tokensToStake, amountDesired, context.nft.address)

      createIncentiveResult = await helpers.createIncentiveFlow({
        rewardToken: context.rewardToken,
        totalReward,
        poolAddress: context.poolObj.address,
        ...timestamps,
      })

      await Time.setAndMine(timestamps.startTime + 1)

      const mintResult = await helpers.mintDepositStakeFlow({
        lp: lpUser0,
        tokensToStake,
        ticks: [getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]), getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM])],
        amountsToStake: [amountDesired, amountDesired],
        createIncentiveResult,
      })
      tokenId = mintResult.tokenId

      await Time.setAndMine(timestamps.endTime - 1)
      await context.staker.connect(lpUser0).unstakeToken(
        {
          refundee: incentiveCreator.address,
          rewardToken: context.rewardToken.address,
          pool: context.pool01,
          ...timestamps,
        },
        tokenId
      )

      claimable = await context.staker.rewards(context.rewardToken.address, lpUser0.address)

      subject = (_token: string, _to: string, _amount: BigNumber) =>
        context.staker.connect(lpUser0).claimReward(_token, _to, _amount)
    })

    describe('when requesting the full amount', () => {
      it('emits RewardClaimed event', async () => {
        const { rewardToken } = context
        claimable = await context.staker.rewards(rewardToken.address, lpUser0.address)
        await expect(subject(rewardToken.address, lpUser0.address, BN('0')))
          .to.emit(context.staker, 'RewardClaimed')
          .withArgs(lpUser0.address, claimable)
      })

      it('transfers the correct reward amount to destination address', async () => {
        const { rewardToken } = context
        claimable = await context.staker.rewards(rewardToken.address, lpUser0.address)
        const balance = await rewardToken.balanceOf(lpUser0.address)
        await subject(rewardToken.address, lpUser0.address, BN('0'))
        expect(await rewardToken.balanceOf(lpUser0.address)).to.equal(balance.add(claimable))
      })

      it('sets the claimed reward amount to zero', async () => {
        const { rewardToken } = context
        expect(await context.staker.rewards(rewardToken.address, lpUser0.address)).to.not.equal(0)

        await subject(rewardToken.address, lpUser0.address, BN('0'))

        expect(await context.staker.rewards(rewardToken.address, lpUser0.address)).to.equal(0)
      })

      it('has gas cost', async () =>
        await snapshotGasCost(subject(context.rewardToken.address, lpUser0.address, BN('0'))))

      it('returns their claimable amount', async () => {
        const { rewardToken, staker } = context
        const amountBefore = await rewardToken.balanceOf(lpUser0.address)
        await subject(rewardToken.address, lpUser0.address, BN('0'))
        expect(await staker.rewards(rewardToken.address, lpUser0.address)).to.eq(BN('0'))
        expect(await rewardToken.balanceOf(lpUser0.address)).to.eq(amountBefore.add(claimable))
      })
    })

    describe('when requesting a nonzero amount', () => {
      it('emits RewardClaimed event', async () => {
        const { rewardToken } = context
        await expect(subject(rewardToken.address, lpUser0.address, claimable))
          .to.emit(context.staker, 'RewardClaimed')
          .withArgs(lpUser0.address, claimable)
      })

      it('transfers the correct reward amount to destination address', async () => {
        const { rewardToken } = context
        claimable = await context.staker.rewards(rewardToken.address, lpUser0.address)
        const balance = await rewardToken.balanceOf(lpUser0.address)
        await subject(rewardToken.address, lpUser0.address, claimable)
        expect(await rewardToken.balanceOf(lpUser0.address)).to.equal(balance.add(claimable))
      })

      it('sets the claimed reward amount to the correct amount', async () => {
        const { rewardToken, staker } = context
        const initialRewardBalance = await staker.rewards(rewardToken.address, lpUser0.address)
        expect(initialRewardBalance).to.not.equal(BN('0'))

        const partialClaim = initialRewardBalance.div(BN('3'))
        await subject(rewardToken.address, lpUser0.address, partialClaim)

        expect(await staker.rewards(rewardToken.address, lpUser0.address)).to.eq(initialRewardBalance.sub(partialClaim))
      })

      describe('when user claims more than they have', () => {
        it('only transfers what they have', async () => {
          const { rewardToken, staker } = context
          const amountBefore = await rewardToken.balanceOf(lpUser0.address)
          await subject(rewardToken.address, lpUser0.address, claimable.mul(BN('3')))
          expect(await staker.rewards(rewardToken.address, lpUser0.address)).to.eq(BN('0'))
          expect(await rewardToken.balanceOf(lpUser0.address)).to.eq(amountBefore.add(claimable))
        })
      })
    })
  })

  describe('#unstakeToken', () => {
    let incentiveId: string
    let subject: (actor: Wallet) => Promise<any>
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
        ['safeTransferFrom(address,address,uint256)'](lpUser0.address, context.staker.address, tokenId)

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

      subject = (_actor: Wallet) =>
        context.staker.connect(_actor).unstakeToken(
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
        const { numberOfStakes: stakesPre } = await context.staker.deposits(tokenId)
        await subject(lpUser0)
        const { numberOfStakes: stakesPost } = await context.staker.deposits(tokenId)
        expect(stakesPre).to.not.equal(stakesPost - 1)
      })

      it('decrements incentive numberOfStakes by 1', async () => {
        const { numberOfStakes: stakesPre } = await context.staker.incentives(incentiveId)
        await subject(lpUser0)
        const { numberOfStakes: stakesPost } = await context.staker.incentives(incentiveId)
        expect(stakesPre).to.not.equal(stakesPost.sub(1))
      })

      it('emits an unstaked event', async () => {
        await expect(subject(lpUser0)).to.emit(context.staker, 'TokenUnstaked').withArgs(tokenId, incentiveId)
      })

      it('has gas cost', async () => {
        await snapshotGasCost(subject(lpUser0))
      })

      it('updates the reward available for the context.staker', async () => {
        const rewardsAccured = await context.staker.rewards(context.rewardToken.address, lpUser0.address)
        await subject(lpUser0)
        expect(await context.staker.rewards(context.rewardToken.address, lpUser0.address)).to.be.gt(rewardsAccured)
      })

      it('updates the stake struct', async () => {
        const stakeBefore = await context.staker.stakes(tokenId, incentiveId)
        await subject(lpUser0)
        const stakeAfter = await context.staker.stakes(tokenId, incentiveId)

        expect(stakeBefore.secondsPerLiquidityInsideInitialX128).to.gt(0)
        expect(stakeBefore.liquidity).to.gt(0)
        expect(stakeAfter.secondsPerLiquidityInsideInitialX128).to.eq(0)
        expect(stakeAfter.liquidity).to.eq(0)
      })

      describe('after the end time', () => {
        beforeEach(async () => {
          // Fast-forward to after the end time
          await Time.setAndMine(timestamps.endTime + 1)
        })

        it('anyone can unstake', async () => {
          await subject(actors.lpUser1())
        })

        it('owner can unstake', async () => {
          await subject(lpUser0)
        })
      })

      it('calculates the right secondsPerLiquidity')
      it('does not overflow totalSecondsUnclaimed')
    })

    describe('fails if', () => {
      it('stake has already been unstaked', async () => {
        await Time.setAndMine(timestamps.endTime + 1)
        await subject(lpUser0)
        await expect(subject(lpUser0)).to.revertedWith('UniswapV3Staker::unstakeToken: stake does not exist')
      })

      it('you have not staked', async () => {
        await expect(subject(actors.lpUser2())).to.revertedWith(
          'UniswapV3Staker::unstakeToken: only owner can withdraw token'
        )
      })

      it('non-owner tries to unstake before the end time', async () => {
        const nonOwner = actors.lpUser2()
        await Time.setAndMine(timestamps.startTime + 100)
        await expect(subject(nonOwner)).to.revertedWith('UniswapV3Staker::unstakeToken: only owner can withdraw token')
        expect(await blockTimestamp(), 'test setup: after end time').to.be.lt(timestamps.endTime)
      })
    })
  })

  describe('liquidityIfOverflow', () => {
    const MAX_UINT_96 = BN('2').pow(BN('96')).sub(1)

    let incentive
    let incentiveId

    beforeEach(async () => {
      timestamps = makeTimestamps(1_000 + (await blockTimestamp()))
      incentive = await helpers.createIncentiveFlow({
        rewardToken: context.rewardToken,
        totalReward,
        poolAddress: context.poolObj.address,
        ...timestamps,
      })
      incentiveId = await helpers.getIncentiveId(incentive)
      await Time.setAndMine(timestamps.startTime + 1)
    })

    it('works when no overflow', async () => {
      // With this `amount`, liquidity ends up less than MAX_UINT96
      const amount = MAX_UINT_96.div(1000)

      const { tokenId } = await helpers.mintFlow({
        lp: lpUser0,
        tokens: [context.token0, context.token1],
        amounts: [amount, amount],
        tickLower: 0,
        tickUpper: 10 * TICK_SPACINGS[FeeAmount.MEDIUM],
      })

      await helpers.depositFlow({
        lp: lpUser0,
        tokenId,
      })

      await context.staker.connect(lpUser0).stakeToken(incentiveResultToStakeAdapter(incentive), tokenId)
      const { liquidity } = await context.staker.stakes(tokenId, incentiveId)
      expect(liquidity).to.be.lt(MAX_UINT_96)
    })

    it('works when overflow', async () => {
      // With this `amount`, liquidity ends up more than MAX_UINT96
      const amount = MAX_UINT_96.sub(100)
      const { tokenId } = await helpers.mintFlow({
        lp: lpUser0,
        tokens: [context.token0, context.token1],
        amounts: [amount, amount],
        tickLower: 0,
        tickUpper: 10 * TICK_SPACINGS[FeeAmount.MEDIUM],
      })

      await helpers.depositFlow({
        lp: lpUser0,
        tokenId,
      })

      await context.staker.connect(lpUser0).stakeToken(incentiveResultToStakeAdapter(incentive), tokenId)
      const { liquidity } = await context.staker.stakes(tokenId, incentiveId)
      expect(liquidity).to.be.gt(MAX_UINT_96)
    })
  })
})
