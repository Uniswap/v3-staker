import { constants, BigNumberish, Wallet } from 'ethers'
import { LoadFixtureFunction } from './types'
import { ethers } from 'hardhat'
import { UniswapV3Staker } from '../typechain/UniswapV3Staker'
import { TestERC20 } from '../typechain'
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
import _ from 'lodash'

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
   * Helper for keeping track of startTime, endTime, claimDeadline.
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

  describe('#createIncentive', async () => {
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

        const { startTime, endTime, claimDeadline } = makeTimestamps(
          await blockTimestamp()
        )

        return await context.staker.connect(incentiveCreator).createIncentive({
          rewardToken: params.rewardToken || context.rewardToken.address,
          pool: context.pool01,
          startTime: params.startTime || startTime,
          endTime: params.endTime || endTime,
          claimDeadline: params.claimDeadline || claimDeadline,
          totalReward,
        })
      }
    })

    describe('works and', async () => {
      it('transfers the right amount of rewardToken', async () => {
        const balanceBefore = await context.rewardToken.balanceOf(
          context.staker.address
        )
        await subject({
          totalReward,
          rewardToken: context.rewardToken.address,
        })
        expect(
          await context.rewardToken.balanceOf(context.staker.address)
        ).to.eq(balanceBefore.add(totalReward))
      })

      it('emits an event with valid parameters', async () => {
        const { startTime, endTime, claimDeadline } = makeTimestamps(
          await blockTimestamp()
        )
        await expect(subject({ startTime, endTime, claimDeadline }))
          .to.emit(context.staker, 'IncentiveCreated')
          .withArgs(
            context.rewardToken.address,
            context.pool01,
            startTime,
            endTime,
            claimDeadline,
            totalReward
          )
      })

      it('creates an incentive with the correct parameters', async () => {
        const timestamps = makeTimestamps(await blockTimestamp())
        await subject(timestamps)
        const incentiveId = await context.incentiveHelper.getIncentiveId(
          incentiveCreator.address,
          context.rewardToken.address,
          context.pool01,
          timestamps.startTime,
          timestamps.endTime,
          timestamps.claimDeadline
        )

        const incentive = await context.staker.incentives(incentiveId)
        expect(incentive.totalRewardUnclaimed).to.equal(totalReward)
        expect(incentive.totalSecondsClaimedX128).to.equal(BN(0))
        expect(incentive.rewardToken).to.equal(context.rewardToken.address)
      })

      it('has gas cost', async () => {
        await snapshotGasCost(subject({}))
      })
    })

    describe('fails when', async () => {
      it('there is already has an incentive with those params', async () => {
        const params = await makeTimestamps((await blockTimestamp()) + 10)
        expect(await subject(params)).to.emit(
          context.staker,
          'IncentiveCreated'
        )
        await expect(subject(params)).to.be.revertedWith('INCENTIVE_EXISTS')
      })

      it('claim deadline is not greater than or equal to end time', async () => {
        const params = await makeTimestamps((await blockTimestamp()) + 10)
        params.endTime = params.claimDeadline + 100
        await expect(subject(params)).to.be.revertedWith(
          'claimDeadline_not_gte_endTime'
        )
      })

      it('end time is not gte start time', async () => {
        const params = makeTimestamps((await blockTimestamp()) + 10)
        params.endTime = params.startTime - 10
        await expect(subject(params)).to.be.revertedWith(
          'endTime_not_gte_startTime'
        )
      })

      it('rewardToken is 0 address', async () =>
        await expect(
          context.staker.connect(incentiveCreator).createIncentive({
            rewardToken: constants.AddressZero,
            pool: context.pool01,
            totalReward,
            ...makeTimestamps(0),
          })
        ).to.be.revertedWith('INVALID_REWARD_ADDRESS'))

      it('totalReward is 0 or an invalid amount', async () =>
        await expect(
          context.staker.connect(incentiveCreator).createIncentive({
            rewardToken: context.rewardToken.address,
            pool: context.pool01,
            totalReward: BNe18(0),
            ...makeTimestamps(0),
          })
        ).to.be.revertedWith('INVALID_REWARD_AMOUNT'))
    })
  })

  describe('#endIncentive', async () => {
    let subject: (params: Partial<ContractParams.EndIncentive>) => Promise<any>
    beforeEach('setup', async () => {
      timestamps = makeTimestamps(await blockTimestamp())

      await helpers.createIncentiveFlow({
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
          claimDeadline: params.claimDeadline || timestamps.claimDeadline,
        })
      }
    })

    describe('works and', () => {
      it('emits IncentiveEnded event', async () => {
        await Time.set(timestamps.claimDeadline + 10)

        await expect(subject({}))
          .to.emit(context.staker, 'IncentiveEnded')
          .withArgs(
            context.rewardToken.address,
            context.pool01,
            timestamps.startTime,
            timestamps.endTime
          )
      })

      it('deletes incentives[key]', async () => {
        const incentiveId = await context.incentiveHelper.getIncentiveId(
          incentiveCreator.address,
          context.rewardToken.address,
          context.pool01,
          timestamps.startTime,
          timestamps.endTime,
          timestamps.claimDeadline
        )
        expect(
          (await context.staker.incentives(incentiveId)).rewardToken
        ).to.eq(context.rewardToken.address)

        await Time.set(timestamps.claimDeadline + 1)
        await subject({})
        expect(
          (await context.staker.incentives(incentiveId)).rewardToken
        ).to.eq(constants.AddressZero)
      })

      it('has gas cost', async () => {
        await Time.set(timestamps.claimDeadline + 1)
        await snapshotGasCost(subject({}))
      })
    })

    describe('fails when', async () => {
      it('block.timestamp <= claim deadline', async () => {
        await Time.set(timestamps.claimDeadline - 10)
        await expect(subject({})).to.be.revertedWith(
          'TIMESTAMP_LTE_CLAIMDEADLINE'
        )
      })

      it('incentive does not exist', async () => {
        // Adjust the block.timestamp so it is after the claim deadline
        Time.set(timestamps.claimDeadline + 1)
        await expect(
          subject({
            startTime: (await blockTimestamp()) + 1000,
          })
        ).to.be.revertedWith('INVALID_INCENTIVE')
      })
    })
  })

  describe('Deposit/Withdraw', () => {
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

      await context.nft
        .connect(lpUser0)
        .approve(context.staker.address, tokenId, {
          gasLimit: MAX_GAS_LIMIT,
        })
    })

    describe('#depositToken', () => {
      subject = async () =>
        await context.staker.connect(lpUser0).depositToken(tokenId)

      describe('works and', async () => {
        it('emits a Deposited event', async () => {
          await expect(subject(tokenId, lpUser0.address))
            .to.emit(context.staker, 'TokenDeposited')
            .withArgs(tokenId, lpUser0.address)
        })

        it('transfers ownership of the NFT', async () => {
          await subject(tokenId, lpUser0.address)
          expect(await context.nft.ownerOf(tokenId)).to.eq(
            context.staker.address
          )
        })

        it('sets owner and maintains numberOfStakes at 0', async () => {
          await subject(tokenId, lpUser0.address)
          const deposit = await context.staker.deposits(tokenId)
          expect(deposit.owner).to.eq(lpUser0.address)
          expect(deposit.numberOfStakes).to.eq(0)
        })

        it('has gas cost', async () => {
          await snapshotGasCost(subject(tokenId, lpUser0.address))
        })
      })
      /*
      Other possible cases to consider:
        * What if make nft.safeTransferFrom is adversarial in some way?
        * What happens if the nft.safeTransferFrom call fails
        * What if tokenId is invalid
        * What happens if I call deposit() twice with the same tokenId?
        * Ownership checks around tokenId? Can you transfer something that is not yours?
      */
    })

    describe('#withdrawToken', () => {
      beforeEach(async () => {
        await context.staker.connect(lpUser0).depositToken(tokenId)

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
          ).to.revertedWith('NOT_YOUR_NFT')
        })

        it('number of stakes is not 0', async () => {
          const incentiveParams: HelperTypes.CreateIncentive.Args = {
            rewardToken: context.rewardToken,
            totalReward,
            poolAddress: context.poolObj.address,
            ...makeTimestamps(await blockTimestamp()),
          }
          const incentive = await helpers.createIncentiveFlow(incentiveParams)

          await context.staker.connect(lpUser0).stakeToken({
            ...incentive,
            rewardToken: incentive.rewardToken.address,
            creator: incentive.creatorAddress,
            tokenId,
          })

          await expect(subject(tokenId, lpUser0.address)).to.revertedWith(
            'NUMBER_OF_STAKES_NOT_ZERO'
          )
        })
      })
    })
  })

  describe('Stake/Unstake', () => {
    /**
     * lpUser0 stakes and unstakes
     */
    let tokenId: string

    describe('#stakeToken', () => {
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
          .approve(context.staker.address, tokenId, { gasLimit: MAX_GAS_LIMIT })

        await context.staker.connect(lpUser0).depositToken(tokenId)
        const incentiveParams: HelperTypes.CreateIncentive.Args = {
          rewardToken: context.rewardToken,
          totalReward,
          poolAddress: context.poolObj.address,
          ...timestamps,
        }
        const incentive = await helpers.createIncentiveFlow(incentiveParams)

        subject = (_tokenId: string, _actor: Wallet = lpUser0) =>
          context.staker.connect(_actor).stakeToken({
            creator: incentiveCreator.address,
            rewardToken: context.rewardToken.address,
            tokenId: _tokenId,
            ...timestamps,
          })
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
            .withArgs(tokenId, liquidity)
        })

        it('sets the stake struct properly', async () => {
          const liquidity = (await context.nft.positions(tokenId)).liquidity
          const incentiveId = await context.incentiveHelper.getIncentiveId(
            incentiveCreator.address,
            context.rewardToken.address,
            context.pool01,
            timestamps.startTime,
            timestamps.endTime,
            timestamps.claimDeadline
          )

          const stakeBefore = await context.staker.stakes(tokenId, incentiveId)
          const nStakesBefore = (await context.staker.deposits(tokenId))
            .numberOfStakes
          await subject(tokenId)
          const stakeAfter = await context.staker.stakes(tokenId, incentiveId)

          expect(stakeBefore.secondsPerLiquidityInitialX128).to.eq(0)
          expect(stakeBefore.liquidity).to.eq(0)
          expect(stakeBefore.exists).to.be.false
          expect(stakeAfter.secondsPerLiquidityInitialX128).to.be.gt(0)
          expect(stakeAfter.liquidity).to.eq(liquidity)
          expect(stakeAfter.exists).to.be.true
          expect((await context.staker.deposits(tokenId)).numberOfStakes).to.eq(
            nStakesBefore + 1
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
            'NOT_YOUR_DEPOSIT'
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
            'incentive not started yet'
          )
        })
      })
    })

    describe('#unstakeToken', () => {
      let subject: () => Promise<any>

      beforeEach(async () => {
        timestamps = makeTimestamps(await blockTimestamp())

        const createIncentiveResult = await helpers.createIncentiveFlow({
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
          .approve(context.staker.address, tokenId, { gasLimit: MAX_GAS_LIMIT })

        await context.staker.connect(lpUser0).depositToken(tokenId)

        await context.staker.connect(lpUser0).stakeToken({
          creator: incentiveCreator.address,
          rewardToken: context.rewardToken.address,
          tokenId,
          ...timestamps,
        })

        subject = () =>
          context.staker.connect(lpUser0).unstakeToken({
            creator: incentiveCreator.address,
            rewardToken: context.rewardToken.address,
            tokenId,
            ...timestamps,
          })
      })

      describe('works and', async () => {
        it('decrements numberOfStakes by 1', async () => {
          const { numberOfStakes: stakesPre } = await context.staker.deposits(
            tokenId
          )
          await subject()
          const { numberOfStakes: stakesPost } = await context.staker.deposits(
            tokenId
          )
          expect(stakesPre).to.not.equal(stakesPost - 1)
        })

        it('emits an unstaked event', async () => {
          await expect(subject())
            .to.emit(context.staker, 'TokenUnstaked')
            .withArgs(tokenId)
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
          const liquidity = (await context.nft.positions(tokenId)).liquidity
          const incentiveId = await context.incentiveHelper.getIncentiveId(
            incentiveCreator.address,
            context.rewardToken.address,
            context.pool01,
            timestamps.startTime,
            timestamps.endTime,
            timestamps.claimDeadline
          )

          const stakeBefore = await context.staker.stakes(tokenId, incentiveId)
          await subject()
          const stakeAfter = await context.staker.stakes(tokenId, incentiveId)

          expect(stakeBefore.secondsPerLiquidityInitialX128).to.gt(0)
          expect(stakeBefore.liquidity).to.gt(0)
          expect(stakeBefore.exists).to.be.true
          expect(stakeAfter.secondsPerLiquidityInitialX128).to.eq(0)
          expect(stakeAfter.liquidity).to.eq(0)
          expect(stakeAfter.exists).to.be.false
        })

        it('calculates the right secondsPerLiquidity')
        it('does not overflow totalSecondsUnclaimed')
      })

      describe('fails if', () => {
        it('you have not staked', async () => {
          await subject()
          expect(subject()).to.revertedWith('Stake does not exist')
        })
      })
    })
  })

  describe('#onERC721Received', () => {
    const stakeParamsEncodeType =
      'tuple(address creator, address rewardToken, uint256 tokenId, uint32 startTime, uint32 endTime, uint32 claimDeadline)'
    let tokenId: BigNumberish
    let data: string
    let timestamps: ContractParams.Timestamps

    beforeEach(async () => {
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

      const stakeParams: ContractParams.StakeToken = incentiveResultToStakeAdapter(
        {
          ...incentive,
          tokenId,
        }
      )

      data = ethers.utils.defaultAbiCoder.encode(
        [stakeParamsEncodeType],
        [stakeParams]
      )
    })

    describe('on successful transfer with staking data', () => {
      beforeEach(async () => {
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
        const incentiveId = await context.incentiveHelper.getIncentiveId(
          incentiveCreator.address,
          context.rewardToken.address,
          context.pool01,
          timestamps.startTime,
          timestamps.endTime,
          timestamps.claimDeadline
        )
        Time.set(timestamps.startTime + 10)
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
        expect(stakeBefore.secondsPerLiquidityInitialX128).to.equal(0)
        expect(stakeBefore.exists).to.be.false
        expect(stakeAfter.secondsPerLiquidityInitialX128).to.be.gt(0)
        expect(stakeAfter.exists).to.be.true
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
        ).to.be.revertedWith('uniswap v3 nft only')
      })

      it('reverts when staking on invalid incentive', async () => {
        const invalidStakeParams = {
          creator: incentiveCreator.address,
          rewardToken: context.rewardToken.address,
          tokenId,
          ...timestamps,
          startTime: 100,
        }

        let invalidData = ethers.utils.defaultAbiCoder.encode(
          [stakeParamsEncodeType],
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

      await context.nft
        .connect(multicaller)
        .approve(context.staker.address, tokenId)

      const createIncentiveTx = context.staker.interface.encodeFunctionData(
        'createIncentive',
        [
          {
            pool: context.pool01,
            rewardToken: context.rewardToken.address,
            totalReward,
            ...makeTimestamps(currentTime),
          },
        ]
      )
      const depositTx = context.staker.interface.encodeFunctionData(
        'depositToken',
        [tokenId]
      )
      await context.staker
        .connect(multicaller)
        .multicall([createIncentiveTx, depositTx], maxGas)

      expect((await context.staker.deposits(tokenId)).owner).to.eq(
        multicaller.address
      )
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

      await context.staker.connect(lpUser0).unstakeToken({
        creator: incentiveCreator.address,
        rewardToken: rewardToken.address,
        tokenId,
        ...timestamps,
      })

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

  describe('#getPositionDetails', () => {
    it('gets called on the nonfungiblePositionManager')
    it('the PoolKey is correct')
    it('the correct address is computed')
    it('the ticks are correct')
    it('the liquidity number is correct')
  })
})
