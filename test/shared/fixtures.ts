import { Fixture } from 'ethereum-waffle'
import { constants } from 'ethers'
import { ethers, waffle } from 'hardhat'
import UniswapV3FactoryJson from '@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json'
import NFTDescriptor from '@uniswap/v3-periphery/artifacts/contracts/libraries/NFTDescriptor.sol/NFTDescriptor.json'
import MockTimeNonfungiblePositionManager from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json'
import NonfungibleTokenPositionDescriptor from '@uniswap/v3-periphery/artifacts/contracts/NonfungibleTokenPositionDescriptor.sol/NonfungibleTokenPositionDescriptor.json'
import SwapRouter from '@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json'
import { UniswapV3Factory } from '../../vendor/uniswap-v3-core/typechain'
import WETH9 from '../contracts/WETH9.json'
import { linkLibraries } from './linkLibraries'
import type { TestERC20, INonfungiblePositionManager } from '../../typechain'
import { UniswapV3Staker } from '../../typechain/UniswapV3Staker'

type IWETH9 = any
type MockTimeSwapRouter = any

type WETH9Fixture = { weth9: IWETH9 }

export const wethFixture: Fixture<WETH9Fixture> = async (
  [wallet],
  provider
) => {
  const weth9 = (await waffle.deployContract(wallet, {
    bytecode: WETH9.bytecode,
    abi: WETH9.abi,
  })) as IWETH9

  return { weth9 }
}

const v3CoreFactoryFixture: Fixture<UniswapV3Factory> = async ([wallet]) => {
  return ((await waffle.deployContract(wallet, {
    bytecode: UniswapV3FactoryJson.bytecode,
    abi: UniswapV3FactoryJson.abi,
  })) as unknown) as UniswapV3Factory
}

export const v3RouterFixture: Fixture<{
  weth9: IWETH9
  factory: UniswapV3Factory
  router: MockTimeSwapRouter
}> = async ([wallet], provider) => {
  const { weth9 } = await wethFixture([wallet], provider)
  const factory = await v3CoreFactoryFixture([wallet], provider)
  const router = ((await waffle.deployContract(
    wallet,
    {
      bytecode: SwapRouter.bytecode,
      abi: SwapRouter.abi,
    },
    [factory.address, weth9.address]
  )) as unknown) as any

  return { factory, weth9, router }
}

type NonfungibleTokenPositionDescriptor = any
const nonfungibleTokenPositionDescriptorFixture: Fixture<{
  nonfungibleTokenPositionDescriptor: NonfungibleTokenPositionDescriptor
}> = async ([wallet], provider) => {
  const factory = new ethers.ContractFactory(
    NonfungibleTokenPositionDescriptor.abi,
    NonfungibleTokenPositionDescriptor.bytecode
  )

  const nonfungibleTokenPositionDescriptor = await factory.deploy()
  return { nonfungibleTokenPositionDescriptor }
}

const mockTimeNonfungiblePositionManagerFixture: Fixture<{
  mockTimeNonfungiblePositionManager: any
}> = async ([wallet], provider) => {
  const factory = new ethers.ContractFactory(
    MockTimeNonfungiblePositionManager.abi,
    MockTimeNonfungiblePositionManager.bytecode
  )
  const mockTimeNonfungiblePositionManager = await factory.deploy()
  return { mockTimeNonfungiblePositionManager }
}

type MockTimeNonfungiblePositionManager = any

type NFTDescriptorLibrary = any
const nftDescriptorLibraryFixture: Fixture<NFTDescriptorLibrary> = async ([
  wallet,
]) => {
  return await waffle.deployContract(wallet, {
    bytecode: NFTDescriptor.bytecode,
    abi: NFTDescriptor.abi,
  })
}

type UniswapFactoryFixture = {
  weth9: IWETH9
  factory: UniswapV3Factory
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
  const tokens = (await Promise.all([
    tokenFactory.deploy(constants.MaxUint256.div(2)), // do not use maxu256 to avoid overflowing
    tokenFactory.deploy(constants.MaxUint256.div(2)),
    tokenFactory.deploy(constants.MaxUint256.div(2)),
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

  const positionDescriptor = await waffle.deployContract(
    wallets[0],
    {
      bytecode: linkedBytecode,
      abi: NonfungibleTokenPositionDescriptor.abi,
    },
    [tokens[0].address]
  )

  const nft = await waffle.deployContract(
    wallets[0],
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

  const tokenId: BigNumber  = await new Promise((resolve) =>
    nft.on('Transfer', (from: any, to: any, tokenId: any) => resolve(tokenId))
  )
  return tokenId.toString()
}

export const uniswapFixture: Fixture<{
  nft: INonfungiblePositionManager
  factory: UniswapV3Factory
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
  totalReward = BNe18(1000),
}: {
  factory: UniswapV3Factory
  tokens: any
  staker: UniswapV3Staker
  startTime: number
  endTime: number
  claimDeadline: number
  totalReward: BigNumberish
  rewardToken: string
}) => {
  const pool = await factory.getPool(
    tokens[0].address,
    tokens[1].address,
    FeeAmount.MEDIUM
  )

  await tokens[0].approve(staker.address, totalReward)

  return await staker.createIncentive({
    rewardToken,
    pool: pool,
    startTime,
    endTime,
    claimDeadline,
    totalReward,
  })
}
