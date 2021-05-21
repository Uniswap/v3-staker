export * from './external/v3-periphery/constants'
export * from './external/v3-periphery/ticks'
export * from './external/v3-periphery/tokenSort'
export * from './fixtures'
export * from './actors'

import { FeeAmount } from './external/v3-periphery/constants'
import { Contract, ContractTransaction } from 'ethers'
import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/abstract-provider'
import { constants } from 'ethers'

export const { MaxUint256 } = constants

import { ethers, waffle } from 'hardhat'
export const blockTimestamp = async () => {
  const block = await waffle.provider.getBlock('latest')
  if (!block) {
    throw new Error('null block returned from provider')
  }
  return block.timestamp
}

import bn from 'bignumber.js'

import { BigNumber, BigNumberish } from 'ethers'

bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 })

import { expect, use } from 'chai'
import { solidity } from 'ethereum-waffle'
import { jestSnapshotPlugin } from 'mocha-chai-jest-snapshot'

use(solidity)
use(jestSnapshotPlugin())

export { expect }

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

export const BN = ethers.BigNumber.from
export const BNe18 = (n) => ethers.BigNumber.from(n).mul(BN(10).pow(18))

export { BigNumber, BigNumberish } from 'ethers'

export async function snapshotGasCost(
  x:
    | TransactionResponse
    | Promise<TransactionResponse>
    | ContractTransaction
    | Promise<ContractTransaction>
    | TransactionReceipt
    | Promise<BigNumber>
    | BigNumber
    | Contract
    | Promise<Contract>
): Promise<void> {
  const resolved = await x
  if ('deployTransaction' in resolved) {
    const receipt = await resolved.deployTransaction.wait()
    expect(receipt.gasUsed.toNumber()).toMatchSnapshot()
  } else if ('wait' in resolved) {
    const waited = await resolved.wait()
    expect(waited.gasUsed.toNumber()).toMatchSnapshot()
  } else if (BigNumber.isBigNumber(resolved)) {
    expect(resolved.toNumber()).toMatchSnapshot()
  }
}

export function encodePath(path: string[], fees: FeeAmount[]): string {
  if (path.length != fees.length + 1) {
    throw new Error('path/fee lengths do not match')
  }

  let encoded = '0x'
  for (let i = 0; i < fees.length; i++) {
    // 20 byte encoding of the address
    encoded += path[i].slice(2)
    // 3 byte encoding of the fee
    encoded += fees[i].toString(16).padStart(2 * 3, '0')
  }
  // encode the final token
  encoded += path[path.length - 1].slice(2)

  return encoded.toLowerCase()
}
