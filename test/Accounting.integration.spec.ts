import { Fixture } from 'ethereum-waffle'
import { Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import {
  TestERC20,
  UniswapV3Staker,
  INonfungiblePositionManager,
} from '../typechain'
import {
  UniswapV3Pool,
  UniswapV3Factory,
} from '../vendor/uniswap-v3-core/typechain'

import { uniswapFixture } from './shared/fixtures'

const { createFixtureLoader } = waffle

type TestEnvironmentFixture = {
  token0: TestERC20
  token1: TestERC20
  rewardToken: TestERC20

  uniswapV3Factory: UniswapV3Factory
  nft: INonfungiblePositionManager
  staker: UniswapV3Staker
  pool: UniswapV3Pool

  incentive: string

  tokenCreatorUser: Wallet
  lpUser1: Wallet
  lpUser2: Wallet
  lpUser3: Wallet
  tokenIdToLpUser: { [tokenId: string]: string }

  traderUser1: Wallet
  traderUser2: Wallet
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

  //   Pool

  const res = {
    token0,
    token1,
    rewardToken,
    uniswapV3Factory,
    nft,
    staker,
  }
  // Create Uniswap V3 Factory and surrounding contracts
  // user0 creates token0, token1, rewardToken
  // user0 transfers X amount of token0, token1 to user1
  // user1 creates a uniswap liquidity pool for token0/token1
  // user1 adds liquidity to a specific range
  // user0 transfers Y amount of token0, token1 to user2
  // move the clock forward
  // user0 transfers Z amount of token0 to user3
  // user3 trades in the pool and moves the price
  // make sure the right bounds are respected
  return res
}

describe('accounting integration tests', async () => {
  // Uniswap V3 Factory

  it("doesn't shit the bed", async () => {
    console.info('hi')

    // Create the pool
  })
})
