import bn from 'bignumber.js'
import {
  BigNumber,
  BigNumberish,
  constants,
  Contract,
  ContractTransaction,
  utils,
  Wallet,
} from 'ethers'

export enum FeeAmount {
  LOW = 500,
  MEDIUM = 3000,
  HIGH = 10000,
}

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
