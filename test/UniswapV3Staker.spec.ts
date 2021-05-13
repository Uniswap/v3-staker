import { BigNumber, BigNumberish } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { Fixture } from 'ethereum-waffle'
import { expect } from './shared'
import { UniswapV3Staker } from '../typechain/UniswapV3Staker'
import type {
  IUniswapV3Factory,
  TestERC20,
  INonfungiblePositionManager,
  IERC721Permit
} from '../typechain'
import { encodePriceSqrt, blockTimestamp } from './shared/utilities'
import { completeFixture } from './shared/fixtures'
import { FeeAmount, TICK_SPACINGS, ZERO_ADDRESS, MaxUint256 } from './shared/constants'
import { getMaxTick, getMinTick } from './shared/ticks'
import { sortedTokens } from './shared/tokenSort'

const { createFixtureLoader } = waffle
let loadFixture: ReturnType<typeof createFixtureLoader>

const BN = ethers.BigNumber.from
const BNe18 = (n) => ethers.BigNumber.from(n).mul(BN(10).pow(18))

async function mintPosition(
  nft: INonfungiblePositionManager,
  mintParams: {
    token0: string
    token1: string
    fee: FeeAmount
    tickLower: number
    tickUpper: number
    recipient: string
    amount0Desired: any
    amount1Desired: any
    amount0Min: number
    amount1Min: number
    deadline: number
  }
): Promise<BigNumber> {
  nft.mint({
    token0: mintParams.token0,
    token1: mintParams.token1,
    fee: mintParams.fee,
    tickLower: mintParams.tickLower,
    tickUpper: mintParams.tickUpper,
    recipient: mintParams.recipient,
    amount0Desired: mintParams.amount0Desired,
    amount1Desired: mintParams.amount1Desired,
    amount0Min: mintParams.amount0Min,
    amount1Min: mintParams.amount1Min,
    deadline: mintParams.deadline,
  })

  const tokenId: BigNumber = await new Promise((resolve) =>
    nft.on('Transfer', (from: any, to: any, tokenId: any) => resolve(tokenId))
  )
  return tokenId
}

