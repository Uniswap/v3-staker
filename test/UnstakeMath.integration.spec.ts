import { ethers, waffle } from 'hardhat'
import { TestContext, LoadFixtureFunction } from './types'
import { IUniswapV3Pool, TestERC20 } from '../typechain'
import {
  BigNumber,
  blockTimestamp,
  BN,
  BNe18,
  encodePath,
  expect,
  FeeAmount,
  getMaxTick,
  getMinTick,
  maxGas,
  MaxUint256,
  poolFactory,
  TICK_SPACINGS,
  uniswapFixture,
  log,
  days,
} from './shared'
import { createTimeMachine } from './shared/time'
import { HelperCommands } from './helpers'
import { createFixtureLoader, provider } from './shared/provider'
import { ActorFixture } from './shared/actors'
import { Fixture } from 'ethereum-waffle'
import _ from 'lodash'

let loadFixture: LoadFixtureFunction

type ThisTestContext = TestContext & { poolObj: IUniswapV3Pool }

describe('UniswapV3Staker.math', async () => {
  const wallets = provider.getWallets()
  const Time = createTimeMachine(provider)
  let context = {} as ThisTestContext
  let actors: ActorFixture

  before('create fixture loader', async () => {
    loadFixture = createFixtureLoader(wallets, provider)
  })

  const fixture: Fixture<ThisTestContext> = async (wallets, provider) => {
    const result = await loadFixture(uniswapFixture)
    return {
      ...result,
      poolObj: poolFactory.attach(result.pool01) as IUniswapV3Pool,
    }
  }

  beforeEach('load fixture', async () => {
    context = await loadFixture(fixture)
    actors = new ActorFixture(wallets, provider)
  })

  describe('when there are multiple LPs in the same range', async () => {
    it('allows them all to withdraw at the end', async () => {
      const {
        staker,
        nft,
        pool01,
        poolObj,
        tokens: [token0, token1, rewardToken],
      } = await loadFixture(fixture)

      const totalReward = BNe18(100)
      const [lpUser0, lpUser1] = [actors.lpUser0(), actors.lpUser1()]
      const epoch = await blockTimestamp()
      await Time.set(epoch + 1)

      // Test parameters:
      const incentiveStartsAt = epoch + 1000
      const amountsToStake: [BigNumber, BigNumber] = [
        BNe18(1_000),
        BNe18(1_000),
      ]
      const tokensToStake: [TestERC20, TestERC20] = [token0, token1]

      /* The LPs will always be within bounds since they're providing against
        the entire liquidity space */
      const ticksToStake: [number, number] = [
        getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      ]

      let balances = {}

      const helpers = new HelperCommands({
        provider,
        staker,
        nft,
        pool: poolObj,
        actors,
      })

      // Pool should not have any initial liquidity so that our math is easier.
      expect(await poolObj.connect(lpUser0).liquidity()).to.eq(BN(0))

      await Time.step(1)
      const createIncentiveResult = await helpers.createIncentiveFlow({
        startTime: incentiveStartsAt,
        rewardToken,
        poolAddress: pool01,
        totalReward,
      })
      balances = {
        [lpUser0.address]: await rewardToken.balanceOf(lpUser0.address),
        [lpUser1.address]: await rewardToken.balanceOf(lpUser1.address),
      }

      const mintDepositStakeParams = {
        tokensToStake,
        amountsToStake,
        createIncentiveResult,
        ticks: ticksToStake,
      }

      log.debug('incentiveStartsAt=', incentiveStartsAt)
      await Time.step(1)
      await Time.set(incentiveStartsAt)
      // lpUser{0,1} stake from 0 - MAX

      const {
        tokenId: lp0token0,
        stakedAt: token0StakedAt,
      } = await helpers.mintDepositStakeFlow({
        ...mintDepositStakeParams,
        lp: lpUser0,
      })

      await Time.step(1)
      const {
        tokenId: lp1token0,
        stakedAt: token1StakedAt,
      } = await helpers.mintDepositStakeFlow({
        ...mintDepositStakeParams,
        lp: lpUser1,
      })

      log.debug(`token0StakedAt=${token0StakedAt}`)
      log.debug(`token1StakedAt=${token1StakedAt}`)
      // Time passes, we get to the end of the incentive program

      // lpUser0 pulls out their liquidity
      await Time.set(createIncentiveResult.endTime)
      const {
        balance: lp0RewardBalance,
        unstakedAt: token0UnstakedAt,
      } = await helpers.unstakeCollectBurnFlow({
        lp: actors.lpUser0(),
        tokenId: lp0token0,
        createIncentiveResult,
      })

      await Time.step(1)

      // lpUser1 pulls out their liquidity
      const {
        balance: lp1RewardBalance,
        unstakedAt: token1UnstakedAt,
      } = await helpers.unstakeCollectBurnFlow({
        lp: actors.lpUser1(),
        tokenId: lp1token0,
        createIncentiveResult,
      })

      log.debug(`token0UnstakedAt=${token0UnstakedAt}`)
      log.debug(`token1UnstakedAt=${token1UnstakedAt}`)

      const lp0Reward = await rewardToken.balanceOf(lpUser0.address)
      log.debug(
        `lpUser0 bal before=${balances[
          lpUser0.address
        ].toString()} delta=${lp0Reward
          .sub(balances[lpUser0.address])
          .toString()}`
      )
      log.debug(lp0RewardBalance.toString())

      const lp1Reward = await rewardToken.balanceOf(lpUser1.address)
      log.debug(
        `lpUser1 bal before=${balances[
          lpUser1.address
        ].toString()} delta=${lp1Reward
          .sub(balances[lpUser1.address])
          .toString()}`
      )
      log.debug(lp1RewardBalance.toString())

      // Fast-forward until after the program ends
      await Time.set(createIncentiveResult.claimDeadline + 1)
      const { amountReturnedToCreator } = await helpers.endIncentiveFlow({
        createIncentiveResult,
      })

      expect(amountReturnedToCreator.add(lp0Reward).add(lp1Reward)).to.eq(
        totalReward
      )
    })
  })

  describe('when one LP unstakes halfway through', async () => {
    it('only gives them half because they were there half the time', async () => {
      // Three LPs. One unstakes halfway through.
      const epoch = await blockTimestamp()
      const totalReward = BNe18(3_000)

      const {
        tokens: [token0, token1, rewardToken],
      } = context
      const helpers = new HelperCommands({
        provider,
        staker: context.staker,
        nft: context.nft,
        pool: context.poolObj,
        actors,
      })
      const tokensToStake: [TestERC20, TestERC20] = [token0, token1]
      const amountsToStake: [BigNumber, BigNumber] = [
        BNe18(1_000),
        BNe18(1_000),
      ]
      const ticksToStake: [number, number] = [
        getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      ]
      const duration = days(30)
      const startTime = epoch + 1_000
      const endTime = startTime + duration

      const createIncentiveResult = await helpers.createIncentiveFlow({
        startTime,
        endTime,
        rewardToken,
        poolAddress: context.pool01,
        totalReward,
      })

      const params = {
        tokensToStake,
        amountsToStake,
        createIncentiveResult,
        ticks: ticksToStake,
      }

      await Time.set(startTime + 1)

      const stakes = await Promise.all(
        actors.lpUsers().map((lp) =>
          helpers.mintDepositStakeFlow({
            ...params,
            lp,
          })
        )
      )

      // Halfway through, lp0 decides they want out
      await Time.set(startTime + duration / 2)

      const [lpUser0, lpUser1, lpUser2] = actors.lpUsers()
      const {
        balance: lpUser0Balance,
        unstakedAt: lpUser0UnstakedAt,
      } = await helpers.unstakeCollectBurnFlow({
        lp: lpUser0,
        tokenId: stakes[0].tokenId,
        createIncentiveResult,
      })

      /* Should be roughly 1/6 of the totalReward since they staked
        1/3 of total liquidity, for 1/2 the time. */
      expect(lpUser0Balance).to.eq(BN('499989197530864021534'))

      // Now the other two LPs hold off till the end and unstake
      await Time.set(endTime + 1)
      const { balance: lpUser1Balance } = await helpers.unstakeCollectBurnFlow({
        lp: lpUser1,
        tokenId: stakes[1].tokenId,
        createIncentiveResult,
      })

      const { balance: lpUser2Balance } = await helpers.unstakeCollectBurnFlow({
        lp: lpUser2,
        tokenId: stakes[2].tokenId,
        createIncentiveResult,
      })

      await Time.set(createIncentiveResult.claimDeadline + 1)
      const { amountReturnedToCreator } = await helpers.endIncentiveFlow({
        createIncentiveResult,
      })
      /* lpUser{1,2} should each have 5/12 of the total rewards.

        (1/3 * 1/2) from before lpUser0 withdrew
        (1/2 * 1/2) from after lpUser0. */
      const divE18 = (n: BigNumber) => n.div(BNe18('1')).toNumber()
      const ratio = (a: BigNumber, b: BigNumber) =>
        (divE18(a) / divE18(b)).toFixed(2)

      expect(ratio(lpUser1Balance, lpUser0Balance)).to.eq('2.50')
      expect(ratio(lpUser2Balance, lpUser1Balance)).to.eq('1.00')

      // It returns what is left to the incentiveCreator and the totals add up
      expect(
        lpUser0Balance
          .add(lpUser1Balance)
          .add(lpUser2Balance)
          .add(amountReturnedToCreator)
      ).to.eq(totalReward)
    })
  })

  describe('when someone starts staking halfway through', () => {})

  describe('when there are different ranges staked', () => {
    it('respects the proportions in which they are in range')
  })
  describe('when everyone waits until claimDeadline', () => {
    it('gives them the right amount of reward')
  })
  describe('when someone stakes, unstakes, then restakes', () => {})

  describe('the liquidity in the pool changes (from a non-staker?)', () => {
    it('increases and rewards work')
    it('decreases and rewards work')
  })

  describe('the liquidity moves outside of one persons bounds', () => {
    it('only rewards those who are within range')
  })
})
