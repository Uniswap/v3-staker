import { constants, BigNumberish } from 'ethers'
import { LoadFixtureFunction } from './types'
import { ethers } from 'hardhat'
import { UniswapV3Staker } from '../typechain/UniswapV3Staker'
import {
  TestERC20,
  INonfungiblePositionManager,
  IUniswapV3Factory,
} from '../typechain'
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
  setTime,
  erc20Wrap,
  makeTimestamps,
} from './shared'
import { createFixtureLoader, provider } from './shared/provider'
import { HelperCommands, ERC20Helper } from './helpers'

import { ContractParams } from '../types/contractParams'
import { createTimeMachine } from './shared/time'

let loadFixture: LoadFixtureFunction

describe.only('UniswapV3Staker.unit', async () => {
  const wallets = provider.getWallets()
  const actors = new ActorFixture(wallets, provider)
  let context: UniswapFixtureType

  // TODO: remove wallet,other
  const [wallet, other] = wallets
  const incentiveCreator = actors.incentiveCreator()
  const lpUser0 = actors.lpUser0()
  const totalReward = BNe18(100)
  const e20h = new ERC20Helper()
  const Time = createTimeMachine(provider)

  let subject: Function

  before('loader', async () => {
    loadFixture = createFixtureLoader(wallets, provider)
  })

  beforeEach('create fixture loader', async () => {
    context = await loadFixture(uniswapFixture)
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
        await e20h.ensureBalancesAndApprovals(
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
        const idGetter = await (
          await ethers.getContractFactory('TestIncentiveID')
        ).deploy()

        const incentiveId = idGetter.getIncentiveId(
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
    let timestamps: ContractParams.Timestamps

    beforeEach('setup', async () => {
      timestamps = makeTimestamps(await blockTimestamp())

      const helpers = new HelperCommands({
        nft: context.nft,
        router: context.router,
        actors,
        provider,
        staker: context.staker,
        pool: context.poolObj,
      })
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
        const idGetter = await (
          await ethers.getContractFactory('TestIncentiveID')
        ).deploy()

        const incentiveId = idGetter.getIncentiveId(
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

  describe('#depositToken', () => {
    /**
     * In these tests, lpUser0 is the one depositing the token.
     */

    let tokenId
    let subject
    const amountDesired = BNe18(10)

    beforeEach(async () => {
      await e20h.ensureBalancesAndApprovals(
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

      subject = async () =>
        await context.staker.connect(lpUser0).depositToken(tokenId)
    })

    describe('works and', async () => {
      it('emits a Deposited event', async () => {
        await expect(subject())
          .to.emit(context.staker, 'TokenDeposited')
          .withArgs(tokenId, lpUser0.address)
      })

      it('transfers ownership of the NFT', async () => {
        await subject()
        expect(await context.nft.ownerOf(tokenId)).to.eq(context.staker.address)
      })

      it('sets owner and maintains numberOfStakes at 0', async () => {
        await subject()
        const deposit = await context.staker.deposits(tokenId)
        expect(deposit.owner).to.eq(lpUser0.address)
        expect(deposit.numberOfStakes).to.eq(0)
      })

      it('has gas cost', async () => {
        await snapshotGasCost(subject())
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
    let tokenId: string
    let subject
    const recipient = wallet.address

    beforeEach(async () => {
      tokenId = await mintPosition(context.nft, {
        token0: context.tokens[0].address,
        token1: context.tokens[1].address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: wallet.address,
        amount0Desired: BN(10).mul(BN(10).pow(18)),
        amount1Desired: BN(10).mul(BN(10).pow(18)),
        amount0Min: 0,
        amount1Min: 0,
        deadline: (await blockTimestamp()) + 1000,
      })

      await context.nft
        .connect(wallets[0])
        .approve(context.staker.address, tokenId, { gasLimit: MAX_GAS_LIMIT })

      await context.staker.connect(wallets[0]).depositToken(tokenId)
      subject = ({ tokenId, recipient }) =>
        context.staker.connect(wallets[0]).withdrawToken(tokenId, recipient)
    })

    describe('works and', () => {
      it('emits a TokenWithdrawn event', async () => {
        await expect(subject({ tokenId, recipient }))
          .to.emit(context.staker, 'TokenWithdrawn')
          .withArgs(tokenId, recipient)
      })

      it('transfers nft ownership', async () => {
        await subject({ tokenId, recipient })
        expect(await context.nft.ownerOf(tokenId)).to.eq(recipient)
      })

      it('prevents you from withdrawing twice', async () => {
        await subject({ tokenId, recipient })
        expect(await context.nft.ownerOf(tokenId)).to.eq(recipient)
        await expect(subject({ tokenId, recipient })).to.be.reverted
      })

      it('has gas cost', async () => {
        await snapshotGasCost(subject({ tokenId, recipient }))
      })
    })

    describe('fails if', () => {
      it('you are withdrawing a token that is not yours', async () => {
        await expect(
          context.staker.connect(other).withdrawToken(tokenId, wallet.address)
        ).to.revertedWith('NOT_YOUR_NFT')
      })

      it('number of stakes is not 0', async () => {
        const currentTime = await blockTimestamp()
        await context.tokens[0].approve(context.staker.address, totalReward)
        await context.staker.connect(wallets[0]).createIncentive({
          pool: context.pool01,
          rewardToken: context.tokens[0].address,
          totalReward,
          startTime: currentTime,
          endTime: currentTime + 100,
          claimDeadline: currentTime + 200,
        })

        await context.staker.connect(wallets[0]).stakeToken({
          creator: wallet.address,
          rewardToken: context.tokens[0].address,
          tokenId,
          startTime: currentTime,
          endTime: currentTime + 100,
          claimDeadline: currentTime + 200,
        })
        await expect(subject({ tokenId, recipient })).to.revertedWith(
          'NUMBER_OF_STAKES_NOT_ZERO'
        )
      })
    })
  })

  describe('#stakeToken', () => {
    let tokenId: string
    let subject
    let rewardToken: TestERC20
    let otherRewardToken: TestERC20
    let startTime: number
    let endTime: number
    let claimDeadline: number

    beforeEach(async () => {
      const currentTime = await blockTimestamp()

      rewardToken = context.tokens[0]
      otherRewardToken = context.tokens[1]
      startTime = currentTime + 1000
      endTime = currentTime + 2000
      claimDeadline = currentTime + 3000

      tokenId = await mintPosition(context.nft, {
        token0: context.tokens[0].address,
        token1: context.tokens[1].address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: wallet.address,
        amount0Desired: BN(10).mul(BN(10).pow(18)),
        amount1Desired: BN(10).mul(BN(10).pow(18)),
        amount0Min: 0,
        amount1Min: 0,
        deadline: claimDeadline,
      })

      await context.nft
        .connect(wallets[0])
        .approve(context.staker.address, tokenId, { gasLimit: MAX_GAS_LIMIT })

      await context.staker.connect(wallets[0]).depositToken(tokenId)

      await context.tokens[0].transfer(incentiveCreator.address, totalReward)
      await context.tokens[0]
        .connect(incentiveCreator)
        .approve(context.staker.address, totalReward)

      await rewardToken
        .connect(incentiveCreator)
        .approve(context.staker.address, totalReward)

      await context.staker.connect(incentiveCreator).createIncentive({
        pool: context.pool01,
        rewardToken: rewardToken.address,
        totalReward,
        startTime,
        endTime,
        claimDeadline,
      })

      subject = () =>
        context.staker.connect(wallets[0]).stakeToken({
          creator: incentiveCreator.address,
          rewardToken: rewardToken.address,
          tokenId,
          startTime,
          endTime,
          claimDeadline,
        })
    })

    describe('works and', async () => {
      beforeEach(async () => {
        await setTime(startTime)
      })

      it('emits the stake event', async () => {
        const liquidity = (await context.nft.positions(tokenId)).liquidity
        await expect(await subject())
          .to.emit(context.staker, 'TokenStaked')
          .withArgs(tokenId, liquidity)
      })

      it('sets the stake struct properly', async () => {
        const liquidity = (await context.nft.positions(tokenId)).liquidity
        const idGetter = await (
          await ethers.getContractFactory('TestIncentiveID')
        ).deploy()

        const incentiveId = await idGetter.getIncentiveId(
          incentiveCreator.address,
          rewardToken.address,
          context.pool01,
          startTime,
          endTime,
          claimDeadline
        )

        const stakeBefore = await context.staker.stakes(tokenId, incentiveId)
        const nStakesBefore = (await context.staker.deposits(tokenId))
          .numberOfStakes
        await subject()
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
        await snapshotGasCost(subject())
      })
    })

    describe('fails when', () => {
      it('deposit is already staked in the incentive', async () => {
        await setTime(startTime)
        await subject()
        await expect(subject()).to.be.revertedWith('already staked')
      })

      it('you are not the owner of the deposit', async () => {
        const nonOwner = wallets[1]
        await setTime(startTime)
        await expect(
          context.staker.connect(nonOwner).stakeToken({
            creator: incentiveCreator.address,
            rewardToken: rewardToken.address,
            tokenId,
            startTime,
            endTime,
            claimDeadline,
          })
        ).to.be.revertedWith('NOT_YOUR_DEPOSIT')
      })

      it('is before the start time', async () => {
        await expect(subject()).to.be.revertedWith('incentive not started yet')
      })

      it('is past the end time', async () => {
        await setTime(endTime)
        await expect(subject()).to.be.revertedWith('incentive ended')
      })
    })
  })

  describe('#unstakeToken', () => {
    let tokenId: string
    let subject
    let rewardToken: TestERC20
    let startTime: number
    let endTime: number
    let claimDeadline: number

    beforeEach(async () => {
      const currentTime = await blockTimestamp()
      rewardToken = context.tokens[2]
      startTime = currentTime
      endTime = currentTime + 100
      claimDeadline = currentTime + 200

      await rewardToken
        .connect(wallets[0])
        .transfer(incentiveCreator.address, totalReward)

      await rewardToken
        .connect(incentiveCreator)
        .approve(context.staker.address, totalReward)

      await context.tokens[0]
        .connect(wallets[0])
        .transfer(lpUser0.address, BNe18(10))
      await context.tokens[1]
        .connect(wallets[0])
        .transfer(lpUser0.address, BNe18(10))

      await context.tokens[0]
        .connect(lpUser0)
        .approve(context.nft.address, BNe18(10))
      await context.tokens[1]
        .connect(lpUser0)
        .approve(context.nft.address, BNe18(10))

      await context.staker.connect(incentiveCreator).createIncentive({
        pool: context.pool01,
        rewardToken: rewardToken.address,
        totalReward,
        startTime,
        endTime,
        claimDeadline,
      })

      tokenId = await mintPosition(context.nft.connect(lpUser0), {
        token0: context.tokens[0].address,
        token1: context.tokens[1].address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: lpUser0.address,
        amount0Desired: BNe18(10),
        amount1Desired: BNe18(10),
        amount0Min: 0,
        amount1Min: 0,
        deadline: claimDeadline,
      })

      await context.nft
        .connect(lpUser0)
        .approve(context.staker.address, tokenId, { gasLimit: MAX_GAS_LIMIT })
      await context.staker.connect(lpUser0).depositToken(tokenId)

      await context.staker.connect(lpUser0).stakeToken({
        creator: incentiveCreator.address,
        rewardToken: rewardToken.address,
        tokenId,
        startTime,
        endTime,
        claimDeadline,
      })

      subject = () =>
        context.staker.connect(lpUser0).unstakeToken({
          creator: incentiveCreator.address,
          rewardToken: rewardToken.address,
          tokenId,
          startTime,
          endTime,
          claimDeadline,
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
          rewardToken.address,
          lpUser0.address
        )
        await subject()
        expect(
          await context.staker.rewards(rewardToken.address, lpUser0.address)
        ).to.be.gt(rewardsAccured)
      })

      it('calculates the right secondsPerLiquidity')
      it('does not overflow totalSecondsUnclaimed')
    })

    describe('fails if', () => {
      it('you have not staked')
    })
  })

  describe('#onERC721Received', () => {
    const stakeParamsEncodeType =
      'tuple(address creator, address rewardToken, uint256 tokenId, uint32 startTime, uint32 endTime, uint32 claimDeadline)'
    let tokenId: BigNumberish
    let rewardToken: TestERC20
    let startTime: number
    let endTime: number
    let claimDeadline: number
    let data: string

    beforeEach(async () => {
      const currentTime = await blockTimestamp()

      rewardToken = context.tokens[1]
      startTime = currentTime
      endTime = currentTime + 100
      claimDeadline = currentTime + 1000

      tokenId = await mintPosition(context.nft.connect(wallets[0]), {
        token0: context.tokens[0].address,
        token1: context.tokens[1].address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: wallet.address,
        amount0Desired: BNe18(10),
        amount1Desired: BNe18(10),
        amount0Min: 0,
        amount1Min: 0,
        deadline: (await blockTimestamp()) + 1000,
      })

      await rewardToken.transfer(incentiveCreator.address, totalReward)
      await rewardToken
        .connect(incentiveCreator)
        .approve(context.staker.address, totalReward)

      await context.staker.connect(incentiveCreator).createIncentive({
        pool: context.pool01,
        rewardToken: rewardToken.address,
        totalReward,
        startTime,
        endTime,
        claimDeadline,
      })

      const stakeParams = {
        creator: incentiveCreator.address,
        rewardToken: rewardToken.address,
        tokenId,
        startTime,
        endTime,
        claimDeadline,
      }

      data = ethers.utils.defaultAbiCoder.encode(
        [stakeParamsEncodeType],
        [stakeParams]
      )
    })

    describe('on successful transfer with staking data', () => {
      it('deposits the token', async () => {
        expect((await context.staker.deposits(1)).owner).to.equal(
          constants.AddressZero
        )
        await context.nft['safeTransferFrom(address,address,uint256)'](
          wallets[0].address,
          context.staker.address,
          tokenId,
          {
            gasLimit: MAX_GAS_LIMIT,
            from: wallets[0].address,
          }
        )
        expect((await context.staker.deposits(1)).owner).to.equal(
          wallet.address
        )
      })

      it('properly stakes the deposit in the select incentive', async () => {
        const idGetter = await (
          await ethers.getContractFactory('TestIncentiveID')
        ).deploy()

        const incentiveId = await idGetter.getIncentiveId(
          incentiveCreator.address,
          rewardToken.address,
          context.pool01,
          startTime,
          endTime,
          claimDeadline
        )

        const stakeBefore = await context.staker.stakes(tokenId, incentiveId)
        const depositBefore = await context.staker.deposits(tokenId)
        await context.nft['safeTransferFrom(address,address,uint256,bytes)'](
          wallets[0].address,
          context.staker.address,
          tokenId,
          data,
          {
            gasLimit: MAX_GAS_LIMIT,
            from: wallets[0].address,
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
          context.nft['safeTransferFrom(address,address,uint256,bytes)'](
            wallets[0].address,
            context.staker.address,
            tokenId,
            data,
            {
              gasLimit: MAX_GAS_LIMIT,
              from: wallets[0].address,
            }
          )
        )
      })
    })

    describe('on invalid call', async () => {
      it('reverts when called by contract other than uniswap v3 nonfungiblePositionManager', async () => {
        await expect(
          context.staker.onERC721Received(
            incentiveCreator.address,
            wallet.address,
            1,
            data
          )
        ).to.be.revertedWith('uniswap v3 nft only')
      })

      it('reverts when staking on invalid incentive', async () => {
        const invalidStakeParams = {
          creator: incentiveCreator.address,
          rewardToken: rewardToken.address,
          tokenId,
          startTime: 100,
          endTime,
          claimDeadline,
        }

        let invalidData = ethers.utils.defaultAbiCoder.encode(
          [stakeParamsEncodeType],
          [invalidStakeParams]
        )
        await expect(
          context.nft['safeTransferFrom(address,address,uint256,bytes)'](
            wallet.address,
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
      const rewardToken = context.tokens[2]
      const currentTime = await blockTimestamp()

      const tokenId = await mintPosition(context.nft, {
        token0: context.tokens[0].address,
        token1: context.tokens[1].address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: wallet.address,
        amount0Desired: BNe18(10),
        amount1Desired: BNe18(10),
        amount0Min: 0,
        amount1Min: 0,
        deadline: currentTime + 10_000,
      })
      await rewardToken.transfer(wallet.address, BNe18(5))
      await context.nft.connect(wallet).approve(context.staker.address, tokenId)
      await rewardToken
        .connect(wallet)
        .approve(context.staker.address, BNe18(5))

      const createIncentiveTx = context.staker.interface.encodeFunctionData(
        'createIncentive',
        [
          {
            pool: context.pool01,
            rewardToken: rewardToken.address,
            totalReward: BNe18(5),
            startTime: currentTime,
            endTime: currentTime + 100,
            claimDeadline: currentTime + 200,
          },
        ]
      )
      const depositTx = context.staker.interface.encodeFunctionData(
        'depositToken',
        [tokenId]
      )
      await context.staker
        .connect(wallet)
        .multicall([createIncentiveTx, depositTx], {
          gasLimit: MAX_GAS_LIMIT,
        })
      expect((await context.staker.deposits(tokenId)).owner).to.eq(
        wallet.address
      )
    })
  })

  describe('#claimReward', () => {
    let rewardToken: TestERC20
    let startTime: number
    let endTime: number
    let claimDeadline: number
    let tokenId: string

    beforeEach('setup', async () => {
      const currentTime = await blockTimestamp()
      rewardToken = context.tokens[2]
      startTime = currentTime
      endTime = currentTime + 100
      claimDeadline = currentTime + 200

      await context.tokens[0].connect(wallets[0]).transfer(lpUser0.address, 100)
      await context.tokens[1].connect(wallets[0]).transfer(lpUser0.address, 100)

      await context.tokens[0].connect(lpUser0).approve(context.nft.address, 100)
      await context.tokens[1].connect(lpUser0).approve(context.nft.address, 100)

      await rewardToken
        .connect(wallets[0])
        .transfer(incentiveCreator.address, totalReward)

      await rewardToken
        .connect(incentiveCreator)
        .approve(context.staker.address, totalReward)

      await context.staker.connect(incentiveCreator).createIncentive({
        pool: context.pool01,
        rewardToken: rewardToken.address,
        totalReward,
        startTime,
        endTime,
        claimDeadline,
      })

      tokenId = await mintPosition(context.nft.connect(lpUser0), {
        token0: context.tokens[0].address,
        token1: context.tokens[1].address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: lpUser0.address,
        amount0Desired: 10,
        amount1Desired: 10,
        amount0Min: 0,
        amount1Min: 0,
        deadline: claimDeadline,
      })

      await context.nft
        .connect(lpUser0)
        .approve(context.staker.address, tokenId, { gasLimit: MAX_GAS_LIMIT })
      await context.staker.connect(lpUser0).depositToken(tokenId)

      await context.staker.connect(lpUser0).stakeToken({
        creator: incentiveCreator.address,
        rewardToken: rewardToken.address,
        tokenId,
        startTime,
        endTime,
        claimDeadline,
      })

      await context.staker.connect(lpUser0).unstakeToken({
        creator: incentiveCreator.address,
        rewardToken: rewardToken.address,
        tokenId,
        startTime,
        endTime,
        claimDeadline,
      })

      subject = ({ token, actor = lpUser0 }) =>
        context.staker.connect(actor).claimReward(token, actor.address)
    })

    it('emits RewardClaimed event', async () => {
      const claimable = await context.staker.rewards(
        rewardToken.address,
        lpUser0.address
      )
      await expect(subject({ token: rewardToken.address, actor: lpUser0 }))
        .to.emit(context.staker, 'RewardClaimed')
        .withArgs(lpUser0.address, claimable)
    })

    it('transfers the correct reward amount to destination address', async () => {
      const claimable = await context.staker.rewards(
        rewardToken.address,
        lpUser0.address
      )
      const balance = await rewardToken.balanceOf(lpUser0.address)
      await subject({ token: rewardToken.address })
      expect(await rewardToken.balanceOf(lpUser0.address)).to.equal(
        balance.add(claimable)
      )
    })

    it('sets the claimed reward amount to zero', async () => {
      expect(
        await context.staker.rewards(rewardToken.address, lpUser0.address)
      ).to.not.equal(0)

      await subject({ token: rewardToken.address, actor: lpUser0 })

      expect(
        await context.staker.rewards(rewardToken.address, lpUser0.address)
      ).to.equal(0)
    })

    it('has gas cost', async () => {
      await snapshotGasCost(subject({ token: rewardToken.address }))
    })
  })

  describe('#getPositionDetails', () => {
    it('gets called on the nonfungiblePositionManager')
    it('the PoolKey is correct')
    it('the correct address is computed')
    it('the ticks are correct')
    it('the liquidity number is correct')
  })
})
