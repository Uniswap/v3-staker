import { BigNumberish, BigNumber, BN } from '../../shared'

export type ComputedRewardAmount = {
  reward: BigNumber
  secondsInsideX128: BigNumber
}

export type RewardMathTestCase = {
  description: string
  totalRewardUnclaimed: BigNumberish
  totalSecondsClaimedX128: BigNumberish
  startTime: BigNumberish
  endTime: BigNumberish
  liquidity: BigNumberish
  secondsPerLiquidityInsideInitialX128: BigNumberish
  secondsPerLiquidityInsideX128: BigNumberish
}

export const writeDescription = (params: RewardMathTestCase): string => {
  if (params.description) {
    return params.description
  }
  return 'hello'
}

export const fillTestCase = (
  params: Partial<RewardMathTestCase>
): RewardMathTestCase => {
  params.description ||= 'Generic Test Case'
  params.totalRewardUnclaimed ||= BN('100')
  params.totalSecondsClaimedX128 ||= BN('100')
  params.startTime ||= BN('123456') // TODO: pick a valid timestamp
  params.endTime ||= BN('1234567') // TODO: pick a valid endtime
  params.liquidity ||= BN('12345')
  params.secondsPerLiquidityInsideInitialX128 ||= BN('1')
  params.secondsPerLiquidityInsideX128 ||= BN('2')

  return params as RewardMathTestCase
}
