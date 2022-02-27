import { BigNumber, constants, Wallet } from 'ethers'
import { LoadFixtureFunction } from '../types'
import { TestERC20 } from '../../typechain'
import { uniswapFixture, mintPosition, UniswapFixtureType } from '../shared/fixtures'
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
  makeTimestamps,
  maxGas,
} from '../shared'
import { createFixtureLoader, provider } from '../shared/provider'
import { HelperCommands, ERC20Helper, incentiveResultToStakeAdapter } from '../helpers'
import { ContractParams } from '../../types/contractParams'
import { createTimeMachine } from '../shared/time'
import { ethers } from 'hardhat'

let loadFixture: LoadFixtureFunction

function decodeDataURI(uri: string, prefix: string) {
  expect(uri.indexOf(prefix)).to.equal(0)
  return ethers.utils.toUtf8String(ethers.utils.base64.decode(uri.substring(prefix.length)))
}

describe('unit/StakedNFTDescriptor', () => {
  const actors = new ActorFixture(provider.getWallets(), provider)
  const incentiveCreator = actors.incentiveCreator()
  const lpUser0 = actors.lpUser0()
  const amountDesired = BNe18(10)
  const totalReward = BNe18(100)
  const erc20Helper = new ERC20Helper()
  const Time = createTimeMachine(provider)
  let helpers: HelperCommands
  let context: UniswapFixtureType
  let timestamps: ContractParams.Timestamps
  let tokenId: string
  let incentiveId: string
  let incentiveKey: ContractParams.IncentiveKey

  before('loader', async () => {
    loadFixture = createFixtureLoader(provider.getWallets(), provider)
  })

  beforeEach('create fixture loader', async () => {
    context = await loadFixture(uniswapFixture)
    helpers = HelperCommands.fromTestContext(context, actors, provider)

    timestamps = makeTimestamps((await blockTimestamp()) + 1_000)
    incentiveKey = {
      rewardToken: context.rewardToken.address,
      pool: context.pool01,
      startTime: timestamps.startTime,
      endTime: timestamps.endTime,
      refundee: incentiveCreator.address,
      minimumTickWidth: 0,
    }
    incentiveId = await context.testIncentiveId.compute(incentiveKey)

    await erc20Helper.ensureBalancesAndApprovals(
      lpUser0,
      [context.token0, context.token1],
      amountDesired,
      context.nft.address
    )

    tokenId = await mintPosition(context.nft.connect(lpUser0), {
      token0: context.token0.address,
      token1: context.token1.address,
      fee: FeeAmount.MEDIUM,
      tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      recipient: lpUser0.address,
      amount0Desired: amountDesired,
      amount1Desired: amountDesired,
      amount0Min: 0,
      amount1Min: 0,
      deadline: (await blockTimestamp()) + 1000,
    })

    await helpers.createIncentiveFlow({
      rewardToken: context.rewardToken,
      totalReward,
      poolAddress: context.poolObj.address,
      ...timestamps,
    })
  })

  describe('#tokenURI', () => {
    it('generates an SVG for a depositted, non-staked NFT', async () => {
      context.nft
        .connect(lpUser0)
        ['safeTransferFrom(address,address,uint256)'](lpUser0.address, context.stakerNFT.address, tokenId, {
          ...maxGas,
          from: lpUser0.address,
        })
      
      let uri = await context.descriptor.tokenURI(context.stakerNFT.address, tokenId)
      let metadata = JSON.parse(decodeDataURI(uri, 'data:application/json;base64,'))

      expect(metadata.name).to.equal('Uniswap Staked - 0.3% - ERC20/ERC20 - MIN<>MAX')
      expect(metadata.description).to.equal(`This NFT represents a liquidity position in a Uniswap V3 ERC20-ERC20 pool, staked and farming. The owner of this NFT can claim rewards and redeem for the underlying position.

Pool Address: ${context.pool01.toLowerCase()}
ERC20 Address: ${context.token1.address.toLowerCase()}
ERC20 Address: ${context.token0.address.toLowerCase()}
Fee Tier: 0.3%
Token ID: 1`)
      expect(metadata.image.indexOf('data:image/svg+xml;base64,')).to.equal(0)

      let imageSVG = decodeDataURI(metadata.image, 'data:image/svg+xml;base64,')

      const svgTitle = '<g mask="url(#fade-symbol)">'
          + '<rect fill="none" x="0px" y="0px" width="290px" height="200px" />'
          + '<text y="60px" x="32px" fill="white" font-family="\'Courier New\', monospace" font-weight="200" font-size="24px">Staked</text>'
          + '<text y="90px" x="32px" fill="white" font-family="\'Courier New\', monospace" font-weight="200" font-size="24px">ERC20/ERC20</text>'
          + '<text y="120px" x="32px" fill="white" font-family="\'Courier New\', monospace" font-weight="200" font-size="24px">0.3%</text>'
        + '</g>'

      let svgFooter = '<g style="transform:translate(29px, 414px)">'
          + '<rect width="178px" height="26px" rx="8px" ry="8px" fill="rgba(0,0,0,0.6)" />'
          + '<text x="12px" y="17px" font-family="\'Courier New\', monospace" font-size="12px" fill="white">'
          + '<tspan fill="rgba(255,255,255,0.6)">Earning: </tspan>None</text>'
        + '</g>'
        + '<g style="transform:translate(29px, 444px)">'
          + '<rect width="178px" height="26px" rx="8px" ry="8px" fill="rgba(0,0,0,0.6)" />'
          + '<text x="12px" y="17px" font-family="\'Courier New\', monospace" font-size="12px" fill="white">'
          + '<tspan fill="rgba(255,255,255,0.6)">ID: </tspan>1</text>'
        + '</g>'

      expect(imageSVG).to.contain('<svg width="290" height="500" viewBox="0 0 290 500" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">')
      expect(imageSVG).to.contain(svgTitle)
      expect(imageSVG).to.contain(svgFooter)

      await Time.set(timestamps.startTime + 1)
      await context.stakerNFT.storeIncentiveKey(incentiveKey)

      await context.stakerNFT.connect(lpUser0).stakeIncentive(tokenId, incentiveId)

      uri = await context.descriptor.tokenURI(context.stakerNFT.address, tokenId)
      metadata = JSON.parse(decodeDataURI(uri, 'data:application/json;base64,'))

      imageSVG = decodeDataURI(metadata.image, 'data:image/svg+xml;base64,')

      svgFooter = '<g style="transform:translate(29px, 414px)">'
          + '<rect width="178px" height="26px" rx="8px" ry="8px" fill="rgba(0,0,0,0.6)" />'
          + '<text x="12px" y="17px" font-family="\'Courier New\', monospace" font-size="12px" fill="white">'
          + '<tspan fill="rgba(255,255,255,0.6)">Earning: </tspan>ERC20</text>'
        + '</g>'
        + '<g style="transform:translate(29px, 444px)">'
          + '<rect width="178px" height="26px" rx="8px" ry="8px" fill="rgba(0,0,0,0.6)" />'
          + '<text x="12px" y="17px" font-family="\'Courier New\', monospace" font-size="12px" fill="white">'
          + '<tspan fill="rgba(255,255,255,0.6)">ID: </tspan>1</text>'
        + '</g>'

      expect(imageSVG).to.contain(svgFooter)
    })
  })
})
