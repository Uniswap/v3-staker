import { BigNumber, Contract, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import _ from 'lodash'
import { provider, createFixtureLoader } from './shared/provider'
import {
  TestERC20,
  INonfungiblePositionManager,
  IUniswapV3Factory,
  UniswapV3Staker,
  IUniswapV3Pool,
} from '../typechain'
import { ActorFixture } from '../test/shared/actors'
import { uniswapFixture, mintPosition } from './shared/fixtures'
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
} from './shared'
import { Fixture } from 'ethereum-waffle'

import MockTimeNonfungiblePositionManager from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json'
import UniswapV3Pool from '@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json'

type ISwapRouter = any

let loadFixture: ReturnType<typeof createFixtureLoader>

const setTime = async (blockTimestamp) => {
  return await provider.send('evm_setNextBlockTimestamp', [blockTimestamp])
}

type TestContext = {
  tokens: [TestERC20, TestERC20, TestERC20]
  factory: IUniswapV3Factory
  nft: INonfungiblePositionManager
  router: ISwapRouter
  staker: UniswapV3Staker
  pool01: string
  pool12: string
  subject?: Function
  fee: FeeAmount
  tokenIds: Array<string>
}

describe('Unstake accounting', async () => {
  const wallets = provider.getWallets()
  let ctx = {} as TestContext
  let actors: ActorFixture

  const fixture: Fixture<TestContext> = async (wallets, provider) => {
    /* This is the top-level fixture that gets run before the integration tests.

    It's pretty long and also calls other fixtures. Do note that when calling a fixture
    from within another fixture, you have to call it directly, instead of through loadFixture.

    This is because `loadFixture` does not currently supported nested fixture calls.

    For example, see how we're calling `uniswapFixture` below:
    */

    let context: TestContext = {
      ...(await uniswapFixture(wallets, provider)),
      tokenIds: [],
    }
    actors = new ActorFixture(wallets, provider)

    const amount = BNe18(10_000)
    const pool = context.pool01
    const lpUser0 = actors.lpUser0()

    /* Give some of token{0,1} to token_holders */
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
            amount.mul(4)
          )
        })
      })
    )

    // const erc20Factory = await ethers.getContractFactory('TestERC20')

    /* Let the staker access them */
    await context.tokens[0]
      .connect(provider.getSigner(lpUser0.address))
      .approve(context.staker.address, amount)

    await context.tokens[1]
      .connect(provider.getSigner(lpUser0.address))
      .approve(context.staker.address, amount)

    /* lpUser0 deposits some liquidity into the pool */
    const nftContract = (await ethers.getContractAt(
      MockTimeNonfungiblePositionManager.abi,
      context.nft.address
    )) as INonfungiblePositionManager

    // TODO: make sure this is called from the right person
    context.tokenIds.push(
      await mintPosition(context.nft, {
        token0: context.tokens[0].address,
        token1: context.tokens[1].address,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: lpUser0.address,
        amount0Desired: amount,
        amount1Desired: amount,
        amount0Min: 0,
        amount1Min: 0,
        deadline: (await blockTimestamp()) + 1000,
      })
    )

    const nftOwnerAddress = await context.nft.ownerOf(context.tokenIds[0])
    expect(nftOwnerAddress).to.eq(lpUser0.address)

    await context.nft
      .connect(lpUser0)
      .approve(context.staker.address, context.tokenIds[0], {
        gasLimit: MAX_GAS_LIMIT,
      })

    await context.staker.connect(lpUser0).depositToken(context.tokenIds[0])

    const pool0 = (await ethers.getContractAt(
      UniswapV3Pool.abi,
      pool
    )) as IUniswapV3Pool

    return {
      ...context,
      pool0,
    }
  }

  before('create fixture loader', async () => {
    loadFixture = createFixtureLoader(wallets, provider)
  })

  beforeEach('load fixture', async () => {
    ctx = await loadFixture(fixture)
    actors = new ActorFixture(wallets, provider)
  })

  it('single liquidity provider: it does not die', async () => {
    const {
      tokens: [tok0, tok1, tok2],
      router,
      staker,
      tokenIds: [tokenId],
    } = ctx

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
    const rewardToken = ctx.tokens[2]
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
      pool: ctx.pool01,
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
    const pool01Obj = poolFactory.attach(ctx.pool01) as IUniswapV3Pool
    // console.debug(pool01Obj)

    const prices = [] as any
    prices.push(await pool01Obj.slot0())

    await setTime(now + 100)

    // console.info('lpUser0 is ', lpUser0.address)
    // console.info('staker is ', staker.address)
    // console.info('owner is ', await ctx.nft.ownerOf(tokenId))

    // await ctx.nft
    // .connect(lpUser0)
    // .approve(staker.address, tokenId, { gasLimit: MAX_GAS_LIMIT })

    /* lpUser0 stakes their NFT */
    await expect(
      staker.connect(lpUser0).stakeToken({
        ...incentiveParams,
        tokenId: ctx.tokenIds[0],
        creator: incentiveCreator.address,
      })
    ).to.emit(staker, 'TokenStaked')

    // console.log('pool01 liquidity:', await pool01Obj.liquidity())

    /* Make sure the price is within range */

    /* there's some trading within that range */
    await router.connect(trader0).exactInput({
      recipient: trader0.address,
      deadline: MaxUint256,
      path: encodePath([tok0.address, tok1.address], [FeeAmount.MEDIUM]),
      amountIn: BNe18(2),
      amountOutMinimum: 0,
    })

    const time = await blockTimestamp()

    prices.push(await pool01Obj.slot0())
    /* Move forward in the future */
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
    // await setTime(time + 400)

    // console.info(prices[prices.length - 1])
    // console.debug(
    //   'Prices:',
    //   prices.map((x) => x.sqrtPriceX96)
    // )

    // console.info('lpuser0 address is ', lpUser0.address)
    const rewardTokenPre = await rewardToken.balanceOf(lpUser0.address)

    console.info(await rewardToken.balanceOf(staker.address))

    /* lpUser0 tries to withdraw their staking rewards */
    await setTime(time + 400)
    const tx = await staker.connect(lpUser0).unstakeToken({
      ...incentiveParams,
      tokenId: ctx.tokenIds[0],
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

    console.info('Token balance before:', rewardTokenPre)
    console.info('Token balance after:', rewardTokenPost)
  })

  it.only('multiple liquidity providers: math works', async () => {
    const {
      tokens: [tok0, tok1, tok2],
      router,
      staker,
      nft,
    } = ctx

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
    const rewardToken = ctx.tokens[2]
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
      pool: ctx.pool01,
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
    const pool01Obj = poolFactory.attach(ctx.pool01) as IUniswapV3Pool

    await expect(
      staker.connect(lpUser0).stakeToken({
        ...incentiveParams,
        tokenId: ctx.tokenIds[0],
        creator: incentiveCreator.address,
      })
    ).to.emit(staker, 'TokenStaked')

    const amount = BNe18(10_000)
    const deadline = (await blockTimestamp()) + 1000

    const lp1Amount = amount.div(2)
    // const lpUser1 = actors.lpUser1()
    const tokenId1 = await mintPosition(nft, {
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
    ctx.tokenIds.push(tokenId1)
    await nft.connect(lpUser0).approve(staker.address, ctx.tokenIds[1], {
      gasLimit: MAX_GAS_LIMIT,
    })
    await staker.connect(lpUser0).depositToken(ctx.tokenIds[1])

    const lpUser2 = actors.lpUser2()
    const lp2Amount = amount.div(4)
    const tokenId2 = await mintPosition(nft, {
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
    ctx.tokenIds.push(tokenId2)
    await nft.connect(lpUser0).approve(staker.address, tokenId2, {
      gasLimit: MAX_GAS_LIMIT,
    })
    await staker.connect(lpUser0).depositToken(ctx.tokenIds[2])

    // To Test: lpUser2 with multiple tokens?

    await expect(
      staker.connect(lpUser0).stakeToken({
        ...incentiveParams,
        tokenId: ctx.tokenIds[1],
        creator: incentiveCreator.address,
      })
    ).to.emit(staker, 'TokenStaked')

    await expect(
      staker.connect(lpUser0).stakeToken({
        ...incentiveParams,
        tokenId: ctx.tokenIds[2],
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

    // console.info('unstake ctx.tokenId')
    // const receipt = await staker.connect(lpUser0).unstakeToken(
    //   {
    //     ...incentiveParams,
    //     tokenId: ctx.tokenIds[0],
    //     creator: incentiveCreator.address,
    //     to: lpUser0.address,
    //   },
    //   { gasLimit: MAX_GAS_LIMIT }
    // )
    // await receipt.wait()

    // await staker
    //   .connect(lpUser0)
    //   .withdrawToken(ctx.tokenIds[0], lpUser0.address)
    // let r = await nft.positions(ctx.tokenIds[0])
    // await nft.decreaseLiquidity(
    //   {
    //     tokenId: ctx.tokenIds[0],
    //     liquidity: r[7],
    //     amount0Min: 0,
    //     amount1Min: 0,
    //     deadline: time + 1000,
    //   },
    //   { gasLimit: MAX_GAS_LIMIT }
    // )
    // console.info('after')
    // await nft.burn(ctx.tokenIds[0])

    // let newBalance = await rewardToken
    //   .connect(lpUser0)
    //   .balanceOf(lpUser0.address)
    // console.info(
    //   `unstaking tokenId=${ctx.tokenIds[0]}`,
    //   newBalance,
    //   newBalance.toString()
    // )

    // await setTime(time + 500)
    // console.info('unstake tokenId1')
    // await staker.connect(lpUser0).unstakeToken(
    //   {
    //     ...incentiveParams,
    //     tokenId: ctx.tokenIds[1],
    //     creator: incentiveCreator.address,
    //     to: lpUser0.address,
    //   },
    //   { gasLimit: MAX_GAS_LIMIT }
    // )
    // await staker.connect(lpUser0).withdrawToken(tokenId1, lpUser0.address)

    // r = await nft.positions(tokenId1)
    // await nft.decreaseLiquidity(
    //   {
    //     tokenId: tokenId1,
    //     liquidity: r[7],
    //     amount0Min: 0,
    //     amount1Min: 0,
    //     deadline: time + 1000,
    //   },
    //   { gasLimit: MAX_GAS_LIMIT }
    // )
    // await nft.burn(tokenId1)

    // newBalance = await rewardToken.connect(lpUser0).balanceOf(lpUser0.address)
    // console.info(
    //   `unstaking tokenId1=${tokenId1}`,
    //   newBalance,
    //   newBalance.toString()
    // )

    // await setTime(time + 600)

    // console.info('unstake tokenId2')
    // await staker.connect(lpUser0).unstakeToken(
    //   {
    //     ...incentiveParams,
    //     tokenId: ctx.tokenIds[2],
    //     creator: incentiveCreator.address,
    //     to: lpUser0.address,
    //   },
    //   { gasLimit: MAX_GAS_LIMIT }
    // )
    // await staker.connect(lpUser0).withdrawToken(tokenId2, lpUser0.address)

    // r = await nft.positions(tokenId2)
    // await nft.decreaseLiquidity(
    //   {
    //     tokenId: ctx.tokenIds[2],
    //     liquidity: r[7],
    //     amount0Min: 0,
    //     amount1Min: 0,
    //     deadline: time + 1000,
    //   },
    //   { gasLimit: MAX_GAS_LIMIT }
    // )
    // await nft.burn(tokenId2)

    // newBalance = await rewardToken.connect(lpUser0).balanceOf(lpUser0.address)
    // console.info(
    //   `unstaking tokenId2=${ctx.tokenIds[2]}`,
    //   newBalance,
    //   newBalance.toString()
    // )
  })
})
