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
  divE18,
  ratioE18,
  bnSum,
} from './shared'
import { createTimeMachine } from './shared/time'
import { HelperCommands } from './helpers'
import { createFixtureLoader, provider } from './shared/provider'
import { ActorFixture } from './shared/actors'
import { Fixture } from 'ethereum-waffle'
import _ from 'lodash'
import { HelperTypes } from './helpers/types'

let loadFixture: LoadFixtureFunction

describe('UniswapV3Staker.math', async () => {
  const wallets = provider.getWallets()
  const Time = createTimeMachine(provider)

  type TestSubject = {
    stakes: Array<HelperTypes.MintStake.Result>
    createIncentiveResult: HelperTypes.CreateIncentive.Result
    helpers: HelperCommands
    context: TestContext
  }
  let subject: TestSubject
  const actors = new ActorFixture(wallets, provider)

  before('create fixture loader', async () => {
    loadFixture = createFixtureLoader(wallets, provider)
  })

  describe('there are three LPs in the same range', async () => {
    const totalReward = BNe18(3_000)
    const duration = days(30)
    const ticksToStake: [number, number] = [
      getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
    ]
    const amountsToStake: [BigNumber, BigNumber] = [BNe18(1_000), BNe18(1_000)]

    const scenario: Fixture<TestSubject> = async (wallets, provider) => {
      const context = await uniswapFixture(wallets, provider)
      const epoch = await blockTimestamp()

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

      return {
        context,
        stakes,
        helpers,
        createIncentiveResult,
      }
    }

    beforeEach('load fixture', async () => {
      // context = await loadFixture(fixture)
      subject = await loadFixture(scenario)
    })

    describe('who all stake the entire time ', async () => {
      it('allows them all to withdraw at the end', async () => {
        const { helpers, createIncentiveResult } = subject
        await Time.set(createIncentiveResult.endTime + 1)

        // Everyone pulls their liquidity at the same time
        const unstakes = await Promise.all(
          subject.stakes.map(({ lp, tokenId }) =>
            helpers.unstakeCollectBurnFlow({
              lp,
              tokenId,
              createIncentiveResult,
            })
          )
        )
        const rewardsEarned = bnSum(unstakes.map((o) => o.balance))
        log.debug('Total rewards ', rewardsEarned.toString())

        // Fast-forward until after the program ends
        await Time.set(createIncentiveResult.claimDeadline + 1)
        const { amountReturnedToCreator } = await helpers.endIncentiveFlow({
          createIncentiveResult,
        })
        expect(rewardsEarned.add(amountReturnedToCreator)).to.eq(totalReward)
      })
    })

    describe('when one LP unstakes halfway through', async () => {
      it('only gives them one sixth the total reward', async () => {
        const { helpers, createIncentiveResult, stakes } = subject
        const { startTime, endTime } = createIncentiveResult

        // Halfway through, lp0 decides they want out. Pauvre lp0.
        await Time.set(startTime + duration / 2)

        const [lpUser0, lpUser1, lpUser2] = actors.lpUsers()
        let unstakes: Array<HelperTypes.UnstakeCollectBurn.Result> = []

        unstakes.push(
          await helpers.unstakeCollectBurnFlow({
            lp: lpUser0,
            tokenId: stakes[0].tokenId,
            createIncentiveResult: subject.createIncentiveResult,
          })
        )

        /* Should be roughly 1/6 of the totalReward since they staked
          1/3 of total liquidity, for 1/2 the time. */
        expect(unstakes[0].balance).to.eq(BN('499989197530864021534'))

        // Now the other two LPs hold off till the end and unstake
        await Time.set(endTime + 1)
        const otherUnstakes = await Promise.all(
          stakes.slice(1).map(({ lp, tokenId }) =>
            helpers.unstakeCollectBurnFlow({
              lp,
              tokenId,
              createIncentiveResult,
            })
          )
        )
        unstakes.push(...otherUnstakes)

        await Time.set(createIncentiveResult.claimDeadline + 1)
        const { amountReturnedToCreator } = await helpers.endIncentiveFlow({
          createIncentiveResult,
        })

        /* lpUser{1,2} should each have 5/12 of the total rewards.
          (1/3 * 1/2) from before lpUser0 withdrew
          (1/2 * 1/2) from after lpUser0. */

        expect(ratioE18(unstakes[1].balance, unstakes[0].balance)).to.eq('2.50')
        expect(ratioE18(unstakes[2].balance, unstakes[1].balance)).to.eq('1.00')

        // All should add up to totalReward
        expect(
          bnSum(unstakes.map((u) => u.balance)).add(amountReturnedToCreator)
        ).to.eq(totalReward)
      })
    })

    describe('when another LP starts staking halfway through', async () => {
      describe('and provides half the liquidity', async () => {
        it('gives them a smaller share of the reward', async () => {
          const { helpers, createIncentiveResult, stakes, context } = subject
          const { startTime, endTime, claimDeadline } = createIncentiveResult

          // Halfway through, lp3 decides they want in. Good for them.
          await Time.set(startTime + duration / 2)

          const lpUser3 = actors.traderUser2()
          const tokensToStake: [TestERC20, TestERC20] = [
            context.tokens[0],
            context.tokens[1],
          ]

          stakes.push(
            await helpers.mintDepositStakeFlow({
              tokensToStake,
              amountsToStake: amountsToStake.map((a) => a.div(2)) as [
                BigNumber,
                BigNumber
              ],
              createIncentiveResult,
              ticks: ticksToStake,
              lp: lpUser3,
            })
          )

          // Now, go to the end and get rewards
          await Time.set(endTime + 1)

          const unstakes = await Promise.all(
            stakes.map(({ lp, tokenId }) =>
              helpers.unstakeCollectBurnFlow({
                lp,
                tokenId,
                createIncentiveResult,
              })
            )
          )

          expect(ratioE18(unstakes[2].balance, unstakes[3].balance)).to.eq(
            '4.34'
          )

          await Time.set(claimDeadline + 1)
          const { amountReturnedToCreator } = await helpers.endIncentiveFlow({
            createIncentiveResult,
          })

          expect(
            bnSum(unstakes.map((u) => u.balance)).add(amountReturnedToCreator)
          ).to.eq(totalReward)
        })
      })
    })
  })

  describe('when there are different ranges staked', async () => {
    it('rewards based on how long they are in range', async () => {})
  })

  describe('the liquidity moves outside of range', () => {
    it('only rewards those who are within range')
  })

  describe('when someone stakes, unstakes, then restakes', () => {})

  describe('the liquidity in the pool changes (from an unstaked LP)', () => {
    it('increases and rewards work')
    it('decreases and rewards work')
  })
})
