import { FeeAmount } from './shared'
import { ISwapRouter } from '../types/ISwapRouter'
import { createFixtureLoader } from './shared/provider'
import {
  TestERC20,
  INonfungiblePositionManager,
  IUniswapV3Factory,
  UniswapV3Staker,
} from '../typechain'

export type LoadFixtureFunction = ReturnType<typeof createFixtureLoader>

export type TestContext = {
  tokens: [TestERC20, TestERC20, TestERC20]
  factory: IUniswapV3Factory
  nft: INonfungiblePositionManager
  router: ISwapRouter
  staker: UniswapV3Staker
  pool01: string
  pool12: string
  subject?: Function
  fee: FeeAmount
}

export type TokenIDs = {
  tokenIds: Array<string>
}
