import { constants, BigNumber, BigNumberish } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { Fixture } from 'ethereum-waffle'
import { UniswapV3Staker } from '../typechain/UniswapV3Staker'
import { TestERC20, INonfungiblePositionManager } from '../typechain'
import {
  uniswapFixture,
  mintPosition,
  createIncentive,
} from './shared/fixtures'
import {
  expect,
  getMaxTick,
  getMinTick,
  FeeAmount,
  TICK_SPACINGS,
  MaxUint256,
  encodePriceSqrt,
  blockTimestamp,
  sortedTokens,
  BN,
  BNe18,
} from './shared'

import { UniswapV3Factory } from '../vendor/uniswap-v3-core/typechain'
const { createFixtureLoader } = waffle
let loadFixture: ReturnType<typeof createFixtureLoader>

describe('UniswapV3Staker.unit', async () => {
  const wallets = waffle.provider.getWallets()
  const [wallet] = wallets
  let tokens: [TestERC20, TestERC20, TestERC20]
  let factory: UniswapV3Factory
  let nft: INonfungiblePositionManager
  let staker: UniswapV3Staker
  let subject

  beforeEach('loader', async () => {
    loadFixture = createFixtureLoader(wallets)
  })

  beforeEach('create fixture loader', async () => {
    ;({ nft, tokens, staker, factory } = await loadFixture(uniswapFixture))
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
    let pool: string

    beforeEach('setup', async () => {
      const [token0, token1] = sortedTokens(tokens[0], tokens[1])

      await nft.createAndInitializePoolIfNecessary(
        token0.address,
        token1.address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      pool = await factory.getPool(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM
      )

      subject = async ({
        startTime = 10,
        endTime = 20,
        claimDeadline = 30,
        totalReward = BNe18(1000),
        rewardToken = tokens[0].address,
      } = {}) =>
        await createIncentive({
          factory,
          tokens,
          staker,
          totalReward,
          startTime,
          endTime,
          claimDeadline,
          rewardToken,
        })
    })

    describe('works and', async () => {
      it('transfers the right amount of rewardToken', async () => {
        const balanceBefore = await tokens[0].balanceOf(staker.address)
        const totalReward = BNe18(1234)
        await subject({ totalReward })
        expect(await tokens[0].balanceOf(staker.address)).to.eq(balanceBefore.add(totalReward))
      })

      it('emits an event with valid parameters', async () => {
        expect(subject()).to.emit(staker, 'IncentiveCreated')
          .withArgs(tokens[0].address, pool, 10, 20, 30, BNe18(1000))
      })

      it('creates an incentive with the correct parameters', async () => {
        await subject()
        const idGetter = await (
          await ethers.getContractFactory('TestIncentiveID')
        ).deploy()

        const incentiveId = idGetter.getIncentiveId(
          wallet.address,
          tokens[0].address,
          pool,
          10,
          20,
          30
        )

        const incentive = await staker.incentives(incentiveId)
        expect(incentive.totalRewardUnclaimed).to.equal(BNe18(1000))
        expect(incentive.totalSecondsClaimedX128).to.equal(BN(0))
        expect(incentive.rewardToken).to.equal(tokens[0].address)
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
            totalReward: 0,
          })
        ).to.be.revertedWith('INVALID_REWARD_AMOUNT')
      })
    })
  })

  describe('#endIncentive', async () => {
    let rewardToken
    let blockTime
    let totalReward
    let startTime
    let endTime
    let claimDeadline
    let pool
    let subject
    let createIncentive

    beforeEach('setup', async () => {
      rewardToken = tokens[0].address
      blockTime = await blockTimestamp()
      totalReward = BNe18(1000)
      startTime = blockTime
      endTime = blockTime + 1000
      claimDeadline = blockTime + 2000
      pool = await factory.getPool(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM
      )
      await tokens[0].approve(staker.address, totalReward)

      createIncentive = async () =>
        staker.createIncentive({
          rewardToken,
          pool,
          startTime,
          endTime,
          claimDeadline,
          totalReward,
        })

      subject = async ({ ...args } = {}) =>
        await staker.endIncentive({
          rewardToken,
          pool,
          startTime,
          endTime,
          claimDeadline,
          ...args,
        })
    })

    describe('works and', () => {
      it('emits IncentiveEnded() event', async () => {
        await createIncentive()
        // Adjust the block.timestamp so it is after the claim deadline
        await ethers.provider.send('evm_setNextBlockTimestamp', [
          claimDeadline + 1,
        ])

        await expect(
          staker.endIncentive({
            rewardToken,
            pool,
            startTime,
            endTime,
            claimDeadline,
          })
        )
          .to.emit(staker, 'IncentiveEnded')
          .withArgs(rewardToken, pool, startTime, endTime)
      })

      it('deletes incentives[key]', async () => {
        await createIncentive()
        const idGetter = await (
          await ethers.getContractFactory('TestIncentiveID')
        ).deploy()

        const incentiveId = idGetter.getIncentiveId(
          wallet.address,
          rewardToken,
          pool,
          startTime,
          endTime,
          claimDeadline
        )
        expect((await staker.incentives(incentiveId)).rewardToken).to.eq(tokens[0].address)
        await ethers.provider.send('evm_setNextBlockTimestamp', [
          claimDeadline + 1,
        ])

        await subject()
        expect((await staker.incentives(incentiveId)).rewardToken).to.eq(constants.AddressZero)
      })
    })

    describe('fails when ', () => {
      it('block.timestamp <= claim deadline', async () => {
        await staker.createIncentive({
          rewardToken,
          pool,
          startTime,
          endTime,
          claimDeadline,
          totalReward,
        })

        // Adjust the block.timestamp so it is before the claim deadline
        await ethers.provider.send('evm_setNextBlockTimestamp', [
          claimDeadline - 1,
        ])

        await expect(subject()).to.be.revertedWith(
          'TIMESTAMP_LTE_CLAIMDEADLINE'
        )
      })

      it('incentive does not exist', async () => {
        // Adjust the block.timestamp so it is after the claim deadline
        await ethers.provider.send('evm_setNextBlockTimestamp', [
          claimDeadline + 1,
        ])

        await expect(subject()).to.be.revertedWith('INVALID_INCENTIVE')
      })
    })
  })

  describe('#depositToken', () => {
    let tokenId
    let subject

    beforeEach(async () => {
      const [token0, token1] = sortedTokens(tokens[1], tokens[2])
      await nft.createAndInitializePoolIfNecessary(
        token0.address,
        token1.address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      tokenId = await mintPosition(nft, {
        token0: token0.address,
        token1: token1.address,
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

      await nft.approve(staker.address, tokenId, { gasLimit: 12450000 })
      subject = async () => await staker.depositToken(tokenId)
    })

    describe('works and', async () => {
      it('emits a Deposited event', async () => {
        const tx = await subject()
        expect(tx)
          .to.emit(staker, 'TokenDeposited')
          .withArgs(tokenId, wallet.address)
      })

      it('transfers ownership of the NFT', async () => {
        await subject()
        expect(await nft.ownerOf(tokenId)).to.eq(staker.address)
      })

      it('sets owner and increases numberOfStakes', async () => {
        await subject()
        const deposit = await staker.deposits(tokenId)
        expect(deposit.owner).to.eq(wallet.address)
        expect(deposit.numberOfStakes).to.eq(0)
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
    let depositToken
    const recipient = wallet.address

    beforeEach(async () => {
      const [token0, token1] = sortedTokens(tokens[1], tokens[2])

      await nft.createAndInitializePoolIfNecessary(
        token0.address,
        token1.address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      tokenId = await mintPosition(nft, {
        token0: token0.address,
        token1: token1.address,
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
      tokenId = '1'
      await nft.approve(staker.address, tokenId, { gasLimit: 12450000 })

      await staker.depositToken(tokenId)
      subject = async ({ tokenId, recipient }) =>
        await staker.withdrawToken(tokenId, recipient)
    })

    describe('works and', () => {
      it('emits a TokenWithdrawn event', async () => {
        await expect(subject({ tokenId, recipient }))
          .to.emit(staker, 'TokenWithdrawn')
          .withArgs(tokenId)
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
    })

    describe('fails if', () => {
      it('you are withdrawing a token that is not yours')
      it('number of stakes != 0')
      it('the nft is adversarial somehow')
    })
  })

  describe('#stakeToken', () => {
    let tokenId: string
    let subject
    let depositToken
    const recipient = wallet.address

    beforeEach(async () => {
      const [token0, token1] = sortedTokens(tokens[1], tokens[2])

      await nft.createAndInitializePoolIfNecessary(
        token0.address,
        token1.address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      tokenId = await mintPosition(nft, {
        token0: token0.address,
        token1: token1.address,
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
      tokenId = '1'
      await nft.approve(staker.address, tokenId, { gasLimit: 12450000 })

      await staker.depositToken(tokenId)

      // subject = async ({}) => await staker.stakeToken()
    })

    describe('works and', async () => {
      it('sets the stake struct properly')
      it('calculates secondsPerLiquidity')
      it('saves the pool address on the stake')
      it('increments numberOfStakes by 1')
    })
    describe('fails when', () => {
      it('you are not the owner of the deposit')
    })
    /*
    happy path
      it sets the Stake struct inside of stakes
        the Stake.secondsPerLiquidity is set correctly
        the pool address is saved on the stake
      it is done on the right tokenId,incentiveId
      numberOfStakes is incremented by 1
    you cannot stake if
      you are not the owner of the deposit
    paranoia:
      what if it's
        before the start time
        after endTime?
        past the claimDeadline?
        the specified params are incorrect and
          the pool doesn't exist
          the pool exists but something else is fishy
        the NFT is adversarial
      */
  })

  describe('#unstakeToken', () => {
    /*
    checks that
      you are the owner of the deposit
      there exists a stake for that key
      there is non-zero secondsPerLiquidity
    effects:
      decrements numberOfStakes by 1
      it transfers the right amoutn of the reward token
      calculations
        it gets the right secondsPerLiquidity
        totalSecondsUnclaimed
          doesn't overflow
          check the math everywhere
        it emits an Unstaked() event
      you cannt unstake if
        you have not staked
      paranoia:
        what if reward cannot be transferred
        what if it's a big number and we risk overflowing
    */
  })

  describe('#onERC721Received', () => {
    const stakeParamsEncodeType =
      'tuple(address creator, address rewardToken, uint256 tokenId, uint32 startTime, uint32 endTime, uint32 claimDeadline)'
    let tokenId: BigNumberish
    let pool: string
    let rewardToken: TestERC20
    let otherRewardToken: TestERC20
    let startTime: number
    let endTime: number
    let claimDeadline: number
    let totalReward: BigNumber
    let data: string

    beforeEach(async () => {
      const currentTime = await blockTimestamp()

      rewardToken = tokens[1]
      otherRewardToken = tokens[2]
      startTime = currentTime
      endTime = currentTime + 100
      claimDeadline = currentTime + 1000
      totalReward = BNe18(1000)

      const [token0, token1] = sortedTokens(tokens[0], tokens[1])
      await nft.createAndInitializePoolIfNecessary(
        token0.address,
        token1.address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )
      pool = await factory.getPool(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM
      )

      tokenId = await mintPosition(nft, {
        token0: token0.address,
        token1: token1.address,
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

      const creator = wallet.address

      await rewardToken.approve(staker.address, totalReward)
      await staker.createIncentive({
        pool,
        rewardToken: rewardToken.address,
        totalReward,
        startTime,
        endTime,
        claimDeadline,
      })

      const stakeParams = {
        creator,
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
          wallet.address,
          staker.address,
          tokenId
        )
        expect((await staker.deposits(1)).owner).to.equal(wallet.address)
      })

      it('properly stakes the deposit in the select incentive', async () => {
        const idGetter = await (
          await ethers.getContractFactory('TestIncentiveID')
        ).deploy()

        const id1 = await idGetter.getIncentiveId(
          wallet.address,
          rewardToken.address,
          pool,
          startTime,
          endTime,
          claimDeadline
        )

        expect((await staker.deposits(tokenId)).numberOfStakes).to.equal(0)
        await nft['safeTransferFrom(address,address,uint256,bytes)'](
          wallet.address,
          staker.address,
          tokenId,
          data
        )
        expect((await staker.deposits(tokenId)).numberOfStakes).to.equal(1)
        expect((await staker.stakes(tokenId, id1)).pool).to.eq(pool)
      })
    })

    it('reverts when called by contract other than uniswap v3 nonfungiblePositionManager', async () => {
      expect(
        staker.onERC721Received(wallet.address, wallet.address, 1, data)
      ).to.revertedWith('uniswap v3 nft only')
    })

    it('reverts when staking on invalid incentive', async () => {
      const invalidStakeParams = {
        creator: wallet.address,
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
      expect(
        nft['safeTransferFrom(address,address,uint256,bytes)'](
          wallet.address,
          staker.address,
          tokenId,
          invalidData
        )
      ).to.revertedWith('non-existent incentive')
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
