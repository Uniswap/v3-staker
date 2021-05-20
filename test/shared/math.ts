import { ethers } from 'hardhat'

export const BN = ethers.BigNumber.from
export const BNe = (n: number, pow: number) =>
  ethers.BigNumber.from(n).mul(BN(10).pow(pow))
export const BNe18 = (n) => ethers.BigNumber.from(n).mul(BN(10).pow(18))

export { BigNumber, BigNumberish } from 'ethers'
