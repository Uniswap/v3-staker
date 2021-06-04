import { MockProvider } from 'ethereum-waffle'
import { log } from './logging'

type TimeSetterFunction = (timestamp: number) => Promise<void>

type TimeSetters = {
  set: TimeSetterFunction
  step: TimeSetterFunction
  setAndMine: TimeSetterFunction
}

export const createTimeMachine = (provider: MockProvider): TimeSetters => {
  return {
    set: async (timestamp: number) => {
      log.debug(`🕒 setTime(${timestamp})`)
      // Not sure if I need both of those
      await provider.send('evm_setNextBlockTimestamp', [timestamp])
    },

    step: async (interval: number) => {
      log.debug(`🕒 increaseTime(${interval})`)
      await provider.send('evm_increaseTime', [interval])
    },

    setAndMine: async (timestamp: number) => {
      await provider.send('evm_setNextBlockTimestamp', [timestamp])
      await provider.send('evm_mine', [])
    },
  }
}
