import { Fixture } from 'ethereum-waffle'
import { constants, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'

import UniswapV3FactoryJson from '@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json'
import NFTDescriptor from '@uniswap/v3-periphery/artifacts/contracts/libraries/NFTDescriptor.sol/NFTDescriptor.json'
import MockTimeNonfungiblePositionManager from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json'
import NonfungibleTokenPositionDescriptor from '@uniswap/v3-periphery/artifacts/contracts/NonfungibleTokenPositionDescriptor.sol/NonfungibleTokenPositionDescriptor.json'
import SwapRouter from '@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json'
import { IUniswapV3Factory, IUniswapV3Pool } from '../../typechain'
import WETH9 from '../contracts/WETH9.json'
import { linkLibraries } from './linkLibraries'
import { INonfungiblePositionManager } from '../../typechain'
import type { TestERC20 } from '../../typechain'
import { UniswapV3Staker } from '../../typechain/UniswapV3Staker'

/* This is a very verbose way of mapping users to accounts, but in crypto, better safe (and verbose) than sorry! */
const WALLET_USER_INDEXES = {
  UNISWAP_ROOT: 0,
  LP_USER_0: 1,
  LP_USER_1: 2,
  LP_USER_2: 3,
  TRADER_USER_0: 4,
  TRADER_USER_1: 5,
  WETH_OWNER: 6,
  TOKENS_OWNER: 7,
}

export const userFixtures = {
  wethOwner: async (wallets, provider) => {
    return wallets[WALLET_USER_INDEXES.WETH_OWNER]
  },
  tokensOwner: async (wallets, provider) => {
    /* Owns the ERC20s other than weth */
    return wallets[WALLET_USER_INDEXES.TOKENS_OWNER]
  },
  uniswapRootUser: async (wallets, provider) => {
    return wallets[WALLET_USER_INDEXES.UNISWAP_ROOT]
  },
  lpUser1: async (wallets, provider) => {
    return wallets[WALLET_USER_INDEXES.LP_USER_1]
  },
  traderUser0: async (wallets, provider) => {
    return wallets[WALLET_USER_INDEXES.TRADER_USER_0]
  },
  lpUser0: async (wallets, provider) => {
    return wallets[WALLET_USER_INDEXES.LP_USER_0]
  },
  lpUser2: async (wallets, provider) => {
    return wallets[WALLET_USER_INDEXES.LP_USER_2]
  },
}

type IWETH9 = any
type MockTimeSwapRouter = any
type WETH9Fixture = { weth9: IWETH9 }

export const wethFixture: Fixture<WETH9Fixture> = async (wallets, provider) => {
  const wallet = await userFixtures.wethOwner(wallets, provider)
  const weth9 = (await waffle.deployContract(wallet, {
    bytecode: WETH9.bytecode,
    abi: WETH9.abi,
  })) as IWETH9

  return { weth9 }
}

const v3CoreFactoryFixture: Fixture<IUniswapV3Factory> = async (
  wallets,
  provider
) => {
  const wallet = await userFixtures.uniswapRootUser(wallets, provider)
  return ((await waffle.deployContract(wallet, {
    bytecode: UniswapV3FactoryJson.bytecode,
    abi: UniswapV3FactoryJson.abi,
  })) as unknown) as IUniswapV3Factory
}

export const v3RouterFixture: Fixture<{
  weth9: IWETH9
  factory: IUniswapV3Factory
  router: MockTimeSwapRouter
}> = async (wallets, provider) => {
  const uniswapRoot = await userFixtures.uniswapRootUser(wallets, provider)
  const { weth9 } = await wethFixture(wallets, provider)
  const factory = await v3CoreFactoryFixture(wallets, provider)
  const router = ((await waffle.deployContract(
    uniswapRoot,
    {
      bytecode: SwapRouter.bytecode,
      abi: SwapRouter.abi,
    },
    [factory.address, weth9.address]
  )) as unknown) as any

  return { factory, weth9, router }
}

type MockTimeNonfungiblePositionManager = any

type NFTDescriptorLibrary = any
const nftDescriptorLibraryFixture: Fixture<NFTDescriptorLibrary> = async (
  wallets,
  provider
) => {
  const uniswapRoot = await userFixtures.uniswapRootUser(wallets, provider)
  return await waffle.deployContract(uniswapRoot, {
    bytecode: NFTDescriptor.bytecode,
    abi: NFTDescriptor.abi,
  })
}

type UniswapFactoryFixture = {
  weth9: IWETH9
  factory: IUniswapV3Factory
  router: MockTimeSwapRouter
  nft: MockTimeNonfungiblePositionManager
  tokens: [TestERC20, TestERC20, TestERC20]
}

export const uniswapFactoryFixture: Fixture<UniswapFactoryFixture> = async (
  wallets,
  provider
) => {
  const { weth9, factory, router } = await v3RouterFixture(wallets, provider)
  const tokenFactory = await ethers.getContractFactory('TestERC20')

  const tokensOwner = await userFixtures.tokensOwner(wallets, provider)

  const tokens = (await Promise.all([
    tokenFactory.connect(tokensOwner).deploy(constants.MaxUint256.div(2)), // do not use maxu256 to avoid overflowing
    tokenFactory.connect(tokensOwner).deploy(constants.MaxUint256.div(2)),
    tokenFactory.connect(tokensOwner).deploy(constants.MaxUint256.div(2)),
  ])) as [TestERC20, TestERC20, TestERC20]

  const nftDescriptorLibrary = await nftDescriptorLibraryFixture(
    wallets,
    provider
  )

  const linkedBytecode = linkLibraries(
    {
      bytecode: NonfungibleTokenPositionDescriptor.bytecode,
      linkReferences: {
        'NFTDescriptor.sol': {
          NFTDescriptor: [
            {
              length: 20,
              start: 1251,
            },
          ],
        },
      },
    },
    {
      NFTDescriptor: nftDescriptorLibrary.address,
    }
  )

  const uniswapRoot = await userFixtures.uniswapRootUser(wallets, provider)
  const positionDescriptor = await waffle.deployContract(
    uniswapRoot,
    {
      bytecode: linkedBytecode,
      abi: NonfungibleTokenPositionDescriptor.abi,
    },
    [tokens[0].address]
  )

  const nft = await waffle.deployContract(
    uniswapRoot,
    {
      bytecode: MockTimeNonfungiblePositionManager.bytecode,
      abi: MockTimeNonfungiblePositionManager.abi,
    },
    [factory.address, weth9.address, positionDescriptor.address]
  )

  tokens.sort((a, b) =>
    a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
  )

  return {
    weth9,
    factory,
    router,
    tokens,
    nft,
  }
}

export const mintPosition = async (
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
): Promise<string> => {
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
  return tokenId.toString()
}

export const uniswapFixture: Fixture<{
  nft: INonfungiblePositionManager
  factory: IUniswapV3Factory
  staker: UniswapV3Staker
  tokens: [TestERC20, TestERC20, TestERC20]
}> = async (wallets, provider) => {
  const { tokens, nft, factory } = await uniswapFactoryFixture(
    wallets,
    provider
  )
  const stakerFactory = await ethers.getContractFactory('UniswapV3Staker')
  const staker = (await stakerFactory.deploy(
    factory.address,
    nft.address
  )) as UniswapV3Staker

  for (const token of tokens) {
    await token.approve(nft.address, constants.MaxUint256)
  }
  return { nft, tokens, staker, factory }
}

import { FeeAmount, BNe18, BigNumberish, BigNumber } from '../shared'

export const createIncentive = async ({
  factory,
  tokens,
  staker,
  startTime,
  endTime,
  claimDeadline,
  rewardToken,
  pool,
  totalReward = BNe18(1000),
}: {
  factory: IUniswapV3Factory
  tokens: any
  staker: UniswapV3Staker
  startTime: number
  endTime: number
  claimDeadline: number
  totalReward: BigNumberish
  rewardToken: string
  pool: string
}) => {
  await tokens[0].approve(staker.address, totalReward)
  const params = {
    rewardToken,
    pool: pool,
    startTime,
    endTime,
    claimDeadline,
    totalReward,
  }
  return await staker.createIncentive(params)
}
