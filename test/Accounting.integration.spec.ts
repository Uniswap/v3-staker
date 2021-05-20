import { Contract } from 'ethers'
import { ethers, waffle } from 'hardhat'
import {
  TestERC20,
  INonfungiblePositionManager,
  IUniswapV3Factory,
  UniswapV3Staker,
  IUniswapV3Pool,
} from '../typechain'
import { ActorFixture } from '../test/shared/actors'
import { uniswapFixture, mintPosition } from './shared/fixtures'

const { createFixtureLoader } = waffle

let loadFixture: ReturnType<typeof createFixtureLoader>
const provider = waffle.provider

describe('Unstake accounting', async () => {
  const wallets = provider.getWallets()

  let tokens: [TestERC20, TestERC20, TestERC20]
  let factory: IUniswapV3Factory
  let nft: INonfungiblePositionManager
  let staker: UniswapV3Staker
  let pool01: string
  let pool12: string
  let subject
  let actors: ActorFixture

  before('loader', async () => {
    loadFixture = createFixtureLoader(wallets)
  })

  beforeEach('create fixture loader', async () => {
    ;({ nft, tokens, staker, factory, pool01, pool12 } = await loadFixture(
      uniswapFixture
    ))
    actors = ActorFixture.forProvider(provider)
  })

  it('does not die', async () => {
    const lpUser0 = actors.lpUser0()
    const lpUser1 = actors.lpUser1()
  })
})
