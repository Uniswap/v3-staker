import { BigNumber, BigNumberish } from '@ethersproject/bignumber'
import chai from 'chai'

const { expect } = chai

const BN = BigNumber.from

declare global {
  module Chai {
    interface Assertion {
      beWithin(marginOfError: BigNumberish, actual: BigNumberish): Assertion
    }
  }
}

chai.use(({ Assertion }) => {
  Assertion.addMethod(
    'beWithin',
    function (marginOfError: BigNumberish, actual: BigNumberish) {
      const result = BN(this._obj)
        .abs()
        .sub(BN(actual).abs())
        .lte(BN(marginOfError))

      new Assertion(
        result,
        `Expected ${this._obj} to be within ${marginOfError} of ${actual}`
      )
    }
  )
})

describe('BigNumber beWithin', () => {
  it('works', () => {
    expect(BN('100')).to.beWithin(BN('1'), BN('99'))
    expect(BN('100')).not.to.beWithin(BN('1'), BN('98'))
    expect(BN('100')).to.beWithin(BN('1'), BN('101'))
    expect(BN('100')).not.to.beWithin(BN('1'), BN('102'))
    expect(BN('10')).not.to.beWithin(BN('1'), BN('2'))
  })
})
