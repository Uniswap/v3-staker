import { Fixture } from 'ethereum-waffle'
import { Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import {
  TestERC20,
  UniswapV3Staker,
  INonfungiblePositionManager,
  IUniswapV3Factory,
  IUniswapV3Pool,
} from '../typechain'
import {
  blockTimestamp,
  BNe18,
  createIncentive,
  expect,
  FeeAmount,
  getMaxTick,
  getMinTick,
  TICK_SPACINGS,
  toWei,
} from './shared'
import { zipObject } from 'lodash'

import { mintPosition, uniswapFixture, userFixtures } from './shared/fixtures'

type TestEnvironmentFixture = {
  token0: TestERC20
  token1: TestERC20
  rewardToken: TestERC20
  uniswapV3Factory: IUniswapV3Factory
  nft: INonfungiblePositionManager
  staker: UniswapV3Staker
  pool: string
  incentive: any
  users: any
}

const FEE = FeeAmount.LOW

const fullEnvironmentFixture: Fixture<TestEnvironmentFixture> = async (
  wallets,
  provider
) => {
  const {
    nft,
    factory: uniswapV3Factory,
    staker,
    tokens: [token0, token1, rewardToken],
  } = await uniswapFixture(wallets, provider)

  const uniswapRootUser = await userFixtures.uniswapRootUser(wallets, provider)

  await uniswapV3Factory
    .connect(uniswapRootUser)
    .createPool(token0.address, token1.address, FEE)

  const pool = await uniswapV3Factory.getPool(
    token0.address,
    token1.address,
    FEE
  )

  const startTime = await blockTimestamp()
  const endTime = startTime + 100
  const claimDeadline = endTime + 100
  const totalReward = BNe18(100)

  const tokensOwner = await userFixtures.tokensOwner(wallets, provider)
  await rewardToken.connect(tokensOwner).approve(staker.address, totalReward)

  const incentive = await staker.connect(tokensOwner).createIncentive({
    rewardToken: rewardToken.address,
    pool,
    startTime,
    endTime,
    claimDeadline,
    totalReward,
  })

  const resolvedWallets = await Promise.all(
    Object.keys(userFixtures).map((key) => userFixtures[key](wallets, provider))
  )

  const users = zipObject(Object.keys(userFixtures), resolvedWallets)

  return {
    token0,
    token1,
    rewardToken,
    uniswapV3Factory,
    nft,
    staker,
    pool,
    incentive,
    users,
  }
}

const { createFixtureLoader } = waffle
let loadFixture: ReturnType<typeof createFixtureLoader>

describe.only('accounting integration tests', async () => {
  const wallets = waffle.provider.getWallets()

  // @ts-ignore
  let ctx: TestEnvironmentFixture = {}

  beforeEach('loader', async () => {
    loadFixture = createFixtureLoader(wallets)
  })

  beforeEach('create fixture loader', async () => {
    ctx = await loadFixture(fullEnvironmentFixture)
  })

  it("doesn't die", async () => {
    // Test scenario
    // lpUser adds liquidity to a specific range specified by ticks

    // The widest possible tick range.
    const tickParams = {
      tickLower: getMinTick(TICK_SPACINGS[FEE]),
      tickUpper: getMaxTick(TICK_SPACINGS[FEE]),
    }
    const amountParams = (amt) => ({
      amount0Desired: amt,
      amount1Desired: amt,
      amount0Min: 0,
      amount1Min: 0,
    })

    const connectedNft = ctx.nft.connect(ctx.users.uniswapRootUser)
    // TokenID for lpUser1

    console.info(connectedNft)

    const mintPositionParams = {
      token0: ctx.token0.address,
      token1: ctx.token1.address,
      fee: FEE,
      recipient: ctx.users.uniswapRootUser.address,
      deadline: (await blockTimestamp()) + 1000,
      ...tickParams,
      ...amountParams(toWei('1')),
    }

    await mintPosition(connectedNft, mintPositionParams)

    // await connectedNft.mint(mintPositionParams, {
    //   gasLimit: 12450000,
    // })

    // const tokenId: any = await new Promise((resolve) =>
    //   connectedNft.on('Transfer', (from: any, to: any, tokenId: any) =>
    //     resolve(tokenId)
    //   )
    // )
    // // await connectedNft.approve(ctx.staker.address, tokenId, {
    // //   gasLimit: 12450000,
    // // })
    // console.info(tokenId.toString())
    // return tokenId.toString()

    // const tokenId = await mintPosition(connectedNft, {
    //   token0: ctx.token0.address,
    //   token1: ctx.token1.address,
    //   fee: FEE,
    //   ...tickParams,
    //   ...amountParams(toWei('1')),
    //   recipient: ctx.users.lpUser1.address,
    //   deadline: (await blockTimestamp()) + 1000,
    // })

    // await connectedNft.approve(ctx.staker.address, tokenId, {
    //   gasLimit: 12450000,
    // })

    // console.info(tokenId)

    // await ctx.nft.approve(ctx.staker.address, tokenIdForLpUser1, {
    //   gasLimit: 12450000,
    // })

    // console.info('Token ID is ', tokenIdForLpUser1)

    // user0 transfers Y amount of token0, token1 to user2
    // move the clock forward
    // user0 transfers Z amount of token0 to user3
    // user3 trades in the pool and moves the price
    // make sure the right bounds are respected
  })
})
