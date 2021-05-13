import { constants } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { Fixture } from 'ethereum-waffle'
import { UniswapV3Staker } from '../typechain/UniswapV3Staker'
import type { TestERC20, INonfungiblePositionManager } from '../typechain'
import {
  uniswapFactoryFixture,
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

  beforeEach('create fixture loader', async () => {
    loadFixture = createFixtureLoader(wallets)
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
    beforeEach('setup', async () => {
      const [token0, token1] = sortedTokens(tokens[1], tokens[2])
      await nft.createAndInitializePoolIfNecessary(
        token0.address,
        token1.address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      await mintPosition(nft, {
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

    describe('works and ', async () => {
      it('transfers the right amount of rewardToken and emits events', async () => {
        const totalReward = BNe18(1234)
        await subject({ totalReward })
        expect(await tokens[0].balanceOf(staker.address)).to.eq(totalReward)
      })

      it('emits an event', async () =>
        expect(await subject()).to.emit(staker, 'IncentiveCreated'))
    })

    describe('fails when', async () => {
      it('there is already has an incentive with those params', async () => {
        const ts = await blockTimestamp()
        const params = {
          startTime: 10,
          endTime: 20,
          claimDeadline: 30,
        }
        expect(await subject(params)).to.emit(staker, 'IncentiveCreated')
        await expect(subject(params)).to.be.revertedWith('INCENTIVE_EXISTS')
      })

      it('claim deadline is not greater than or equal to end time', async () =>
        await expect(
          subject({
            startTime: 10,
            endTime: 30,
            claimDeadline: 20,
          })
        ).to.be.revertedWith('claimDeadline_not_gte_endTime'))

      it('end time is not gte start time', async () =>
        await expect(
          subject({
            startTime: 20,
            endTime: 10,
            claimDeadline: 100,
          })
        ).to.be.revertedWith('endTime_not_gte_startTime'))

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

      it('rewardToken cannot be transferred')
      // TODO: Mock a malicious ERC20 where the transfer call fails
    })
  })

  describe('#endIncentive', async () => {
    let rewardToken
    let blockTime
    let depositAmount
    let startTime
    let endTime
    let claimDeadline
    let pool

    beforeEach('setup', async () => {
      rewardToken = tokens[0].address
      blockTime = await blockTimestamp()
      depositAmount = BNe18(1000)
      startTime = blockTime
      endTime = blockTime + 1000
      claimDeadline = blockTime + 2000
      pool = await factory.getPool(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM
      )
      await tokens[0].approve(staker.address, depositAmount)
    })

    describe('should fail if ', () => {
      it('block.timestamp <= claim deadline', async () => {
        await staker.createIncentive(
          rewardToken,
          pool,
          startTime,
          endTime,
          claimDeadline,
          depositAmount
        )

        // Adjust the block.timestamp so it is before the claim deadline
        await ethers.provider.send('evm_setNextBlockTimestamp', [
          claimDeadline - 1,
        ])

        expect(
          staker.endIncentive(
            tokens[0].address,
            pool,
            startTime,
            endTime,
            claimDeadline
          )
        ).to.be.revertedWith('TIMESTAMP_LTE_CLAIMDEADLINE')
      })

      it('incentive does not exist', async () => {
        // Adjust the block.timestamp so it is after the claim deadline
        await ethers.provider.send('evm_setNextBlockTimestamp', [
          claimDeadline + 1,
        ])

        expect(
          staker.endIncentive(
            rewardToken,
            pool,
            startTime,
            endTime,
            claimDeadline
          )
        ).to.be.revertedWith('INVALID_INCENTIVE')
      })
    })

    describe('works and', () => {
      it('emits IncentiveEnded() event', async () => {
        await staker.createIncentive(
          rewardToken,
          pool,
          startTime,
          endTime,
          claimDeadline,
          depositAmount
        )

        // Adjust the block.timestamp so it is after the claim deadline
        await ethers.provider.send('evm_setNextBlockTimestamp', [
          claimDeadline + 1,
        ])

        expect(
          staker.endIncentive(
            rewardToken,
            pool,
            startTime,
            endTime,
            claimDeadline
          )
        )
          .to.emit(staker, 'IncentiveEnded')
          .withArgs(rewardToken, pool, startTime, endTime)
      })
      it('deletes incentives[key]')
      it('deletes even if the transfer fails (re-entrancy vulnerability check)')
    })
  })

  describe('_getIncentiveId', () => {
    it('test various inputs')
  })

  describe('#depositToken', () => {
    describe('that are successful', () => {
      let tokenId: string
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
      })

      it('emit a Deposited event', async () => {
        const tokenId = 1
        await nft.approve(staker.address, tokenId, { gasLimit: 12450000 })
        expect(staker.depositToken(tokenId))
          .to.emit(staker, 'TokenDeposited')
          .withArgs(tokenId)

        // it('actually transfers the NFT to the contract')
        expect(await nft.ownerOf(tokenId)).to.eq(staker.address)

        // it('creates deposits[tokenId] = Deposit struct')
        const deposit = await staker.deposits(tokenId)
        expect(deposit.owner).to.eq(wallet.address)
        expect(deposit.numberOfStakes).to.eq(0)
        // it('respond to the onERC721Received function')
      })
    })

    describe('paranoia edge cases', () => {
      /*
      Other possible cases to consider:
        * What if make nft.safeTransferFrom is adversarial in some way?
        * What happens if the nft.safeTransferFrom call fails
        * What if tokenId is invalid
        * What happens if I call deposit() twice with the same tokenId?
        * Ownership checks around tokenId? Can you transfer something that is not yours?
      */
    })
  })

  describe('#withdrawToken', () => {
    describe('happy path', () => {
      it('emits a withdrawal event')
      it('does the safeTransferFrom and transfers ownership')
      it('prevents you from withdrawing twice')
    })
    /*
    Consider:
      you cannot withdraw a token if
        it is not yours
        number of stakes != 0
      paranoia:
        could there be something insecure in nonfungiblePositionManager.ownerOf(tokenId)?
        delegate calls to withdraw?
        it goes through even if the NFT is janky / invalid / adversarial
      */
  })

  describe('#stakeToken', () => {
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

  describe('#getPositionDetails', () => {
    it('gets called on the nonfungiblePositionManager')
    it('the PoolKey is correct')
    it('the correct address is computed')
    it('the ticks are correct')
    it('the liquidity number is correct')
  })
})
