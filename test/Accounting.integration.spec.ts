import { ethers } from 'hardhat'
import { Fixture } from 'ethereum-waffle'
import _ from 'lodash'
import { provider, createFixtureLoader } from './shared/provider'
import {
  TestERC20,
  INonfungiblePositionManager,
  IUniswapV3Factory,
  UniswapV3Staker,
  MockTimeUniswapV3Staker,
  IUniswapV3Pool,
} from '../typechain'
import { ActorFixture } from '../test/shared/actors'
import { uniswapFixture, mintPosition, poolFactory } from './shared/fixtures'
import { HelperCommands } from './helpers'
import {
  blockTimestamp,
  BNe18,
  expect,
  FeeAmount,
  getMaxTick,
  getMinTick,
  TICK_SPACINGS,
  MaxUint256,
  encodePath,
  MAX_GAS_LIMIT,
  maxGas,
  BN,
  BigNumber,
} from './shared'
import UniswapV3Pool from '@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json'

type ISwapRouter = any
type TimeSetterFunction = (timestamp: number) => Promise<any>
let loadFixture: ReturnType<typeof createFixtureLoader>

const defaultAmountToStake = BNe18(1_000)

type TestContext = {
  tokens: [TestERC20, TestERC20, TestERC20]
  factory: IUniswapV3Factory
  nft: INonfungiblePositionManager
  router: ISwapRouter
  pool01: string
  pool12: string
  subject?: Function
  fee: FeeAmount
}

type Staker = { staker: UniswapV3Staker }
type MockStaker = { mockStaker: MockTimeUniswapV3Staker }

const mockTimeFixture: Fixture<TestContext & MockStaker> = async (
  wallets,
  provider
) => {
  const actors = new ActorFixture(wallets, provider)
  const context: TestContext = _.assign(
    {},
    await mockTimeUniswapFixture(wallets, provider),
    {
      tokenIds: [],
    }
  )

  const token_holders = [
    actors.lpUser0(),
    actors.lpUser1(),
    actors.traderUser0(),
    actors.traderUser1(),
  ]
  await Promise.all(
    _.range(2).map((tokenIndex) => {
      token_holders.map((user) => {
        return context.tokens[tokenIndex].transfer(
          user.address,
          defaultAmountToStake
        )
      })
    })
  )

  const mockStakerFactory = await ethers.getContractFactory(
    'MockTimeUniswapV3Staker',
    actors.stakerDeployer()
  )
  const mockStaker = (await mockStakerFactory.deploy(
    context.factory.address,
    context.nft.address
  )) as MockTimeUniswapV3Staker

  return _.assign({}, context, { mockStaker })
}

type TestContextWithLiquidity = TestContext & {
  tokenId: string
  staker: UniswapV3Staker
}
const fixture: Fixture<TestContextWithLiquidity> = async (
  wallets,
  provider
) => {
  /* Regular fixture: uses the regular contracts so time progresses automatically.

  It also adds some liquidity to the pool by default. */
  const actors = new ActorFixture(wallets, provider)
  const context = _.assign({}, await uniswapFixture(wallets, provider), {
    tokenIds: [],
  })

  const token_holders = [
    actors.lpUser0(),
    actors.lpUser1(),
    actors.traderUser0(),
    actors.traderUser1(),
  ]
  await Promise.all(
    _.range(2).map((tokenIndex) => {
      token_holders.map((user) => {
        return context.tokens[tokenIndex].transfer(
          user.address,
          defaultAmountToStake
        )
      })
    })
  )

  const lpUser0 = actors.lpUser0()

  await context.tokens[0]
    .connect(lpUser0)
    .approve(context.nft.address, defaultAmountToStake)

  await context.tokens[1]
    .connect(lpUser0)
    .approve(context.nft.address, defaultAmountToStake)

  const tokenId = await mintPosition(context.nft.connect(lpUser0), {
    token0: context.tokens[0].address,
    token1: context.tokens[1].address,
    fee: FeeAmount.MEDIUM,
    tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
    tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
    recipient: lpUser0.address,
    amount0Desired: defaultAmountToStake,
    amount1Desired: defaultAmountToStake,
    amount0Min: 0,
    amount1Min: 0,
    deadline: (await blockTimestamp()) + 1000,
  })

  const nftOwnerAddress = await context.nft.ownerOf(tokenId)
  expect(nftOwnerAddress).to.eq(lpUser0.address)

  await context.nft
    .connect(lpUser0)
    .approve(context.staker.address, tokenId, maxGas)

  await context.staker.connect(lpUser0).depositToken(tokenId)
  return _.assign({}, context, { tokenId })
}

