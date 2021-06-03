import { BigNumber, BigNumberish } from 'ethers'

export module ContractParams {
  export type Timestamps = {
    startTime: number
    endTime: number
    claimDeadline: number
  }

  export type CreateIncentive = {
    pool: string
    rewardToken: string
    totalReward: BigNumberish
    beneficiary: string
  } & Timestamps

  export type EndIncentive = {
    pool: string
    rewardToken: string
  } & Timestamps

  export type UpdateStakeParams = {
    rewardToken: string
    tokenId: number
    beneficiary: string
  } & Timestamps

  export type StakeToken = UpdateStakeParams

  export type UnstakeToken = UpdateStakeParams

  export type Incentive = {
    totalRewardUnclaimed: BigNumber
    totalSecondsClaimedX128: BigNumber
  }

  export type Stake = {
    secondsPerLiquidityInitialX128: BigNumber
    liquidity: BigNumber
  }
}
