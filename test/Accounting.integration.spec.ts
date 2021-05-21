import { Contract } from 'ethers'
import { ethers, waffle } from 'hardhat'
import MockTimeNonfungiblePositionManager from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json'
import UniswapV3Pool from '@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json'
import { BigNumber } from 'ethers'
import {
  TestERC20,
  INonfungiblePositionManager,
  IUniswapV3Factory,
  UniswapV3Staker,
  IUniswapV3Pool,
} from '../typechain'
import { ActorFixture } from '../test/shared/actors'
import { uniswapFixture, mintPosition } from './shared/fixtures'
import {
  blockTimestamp,
  BNe18,
  expect,
  FeeAmount,
  getMaxTick,
  getMinTick,
  TICK_SPACINGS,
} from './shared'
import _ from 'lodash'
import { hexlify, hexValue } from 'ethers/lib/utils'

export const MIN_SQRT_RATIO = BigNumber.from('4295128739')
export const MAX_SQRT_RATIO = BigNumber.from(
  '1461446703485210103287273052203988822378723970342'
)

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
  let fee: FeeAmount

  before('loader', async () => {
    loadFixture = createFixtureLoader(wallets)
  })

  beforeEach('create fixture loader', async () => {
    ;({ nft, tokens, staker, factory, pool01, pool12, fee } = await loadFixture(
      uniswapFixture
    ))
    actors = ActorFixture.forProvider(provider)
  })

  it('does not die', async () => {
    const incentiveCreator = actors.tokensOwner()
    const lpUsers = [actors.lpUser0(), actors.lpUser1()]
    const traderUsers = [actors.traderUser0(), actors.traderUser1()]
    const amount = BNe18(2)
    const pool = pool01

    /* Give some of token0 and token1 to lpUser0 and lpUser1 */
    await Promise.all(
      _.range(2).map((tokenIndex) => {
        lpUsers.concat(traderUsers).map((lpUser) => {
          return tokens[tokenIndex].transfer(lpUser.address, amount)
        })
      })
    )

    expect(await tokens[0].balanceOf(lpUsers[0].address)).to.eq(amount)
    expect(await tokens[1].balanceOf(lpUsers[0].address)).to.eq(amount)

    const lpUser0Signer = provider.getSigner(lpUsers[0].address)

    const erc20Factory = await ethers.getContractFactory('TestERC20')

    /* Let the staker access them */

    const tok0 = erc20Factory
      .attach(tokens[0].address)
      .connect(lpUser0Signer) as TestERC20
    await tok0.approve(staker.address, amount)

    const tok1 = erc20Factory
      .attach(tokens[1].address)
      .connect(lpUser0Signer) as TestERC20
    await tok1.approve(staker.address, amount)

    /* lpUser0 deposits some liquidity into the pool */
    // TODO: make sure this is called from the right person
    const nftContract = await ethers.getContractAt(
      MockTimeNonfungiblePositionManager.abi,
      nft.address
    )

    // deposit liquidity
    const connectedNft = nftContract.connect(
      lpUser0Signer
    ) as INonfungiblePositionManager

    const tokenId = await mintPosition(nft, {
      token0: tok0.address,
      token1: tok1.address,
      fee,
      tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      recipient: lpUsers[0].address,
      amount0Desired: amount,
      amount1Desired: amount.div(2),
      amount0Min: 0,
      amount1Min: 0,
      deadline: (await blockTimestamp()) + 1000,
    })

    console.info(tokenId)

    await connectedNft.approve(staker.address, tokenId, { gasLimit: 12450000 })
    await staker.connect(lpUsers[0]).depositToken(tokenId)

    /* Now there's some trading */
    const trader0 = traderUsers[0]
    const trader0Signer = await ethers.getSigner(trader0.address)

    const pool0 = (await ethers.getContractAt(
      UniswapV3Pool.abi,
      pool
    )) as IUniswapV3Pool
    const slot0 = await pool0.slot0()

    const trader1 = traderUsers[1]
    await pool0
      .connect(trader1)
      .swap(
        trader0.address,
        true,
        amount.div(10000),
        slot0.sqrtPriceX96.sub('1000'),
        hexlify(0)
      )

    /* Now someone creates an incentive program */

    /* there's some trading within that range */

    /* lpUser0 tries to withdraw their staking rewards */

    /* They can */
  })
})
