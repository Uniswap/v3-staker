import { BigNumber, BigNumberish } from 'ethers'

export module ContractParams {
  export type Timestamps = {
    startTime: number
    endTime: number
  }

  export type IncentiveKey = {
    pool: string
    rewardToken: string
    refundee: string
  } & Timestamps

  export type CreateIncentive = IncentiveKey & {
    reward: BigNumberish
  }

  export type EndIncentive = IncentiveKey

  export type Stake = {
    secondsPerLiquidityInsideInitialX128: BigNumber
    liquidity: BigNumber
  }
}
