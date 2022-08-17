# uniswap-v3-staker

This is the canonical staking contract designed for [Uniswap V3](https://github.com/Uniswap/uniswap-v3-core).

The main change compared to v1.2 is the addition of a new configuration value called vestingPeriod, which defines the minimal time a staked position needs to be in range to recieve the full reward.

## Deployments

| Network          | Explorer                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Polygon          | https://polygonscan.com/address/0xdBA0d1c99f08BA9E2481ABeC78b4671CdDFbC178               |

## Subgraph

An adapted version of the subgraph can be found here:

| Network          | Explorer                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Polygon          | https://thegraph.com/hosted-service/subgraph/revert-finance/uni-v3-vesting-staker-polygon|


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
