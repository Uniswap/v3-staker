import { BigNumber, BigNumberish } from 'ethers'

export module ContractParams {
  type Timestamps = {
    startTime: number
    endTime: number
    claimDeadline: number
  }

  export type CreateIncentive = {
    pool: string
    rewardToken: string
    totalReward: BigNumberish
  } & Timestamps

  export type EndIncentive = {
    pool: string
    rewardToken: string
  } & Timestamps

  export type StakeToken = {
    creator: string
    rewardToken: string
    tokenId: number
  } & Timestamps

  export type UnstakeToken = {
    creator: string
    rewardToken: string
    tokenId: number
  } & Timestamps
}
