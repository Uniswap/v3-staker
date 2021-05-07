import { ethers } from 'hardhat'
import {
  abi as FACTORY_ABI,
  bytecode as FACTORY_BYTECODE,
} from '@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json'

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
