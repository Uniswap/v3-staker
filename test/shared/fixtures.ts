import { ethers } from 'hardhat'
import { Fixture } from 'ethereum-waffle'
import { constants } from 'ethers'
import { TestERC20 } from '../../typechain/TestERC20'
import { IWETH9 } from '../../typechain/IWETH9'

import {
  abi as FACTORY_ABI,
  bytecode as FACTORY_BYTECODE,
} from '@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json'

import {
  abi as NFT_MANAGER_ABI,
  bytecode as NFT_MANAGER_BYTECODE,
} from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json'

/*
A lot of this is from
https://github.com/Uniswap/uniswap-v3-core/6bd967abe491e4d985cccaaf83a5de376dc121f0/test/shared/fixtures.ts
*/
export const uniswapV3FactoryFixture = async () => {
  const uniswapV3FactoryFactory = new ethers.ContractFactory(
    FACTORY_ABI,
    FACTORY_BYTECODE
  )
  const factory = await uniswapV3FactoryFactory.deploy()
  return { factory }
}

export const nftManagerFixture = async () => {
  const nftManagerFactory = new ethers.ContractFactory(
    NFT_MANAGER_ABI,
    NFT_MANAGER_BYTECODE
  )
  const nftManager = await nftManagerFactory.deploy()
  return { nft: nftManager }
}

type MockTimeNonfungiblePositionManager = any
type IUniswapV3Factory = any

// export const nftFixture: Fixture<{
//   nft: MockTimeNonfungiblePositionManager
//   factory: IUniswapV3Factory
//   tokens: [TestERC20, TestERC20, TestERC20]
//   weth9: IWETH9
//   router: any
// }> = async (wallets, provider) => {
//   const { weth9, factory, tokens, nft, router } = await completeFixture(
//     wallets,
//     provider
//   )

//   // approve & fund wallets
//   for (const token of tokens) {
//     await token.approve(nft.address, constants.MaxUint256)
//     await token.connect(other).approve(nft.address, constants.MaxUint256)
//     await token.transfer(other.address, expandTo18Decimals(1_000_000))
//   }

//   return {
//     nft,
//     factory,
//     tokens,
//     weth9,
//     router,
//   }
// }
