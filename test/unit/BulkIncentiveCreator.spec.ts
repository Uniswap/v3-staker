import { LoadFixtureFunction } from '../types'
import { uniswapFixture, UniswapFixtureType } from '../shared/fixtures'
import {
  expect,
  getMaxTick,
  getMinTick,
  FeeAmount,
  TICK_SPACINGS,
  blockTimestamp,
  BN,
  BNe18,
  snapshotGasCost,
  ActorFixture,
  erc20Wrap,
  makeTimestamps,
} from '../shared'
import { createFixtureLoader, provider } from '../shared/provider'
import { HelperCommands, ERC20Helper } from '../helpers'
import { ContractParams } from '../../types/contractParams'
import { BulkIncentiveCreator } from '../../typechain'
import { createTimeMachine } from '../shared/time'
import { HelperTypes } from '../helpers/types'
import { ethers } from 'hardhat'

let loadFixture: LoadFixtureFunction

describe('unit/BulkIncentiveCreator', async () => {
  const actors = new ActorFixture(provider.getWallets(), provider)
  const incentiveCreator = actors.incentiveCreator()
  const totalReward = BNe18(100)
  const erc20Helper = new ERC20Helper()
  const Time = createTimeMachine(provider)

  let helpers: HelperCommands
  let context: UniswapFixtureType
  let timestamps: ContractParams.Timestamps

  before('loader', async () => {
    loadFixture = createFixtureLoader(provider.getWallets(), provider)
  })

  beforeEach('create fixture loader', async () => {
    context = await loadFixture(uniswapFixture)
    helpers = HelperCommands.fromTestContext(context, actors, provider)
  })

  describe('#setup', () => {
    let subject: (params: Partial<ContractParams.CreateIncentive>) => Promise<any>
    let deployCreator: (params?: any) => Promise<BulkIncentiveCreator>

    beforeEach('setup', async () => {
      deployCreator = async (params: any = {}) => {
        const { startTime, endTime } = makeTimestamps(await blockTimestamp())

        const bulkIncentiveCreatorFactory = await ethers.getContractFactory('BulkIncentiveCreator')
        const creator = (await bulkIncentiveCreatorFactory.deploy(
          context.staker.address,
          context.rewardToken.address,
          params.startTime || startTime,
          params.endTime || endTime,
          incentiveCreator.address,
          [context.pool01, context.pool12],
          [0, 0],
          [1, 3],
        )) as BulkIncentiveCreator

        await context.rewardToken.transfer(creator.address, totalReward)

        return creator
      }
    })

    describe('works and', () => {
      it('transfers the right amount of rewardToken', async () => {
        const creator = await deployCreator()

        const balanceBefore = await context.rewardToken.balanceOf(context.staker.address)

        await creator.setup()

        expect(await context.rewardToken.balanceOf(context.staker.address)).to.eq(balanceBefore.add(totalReward))
      })

      it('emits an event with valid parameters', async () => {
        const { startTime, endTime } = makeTimestamps(await blockTimestamp())

        const creator = await deployCreator({ startTime, endTime })

        const incentiveId1 = await context.testIncentiveId.compute({
          rewardToken: context.rewardToken.address,
          pool: context.pool01,
          startTime,
          endTime,
          refundee: incentiveCreator.address,
          minimumTickWidth: 0,
        })

        const incentiveId2 = await context.testIncentiveId.compute({
          rewardToken: context.rewardToken.address,
          pool: context.pool12,
          startTime,
          endTime,
          refundee: incentiveCreator.address,
          minimumTickWidth: 0,
        })

        await expect(creator.setup())
          .to.emit(context.staker, 'IncentiveCreated')
          .withArgs(
            incentiveId1,
            context.rewardToken.address,
            context.pool01,
            startTime,
            endTime,
            incentiveCreator.address,
            0,
            totalReward.div(4)
          )
          .to.emit(context.staker, 'IncentiveCreated')
          .withArgs(
            incentiveId2,
            context.rewardToken.address,
            context.pool12,
            startTime,
            endTime,
            incentiveCreator.address,
            0,
            totalReward.div(4).mul(3)
          )
      })

      it('creates incentives with the correct parameters', async () => {
        const { startTime, endTime } = makeTimestamps(await blockTimestamp())

        const creator = await deployCreator({ startTime, endTime })

        await creator.setup()

        const incentiveId1 = await context.testIncentiveId.compute({
          rewardToken: context.rewardToken.address,
          pool: context.pool01,
          startTime,
          endTime,
          refundee: incentiveCreator.address,
          minimumTickWidth: 0,
        })

        const incentiveId2 = await context.testIncentiveId.compute({
          rewardToken: context.rewardToken.address,
          pool: context.pool12,
          startTime,
          endTime,
          refundee: incentiveCreator.address,
          minimumTickWidth: 0,
        })

        const incentive1 = await context.staker.incentives(incentiveId1)
        expect(incentive1.totalRewardUnclaimed).to.equal(totalReward.div(4))
        expect(incentive1.totalSecondsClaimedX128).to.equal(BN(0))

        const incentive2 = await context.staker.incentives(incentiveId2)
        expect(incentive2.totalRewardUnclaimed).to.equal(totalReward.div(4).mul(3))
        expect(incentive2.totalSecondsClaimedX128).to.equal(BN(0))
      })

      it('adds to existing incentives', async () => {
        const { startTime, endTime } = makeTimestamps(await blockTimestamp())

        const creator = await deployCreator({ startTime, endTime })

        await expect(creator.setup()).to.emit(context.staker, 'IncentiveCreated')
        
        await context.rewardToken.transfer(creator.address, totalReward)
        await expect(creator.setup()).to.not.be.reverted

        const incentiveId1 = await context.testIncentiveId.compute({
          rewardToken: context.rewardToken.address,
          pool: context.pool01,
          startTime,
          endTime,
          refundee: incentiveCreator.address,
          minimumTickWidth: 0,
        })

        const incentiveId2 = await context.testIncentiveId.compute({
          rewardToken: context.rewardToken.address,
          pool: context.pool12,
          startTime,
          endTime,
          refundee: incentiveCreator.address,
          minimumTickWidth: 0,
        })

        const {
          totalRewardUnclaimed: unclaimed1,
          totalSecondsClaimedX128: seconds1,
          numberOfStakes: staker1,
        } = await context.staker.incentives(incentiveId1)
        expect(unclaimed1).to.equal(totalReward.div(2))
        expect(seconds1).to.equal(0)
        expect(staker1).to.equal(0)

        const {
          totalRewardUnclaimed: unclaimed2,
          totalSecondsClaimedX128: seconds2,
          numberOfStakes: staker2,
        } = await context.staker.incentives(incentiveId2)
        expect(unclaimed2).to.equal(totalReward.div(2).mul(3))
        expect(seconds2).to.equal(0)
        expect(staker2).to.equal(0)
      })
    })

    describe('fails when', () => {
      it('no tokens are depositted', async () => {
        const { startTime, endTime } = makeTimestamps(await blockTimestamp())

        const bulkIncentiveCreatorFactory = await ethers.getContractFactory('BulkIncentiveCreator')
        const creator = (await bulkIncentiveCreatorFactory.deploy(
          context.staker.address,
          context.rewardToken.address,
          startTime,
          endTime,
          incentiveCreator.address,
          [context.pool01, context.pool12],
          [0, 0],
          [1, 3],
        )) as BulkIncentiveCreator

        await expect(
          creator.setup()
        ).to.be.revertedWith('NOREW')
      })
    })
  })
})
