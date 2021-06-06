import { constants, BigNumberish, Wallet, BigNumber } from 'ethers'
import { LoadFixtureFunction } from '../types'
import { ethers } from 'hardhat'
import { UniswapV3Staker, TestERC20 } from '../../typechain'
import {
  uniswapFixture,
  mintPosition,
  UniswapFixtureType,
} from '../shared/fixtures'
import {
  expect,
  getMaxTick,
  getMinTick,
  FeeAmount,
  TICK_SPACINGS,
  blockTimestamp,
  BN,
  BNe,
  BNe18,
  snapshotGasCost,
  ActorFixture,
  erc20Wrap,
  makeTimestamps,
  maxGas,
} from '../shared'
import { createFixtureLoader, provider } from '../shared/provider'
import {
  HelperCommands,
  ERC20Helper,
  incentiveResultToStakeAdapter,
} from '../helpers'

import { ContractParams, ContractStructs } from '../../types/contractParams'
import { createTimeMachine } from '../shared/time'
import { HelperTypes } from '../helpers/types'

let loadFixture: LoadFixtureFunction

describe('unit.Deployment', async () => {
  /**
   * Instead of using wallet indexes, we use the actors fixture to
   * acces specific roles.
   */
  const actors = new ActorFixture(provider.getWallets(), provider)

  /**
   * By default, this EOA create incentives.
   */
  const incentiveCreator = actors.incentiveCreator()

  /**
   * By default, lpUser0 is the liquidity provider who gets the NFT.
   */
  const lpUser0 = actors.lpUser0()

  /**
   * How much the lp wants to deposit (of each token)
   */
  const amountDesired = BNe18(10)

  /**
   * Incentive programs will distribute this much of rewardToken.
   */
  const totalReward = BNe18(100)

  const erc20Helper = new ERC20Helper()
  const Time = createTimeMachine(provider)
  let helpers: HelperCommands

  /**
   * Access context this way instead of dealing with namespace collisions.
   * Context is always loaded from the test fixture.
   */
  let context: UniswapFixtureType

  /**
   * Helper for keeping track of startTime, endTime.
   */
  let timestamps: ContractParams.Timestamps

  before('loader', async () => {
    loadFixture = createFixtureLoader(provider.getWallets(), provider)
  })

  beforeEach('create fixture loader', async () => {
    context = await loadFixture(uniswapFixture)
    helpers = new HelperCommands({
      nft: context.nft,
      router: context.router,
      staker: context.staker,
      pool: context.poolObj,
      actors,
      provider,
      testIncentiveId: context.testIncentiveId,
    })
  })

  it('deploys and has an address', async () => {
    const stakerFactory = await ethers.getContractFactory('UniswapV3Staker')
    const staker = (await stakerFactory.deploy(
      context.factory.address,
      context.nft.address
    )) as UniswapV3Staker
    expect(staker.address).to.be.a.string
  })
})
