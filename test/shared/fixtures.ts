import { constants } from 'ethers'
import { Fixture } from 'ethereum-waffle'
import { ethers, waffle } from 'hardhat'
import { linkLibraries } from './linkLibraries'
import WETH9 from '../contracts/WETH9.json'
import { TestERC20 } from '../../typechain/TestERC20'
import UniswapV3FactoryJson from '@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json'
import { UniswapV3Factory } from '../../vendor/uniswap-v3-core/typechain'
import SwapRouter from '@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json'

type IWETH9 = any
type MockTimeSwapRouter = any

export const wethFixture: Fixture<{ weth9: IWETH9 }> = async (
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

import NonfungibleTokenPositionDescriptor from '@uniswap/v3-periphery/artifacts/contracts/NonfungibleTokenPositionDescriptor.sol/NonfungibleTokenPositionDescriptor.json'
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

import MockTimeNonfungiblePositionManager from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json'
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

import NFTDescriptor from '@uniswap/v3-periphery/artifacts/contracts/libraries/NFTDescriptor.sol/NFTDescriptor.json'

type NFTDescriptorLibrary = any
const nftDescriptorLibraryFixture: Fixture<NFTDescriptorLibrary> = async ([
  wallet,
]) => {
  return await waffle.deployContract(wallet, {
    bytecode: NFTDescriptor.bytecode,
    abi: NFTDescriptor.abi,
  })
}

export const completeFixture: Fixture<{
  weth9: IWETH9
  factory: UniswapV3Factory
  router: MockTimeSwapRouter
  nft: MockTimeNonfungiblePositionManager
  tokens: [TestERC20, TestERC20, TestERC20]
}> = async (wallets, provider) => {
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
