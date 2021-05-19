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
} from './shared'

import { uniswapFixture, userFixtures } from './shared/fixtures'

type TestEnvironmentFixture = {
  token0: TestERC20
  token1: TestERC20
  rewardToken: TestERC20
  uniswapV3Factory: IUniswapV3Factory
  nft: INonfungiblePositionManager
  staker: UniswapV3Staker
  pool: string
  incentive: any
}

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
    .createPool(token0.address, token1.address, FeeAmount.LOW)

  const pool = await uniswapV3Factory.getPool(
    token0.address,
    token1.address,
    FeeAmount.LOW
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

  return {
    token0,
    token1,
    rewardToken,
    uniswapV3Factory,
    nft,
    staker,
    pool,
    incentive,
  }
}

const { createFixtureLoader } = waffle
let loadFixture: ReturnType<typeof createFixtureLoader>

describe.only('accounting integration tests', async () => {
  const wallets = waffle.provider.getWallets()
  const ctx = ({} as unknown) as any

  beforeEach('loader', async () => {
    loadFixture = createFixtureLoader(wallets)
  })

  beforeEach('create fixture loader', async () => {
    ctx.foo = 'bar'
    const items = await loadFixture(fullEnvironmentFixture)
    console.info('after loadFixture')
    console.info(items)
  })

  it("doesn't shit the bed", async () => {
    expect(ctx.foo).to.eq('bar')
    // Test scenario
    // (Done) Create Uniswap V3 Factory and surrounding contracts
    // (Done) user0 creates token0, token1, rewardToken
    // (Done) user0 transfers X amount of token0, token1 to user1
    // user1 creates a uniswap liquidity pool for token0/token1
    // user1 adds liquidity to a specific range
    // user0 transfers Y amount of token0, token1 to user2
    // move the clock forward
    // user0 transfers Z amount of token0 to user3
    // user3 trades in the pool and moves the price
    // make sure the right bounds are respected
  })
})