describe('UniswapV3Staker', () => {
  const wallets = waffle.provider.getWallets()
  const [wallet, other] = wallets

  let tokens: [TestERC20, TestERC20, TestERC20]
  let factory: IUniswapV3Factory
  let nft: any
  let staker: UniswapV3Staker

  const uniswapFixture: Fixture<{
    nft: INonfungiblePositionManager
    factory: IUniswapV3Factory
    staker: UniswapV3Staker
    tokens: [TestERC20, TestERC20, TestERC20]
  }> = async (wallets, provider) => {
    const { tokens, nft, factory } = await completeFixture(wallets, provider)
    const stakerFactory = await ethers.getContractFactory('UniswapV3Staker')
    staker = (await stakerFactory.deploy(
      factory.address,
      nft.address
    )) as UniswapV3Staker

    for (const token of tokens) {
      await token.approve(nft.address, MaxUint256)
    }
    return { nft, tokens, staker, factory }
  }

  beforeEach('create fixture loader', async () => {
    loadFixture = createFixtureLoader(wallets)
  })

  beforeEach('setup contracts', async () => {
    ;({ nft, tokens, staker, factory } = await loadFixture(uniswapFixture))
  })

  describe('#initialize', async () => {
    it('deploys', async () => {
      const stakerFactory = await ethers.getContractFactory('UniswapV3Staker')
      staker = (await stakerFactory.deploy(
        factory.address,
        nft.address
      )) as UniswapV3Staker
      expect(staker.address).to.be.a.string
    })
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
    })

    describe('happy path', () => {
      it('transfers the right amount of rewardToken', async () => {
        const pool = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM)
        const depositAmount = BNe18(1000)
        const blockTime = await blockTimestamp()
        await tokens[0].approve(staker.address, BNe18(1000))
        await staker.createIncentive(
          tokens[0].address,
          pool,
          blockTime,
          blockTime + 1000,
          blockTime + 10000,
          depositAmount
        )
        expect(await tokens[0].balanceOf(staker.address)).to.eq(depositAmount)
      })
      it('emits IncentiveCreated()')
    })
    describe('should fail if', () => {
      it('already has an incentive with those params')
      it('claim deadline not gte end time')
      it('end time not gte start time')
      it('rewardToken is 0 address')
      it('totalReward is 0 or an invalid amount')
      it('rewardToken cannot be transferred')
      // Maybe: it('fails if maybe: fails if pool is not a uniswap v3 pool?')
    })
  })

  describe('#endIncentive', async () => {
    describe('should fail if ', () => {
      it('block.timestamp <= claim deadline')
      it('incentive does not exist')
    })
    describe('works and', () => {
      it('deletes incentives[key]')
      it('deletes even if the transfer fails (re-entrancy vulnerability check)')
    })
  })

  describe('_getIncentiveId', () => {
    it('test various inputs')
  })

  describe('#depositToken', () => {
    describe('that are successful', () => {
      let tokenId: BigNumber
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
        await nft.approve(staker.address, 1, {gasLimit: 12450000})
        expect(staker.depositToken(1))
          .to.emit(staker, 'TokenDeposited')
          .withArgs(1, wallet.address)
      })

      it('actually transfers the NFT to the contract')
      it('respond to the onERC721Received function')
      it('creates deposits[tokenId] = Deposit struct')
      describe('deposit struct', () => {
        it('numberOfStakes is 0')
        it('owner is msg.sender')
      })
    })

    describe('that fail', () => {
      it('does not emit an event')
      it('does not create a deposit struct in deposits')
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

  describe('#onERC721Received', () => {
    const stakeParamsEncodeType = 'tuple(uint256 tokenId, address creator, address rewardToken, uint32 startTime, uint32 endTime, uint32 claimDeadline)[]'
    let tokenId: BigNumberish
    let poolAddress: string
    let rewardToken: TestERC20
    let startTime: number
    let endTime: number
    let claimDeadline: number
    let totalReward: BigNumber

    beforeEach(async () => {
      const currentTime = await blockTimestamp()

      rewardToken = tokens[1]
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
      poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM)

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

      await rewardToken.approve(staker.address, totalReward)
      await staker.createIncentive(
        rewardToken.address,
        poolAddress,
        startTime,
        endTime,
        claimDeadline,
        totalReward
      )
    })

    describe('on successful transfer with staking data', () => {
      let otherRewardToken: TestERC20
      let data: string

      beforeEach(async () => {
        const creator = wallet.address
        otherRewardToken = tokens[2]
        await otherRewardToken.approve(staker.address, totalReward)
        await staker.createIncentive(
          otherRewardToken.address,
          poolAddress,
          startTime,
          endTime,
          claimDeadline,
          totalReward
        )

        const stakeParams1 = {
          tokenId,
          creator,
          rewardToken: rewardToken.address,
          startTime,
          endTime,
          claimDeadline
        }

        const stakeParams2 = {
          tokenId,
          creator,
          rewardToken: otherRewardToken.address,
          startTime,
          endTime,
          claimDeadline
        }
        data = ethers.utils.defaultAbiCoder.encode([stakeParamsEncodeType], [[stakeParams1, stakeParams2]])
      })

      it('deposits the token', async () => {
        expect((await staker.deposits(1)).owner).to.equal(ZERO_ADDRESS)
        await nft['safeTransferFrom(address,address,uint256,bytes)'](wallet.address, staker.address, tokenId, data)
        expect((await staker.deposits(1)).owner).to.equal(wallet.address)
      })

      it.only('properly stakes the deposit in the select incentives', async () => {
        expect((await staker.deposits(1)).numberOfStakes).to.equal(0)
        await nft['safeTransferFrom(address,address,uint256,bytes)'](wallet.address, staker.address, tokenId, data)
        expect((await staker.deposits(1)).numberOfStakes).to.equal(2)
        const id1 = await staker.getIncentiveId(wallet.address, rewardToken.address, poolAddress, startTime, endTime, claimDeadline)
        const id2 = await staker.getIncentiveId(wallet.address, otherRewardToken.address, poolAddress, startTime, endTime, claimDeadline)
        expect((await staker.stakes(1, id1)).pool).to.eq(poolAddress)
        expect((await staker.stakes(1, id2)).pool).to.eq(poolAddress)
      })
    })
    it('reverts when called by contract other than uniswap v3 nonfungiblePositionManager')
    it('reverts when staking on invalid incentive')
  })

  describe('#getPositionDetails', () => {
    it('gets called on the nonfungiblePositionManager')
    it('the PoolKey is correct')
    it('the correct address is computed')
    it('the ticks are correct')
    it('the liquidity number is correct')
  })
})
