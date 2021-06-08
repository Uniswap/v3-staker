/* https://github.com/Uniswap/uniswap-v3-periphery/blob/e3fb908f1fbc72f1b1342c983c9ad756448c3bba/test/shared/ticks.ts */

import { BigNumber } from 'ethers'

export const getMinTick = (tickSpacing: number) => Math.ceil(-887272 / tickSpacing) * tickSpacing

export const getMaxTick = (tickSpacing: number) => Math.floor(887272 / tickSpacing) * tickSpacing

export const getMaxLiquidityPerTick = (tickSpacing: number) =>
  BigNumber.from(2)
    .pow(128)
    .sub(1)
    .div((getMaxTick(tickSpacing) - getMinTick(tickSpacing)) / tickSpacing + 1)
