/// <reference path="./matchers/beWithin.ts"/>

import { createFixtureLoader } from './shared/provider'
import { UniswapFixtureType } from './shared/fixtures'

export type LoadFixtureFunction = ReturnType<typeof createFixtureLoader>

export type TestContext = UniswapFixtureType & {
  subject?: Function
}
