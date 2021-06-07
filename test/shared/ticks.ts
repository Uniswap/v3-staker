import { FeeAmount } from './external/v3-periphery/constants'
import { getMinTick, getMaxTick } from './external/v3-periphery/ticks'
import { TICK_SPACINGS } from './external/v3-periphery/constants'

export const defaultTicks = (fee: FeeAmount = FeeAmount.MEDIUM) => ({
  tickLower: getMinTick(TICK_SPACINGS[fee]),
  tickUpper: getMaxTick(TICK_SPACINGS[fee]),
})

export const defaultTicksArray = (...args): [number, number] => {
  const { tickLower, tickUpper } = defaultTicks(...args)
  return [tickLower, tickUpper]
}
