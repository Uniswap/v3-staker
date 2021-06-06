import { MockProvider } from 'ethereum-waffle'
import { Wallet } from 'ethers'

export const WALLET_USER_INDEXES = {
  WETH_OWNER: 0,
  TOKENS_OWNER: 1,
  UNISWAP_ROOT: 2,
  STAKER_DEPLOYER: 3,
  LP_USER_0: 4,
  LP_USER_1: 5,
  LP_USER_2: 6,
  TRADER_USER_0: 7,
  TRADER_USER_1: 8,
  TRADER_USER_2: 9,
  INCENTIVE_CREATOR: 10,
}

export class ActorFixture {
  wallets: Array<Wallet>
  provider: MockProvider

  constructor(wallets, provider) {
    this.wallets = wallets
    this.provider = provider
  }
  /* EOA that owns all Uniswap-related contracts */

  /* EOA that mints and transfers WETH to test accounts */
  wethOwner() {
    return this._getActor(WALLET_USER_INDEXES.WETH_OWNER)
  }

  /* EOA that mints all the Test ERC20s we use */
  tokensOwner() {
    return this._getActor(WALLET_USER_INDEXES.TOKENS_OWNER)
  }

  uniswapRootUser() {
    return this._getActor(WALLET_USER_INDEXES.UNISWAP_ROOT)
  }

  /* EOA that will deploy the staker */
  stakerDeployer() {
    return this._getActor(WALLET_USER_INDEXES.STAKER_DEPLOYER)
  }

  /* These EOAs provide liquidity in pools and collect fees/staking incentives */
  lpUser0() {
    return this._getActor(WALLET_USER_INDEXES.LP_USER_0)
  }

  lpUser1() {
    return this._getActor(WALLET_USER_INDEXES.LP_USER_1)
  }

  lpUser2() {
    return this._getActor(WALLET_USER_INDEXES.LP_USER_2)
  }

  lpUsers() {
    return [this.lpUser0(), this.lpUser1(), this.lpUser2()]
  }

  /* These EOAs trade in the uniswap pools and incur fees */
  traderUser0() {
    return this._getActor(WALLET_USER_INDEXES.TRADER_USER_0)
  }

  traderUser1() {
    return this._getActor(WALLET_USER_INDEXES.TRADER_USER_1)
  }

  traderUser2() {
    return this._getActor(WALLET_USER_INDEXES.TRADER_USER_2)
  }

  incentiveCreator() {
    return this._getActor(WALLET_USER_INDEXES.INCENTIVE_CREATOR)
  }

  private _getActor(index: number): Wallet {
    /* Actual logic for fetching the wallet */
    if (!index) {
      throw new Error(`Invalid index: ${index}`)
    }
    const account = this.wallets[index]
    if (!account) {
      throw new Error(`Account ID ${index} could not be loaded`)
    }
    return account
  }
}
