import { BigNumber, Contract, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import _, { result } from 'lodash'

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
} from './shared'
import { Fixture } from 'ethereum-waffle'

import MockTimeNonfungiblePositionManager from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json'
import UniswapV3Pool from '@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json'

type ISwapRouter = any
const { createFixtureLoader } = waffle

let loadFixture: ReturnType<typeof createFixtureLoader>
const provider = waffle.provider

type TestContext = {
  tokens: [TestERC20, TestERC20, TestERC20]
  tok0: TestERC20
  tok1: TestERC20
  factory: IUniswapV3Factory
  nft: INonfungiblePositionManager
  router: ISwapRouter
  staker: UniswapV3Staker
  pool01: string
  pool12: string
  subject?: Function
  fee: FeeAmount
}

describe('Unstake accounting', async () => {
  const wallets = provider.getWallets()
  let ctx = {} as TestContext
  let actors: ActorFixture

  before('create fixture loader', async () => {
    loadFixture = createFixtureLoader(wallets, provider)
  })

  const fixture: Fixture<TestContext> = async (wallets, provider) => {
    actors = ActorFixture.forProvider(provider)
    const result = await uniswapFixture(wallets, provider)
    const lpUsers = [actors.lpUser0(), actors.lpUser1()]
    const traderUsers = [actors.traderUser0(), actors.traderUser1()]
    const amount = BNe18(10_000)
    const pool = result.pool01

    /* Give some of token0 and token1 to lpUser0 and lpUser1 */
    await Promise.all(
      _.range(2).map((tokenIndex) => {
        lpUsers.concat(traderUsers).map((user) => {
          return result.tokens[tokenIndex].transfer(user.address, amount)
        })
      })
    )

    expect(await result.tokens[0].balanceOf(lpUsers[0].address)).to.eq(amount)
    expect(await result.tokens[1].balanceOf(lpUsers[0].address)).to.eq(amount)

    const lpUser0Signer = provider.getSigner(lpUsers[0].address)
    const erc20Factory = await ethers.getContractFactory('TestERC20')

    /* Let the staker access them */
    const tok0 = erc20Factory.attach(result.tokens[0].address) as TestERC20
    await tok0.connect(lpUser0Signer).approve(result.staker.address, amount)

    const tok1 = erc20Factory.attach(result.tokens[1].address) as TestERC20
    await tok1.connect(lpUser0Signer).approve(result.staker.address, amount)

    /* lpUser0 deposits some liquidity into the pool */
    // TODO: make sure this is called from the right person
    const nftContract = await ethers.getContractAt(
      MockTimeNonfungiblePositionManager.abi,
      result.nft.address
    )

    // deposit liquidity
    const connectedNft = nftContract.connect(
      lpUser0Signer
    ) as INonfungiblePositionManager

    const tokenId = await mintPosition(result.nft, {
      token0: tok0.address,
      token1: tok1.address,
      fee: FeeAmount.MEDIUM,
      tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      recipient: lpUsers[0].address,
      amount0Desired: amount,
      amount1Desired: amount.div(2),
      amount0Min: 0,
      amount1Min: 0,
      deadline: (await blockTimestamp()) + 1000,
    })

    await connectedNft.approve(result.staker.address, tokenId, {
      gasLimit: 12450000,
    })
    await result.staker.connect(lpUsers[0]).depositToken(tokenId)

    const pool0 = (await ethers.getContractAt(
      UniswapV3Pool.abi,
      pool
    )) as IUniswapV3Pool

    return {
      ...result,
      tok0,
      tok1,
      pool0,
    }
  }

  beforeEach('load fixture', async () => {
    ctx = await loadFixture(fixture)
    actors = ActorFixture.forProvider(provider)
  })

  it.only('does not die', async () => {
    // const incentiveCreator = actors.tokensOwner()
    const { tok0, tok1, router, staker } = ctx

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
    const totalReward = BNe18(100)
    const incentiveCreator = actors.incentiveCreator()

    // First, send the incentive creator totalReward of rewardToken
    await rewardToken.transfer(incentiveCreator.address, totalReward)
    expect(await rewardToken.balanceOf(incentiveCreator.address)).to.eq(
      totalReward
    )

    await rewardToken
      .connect(incentiveCreator)
      .approve(staker.address, totalReward)

    const incentiveParams = (ts: number) => ({
      pool: ctx.pool01,
      rewardToken: rewardToken.address,
      totalReward: totalReward,
      startTime: ts,
      endTime: ts + 1000,
      claimDeadline: ts + 2000,
    })
    await staker
      .connect(incentiveCreator)
      .createIncentive(incentiveParams(await blockTimestamp()))

    /* there's some trading within that range */
    await router.connect(trader0).exactInput({
      recipient: trader0.address,
      deadline: MaxUint256,
      path: encodePath([tok0.address, tok1.address], [FeeAmount.MEDIUM]),
      amountIn: BNe18(2),
      amountOutMinimum: 0,
    })

    await router.connect(trader1).exactInput({
      recipient: trader1.address,
      deadline: MaxUint256,
      path: encodePath([tok1.address, tok0.address], [FeeAmount.MEDIUM]),
      amountIn: BNe18(2),
      amountOutMinimum: 0,
    })

    /* lpUser0 tries to withdraw their staking rewards */

    /* They can */
  })
})
