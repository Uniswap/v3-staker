import { constants, BigNumberish, Wallet } from 'ethers'
import { LoadFixtureFunction } from '../types'
import { ethers } from 'hardhat'
import { uniswapFixture, mintPosition, UniswapFixtureType } from '../shared/fixtures'
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

describe('unit/Deposits', () => {
  const actors = new ActorFixture(provider.getWallets(), provider)
  const lpUser0 = actors.lpUser0()
  const amountDesired = BNe18(10)
  const totalReward = BNe18(100)
  const erc20Helper = new ERC20Helper()
  const Time = createTimeMachine(provider)
  let helpers: HelperCommands
  const incentiveCreator = actors.incentiveCreator()
  let context: UniswapFixtureType

  before('loader', async () => {
    loadFixture = createFixtureLoader(provider.getWallets(), provider)
  })

  beforeEach('create fixture loader', async () => {
    context = await loadFixture(uniswapFixture)
    helpers = HelperCommands.fromTestContext(context, actors, provider)
  })

  let subject: (tokenId: string, recipient: string) => Promise<any>
  let tokenId: string
  let recipient = lpUser0.address

  const SAFE_TRANSFER_FROM_SIGNATURE = 'safeTransferFrom(address,address,uint256,bytes)'
  const INCENTIVE_KEY_ABI =
    'tuple(address rewardToken, address pool, uint256 startTime, uint256 endTime, address refundee)'

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

  describe('nft#safeTransferFrom', () => {
    /**
     * We're ultimately checking these variables, so subject calls with calldata (from actor)
     * and returns those three objects. */
    let subject: (calldata: string, actor?: Wallet) => Promise<void>

    let createIncentiveResult: HelperTypes.CreateIncentive.Result

    async function getTokenInfo(
      tokenId: string,
      _createIncentiveResult: HelperTypes.CreateIncentive.Result = createIncentiveResult
    ) {
      const incentiveId = await helpers.getIncentiveId(_createIncentiveResult)

      return {
        deposit: await context.staker.deposits(tokenId),
        incentive: await context.staker.incentives(incentiveId),
        stake: await context.staker.stakes(tokenId, incentiveId),
      }
    }

    beforeEach('setup', async () => {
      const { startTime } = makeTimestamps(await blockTimestamp())

      createIncentiveResult = await helpers.createIncentiveFlow({
        rewardToken: context.rewardToken,
        poolAddress: context.poolObj.address,
        startTime,
        totalReward,
      })

      await Time.setAndMine(startTime + 1)

      // Make sure we're starting from a clean slate
      const depositBefore = await context.staker.deposits(tokenId)
      expect(depositBefore.owner).to.eq(constants.AddressZero)
      expect(depositBefore.numberOfStakes).to.eq(0)

      subject = async (data: string, actor: Wallet = lpUser0) => {
        await context.nft
          .connect(actor)
          [SAFE_TRANSFER_FROM_SIGNATURE](actor.address, context.staker.address, tokenId, data, {
            ...maxGas,
            from: actor.address,
          })
      }
    })

    it('allows depositing without staking', async () => {
      // Pass empty data
      await subject(ethers.utils.defaultAbiCoder.encode([], []))
      const { deposit, incentive, stake } = await getTokenInfo(tokenId)

      expect(deposit.owner).to.eq(lpUser0.address)
      expect(deposit.numberOfStakes).to.eq(BN('0'))
      expect(incentive.numberOfStakes).to.eq(BN('0'))
      expect(stake.secondsPerLiquidityInsideInitialX128).to.eq(BN('0'))
    })

    it('allows depositing and staking for a single incentive', async () => {
      const data = ethers.utils.defaultAbiCoder.encode(
        [INCENTIVE_KEY_ABI],
        [incentiveResultToStakeAdapter(createIncentiveResult)]
      )
      await subject(data, lpUser0)
      const { deposit, incentive, stake } = await getTokenInfo(tokenId)
      expect(deposit.owner).to.eq(lpUser0.address)
      expect(deposit.numberOfStakes).to.eq(BN('1'))
      expect(incentive.numberOfStakes).to.eq(BN('1'))
      expect(stake.secondsPerLiquidityInsideInitialX128).not.to.eq(BN('0'))
    })

    it('allows depositing and staking for two incentives', async () => {
      const createIncentiveResult2 = await helpers.createIncentiveFlow({
        rewardToken: context.rewardToken,
        poolAddress: context.poolObj.address,
        startTime: createIncentiveResult.startTime + 100,
        totalReward,
      })

      await Time.setAndMine(createIncentiveResult2.startTime)

      const data = ethers.utils.defaultAbiCoder.encode(
        [`${INCENTIVE_KEY_ABI}[]`],
        [[createIncentiveResult, createIncentiveResult2].map(incentiveResultToStakeAdapter)]
      )

      await subject(data)
      const { deposit, incentive, stake } = await getTokenInfo(tokenId)
      expect(deposit.owner).to.eq(lpUser0.address)
      expect(deposit.numberOfStakes).to.eq(BN('2'))
      expect(incentive.numberOfStakes).to.eq(BN('1'))
      expect(stake.secondsPerLiquidityInsideInitialX128).not.to.eq(BN('0'))

      const { incentive: incentive2, stake: stake2 } = await getTokenInfo(tokenId, createIncentiveResult2)

      expect(incentive2.numberOfStakes).to.eq(BN('1'))
      expect(stake2.secondsPerLiquidityInsideInitialX128).not.to.eq(BN('0'))
    })

    describe('reverts when', () => {
      it('staking info is less than 160 bytes and greater than 0 bytes', async () => {
        const data = ethers.utils.defaultAbiCoder.encode(
          [INCENTIVE_KEY_ABI],
          [incentiveResultToStakeAdapter(createIncentiveResult)]
        )
        const malformedData = data.slice(0, data.length - 2)
        await expect(subject(malformedData)).to.be.reverted
      })

      it('it has an invalid pool address', async () => {
        const data = ethers.utils.defaultAbiCoder.encode(
          [INCENTIVE_KEY_ABI],
          [
            // Make the data invalid
            incentiveResultToStakeAdapter({
              ...createIncentiveResult,
              poolAddress: constants.AddressZero,
            }),
          ]
        )

        await expect(subject(data)).to.be.reverted
      })

      it('staking information is invalid and greater than 160 bytes', async () => {
        const malformedData =
          ethers.utils.defaultAbiCoder.encode(
            [INCENTIVE_KEY_ABI],
            [incentiveResultToStakeAdapter(createIncentiveResult)]
          ) + 'aaaa'

        await expect(subject(malformedData)).to.be.reverted
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

      const incentiveKey: ContractParams.IncentiveKey = incentiveResultToStakeAdapter(incentive)

      data = ethers.utils.defaultAbiCoder.encode([incentiveKeyAbi], [incentiveKey])
    })

    describe('on successful transfer with staking data', () => {
      beforeEach('set the timestamp after the start time', async () => {
        await Time.set(timestamps.startTime + 1)
      })

      it('deposits the token', async () => {
        expect((await context.staker.deposits(tokenId)).owner).to.equal(constants.AddressZero)
        await context.nft
          .connect(lpUser0)
          ['safeTransferFrom(address,address,uint256)'](lpUser0.address, context.staker.address, tokenId, {
            ...maxGas,
            from: lpUser0.address,
          })

        expect((await context.staker.deposits(tokenId)).owner).to.equal(lpUser0.address)
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
          ['safeTransferFrom(address,address,uint256,bytes)'](lpUser0.address, context.staker.address, tokenId, data, {
            ...maxGas,
            from: lpUser0.address,
          })
        const stakeAfter = await context.staker.stakes(tokenId, incentiveId)

        expect(depositBefore.numberOfStakes).to.equal(0)
        expect((await context.staker.deposits(tokenId)).numberOfStakes).to.equal(1)
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
          context.staker.connect(lpUser0).onERC721Received(incentiveCreator.address, lpUser0.address, 1, data)
        ).to.be.revertedWith('UniswapV3Staker::onERC721Received: not a univ3 nft')
      })

      it('reverts when staking on invalid incentive', async () => {
        const invalidStakeParams = {
          rewardToken: context.rewardToken.address,
          refundee: incentiveCreator.address,
          pool: context.pool01,
          ...timestamps,
          startTime: 100,
        }

        let invalidData = ethers.utils.defaultAbiCoder.encode([incentiveKeyAbi], [invalidStakeParams])

        await expect(
          context.nft
            .connect(lpUser0)
            ['safeTransferFrom(address,address,uint256,bytes)'](
              lpUser0.address,
              context.staker.address,
              tokenId,
              invalidData
            )
        ).to.be.revertedWith('UniswapV3Staker::stakeToken: non-existent incentive')
      })
    })
  })

  describe('#withdrawToken', () => {
    beforeEach(async () => {
      await context.nft
        .connect(lpUser0)
        ['safeTransferFrom(address,address,uint256)'](lpUser0.address, context.staker.address, tokenId)

      subject = (_tokenId, _recipient) => context.staker.connect(lpUser0).withdrawToken(_tokenId, _recipient, '0x')
    })

    describe('works and', () => {
      it('emits a DepositTransferred event', async () =>
        await expect(subject(tokenId, recipient))
          .to.emit(context.staker, 'DepositTransferred')
          .withArgs(tokenId, recipient, constants.AddressZero))

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
        expect((await context.staker.deposits(tokenId)).owner).to.equal(lpUser0.address)
        await subject(tokenId, recipient)
        expect((await context.staker.deposits(tokenId)).owner).to.equal(constants.AddressZero)
      })

      it('has gas cost', async () => await snapshotGasCost(subject(tokenId, recipient)))
    })

    describe('fails if', () => {
      it('you are withdrawing a token that is not yours', async () => {
        const notOwner = actors.traderUser1()
        await expect(context.staker.connect(notOwner).withdrawToken(tokenId, notOwner.address, '0x')).to.revertedWith(
          'UniswapV3Staker::withdrawToken: only owner can withdraw token'
        )
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
          'UniswapV3Staker::withdrawToken: cannot withdraw token while staked'
        )
      })
    })
  })

  describe('#transferDeposit', () => {
    const lpUser1 = actors.lpUser1()
    beforeEach('create a deposit by lpUser0', async () => {
      await context.nft
        .connect(lpUser0)
        ['safeTransferFrom(address,address,uint256)'](lpUser0.address, context.staker.address, tokenId)
    })

    it('emits a DepositTransferred event', () =>
      expect(context.staker.connect(lpUser0).transferDeposit(tokenId, lpUser1.address))
        .to.emit(context.staker, 'DepositTransferred')
        .withArgs(tokenId, recipient, lpUser1.address))

    it('transfers nft ownership', async () => {
      const { owner: ownerBefore } = await context.staker.deposits(tokenId)
      await context.staker.connect(lpUser0).transferDeposit(tokenId, lpUser1.address)
      const { owner: ownerAfter } = await context.staker.deposits(tokenId)
      expect(ownerBefore).to.eq(lpUser0.address)
      expect(ownerAfter).to.eq(lpUser1.address)
    })

    it('can only be called by the owner', async () => {
      await expect(context.staker.connect(lpUser1).transferDeposit(tokenId, lpUser1.address)).to.be.revertedWith(
        'UniswapV3Staker::transferDeposit: can only be called by deposit owner'
      )
    })

    it('cannot be transferred to address 0', async () => {
      await expect(context.staker.connect(lpUser0).transferDeposit(tokenId, constants.AddressZero)).to.be.revertedWith(
        'UniswapV3Staker::transferDeposit: invalid transfer recipient'
      )
    })

    it('has gas cost', () => snapshotGasCost(context.staker.connect(lpUser0).transferDeposit(tokenId, lpUser1.address)))
  })
})
