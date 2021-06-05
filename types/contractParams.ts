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
}

export module ContractStructs {
  // I think this is possible using ReturnType and ThenArg
  export type Stake = {
    secondsPerLiquidityInsideInitialX128: BigNumber
    liquidity: BigNumber
  }

  export type Deposit = {
    owner: string
    numberOfStakes: BigNumber
  }

  export type Incentive = {
    totalRewardUnclaimed: BigNumber
    numberOfStakes: BigNumber
    totalSecondsClaimedX128: BigNumber
  }
}
