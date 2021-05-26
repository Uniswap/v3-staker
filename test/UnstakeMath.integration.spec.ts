import { ethers, waffle } from 'hardhat'
import { TestContext, TimeSetterFunction, LoadFixtureFunction } from './types'
import { IUniswapV3Pool, TestERC20 } from '../typechain'
import {
  BigNumber,
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
  setTime,
  TICK_SPACINGS,
  uniswapFixture,
} from './shared'
import { HelperCommands } from './helpers'
import { createFixtureLoader, provider } from './shared/provider'
import { ActorFixture } from './shared/actors'
import { Fixture } from 'ethereum-waffle'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let loadFixture: LoadFixtureFunction

describe.only('UniswapV3Staker.math', async () => {
  const wallets = provider.getWallets()
  let ctx = {} as TestContext
  let actors: ActorFixture

  const Time: { set: TimeSetterFunction; step: TimeSetterFunction } = {
    set: async (timestamp: number) => {
      console.info(`🕒 setTime(${timestamp})`)
      // Not sure if I need both of those
      await provider.send('evm_setNextBlockTimestamp', [timestamp])
      await ethers.provider.send('evm_setNextBlockTimestamp', [timestamp])
    },

    step: async (interval: number) => {
      console.info(`🕒 increaseTime(${interval})`)
      await provider.send('evm_increaseTime', [interval])
      await ethers.provider.send('evm_increaseTime', [interval])
    },
  }

  const fixture: Fixture<TestContext> = async (wallets, provider) => {
    return await loadFixture(uniswapFixture)
  }

  before('create fixture loader', async () => {
    loadFixture = createFixtureLoader(wallets, provider)
  })

  beforeEach('load fixture', async () => {
    ctx = await loadFixture(fixture)
    actors = new ActorFixture(wallets, provider)
  })

  describe('complex situations', () => {
    let context: TestContext

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
          tokens: [token0, token1, rewardToken],
        } = context

        const [lpUser0, lpUser1] = [actors.lpUser0(), actors.lpUser1()]
        const totalReward = BNe18(100)

        const poolObj = poolFactory
          .attach(pool01)
          .connect(lpUser0) as IUniswapV3Pool

        // Test parameters:

        const epoch = 10

        await Time.set(epoch)

        const incentiveStartsAt = epoch + 10
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

        const helpers = new HelperCommands(
          provider,
          staker,
          nft,
          poolObj,
          actors
        )

        // Pool should not have any initial liquidity so that our math is easier.
        expect(await poolObj.liquidity()).to.eq(BN(0))

        const createIncentiveResult = await helpers.createIncentiveFlow({
          startTime: incentiveStartsAt,
          rewardToken,
          poolAddress: pool01,
          totalReward,
        })
        await Time.set(createIncentiveResult.startTime)
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

        // lpUser{0,1} stake from 0 - MAX
        const { tokenId: lp0token0 } = await helpers.mintDepositStakeFlow({
          ...mintDepositStakeParams,
          lp: lpUser0,
        })
        const { tokenId: lp1token0 } = await helpers.mintDepositStakeFlow({
          ...mintDepositStakeParams,
          lp: lpUser1,
        })

        // Time passes, we get to the end of the incentive program

        // lpUser0 pulls out their liquidity
        await Time.set(createIncentiveResult.startTime + 86400)
        const {
          balance: lp0RewardBalance,
        } = await helpers.unstakeCollectBurnFlow({
          lp: actors.lpUser0(),
          tokenId: lp0token0,
          createIncentiveResult,
        })

        await Time.step(1)

        // lpUser1 pulls out their liquidity
        // await freezeTime(createIncentiveResult.startTime + 86400)
        const {
          balance: lp1RewardBalance,
        } = await helpers.unstakeCollectBurnFlow({
          lp: actors.lpUser1(),
          tokenId: lp1token0,
          createIncentiveResult,
        })

        const bal0 = await rewardToken.balanceOf(lpUser0.address)
        console.info(
          `lpUser0 bal before=${balances[
            lpUser0.address
          ].toString()} delta=${bal0.sub(balances[lpUser0.address]).toString()}`
        )
        console.info(lp0RewardBalance.toString())

        const bal1 = await rewardToken.balanceOf(lpUser1.address)
        console.info(
          `lpUser1 bal before=${balances[
            lpUser1.address
          ].toString()} delta=${bal1.sub(balances[lpUser1.address]).toString()}`
        )
        console.info(lp1RewardBalance.toString())

        // This will fail until we have the MockTimeStaker in place.
        // expect(bal0.add(bal1)).to.eq(totalReward)
      })
    })

    describe('when someone unstakes halfway through', () => {
      it('only gives them half because they were there half the time')
      it(
        'make sure the other people are getting their amount plus the leftover from the account that unstaked'
      )
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
})
