import { ethers, waffle } from 'hardhat'
import { Fixture } from 'ethereum-waffle'
import { expect } from './shared'
import { UniswapV3Staker } from '../typechain/UniswapV3Staker'
import type { IUniswapV3Pool, TestERC20, IUniswapV3Factory } from '../typechain'

import { completeFixture } from './shared/fixtures'

type UniswapV3Factory = any
type UniswapNFT = any

const { createFixtureLoader } = waffle
let loadFixture: ReturnType<typeof createFixtureLoader>

describe('UniswapV3Staker', () => {
  const wallets = waffle.provider.getWallets()

  let factory: UniswapV3Factory
  let nft: UniswapNFT
  let staker: UniswapV3Staker

  const uniswapFixture: Fixture<{
    factory: UniswapV3Factory
    nft: UniswapNFT
  }> = async (wallets, provider) => {
    return await completeFixture(wallets, provider)
  }

  before('create fixture loader', async () => {
    loadFixture = createFixtureLoader(wallets)
    ;({ factory, nft } = await loadFixture(uniswapFixture))
  })

  describe('#initialize', async () => {
    it('deploys', async () => {
      const stakerFactory = await ethers.getContractFactory('UniswapV3Staker')
      staker = (await stakerFactory.deploy(
        factory.address,
        nft.address
      )) as UniswapV3Staker
      expect(staker.address).to.be.a.string
    })
  })

  describe('#createIncentive', async () => {
    describe('happy path', () => {
      it('transfers the right amount of rewardToken', async () => {
        // staker.createIncentive()
      })
      it('emits IncentiveCreated()')
    })
    describe('should fail if', () => {
      it('already has an incentive with those params')
      it('claim deadline not gte end time')
      it('end time not gte start time')
      it('rewardToken is 0 address')
      it('totalReward is 0 or an invalid amount')
      it('rewardToken cannot be transferred')
      // Maybe: it('fails if maybe: fails if pool is not a uniswap v3 pool?')
    })
  })

  describe('#endIncentive', async () => {
    describe('should fail if ', () => {
      it('block.timestamp <= claim deadline')
      it('incentive does not exist')
    })
    describe('works and', () => {
      it('deletes incentives[key]')
      it('deletes even if the transfer fails (re-entrancy vulnerability check)')
    })
  })

  describe('_getIncentiveId', () => {
    it('test various inputs')
  })

  describe('#depositToken', () => {
    describe('that are successful', () => {
      it('emit a Deposited event')
      it('actually transfers the NFT to the contract')
      it('respond to the onERC721Received function')
      it('creates deposits[tokenId] = Deposit struct')
      describe('deposit struct', () => {
        it('numberOfStakes is 0')
        it('owner is msg.sender')
      })
    })

    describe('that fail', () => {
      it('does not emit an event')
      it('does not create a deposit struct in deposits')
    })

    describe('paranoia edge cases', () => {
      /*
      Other possible cases to consider:
        * What if make nft.safeTransferFrom is adversarial in some way?
        * What happens if the nft.safeTransferFrom call fails
        * What if tokenId is invalid
        * What happens if I call deposit() twice with the same tokenId?
        * Ownership checks around tokenId? Can you transfer something that is not yours?

      */
    })
  })

  describe('#withdrawToken', () => {
    describe('happy path', () => {
      it('emits a withdrawal event')
      it('does the safeTransferFrom and transfers ownership')
      it('prevents you from withdrawing twice')
    })
    /*
    Consider:
      you cannot withdraw a token if
        it is not yours
        number of stakes != 0
      paranoia:
        could there be something insecure in nonfungiblePositionManager.ownerOf(tokenId)?
        delegate calls to withdraw?
        it goes through even if the NFT is janky / invalid / adversarial
      */
  })

  describe('#stakeToken', () => {
    /*
    happy path
      it sets the Stake struct inside of stakes
        the Stake.secondsPerLiquidity is set correctly
        the pool address is saved on the stake
      it is done on the right tokenId,incentiveId
      numberOfStakes is incremented by 1
    you cannot stake if
      you are not the owner of the deposit
    paranoia:
      what if it's
        before the start time
        after endTime?
        past the claimDeadline?
        the specified params are incorrect and
          the pool doesn't exist
          the pool exists but something else is fishy
        the NFT is adversarial
      */
  })

  describe('#unstakeToken', () => {
    /*
    checks that
      you are the owner of the deposit
      there exists a stake for that key
      there is non-zero secondsPerLiquidity
    effects:
      decrements numberOfStakes by 1
      it transfers the right amoutn of the reward token
      calculations
        it gets the right secondsPerLiquidity
        totalSecondsUnclaimed
          doesn't overflow
          check the math everywhere
        it emits an Unstaked() event
      you cannt unstake if
        you have not staked
      paranoia:
        what if reward cannot be transferred
        what if it's a big number and we risk overflowing
    */
  })

  describe('#getPositionDetails', () => {
    it('gets called on the nonfungiblePositionManager')
    it('the PoolKey is correct')
    it('the correct address is computed')
    it('the ticks are correct')
    it('the liquidity number is correct')
  })
})
