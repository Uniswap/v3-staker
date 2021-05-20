import { MockProvider } from 'ethereum-waffle'
import { Wallet, Signer } from 'ethers'

const WALLET_USER_INDEXES = {
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
}

const _getActor = (
  n: number,
  wallets: Array<Wallet>,
  provider: MockProvider
) => {
  /* Actual logic for fetching the wallet */
  if (!n) {
    throw new Error(`Invalid index: ${n}`)
  }
  const account = provider.getSigner(n)
  if (!account) {
    throw new Error(`Account ID ${n} could not be loaded`)
  }
  return account
}

type Actor =
  | 'wethOwner'
  | 'tokensOwner'
  | 'uniswapRootUser'
  | 'stakerDeployer'
  | 'lpUser0'
  | 'lpUser1'
  | 'lpUser2'
  | 'traderUser0'
  | 'traderUser1'
  | 'traderUser2'

type GetActorFunc = (wallets: Array<Wallet>, provider: MockProvider) => Signer
export const actors: { [K in Actor]: GetActorFunc } = {
  /* EOA that mints and transfers WETH to test accounts */
  wethOwner: (wallets, provider) =>
    _getActor(WALLET_USER_INDEXES.WETH_OWNER, wallets, provider),

  /* EOA that mints all the Test ERC20s we use */
  tokensOwner: (wallets, provider) =>
    _getActor(WALLET_USER_INDEXES.TOKENS_OWNER, wallets, provider),

  /* EOA that owns all Uniswap-related contracts */
  uniswapRootUser: (wallets, provider) =>
    _getActor(WALLET_USER_INDEXES.UNISWAP_ROOT, wallets, provider),

  /* EOA that will deploy the staker */
  stakerDeployer: (wallets, provider) =>
    _getActor(WALLET_USER_INDEXES.STAKER_DEPLOYER, wallets, provider),

  /* These EOAs provide liquidity in pools and collect fees/staking incentives */
  lpUser0: (wallets, provider) =>
    _getActor(WALLET_USER_INDEXES.LP_USER_0, wallets, provider),
  lpUser1: (wallets, provider) =>
    _getActor(WALLET_USER_INDEXES.LP_USER_1, wallets, provider),
  lpUser2: (wallets, provider) =>
    _getActor(WALLET_USER_INDEXES.LP_USER_2, wallets, provider),

  /* These EOAs trade in the uniswap pools and incur fees */
  traderUser0: (wallets, provider) =>
    _getActor(WALLET_USER_INDEXES.TRADER_USER_0, wallets, provider),
  traderUser1: (wallets, provider) =>
    _getActor(WALLET_USER_INDEXES.TRADER_USER_1, wallets, provider),
  traderUser2: (wallets, provider) =>
    _getActor(WALLET_USER_INDEXES.TRADER_USER_1, wallets, provider),
}
