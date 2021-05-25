import { constants, BigNumber, BigNumberish } from 'ethers'
import { ethers } from 'hardhat'
import { UniswapV3Staker } from '../typechain/UniswapV3Staker'
import {
  TestERC20,
  INonfungiblePositionManager,
  IUniswapV3Factory,
} from '../typechain'
import { uniswapFixture, mintPosition } from './shared/fixtures'
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
} from './shared'
import { createFixtureLoader, provider } from './shared/provider'

let loadFixture: ReturnType<typeof createFixtureLoader>

describe('UniswapV3Staker.unit', async () => {
  const wallets = provider.getWallets()
  const [wallet, other] = wallets
  let tokens: [TestERC20, TestERC20, TestERC20]
  let factory: IUniswapV3Factory
  let nft: INonfungiblePositionManager
  let staker: UniswapV3Staker
  let pool01: string
  let pool12: string
  let subject
  const actors = new ActorFixture(wallets, provider)

  // The account that has rewardToken and creates the incentive program
  const incentiveCreator = actors.incentiveCreator()

  // Default total reward for incentive
  const totalReward = BNe18(100)

  before('loader', async () => {
    // set timestamp for consistency
    await provider.send('evm_setNextBlockTimestamp', [2000000000])
    loadFixture = createFixtureLoader(wallets)
  })

  beforeEach('create fixture loader', async () => {
    ;({ nft, tokens, staker, factory, pool01, pool12 } = await loadFixture(
      uniswapFixture
    ))
  })

  it('deploys and has an address', async () => {
    const stakerFactory = await ethers.getContractFactory('UniswapV3Staker')
    staker = (await stakerFactory.deploy(
      factory.address,
      nft.address
    )) as UniswapV3Staker
    expect(staker.address).to.be.a.string
  })

  describe('#createIncentive', async () => {
    beforeEach('setup', async () => {
      subject = async ({
        startTime = 10,
        endTime = 20,
        claimDeadline = 30,
        totalReward = BNe18(1000),
        rewardToken = tokens[0].address,
      } = {}) => {
        await tokens[0].transfer(incentiveCreator.address, totalReward)
        await tokens[0]
          .connect(incentiveCreator)
          .approve(staker.address, totalReward)
        return await staker.connect(incentiveCreator).createIncentive({
          rewardToken,
          pool: pool01,
          startTime,
          endTime,
          claimDeadline,
          totalReward,
        })
      }
    })

    describe('works and', async () => {
      it('transfers the right amount of rewardToken', async () => {
        const balanceBefore = await tokens[0].balanceOf(staker.address)
        await subject({ totalReward })
        expect(await tokens[0].balanceOf(staker.address)).to.eq(
          balanceBefore.add(totalReward)
        )
      })

      it('emits an event with valid parameters', async () => {
        await expect(subject())
          .to.emit(staker, 'IncentiveCreated')
          .withArgs(tokens[0].address, pool01, 10, 20, 30, BNe18(1000))
      })

      it('creates an incentive with the correct parameters', async () => {
        await subject()
        const idGetter = await (
          await ethers.getContractFactory('TestIncentiveID')
        ).deploy()

        const incentiveId = idGetter.getIncentiveId(
          incentiveCreator.address,
          tokens[0].address,
          pool01,
          10,
          20,
          30
        )

        const incentive = await staker.incentives(incentiveId)
        expect(incentive.totalRewardUnclaimed).to.equal(BNe18(1000))
        expect(incentive.totalSecondsClaimedX128).to.equal(BN(0))
        expect(incentive.rewardToken).to.equal(tokens[0].address)
      })

      it('has gas cost', async () => {
        await snapshotGasCost(subject())
      })
    })

    describe('fails when', async () => {
      it('there is already has an incentive with those params', async () => {
        const params = {
          startTime: 10,
          endTime: 20,
          claimDeadline: 30,
        }
        expect(await subject(params)).to.emit(staker, 'IncentiveCreated')
        await expect(subject(params)).to.be.revertedWith('INCENTIVE_EXISTS')
      })

      it('claim deadline is not greater than or equal to end time', async () => {
        await expect(
          subject({
            startTime: 10,
            endTime: 30,
            claimDeadline: 20,
          })
        ).to.be.revertedWith('claimDeadline_not_gte_endTime')
      })

      it('end time is not gte start time', async () => {
        await expect(
          subject({
            startTime: 20,
            endTime: 10,
            claimDeadline: 100,
          })
        ).to.be.revertedWith('endTime_not_gte_startTime')
      })

      it('rewardToken is 0 address', async () => {
        await expect(
          subject({
            rewardToken: constants.AddressZero,
          })
        ).to.be.revertedWith('INVALID_REWARD_ADDRESS')
      })

      it('totalReward is 0 or an invalid amount', async () => {
        await expect(
          subject({
            totalReward: BNe18(0),
          })
        ).to.be.revertedWith('INVALID_REWARD_AMOUNT')
      })
    })
  })

  describe('#endIncentive', async () => {
    let rewardToken: string
    let blockTime: number
    let startTime: number
    let endTime: number
    let claimDeadline: number
    let subject: Function
    let createIncentive: Function

    beforeEach('setup', async () => {
      rewardToken = tokens[0].address
      blockTime = await blockTimestamp()
      startTime = blockTime
      endTime = blockTime + 1000
      claimDeadline = blockTime + 2000

      await tokens[0].transfer(incentiveCreator.address, totalReward)
      await tokens[0]
        .connect(incentiveCreator)
        .approve(staker.address, totalReward)

      createIncentive = async () =>
        staker.connect(incentiveCreator).createIncentive({
          rewardToken,
          pool: pool01,
          startTime,
          endTime,
          claimDeadline,
          totalReward,
        })

      subject = async ({ ...args } = {}) =>
        await staker.connect(incentiveCreator).endIncentive({
          rewardToken,
          pool: pool01,
          startTime,
          endTime,
          claimDeadline,
          ...args,
        })
    })

    describe('works and', () => {
      it('emits IncentiveEnded event', async () => {
        await createIncentive()
        // Adjust the block.timestamp so it is after the claim deadline
        await provider.send('evm_setNextBlockTimestamp', [claimDeadline + 1])

        await expect(subject())
          .to.emit(staker, 'IncentiveEnded')
          .withArgs(rewardToken, pool01, startTime, endTime)
      })

      it('deletes incentives[key]', async () => {
        await createIncentive()
        const idGetter = await (
          await ethers.getContractFactory('TestIncentiveID')
        ).deploy()

        const incentiveId = idGetter.getIncentiveId(
          incentiveCreator.address,
          rewardToken,
          pool01,
          startTime,
          endTime,
          claimDeadline
        )
        expect((await staker.incentives(incentiveId)).rewardToken).to.eq(
          tokens[0].address
        )
        await provider.send('evm_setNextBlockTimestamp', [claimDeadline + 1])

        await subject()
        expect((await staker.incentives(incentiveId)).rewardToken).to.eq(
          constants.AddressZero
        )
      })

      it('has gas cost', async () => {
        await createIncentive()
        await provider.send('evm_setNextBlockTimestamp', [claimDeadline + 1])
        await snapshotGasCost(subject())
      })
    })

    describe('fails when ', () => {
      it('block.timestamp <= claim deadline', async () => {
        await createIncentive()

        // Adjust the block.timestamp so it is before the claim deadline
        await provider.send('evm_setNextBlockTimestamp', [claimDeadline - 1])

        await expect(subject()).to.be.revertedWith(
          'TIMESTAMP_LTE_CLAIMDEADLINE'
        )
      })

      it('incentive does not exist', async () => {
        // Adjust the block.timestamp so it is after the claim deadline
        await provider.send('evm_setNextBlockTimestamp', [claimDeadline + 1])

        await expect(subject()).to.be.revertedWith('INVALID_INCENTIVE')
      })
    })
  })

  describe('#depositToken', () => {
    let tokenId
    let subject

    beforeEach(async () => {
      tokenId = await mintPosition(nft, {
        token0: tokens[1].address,
        token1: tokens[2].address,
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

      await nft.approve(staker.address, tokenId, { gasLimit: MAX_GAS_LIMIT })
      subject = async () => await staker.connect(wallet).depositToken(tokenId)
    })

    describe('works and', async () => {
      it('emits a Deposited event', async () => {
        await expect(subject())
          .to.emit(staker, 'TokenDeposited')
          .withArgs(tokenId, wallet.address)
      })

      it('transfers ownership of the NFT', async () => {
        await subject()
        expect(await nft.ownerOf(tokenId)).to.eq(staker.address)
      })

      it('sets owner and maintains numberOfStakes at 0', async () => {
        await subject()
        const deposit = await staker.deposits(tokenId)
        expect(deposit.owner).to.eq(wallet.address)
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
      tokenId = await mintPosition(nft, {
        token0: tokens[0].address,
        token1: tokens[1].address,
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

      await nft
        .connect(wallets[0])
        .approve(staker.address, tokenId, { gasLimit: MAX_GAS_LIMIT })

      await staker.connect(wallets[0]).depositToken(tokenId)
      subject = ({ tokenId, recipient }) =>
        staker.connect(wallets[0]).withdrawToken(tokenId, recipient)
    })

    describe('works and', () => {
      it('emits a TokenWithdrawn event', async () => {
        await expect(subject({ tokenId, recipient }))
          .to.emit(staker, 'TokenWithdrawn')
          .withArgs(tokenId, recipient)
      })

      it('transfers nft ownership', async () => {
        await subject({ tokenId, recipient })
        expect(await nft.ownerOf(tokenId)).to.eq(recipient)
      })

      it('prevents you from withdrawing twice', async () => {
        await subject({ tokenId, recipient })
        expect(await nft.ownerOf(tokenId)).to.eq(recipient)
        await expect(subject({ tokenId, recipient })).to.be.reverted
      })

      it('has gas cost', async () => {
        await snapshotGasCost(subject({ tokenId, recipient }))
      })
    })

    describe('fails if', () => {
      it('you are withdrawing a token that is not yours', async () => {
        await expect(
          staker.connect(other).withdrawToken(tokenId, wallet.address)
        ).to.revertedWith('NOT_YOUR_NFT')
      })

      it('number of stakes is not 0', async () => {
        await tokens[0].approve(staker.address, totalReward)
        await staker.connect(wallets[0]).createIncentive({
          pool: pool01,
          rewardToken: tokens[0].address,
          totalReward,
          startTime: 10,
          endTime: 20,
          claimDeadline: 30,
        })

        await staker.connect(wallets[0]).stakeToken({
          creator: wallet.address,
          rewardToken: tokens[0].address,
          tokenId,
          startTime: 10,
          endTime: 20,
          claimDeadline: 30,
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

      rewardToken = tokens[0]
      otherRewardToken = tokens[1]
      startTime = currentTime
      endTime = currentTime + 100
      claimDeadline = currentTime + 1000

      tokenId = await mintPosition(nft, {
        token0: tokens[0].address,
        token1: tokens[1].address,
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

      await nft
        .connect(wallets[0])
        .approve(staker.address, tokenId, { gasLimit: MAX_GAS_LIMIT })

      await staker.connect(wallets[0]).depositToken(tokenId)

      await tokens[0].transfer(incentiveCreator.address, totalReward)
      await tokens[0]
        .connect(incentiveCreator)
        .approve(staker.address, totalReward)

      await rewardToken
        .connect(incentiveCreator)
        .approve(staker.address, totalReward)

      await staker.connect(incentiveCreator).createIncentive({
        pool: pool01,
        rewardToken: rewardToken.address,
        totalReward,
        startTime,
        endTime,
        claimDeadline,
      })

      subject = () =>
        staker.connect(wallets[0]).stakeToken({
          creator: incentiveCreator.address,
          rewardToken: rewardToken.address,
          tokenId,
          startTime,
          endTime,
          claimDeadline,
        })
    })

    describe('works and', async () => {
      it('emits the stake event', async () => {
        expect(await subject())
          .to.emit(staker, 'TokenStaked')
          .withArgs(tokenId)
      })

      it('sets the stake struct properly', async () => {
        const idGetter = await (
          await ethers.getContractFactory('TestIncentiveID')
        ).deploy()

        const incentiveId = await idGetter.getIncentiveId(
          incentiveCreator.address,
          rewardToken.address,
          pool01,
          startTime,
          endTime,
          claimDeadline
        )

        const stakeBefore = await staker.stakes(tokenId, incentiveId)
        const nStakesBefore = (await staker.deposits(tokenId)).numberOfStakes
        await subject()
        const stakeAfter = await staker.stakes(tokenId, incentiveId)

        expect(stakeBefore.secondsPerLiquidityInitialX128).to.eq(0)
        expect(stakeBefore.exists).to.be.false
        expect(stakeAfter.secondsPerLiquidityInitialX128).to.be.gt(0)
        expect(stakeAfter.exists).to.be.true
        expect((await staker.deposits(tokenId)).numberOfStakes).to.eq(
          nStakesBefore + 1
        )
      })

      it('has gas cost', async () => {
        await snapshotGasCost(subject())
      })
    })
    describe('fails when', () => {
      it('deposit is already staked in the incentive', async () => {
        await subject()
        await expect(subject()).to.be.revertedWith('already staked')
      })

      it('you are not the owner of the deposit')
      it('is before the start time')
      it('is after the end time')
      it('is past the claim deadline')
      it('gets an invalid pool')
      it('deals with an adversarial nft')
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
      rewardToken = tokens[2]
      startTime = currentTime
      endTime = currentTime + 100
      claimDeadline = currentTime + 200

      await rewardToken
        .connect(wallets[0])
        .transfer(incentiveCreator.address, totalReward)

      await rewardToken
        .connect(incentiveCreator)
        .approve(staker.address, totalReward)

      await staker.connect(incentiveCreator).createIncentive({
        pool: pool01,
        rewardToken: rewardToken.address,
        totalReward,
        startTime,
        endTime,
        claimDeadline,
      })

      tokenId = await mintPosition(nft.connect(wallets[0]), {
        token0: tokens[0].address,
        token1: tokens[1].address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: wallet.address,
        amount0Desired: BNe18(10),
        amount1Desired: BNe18(10),
        amount0Min: 0,
        amount1Min: 0,
        deadline: claimDeadline,
      })

      await nft.approve(staker.address, tokenId, { gasLimit: MAX_GAS_LIMIT })
      await staker.connect(wallets[0]).depositToken(tokenId)

      await staker.connect(wallets[0]).stakeToken({
        creator: incentiveCreator.address,
        rewardToken: rewardToken.address,
        tokenId,
        startTime,
        endTime,
        claimDeadline,
      })

      subject = ({ to }) =>
        staker.connect(wallets[0]).unstakeToken({
          creator: incentiveCreator.address,
          rewardToken: rewardToken.address,
          tokenId,
          startTime,
          endTime,
          claimDeadline,
          to,
        })
    })

    const recipient = wallets[3].address

    describe('works and', async () => {
      it('decrements numberOfStakes by 1', async () => {
        await subject({ to: recipient })
      })

      it('emits an unstaked event', async () => {
        await expect(subject({ to: recipient }))
          .to.emit(staker, 'TokenUnstaked')
          .withArgs(tokenId)
      })

      it('has gas cost', async () => {
        await snapshotGasCost(subject({ to: recipient }))
      })

      it('transfers the right amount of the reward token')
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

      rewardToken = tokens[1]
      startTime = currentTime
      endTime = currentTime + 100
      claimDeadline = currentTime + 1000

      tokenId = await mintPosition(nft.connect(wallets[0]), {
        token0: tokens[0].address,
        token1: tokens[1].address,
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
        .approve(staker.address, totalReward)

      await staker.connect(incentiveCreator).createIncentive({
        pool: pool01,
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
        expect((await staker.deposits(1)).owner).to.equal(constants.AddressZero)
        await nft['safeTransferFrom(address,address,uint256)'](
          wallets[0].address,
          staker.address,
          tokenId,
          {
            gasLimit: MAX_GAS_LIMIT,
            from: wallets[0].address,
          }
        )
        expect((await staker.deposits(1)).owner).to.equal(wallet.address)
      })

      it('properly stakes the deposit in the select incentive', async () => {
        const idGetter = await (
          await ethers.getContractFactory('TestIncentiveID')
        ).deploy()

        const incentiveId = await idGetter.getIncentiveId(
          incentiveCreator.address,
          rewardToken.address,
          pool01,
          startTime,
          endTime,
          claimDeadline
        )

        const stakeBefore = await staker.stakes(tokenId, incentiveId)
        const depositBefore = await staker.deposits(tokenId)
        await nft['safeTransferFrom(address,address,uint256,bytes)'](
          wallets[0].address,
          staker.address,
          tokenId,
          data,
          {
            gasLimit: MAX_GAS_LIMIT,
            from: wallets[0].address,
          }
        )
        const stakeAfter = await staker.stakes(tokenId, incentiveId)

        expect(depositBefore.numberOfStakes).to.equal(0)
        expect((await staker.deposits(tokenId)).numberOfStakes).to.equal(1)
        expect(stakeBefore.secondsPerLiquidityInitialX128).to.equal(0)
        expect(stakeBefore.exists).to.be.false
        expect(stakeAfter.secondsPerLiquidityInitialX128).to.be.gt(0)
        expect(stakeAfter.exists).to.be.true
      })

      it('has gas cost', async () => {
        await snapshotGasCost(
          nft['safeTransferFrom(address,address,uint256,bytes)'](
            wallets[0].address,
            staker.address,
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
          staker.onERC721Received(
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
          nft['safeTransferFrom(address,address,uint256,bytes)'](
            wallet.address,
            staker.address,
            tokenId,
            invalidData
          )
        ).to.be.revertedWith('non-existent incentive')
      })
    })
  })

  describe('#multicall', () => {
    it('is implemented', async () => {
      const rewardToken = tokens[2]
      const currentTime = await blockTimestamp()

      const tokenId = await mintPosition(nft, {
        token0: tokens[0].address,
        token1: tokens[1].address,
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
      await nft.connect(wallet).approve(staker.address, tokenId)
      await rewardToken.connect(wallet).approve(staker.address, BNe18(5))

      const createIncentiveTx = staker.interface.encodeFunctionData(
        'createIncentive',
        [
          {
            pool: pool01,
            rewardToken: rewardToken.address,
            totalReward: BNe18(5),
            startTime: currentTime,
            endTime: currentTime + 100,
            claimDeadline: currentTime + 200,
          },
        ]
      )
      const depositTx = staker.interface.encodeFunctionData('depositToken', [
        tokenId,
      ])
      await staker.connect(wallet).multicall([createIncentiveTx, depositTx], {
        gasLimit: MAX_GAS_LIMIT,
      })
      expect((await staker.deposits(tokenId)).owner).to.eq(wallet.address)
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
