export * from '../../vendor/uniswap-v3-periphery/test/shared/constants'
export * from '../../vendor/uniswap-v3-periphery/test/shared/ticks'

export * from './fixtures'

import { constants } from 'ethers'
export const { MaxUint256 } = constants

import { ethers } from 'hardhat'
export const blockTimestamp = async () => {
  const blockNumber = await ethers.provider.getBlockNumber()
  const block = await ethers.provider.getBlock(blockNumber)
  return block.timestamp
}

import { expect, use } from 'chai'
import { solidity } from 'ethereum-waffle'
import { jestSnapshotPlugin } from 'mocha-chai-jest-snapshot'

use(solidity)
use(jestSnapshotPlugin())

export { expect }

import bn from 'bignumber.js'

import { BigNumber, BigNumberish } from 'ethers'

bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 })

// returns the sqrt price as a 64x96
export const encodePriceSqrt = (
  reserve1: BigNumberish,
  reserve0: BigNumberish
): BigNumber => {
  return BigNumber.from(
    new bn(reserve1.toString())
      .div(reserve0.toString())
      .sqrt()
      .multipliedBy(new bn(2).pow(96))
      .integerValue(3)
      .toString()
  )
}
