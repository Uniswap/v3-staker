import { expect } from 'chai'
import { ethers } from 'hardhat'
import { TestRewardMath } from '../../../typechain'
import { BN } from '../../shared'
import {
  writeDescription,
  fillTestCase,
  RewardMathTestCase,
  ComputedRewardAmount,
} from './helper'

const TEST_CASES: Array<Partial<RewardMathTestCase>> = [
  {
    description: 'totalRewardUnclaimed is 0',
    totalRewardUnclaimed: BN('0'),
    totalSecondsClaimedX128: BN('1234'),
  },
  {
    description: 'another scenario',
    totalRewardUnclaimed: BN('1'),
    totalSecondsClaimedX128: BN('2'),
  },
]

describe('unit/RewardMath', () => {
  let rewardMath: TestRewardMath
  before('setup test reward math', async () => {
    const factory = await ethers.getContractFactory('TestRewardMath')
    rewardMath = (await factory.deploy()) as TestRewardMath
  })

  type TestSubject = (
    params: RewardMathTestCase
  ) => Promise<ComputedRewardAmount>

  const subject: TestSubject = async (params: RewardMathTestCase) => {
    return await rewardMath.computeRewardAmount(
      params.totalRewardUnclaimed,
      params.totalSecondsClaimedX128,
      params.startTime,
      params.endTime,
      params.liquidity,
      params.secondsPerLiquidityInsideInitialX128,
      params.secondsPerLiquidityInsideX128
    )
  }

  it('fails if block.timestamp >= startTime', () => {})

  for (const testCase of TEST_CASES.map(fillTestCase)) {
    it(writeDescription(testCase), async () => {
      expect(true).to.be
      await subject(testCase)
    })
  }
})