describe('UniswapV3Staker.integration', async () => {
  const wallets = provider.getWallets()
  let actors: ActorFixture

  before('create fixture loader', async () => {
    loadFixture = createFixtureLoader(wallets, provider)
  })

  describe('simple trading', async () => {
    let context: TestContextWithLiquidity

    // We are using the real contract, so we set time in the EVM
    const setTime: TimeSetterFunction = async (blockTimestamp: number) => {
      return await provider.send('evm_setNextBlockTimestamp', [blockTimestamp])
    }

    beforeEach('load fixture', async () => {
      context = await loadFixture(fixture)
      actors = new ActorFixture(wallets, provider)
    })

    it('works with a single liquidity provider', async () => {
      const {
        tokens: [tok0, tok1, tok2],
        router,
        staker,
        tokenId,
      } = context

      const lpUser0 = actors.lpUser0()
      const trader0 = actors.traderUser0()
      const trader1 = actors.traderUser1()

      await tok0.connect(trader0).approve(router.address, BNe18(100))
      await tok1.connect(trader0).approve(router.address, BNe18(100))
      await tok0.connect(trader1).approve(router.address, BNe18(100))
      await tok1.connect(trader1).approve(router.address, BNe18(100))

      await router.connect(trader0).exactInput({
        recipient: trader0.address,
        deadline: MaxUint256,
        path: encodePath([tok0.address, tok1.address], [FeeAmount.MEDIUM]),
        amountIn: BNe18(1),
        amountOutMinimum: 0,
      })

      /* Now someone creates an incentive program */
      const rewardToken = context.tokens[2]
      const totalReward = BNe18(1_000)
      const incentiveCreator = actors.incentiveCreator()

      await rewardToken.transfer(incentiveCreator.address, totalReward)
      expect(await rewardToken.balanceOf(incentiveCreator.address)).to.eq(
        totalReward
      )

      await rewardToken
        .connect(incentiveCreator)
        .approve(staker.address, totalReward)

      let now = await blockTimestamp()
      const [startTime, endTime, claimDeadline] = [now, now + 1000, now + 2000]

      const incentiveParams = {
        pool: context.pool01,
        totalReward,
        startTime,
        endTime,
        claimDeadline,
        rewardToken: rewardToken.address,
      }

      await expect(
        staker.connect(incentiveCreator).createIncentive({
          ...incentiveParams,
        })
      ).to.emit(staker, 'IncentiveCreated')

      const pool01Obj = poolFactory
        .connect(lpUser0)
        .attach(context.pool01) as IUniswapV3Pool

      await setTime(now + 100)

      /* lpUser0 stakes their NFT */
      await expect(
        staker.connect(lpUser0).stakeToken({
          ...incentiveParams,
          tokenId,
          creator: incentiveCreator.address,
        })
      ).to.emit(staker, 'TokenStaked')

      await router.connect(trader0).exactInput({
        recipient: trader0.address,
        deadline: MaxUint256,
        path: encodePath([tok0.address, tok1.address], [FeeAmount.MEDIUM]),
        amountIn: BNe18(2),
        amountOutMinimum: 0,
      })

      const time = await blockTimestamp()
      await setTime(time + 100)

      await router.connect(trader1).exactInput({
        recipient: trader1.address,
        deadline: MaxUint256,
        path: encodePath([tok1.address, tok0.address], [FeeAmount.MEDIUM]),
        amountIn: BNe18(2),
        amountOutMinimum: 0,
      })
      await setTime(time + 200)
      await router.connect(trader0).exactInput({
        recipient: trader1.address,
        deadline: MaxUint256,
        path: encodePath([tok1.address, tok0.address], [FeeAmount.MEDIUM]),
        amountIn: BNe18(2),
        amountOutMinimum: 0,
      })

      await setTime(time + 300)
      await router.connect(trader1).exactInput({
        recipient: trader1.address,
        deadline: MaxUint256,
        path: encodePath([tok1.address, tok0.address], [FeeAmount.MEDIUM]),
        amountIn: BNe18(2),
        amountOutMinimum: 0,
      })

      // console.debug(
      //   'Prices:',
      //   prices.map((x) => x.sqrtPriceX96)
      // )

      const rewardTokenPre = await rewardToken.balanceOf(lpUser0.address)

      /* lpUser0 tries to withdraw their staking rewards */
      await setTime(time + 400)
      const tx = await staker.connect(lpUser0).unstakeToken({
        ...incentiveParams,
        tokenId,
        creator: incentiveCreator.address,
        to: lpUser0.address,
      })

      const topicUnstakedFilter = staker.filters.TokenUnstaked(null)
      const tokenUnstakedTopic = staker.interface.getEventTopic('TokenUnstaked')

      const receipt = await tx.wait()

      const log = receipt.logs.find(
        (log) =>
          log.address === staker.address &&
          log.topics.includes(tokenUnstakedTopic)
      )
      if (log) {
        const events = await staker.queryFilter(
          topicUnstakedFilter,
          log.blockHash
        )
        if (events.length === 1) {
          expect(events[0].args.tokenId).to.eq(tokenId)
        }
      }

      const rewardTokenPost = await rewardToken.balanceOf(lpUser0.address)
      expect(rewardTokenPre).to.be.lt(rewardTokenPost)
    })

    it('works with multiple liquidity providers', async () => {
      const {
        tokens: [tok0, tok1, tok2],
        router,
        staker,
        nft,
      } = context

      const lpUser0 = actors.lpUser0()
      const trader0 = actors.traderUser0()
      const trader1 = actors.traderUser1()

      await tok0.connect(trader0).approve(router.address, BNe18(100))
      await tok1.connect(trader0).approve(router.address, BNe18(100))
      await tok0.connect(trader1).approve(router.address, BNe18(100))
      await tok1.connect(trader1).approve(router.address, BNe18(100))

      // await router.connect(trader0).exactInput({
      //   recipient: trader0.address,
      //   deadline: MaxUint256,
      //   path: encodePath([tok0.address, tok1.address], [FeeAmount.MEDIUM]),
      //   amountIn: BNe18(1),
      //   amountOutMinimum: 0,
      // })

      /* Now someone creates an incentive program */
      const rewardToken = context.tokens[2]
      const totalReward = BNe18(1_000)
      const incentiveCreator = actors.incentiveCreator()

      // First, send the incentive creator totalReward of rewardToken
      await rewardToken.transfer(incentiveCreator.address, totalReward)
      expect(await rewardToken.balanceOf(incentiveCreator.address)).to.eq(
        totalReward
      )

      await rewardToken
        .connect(incentiveCreator)
        .approve(staker.address, totalReward)

      let now = await blockTimestamp()
      const [startTime, endTime, claimDeadline] = [now, now + 1000, now + 2000]

      const incentiveParams = {
        pool: context.pool01,
        totalReward,
        startTime,
        endTime,
        claimDeadline,
        rewardToken: rewardToken.address,
      }

      await expect(
        staker.connect(incentiveCreator).createIncentive({
          ...incentiveParams,
        })
      ).to.emit(staker, 'IncentiveCreated')

      // const pool = UniswapV3Pool()
      const poolFactory = new ethers.ContractFactory(
        UniswapV3Pool.abi,
        UniswapV3Pool.bytecode,
        lpUser0
      )
      const pool01Obj = poolFactory.attach(context.pool01) as IUniswapV3Pool

      const tokenIds = [context.tokenId]

      await expect(
        staker.connect(lpUser0).stakeToken({
          ...incentiveParams,
          tokenId: tokenIds[0],
          creator: incentiveCreator.address,
        })
      ).to.emit(staker, 'TokenStaked')

      const deadline = (await blockTimestamp()) + 1000

      const lp1Amount = BNe18(20)

      const tokenId1 = await mintPosition(nft.connect(lpUser0), {
        token0: tok0.address,
        token1: tok1.address,
        fee: FeeAmount.MEDIUM,
        tickLower: 0,
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: lpUser0.address,
        amount0Desired: lp1Amount,
        amount1Desired: lp1Amount,
        amount0Min: 0,
        amount1Min: 0,
        deadline,
      })
      tokenIds.push(tokenId1)
      await nft.connect(lpUser0).approve(staker.address, tokenIds[1], {
        gasLimit: MAX_GAS_LIMIT,
      })
      await staker.connect(lpUser0).depositToken(tokenIds[1])

      const lp2Amount = BNe18(50)

      const tokenId2 = await mintPosition(nft.connect(lpUser0), {
        token0: tok0.address,
        token1: tok1.address,
        fee: FeeAmount.MEDIUM,
        tickLower: 0,
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: lpUser0.address,
        amount0Desired: lp2Amount,
        amount1Desired: lp2Amount,
        amount0Min: 0,
        amount1Min: 0,
        deadline,
      })

      tokenIds.push(tokenId2)
      await nft.connect(lpUser0).approve(staker.address, tokenId2, {
        gasLimit: MAX_GAS_LIMIT,
      })
      await staker.connect(lpUser0).depositToken(tokenId2)

      // To Test: lpUser2 with multiple tokens?
      await expect(
        staker.connect(lpUser0).stakeToken({
          ...incentiveParams,
          tokenId: tokenIds[1],
          creator: incentiveCreator.address,
        })
      ).to.emit(staker, 'TokenStaked')

      await expect(
        staker.connect(lpUser0).stakeToken({
          ...incentiveParams,
          tokenId: tokenIds[2],
          creator: incentiveCreator.address,
        })
      ).to.emit(staker, 'TokenStaked')

      /* there's some trading within that range */
      await router.connect(trader0).exactInput({
        recipient: trader0.address,
        deadline: MaxUint256,
        path: encodePath([tok0.address, tok1.address], [FeeAmount.MEDIUM]),
        amountIn: BNe18(2),
        amountOutMinimum: 0,
      })

      const time = await blockTimestamp()
      const prices = [] as any
      prices.push(await pool01Obj.slot0())
      await setTime(time + 100)

      await router.connect(trader1).exactInput({
        recipient: trader1.address,
        deadline: MaxUint256,
        path: encodePath([tok1.address, tok0.address], [FeeAmount.MEDIUM]),
        amountIn: BNe18(2),
        amountOutMinimum: 0,
      })

      prices.push(await pool01Obj.slot0())

      await setTime(time + 200)

      await router.connect(trader0).exactInput({
        recipient: trader1.address,
        deadline: MaxUint256,
        path: encodePath([tok1.address, tok0.address], [FeeAmount.MEDIUM]),
        amountIn: BNe18(2),
        amountOutMinimum: 0,
      })
      prices.push(await pool01Obj.slot0())
      await setTime(time + 300)

      await router.connect(trader1).exactInput({
        recipient: trader1.address,
        deadline: MaxUint256,
        path: encodePath([tok1.address, tok0.address], [FeeAmount.MEDIUM]),
        amountIn: BNe18(2),
        amountOutMinimum: 0,
      })
      prices.push(await pool01Obj.slot0())

      await setTime(time + 400)

      await staker.connect(lpUser0).unstakeToken({
        ...incentiveParams,
        tokenId: tokenIds[0],
        creator: incentiveCreator.address,
        to: lpUser0.address,
      })

      await staker.connect(lpUser0).withdrawToken(tokenIds[0], lpUser0.address)

      let position = await nft.connect(lpUser0).positions(tokenIds[0])

      await nft.connect(lpUser0).decreaseLiquidity({
        tokenId: tokenIds[0],
        liquidity: position.liquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: time + 10000,
      })

      let { tokensOwed0, tokensOwed1 } = await nft
        .connect(lpUser0)
        .positions(tokenIds[0])

      await nft.connect(lpUser0).collect({
        tokenId: tokenIds[0],
        recipient: lpUser0.address,
        amount0Max: tokensOwed0,
        amount1Max: tokensOwed1,
      })

      await nft.connect(lpUser0).burn(tokenIds[0], maxGas)

      // let newBalance = await rewardToken
      //   .connect(lpUser0)
      //   .balanceOf(lpUser0.address)

      console.info('✅ Token0 burn complete')
    })
  })

  describe('complex situations', () => {
    let context: TestContext & MockStaker
    let freezeTime: TimeSetterFunction

    beforeEach('load fixture', async () => {
      context = await loadFixture(mockTimeFixture)
      actors = new ActorFixture(wallets, provider)
      // await provider.send('evm_increaseTime', [0])

      /* Has to set the time on both the MockStaker and the MockNFT */
    })

    describe.only('when there are multiple LPs in the same range', async () => {
      it('allows them all to withdraw at the end', async () => {
        const {
          mockStaker: staker,
          nft,
          pool01,
          tokens: [token0, token1, rewardToken],
        } = context

        const [lpUser0, lpUser1] = [actors.lpUser0(), actors.lpUser1()]
        const totalReward = BNe18(100)

        const poolObj = poolFactory
          .attach(pool01)
          .connect(lpUser0) as IUniswapV3Pool

        freezeTime = async (timestamp: number) => {
          throw new Error('not implemented yet')
          console.info(`🕒 set time ${timestamp}`)
          // await staker.setTime(timestamp)
          // // @ts-ignore
          // await context.nft.setTime(timestamp)
          // // @ts-ignore
          // await context.router.setTime(timestamp)
          // @ts-ignore
          // await poolObj.setTime(timestamp)

          // await provider.send('evm_setNextBlockTimestamp', [timestamp])
          // await provider.send('evm_increaseTime', [1])
        }

        // Test parameters:

        const epoch = 10
        await freezeTime(epoch)
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
        await freezeTime(createIncentiveResult.startTime)

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
        await freezeTime(createIncentiveResult.startTime + 86400)
        const {
          balance: lp0RewardBalance,
        } = await helpers.unstakeCollectBurnFlow({
          lp: actors.lpUser0(),
          tokenId: lp0token0,
          createIncentiveResult,
        })

        // lpUser1 pulls out their liquidity
        await freezeTime(createIncentiveResult.startTime + 86400)
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
