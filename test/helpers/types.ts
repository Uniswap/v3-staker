import { BigNumber, Wallet } from 'ethers'
import { TestERC20 } from '../../typechain'

export module HelperTypes {
  type CommandFunction<Input, Output> = (input: Input) => Promise<Output>

  export module CreateIncentive {
    type Args = {
      rewardToken: TestERC20
      totalReward: BigNumber
      poolAddress: string
      startTime: number
    }
    export type Result = {
      poolAddress: string
      rewardToken: TestERC20
      totalReward: BigNumber
      startTime: number
      endTime: number
      claimDeadline: number
      creatorAddress: string
    }

    export type Command = CommandFunction<Args, Result>
  }

  export module MintStake {
    type Args = {
      lp: Wallet
      tokensToStake: [TestERC20, TestERC20]
      amountsToStake: [BigNumber, BigNumber]
      ticks: [number, number]
      createIncentiveResult: CreateIncentive.Result
    }

    type Result = {
      tokenId: string
      stakedAt: number
    }

    export type Command = CommandFunction<Args, Result>
  }

  export module SimulateTrading {
    type Args = {
      numberOfTrades: number
    }
    type Result = {
      timeseries: Array<{ slot0: any; time: number }>
    }

    export type Command = CommandFunction<Args, Result>
  }

  export module UnstakeCollectBurn {
    type Args = {
      lp: Wallet
      tokenId: string
      createIncentiveResult: CreateIncentive.Result
    }
    type Result = {
      balance: BigNumber
      unstakedAt: number
    }

    export type Command = CommandFunction<Args, Result>
  }

  export module EndIncentive {
    type Args = {
      createIncentiveResult: CreateIncentive.Result
    }

    type Result = {
      amountReturnedToCreator: BigNumber
    }

    export type Command = CommandFunction<Args, Result>
  }
}
