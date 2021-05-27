import { FeeAmount } from './shared'
import { ISwapRouter } from '../types/ISwapRouter'
import { createFixtureLoader } from './shared/provider'
import { UniswapFixtureType } from './shared/fixtures'
import {
  TestERC20,
  INonfungiblePositionManager,
  IUniswapV3Factory,
  UniswapV3Staker,
} from '../typechain'

export type LoadFixtureFunction = ReturnType<typeof createFixtureLoader>

export type TestContext = UniswapFixtureType & {
  subject?: Function
}

export type TokenIDs = {
  tokenIds: Array<string>
}
