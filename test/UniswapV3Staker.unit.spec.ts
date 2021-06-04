import { constants, BigNumberish, Wallet } from 'ethers'
import { LoadFixtureFunction } from './types'
import { ethers } from 'hardhat'
import { UniswapV3Staker, TestERC20 } from '../typechain'
import {
  uniswapFixture,
  mintPosition,
  UniswapFixtureType,
} from './shared/fixtures'
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
  MAX_GAS_LIMIT,
  ActorFixture,
  erc20Wrap,
  makeTimestamps,
  maxGas,
} from './shared'
import { createFixtureLoader, provider } from './shared/provider'
import {
  HelperCommands,
  ERC20Helper,
  incentiveResultToStakeAdapter,
} from './helpers'

import { ContractParams } from '../types/contractParams'
import { createTimeMachine } from './shared/time'
import { HelperTypes } from './helpers/types'

let loadFixture: LoadFixtureFunction

describe('UniswapV3Staker.unit', async () => {
  /**
   * Instead of using wallet indexes, we use the actors fixture to
   * acces specific roles.
   */
  const actors = new ActorFixture(provider.getWallets(), provider)

  /**
   * By default, this EOA create incentives.
   */
  const incentiveCreator = actors.incentiveCreator()

  /**
   * By default, lpUser0 is the liquidity provider who gets the NFT.
   */
  const lpUser0 = actors.lpUser0()

  /**
   * How much the lp wants to deposit (of each token)
   */
  const amountDesired = BNe18(10)

  /**
   * Incentive programs will distribute this much of rewardToken.
   */
  const totalReward = BNe18(100)

  const erc20Helper = new ERC20Helper()
  const Time = createTimeMachine(provider)
  let helpers: HelperCommands

  /**
   * Access context this way instead of dealing with namespace collisions.
   * Context is always loaded from the test fixture.
   */
  let context: UniswapFixtureType

  /**
   * Helper for keeping track of startTime, endTime.
   */
  let timestamps: ContractParams.Timestamps

  before('loader', async () => {
    loadFixture = createFixtureLoader(provider.getWallets(), provider)
  })

  beforeEach('create fixture loader', async () => {
    context = await loadFixture(uniswapFixture)
    helpers = new HelperCommands({
      nft: context.nft,
      router: context.router,
      staker: context.staker,
      pool: context.poolObj,
      actors,
      provider,
      testIncentiveId: context.testIncentiveId,
    })
  })

  describe('deploying', async () => {
    it('deploys and has an address', async () => {
      const stakerFactory = await ethers.getContractFactory('UniswapV3Staker')
      const staker = (await stakerFactory.deploy(
        context.factory.address,
        context.nft.address
      )) as UniswapV3Staker
      expect(staker.address).to.be.a.string
    })
  })

  describe('Incentives', () => {
    describe('#createIncentive', () => {
      let subject: (
        params: Partial<ContractParams.CreateIncentive>
      ) => Promise<any>

      beforeEach('setup', async () => {
        subject = async (
          params: Partial<ContractParams.CreateIncentive> = {}
        ) => {
          await erc20Helper.ensureBalancesAndApprovals(
            incentiveCreator,
            params.rewardToken
              ? await erc20Wrap(params?.rewardToken)
              : context.rewardToken,
            totalReward,
            context.staker.address
          )

          const { startTime, endTime } = makeTimestamps(await blockTimestamp())

          return await context.staker.connect(incentiveCreator).createIncentive(
            {
              rewardToken: params.rewardToken || context.rewardToken.address,
              pool: context.pool01,
              startTime: params.startTime || startTime,
              endTime: params.endTime || endTime,
              refundee: params.refundee || incentiveCreator.address,
            },
            totalReward
          )
        }
      })

      describe('works and', () => {
        it('transfers the right amount of rewardToken', async () => {
          const balanceBefore = await context.rewardToken.balanceOf(
            context.staker.address
          )
          await subject({
            reward: totalReward,
            rewardToken: context.rewardToken.address,
          })
          expect(
            await context.rewardToken.balanceOf(context.staker.address)
          ).to.eq(balanceBefore.add(totalReward))
        })

        it('emits an event with valid parameters', async () => {
          const { startTime, endTime } = makeTimestamps(await blockTimestamp())
          await expect(subject({ startTime, endTime }))
            .to.emit(context.staker, 'IncentiveCreated')
            .withArgs(
              context.rewardToken.address,
              context.pool01,
              startTime,
              endTime,
              incentiveCreator.address,
              totalReward
            )
        })

        it('creates an incentive with the correct parameters', async () => {
          const timestamps = makeTimestamps(await blockTimestamp())
          await subject(timestamps)
          const incentiveId = await context.testIncentiveId.compute({
            rewardToken: context.rewardToken.address,
            pool: context.pool01,
            startTime: timestamps.startTime,
            endTime: timestamps.endTime,
            refundee: incentiveCreator.address,
          })

          const incentive = await context.staker.incentives(incentiveId)
          expect(incentive.totalRewardUnclaimed).to.equal(totalReward)
          expect(incentive.totalSecondsClaimedX128).to.equal(BN(0))
        })

        it('has gas cost', async () => {
          await snapshotGasCost(subject({}))
        })
      })

      describe('fails when', () => {
        it('there is already has an incentive with those params', async () => {
          const params = makeTimestamps(await blockTimestamp())
          expect(await subject(params)).to.emit(
            context.staker,
            'IncentiveCreated'
          )
          await expect(subject(params)).to.be.revertedWith(
            'incentive already exists'
          )
        })

        describe('invalid timestamps', () => {
          it('current time is after start time', async () => {
            const params = makeTimestamps(await blockTimestamp(), 100_000)

            // Go to after the start time
            await Time.setAndMine(params.startTime + 100)

            const now = await blockTimestamp()
            expect(now).to.be.greaterThan(
              params.startTime,
              'test setup: before start time'
            )

            expect(now).to.be.lessThan(
              params.endTime,
              'test setup: after end time'
            )

            await expect(subject(params)).to.be.revertedWith(
              'start time must be now or in the future'
            )
          })

          it('end time is before start time', async () => {
            const params = makeTimestamps(await blockTimestamp())
            params.endTime = params.startTime - 10
            await expect(subject(params)).to.be.revertedWith(
              'start time must be before end time'
            )
          })
        })

        describe('invalid reward', () => {
          const ERR_REWARD_INVALID = 'reward must be positive'

          it('totalReward is 0 or an invalid amount', async () => {
            const now = await blockTimestamp()

            await expect(
              context.staker.connect(incentiveCreator).createIncentive(
                {
                  rewardToken: context.rewardToken.address,
                  pool: context.pool01,
                  refundee: incentiveCreator.address,
                  ...makeTimestamps(now, 1_000),
                },
                BNe18(0)
              )
            ).to.be.revertedWith(ERR_REWARD_INVALID)
          })
        })
      })
    })

    describe('#endIncentive', async () => {
      let subject: (
        params: Partial<ContractParams.EndIncentive>
      ) => Promise<any>
      let createIncentiveResult: HelperTypes.CreateIncentive.Result

      beforeEach('setup', async () => {
        timestamps = makeTimestamps(await blockTimestamp())

        createIncentiveResult = await helpers.createIncentiveFlow({
          ...timestamps,
          rewardToken: context.rewardToken,
          poolAddress: context.poolObj.address,
          totalReward,
        })

        subject = async (params: Partial<ContractParams.EndIncentive> = {}) => {
          return await context.staker.connect(incentiveCreator).endIncentive({
            rewardToken: params.rewardToken || context.rewardToken.address,
            pool: context.pool01,
            startTime: params.startTime || timestamps.startTime,
            endTime: params.endTime || timestamps.endTime,
            refundee: incentiveCreator.address,
          })
        }
      })

      describe('works and', () => {
        it('emits IncentiveEnded event', async () => {
          await Time.set(timestamps.endTime + 10)

          const incentiveId = await helpers.getIncentiveId(
            createIncentiveResult
          )

          await expect(subject({}))
            .to.emit(context.staker, 'IncentiveEnded')
            .withArgs(incentiveId, '100000000000000000000')
        })

        it('deletes incentives[key]', async () => {
          const incentiveId = await helpers.getIncentiveId(
            createIncentiveResult
          )
          expect(
            (await context.staker.incentives(incentiveId)).totalRewardUnclaimed
          ).to.be.gt(0)

          await Time.set(timestamps.endTime + 1)
          await subject({})
          const {
            totalRewardUnclaimed,
            totalSecondsClaimedX128,
            numberOfStakes,
          } = await context.staker.incentives(incentiveId)
          expect(totalRewardUnclaimed).to.eq(0)
          expect(totalSecondsClaimedX128).to.eq(0)
          expect(numberOfStakes).to.eq(0)
        })

        it('has gas cost', async () => {
          await Time.set(timestamps.endTime + 1)
          await snapshotGasCost(subject({}))
        })
      })

      describe('reverts when', async () => {
        it('block.timestamp <= end time', async () => {
          await Time.set(timestamps.endTime - 10)
          await expect(subject({})).to.be.revertedWith(
            'cannot end incentive before end time'
          )
        })

        it('incentive does not exist', async () => {
          // Adjust the block.timestamp so it is after the claim deadline
          await Time.set(timestamps.endTime + 1)
          await expect(
            subject({
              startTime: (await blockTimestamp()) + 1000,
            })
          ).to.be.revertedWith('no refund available')
        })

        it('incentive has stakes', async () => {
          await Time.set(timestamps.startTime)

          // stake a token
          await helpers.mintDepositStakeFlow({
            lp: lpUser0,
            createIncentiveResult,
            tokensToStake: [context.token0, context.token1],
            ticks: [
              getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
            ],
            amountsToStake: [amountDesired, amountDesired],
          })

          // Adjust the block.timestamp so it is after the claim deadline
          await Time.set(timestamps.endTime + 1)
          await expect(subject({})).to.be.revertedWith(
            'cannot end incentive while deposits are staked'
          )
        })
      })
    })
  })

  describe('Deposits', () => {
    /**
     * In these tests, lpUser0 is the one depositing the token.
     */

    let subject: (tokenId: string, recipient: string) => Promise<any>
    let tokenId: string
    let recipient = lpUser0.address

    beforeEach(async () => {
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
    })

    describe('via nft#safeTransferFrom', () => {
      it('allows depositing without staking')
      it('allows depositing and staking for a single incentive')
      it('allows depositing and staking for two incentives')
      it(
        'reverts if staking information is less than 160 bytes and greater than 0 bytes'
      )
      it('reverts if staking information is invalid and greater than 160 bytes')
    })

    describe('#withdrawToken', () => {
      beforeEach(async () => {
        await context.nft
          .connect(lpUser0)
          ['safeTransferFrom(address,address,uint256)'](
            lpUser0.address,
            context.staker.address,
            tokenId
          )

        subject = (_tokenId, _recipient) =>
          context.staker.connect(lpUser0).withdrawToken(_tokenId, _recipient)
      })

      describe('works and', () => {
        it('emits a TokenWithdrawn event', async () =>
          await expect(subject(tokenId, recipient))
            .to.emit(context.staker, 'TokenWithdrawn')
            .withArgs(tokenId, recipient))

        it('transfers nft ownership', async () => {
          await subject(tokenId, recipient)
          expect(await context.nft.ownerOf(tokenId)).to.eq(recipient)
        })

        it('prevents you from withdrawing twice', async () => {
          await subject(tokenId, recipient)
          expect(await context.nft.ownerOf(tokenId)).to.eq(recipient)
          await expect(subject(tokenId, recipient)).to.be.reverted
        })

        it('deletes deposit upon withdrawal', async () => {
          expect((await context.staker.deposits(tokenId)).owner).to.equal(
            lpUser0.address
          )
          await subject(tokenId, recipient)
          expect((await context.staker.deposits(tokenId)).owner).to.equal(
            constants.AddressZero
          )
        })

        it('has gas cost', async () =>
          await snapshotGasCost(subject(tokenId, recipient)))
      })

      describe('fails if', () => {
        it('you are withdrawing a token that is not yours', async () => {
          const notOwner = actors.traderUser1()
          await expect(
            context.staker
              .connect(notOwner)
              .withdrawToken(tokenId, notOwner.address)
          ).to.revertedWith('only owner can withdraw token')
        })

        it('number of stakes is not 0', async () => {
          const timestamps = makeTimestamps(await blockTimestamp())
          const incentiveParams: HelperTypes.CreateIncentive.Args = {
            rewardToken: context.rewardToken,
            totalReward,
            poolAddress: context.poolObj.address,
            ...timestamps,
          }
          const incentive = await helpers.createIncentiveFlow(incentiveParams)
          await Time.setAndMine(timestamps.startTime + 1)
          await context.staker.connect(lpUser0).stakeToken(
            {
              ...incentive,
              pool: context.pool01,
              rewardToken: incentive.rewardToken.address,
            },
            tokenId
          )

          await expect(subject(tokenId, lpUser0.address)).to.revertedWith(
            'cannot withdraw token while staked'
          )
        })
      })
    })
  })

  describe('Stakes', () => {
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
            'only owner can withdraw token'
          )
        })

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
      let stake: ContractParams.Stake
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
        stake = await context.staker.stakes(tokenId, incentiveId)
      })

      it('returns correct rewardAmount and secondsInPeriodX128 for the position', async () => {
        const pool = context.poolObj.connect(actors.lpUser0())

        await provider.send('evm_mine', [timestamps.startTime + 100])

        const reward = await context.staker
          .connect(lpUser0)
          .getRewardAmount(stakeIncentiveKey, tokenId)

        const { tickLower, tickUpper } = await context.nft.positions(tokenId)
        const {
          secondsPerLiquidityInsideX128,
        } = await pool.snapshotCumulativesInside(tickLower, tickUpper)

        const expectedSecondsInPeriod = secondsPerLiquidityInsideX128
          .sub(stake.secondsPerLiquidityInsideInitialX128)
          .mul(stake.liquidity)

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
          const {
            numberOfStakes: stakesPost,
          } = await context.staker.incentives(incentiveId)
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
      })

      describe('fails if', () => {
        it('you have not staked', async () => {
          await subject()
          await expect(subject()).to.revertedWith('stake does not exist')
        })
      })
    })
  })

  describe('#onERC721Received', () => {
    const incentiveKeyAbi =
      'tuple(address rewardToken, address pool, uint256 startTime, uint256 endTime, address refundee)'
    let tokenId: BigNumberish
    let data: string
    let timestamps: ContractParams.Timestamps

    beforeEach('set up position', async () => {
      const { rewardToken } = context
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

      const incentive = await helpers.createIncentiveFlow({
        rewardToken,
        totalReward,
        poolAddress: context.poolObj.address,
        ...timestamps,
      })

      const incentiveKey: ContractParams.IncentiveKey = incentiveResultToStakeAdapter(
        incentive
      )

      data = ethers.utils.defaultAbiCoder.encode(
        [incentiveKeyAbi],
        [incentiveKey]
      )
    })

    describe('on successful transfer with staking data', () => {
      beforeEach('set the timestamp after the start time', async () => {
        await Time.set(timestamps.startTime + 1)
      })

      it('deposits the token', async () => {
        expect((await context.staker.deposits(1)).owner).to.equal(
          constants.AddressZero
        )
        await context.nft
          .connect(lpUser0)
          ['safeTransferFrom(address,address,uint256)'](
            lpUser0.address,
            context.staker.address,
            tokenId,
            {
              ...maxGas,
            }
          )
        expect((await context.staker.deposits(1)).owner).to.equal(
          lpUser0.address
        )
      })

      it('properly stakes the deposit in the select incentive', async () => {
        const incentiveId = await context.testIncentiveId.compute({
          rewardToken: context.rewardToken.address,
          pool: context.pool01,
          startTime: timestamps.startTime,
          endTime: timestamps.endTime,
          refundee: incentiveCreator.address,
        })
        await Time.set(timestamps.startTime + 10)
        const stakeBefore = await context.staker.stakes(tokenId, incentiveId)
        const depositBefore = await context.staker.deposits(tokenId)
        await context.nft
          .connect(lpUser0)
          ['safeTransferFrom(address,address,uint256,bytes)'](
            lpUser0.address,
            context.staker.address,
            tokenId,
            data,
            {
              ...maxGas,
              from: lpUser0.address,
            }
          )
        const stakeAfter = await context.staker.stakes(tokenId, incentiveId)

        expect(depositBefore.numberOfStakes).to.equal(0)
        expect(
          (await context.staker.deposits(tokenId)).numberOfStakes
        ).to.equal(1)
        expect(stakeBefore.secondsPerLiquidityInsideInitialX128).to.equal(0)
        expect(stakeAfter.secondsPerLiquidityInsideInitialX128).to.be.gt(0)
      })

      it('has gas cost', async () => {
        await snapshotGasCost(
          context.nft
            .connect(lpUser0)
            ['safeTransferFrom(address,address,uint256,bytes)'](
              lpUser0.address,
              context.staker.address,
              tokenId,
              data,
              {
                ...maxGas,
                from: lpUser0.address,
              }
            )
        )
      })
    })

    describe('on invalid call', async () => {
      it('reverts when called by contract other than uniswap v3 nonfungiblePositionManager', async () => {
        await expect(
          context.staker
            .connect(lpUser0)
            .onERC721Received(
              incentiveCreator.address,
              lpUser0.address,
              1,
              data
            )
        ).to.be.revertedWith('not a univ3 nft')
      })

      it('reverts when staking on invalid incentive', async () => {
        const invalidStakeParams = {
          rewardToken: context.rewardToken.address,
          refundee: incentiveCreator.address,
          pool: context.pool01,
          ...timestamps,
          startTime: 100,
        }

        let invalidData = ethers.utils.defaultAbiCoder.encode(
          [incentiveKeyAbi],
          [invalidStakeParams]
        )

        await expect(
          context.nft
            .connect(lpUser0)
            ['safeTransferFrom(address,address,uint256,bytes)'](
              lpUser0.address,
              context.staker.address,
              tokenId,
              invalidData
            )
        ).to.be.revertedWith('non-existent incentive')
      })
    })
  })

  describe('#multicall', () => {
    it('is implemented', async () => {
      const currentTime = await blockTimestamp()
      const multicaller = actors.traderUser2()

      await erc20Helper.ensureBalancesAndApprovals(
        multicaller,
        [context.token0, context.token1],
        amountDesired,
        context.nft.address
      )
      const tokenId = await mintPosition(context.nft.connect(multicaller), {
        token0: context.token0.address,
        token1: context.token1.address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: multicaller.address,
        amount0Desired: amountDesired,
        amount1Desired: amountDesired,
        amount0Min: 0,
        amount1Min: 0,
        deadline: currentTime + 10_000,
      })

      await erc20Helper.ensureBalancesAndApprovals(
        multicaller,
        context.rewardToken,
        totalReward,
        context.staker.address
      )

      const createIncentiveTx = context.staker.interface.encodeFunctionData(
        'createIncentive',
        [
          {
            pool: context.pool01,
            rewardToken: context.rewardToken.address,
            refundee: incentiveCreator.address,
            ...makeTimestamps(currentTime + 100),
          },
          totalReward,
        ]
      )
      await context.staker
        .connect(multicaller)
        .multicall([createIncentiveTx], maxGas)

      // expect((await context.staker.deposits(tokenId)).owner).to.eq(
      //   multicaller.address
      // )
    })
  })
})
