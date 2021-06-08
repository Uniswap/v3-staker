import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { TestRewardMath } from '../../../typechain'
import { expect } from '../../shared'

describe('unit/RewardMath', () => {
  let rewardMath: TestRewardMath

  before('setup test reward math', async () => {
    const factory = await ethers.getContractFactory('TestRewardMath')
    rewardMath = (await factory.deploy()) as TestRewardMath
  })

  it.only('half the liquidity over 20% of the total duration', async () => {
    const { reward, secondsInsideX128 } = await rewardMath.computeRewardAmount(
      /*totalRewardUnclaimed=*/ 1000,
      /*totalSecondsClaimedX128=*/ 0,
      /*startTime=*/ 100,
      /*endTime=*/ 200,
      /*liquidity=*/ 5,
      /*secondsPerLiquidityInsideInitialX128=*/ 0,
      /*secondsPerLiquidityInsideX128=*/ BigNumber.from(20).shl(128).div(10),
      /*currentTime=*/ 120
    )
    // 1000 * 0.5 * 0.2
    expect(reward).to.eq(100)
    // 20 seconds * 0.5 shl 128
    expect(secondsInsideX128).to.eq(BigNumber.from(10).shl(128))
  })
})
