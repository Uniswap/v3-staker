# uniswap-v3-staker

This is the canonical staking contract designed for [Uniswap V3](https://github.com/Uniswap/uniswap-v3-core).

## Deployments

Note that the v1.0.0 release is susceptible to a [high-difficulty, never-exploited vulnerability](https://github.com/Uniswap/v3-staker/issues/219). For this reason, please use the v1.0.1 release, deployed at the following addresses:

| Network          | Explorer                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Mainnet          | https://etherscan.io/address/0xA9bf398e74Da1Ac6F5c4CB67Ab8937c10a1e454d                  |
| Rinkeby          | https://rinkeby.etherscan.io/address/0xa9bf398e74da1ac6f5c4cb67ab8937c10a1e454d          |
| Kovan            | https://kovan.etherscan.io/address/0xa9bf398e74da1ac6f5c4cb67ab8937c10a1e454d            |
| Ropsten          | https://ropsten.etherscan.io/address/0xa9bf398e74da1ac6f5c4cb67ab8937c10a1e454d          |
| Goerli           | https://goerli.etherscan.io/address/0xa9bf398e74da1ac6f5c4cb67ab8937c10a1e454d           |
| Arbitrum Rinkeby | https://testnet.arbiscan.io/address/0xA9bf398e74Da1Ac6F5c4CB67Ab8937c10a1e454d           |
| Arbitrum One     | https://arbiscan.io/address/0xA9bf398e74Da1Ac6F5c4CB67Ab8937c10a1e454d                   |
| Optimism         | https://optimistic.etherscan.io/address/0x62094CdA36dd8945a2c158A4c6c8865c5B34FEf9       |
| Optimism Kovan   | https://kovan-optimistic.etherscan.io/address/0xA5644E29708357803b5A882D272c41cC0dF92B34 |

DEPRECATED: For historical verification, the staker at tag v1.0.0 is deployed and verified on Etherscan for on all networks at the address: `0x1f98407aaB862CdDeF78Ed252D6f557aA5b0f00d`

| Network          | Explorer                                                                             |
| ---------------- | ------------------------------------------------------------------------------------ |
| Mainnet          | https://etherscan.io/address/0x1f98407aaB862CdDeF78Ed252D6f557aA5b0f00d#code         |
| Rinkeby          | https://rinkeby.etherscan.io/address/0x1f98407aaB862CdDeF78Ed252D6f557aA5b0f00d#code |
| Kovan            | https://kovan.etherscan.io/address/0x1f98407aaB862CdDeF78Ed252D6f557aA5b0f00d#code   |
| Ropsten          | https://ropsten.etherscan.io/address/0x1f98407aaB862CdDeF78Ed252D6f557aA5b0f00d#code |
| Goerli           | https://goerli.etherscan.io/address/0x1f98407aaB862CdDeF78Ed252D6f557aA5b0f00d#code  |
| Arbitrum Rinkeby | https://testnet.arbiscan.io/address/0x1f98407aab862cddef78ed252d6f557aa5b0f00d       |
| Arbitrum One     | https://arbiscan.io/address/0x1f98407aab862cddef78ed252d6f557aa5b0f00d               |

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
