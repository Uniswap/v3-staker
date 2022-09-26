# uniswap-v3-staker

This is the canonical staking contract designed for [Uniswap V3](https://github.com/Uniswap/uniswap-v3-core).

## Deployments

v1.0.3

The main change compared to v1.0.2 is the addition of a new configuration value called vestingPeriod, which defines the minimal time a staked position needs to be in range to recieve the full reward.

| Network          | Explorer                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Polygon          | https://polygonscan.com/address/0x8c696deF6Db3104DF72F7843730784460795659a               |

v1.0.2

| Network          | Explorer                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Mainnet          | https://etherscan.io/address/0xe34139463bA50bD61336E0c446Bd8C0867c6fE65                  |
| Rinkeby          | https://rinkeby.etherscan.io/address/0xe34139463bA50bD61336E0c446Bd8C0867c6fE65          |
| Kovan            | https://kovan.etherscan.io/address/0xe34139463bA50bD61336E0c446Bd8C0867c6fE65            |
| Ropsten          | https://ropsten.etherscan.io/address/0xe34139463bA50bD61336E0c446Bd8C0867c6fE65          |
| Goerli           | https://goerli.etherscan.io/address/0xe34139463bA50bD61336E0c446Bd8C0867c6fE65           |
| Arbitrum Rinkeby | https://testnet.arbiscan.io/address/0xe34139463bA50bD61336E0c446Bd8C0867c6fE65           |
| Arbitrum One     | https://arbiscan.io/address/0xe34139463bA50bD61336E0c446Bd8C0867c6fE65                   |
| Optimism         | https://optimistic.etherscan.io/address/0xe34139463bA50bD61336E0c446Bd8C0867c6fE65       |
| Optimism Kovan   | https://kovan-optimistic.etherscan.io/address/0xe34139463bA50bD61336E0c446Bd8C0867c6fE65 |

⚠️DEPRECATED⚠️: For historical verification purposes only, the staker at tag v1.0.0 was deployed at the address: `0x1f98407aaB862CdDeF78Ed252D6f557aA5b0f00d`

## Links:

- [Contract Design](docs/Design.md)

## Development and Testing

```sh
$ yarn
$ yarn test
```

## Gas Snapshots

```sh
# if gas snapshots need to be updated
$ UPDATE_SNAPSHOT=1 yarn test
```

## Contract Sizing

```sh
$ yarn size-contracts
```
