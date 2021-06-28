# uniswap-v3-staker

This is the canonical staking contract designed for [Uniswap V3](https://github.com/Uniswap/uniswap-v3-core).

## Deployments

The staker at tag v1.0.0 is deployed and verified on Etherscan for on all networks at the address: `0x1f98407aaB862CdDeF78Ed252D6f557aA5b0f00d`

| Network          | Explorer                                                                                |
|------------------|-----------------------------------------------------------------------------------------|
| Mainnet          | https://etherscan.io/address/0x1f98407aaB862CdDeF78Ed252D6f557aA5b0f00d#code            |
| Rinkeby          | https://rinkeby.etherscan.io/address/0x1f98407aaB862CdDeF78Ed252D6f557aA5b0f00d#code    |
| Kovan            | https://kovan.etherscan.io/address/0x1f98407aaB862CdDeF78Ed252D6f557aA5b0f00d#code      |
| Ropsten          | https://ropsten.etherscan.io/address/0x1f98407aaB862CdDeF78Ed252D6f557aA5b0f00d#code    |
| Goerli           | https://goerli.etherscan.io/address/0x1f98407aaB862CdDeF78Ed252D6f557aA5b0f00d#code     |
| Arbitrum Rinkeby | https://rinkeby-explorer.arbitrum.io/address/0x1f98407aaB862CdDeF78Ed252D6f557aA5b0f00d |
| Arbitrum One     | https://explorer.arbitrum.io/address/0x1f98407aaB862CdDeF78Ed252D6f557aA5b0f00d         |

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
