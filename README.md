# uniswap-v3-staker

This is a canonical staking contract designed for [Uniswap V3](https://github.com/Uniswap/uniswap-v3-core).

**This is still under active development and not yet production ready.** This section will be updated once the contract is ready.

## Links:

* [Contract Design](docs/Design.md)
* [Grant Application](docs/Grant-Application.md)

## Development and Testing

```sh
$ yarn test
```

It's also helpful to have access to the type definitions from `@uniswap/v3-core` and `@uniswap/v3-periphery`. Until these types get exported from their NPM packages, do this to get access to the types:

```sh
$ make deps
```

This will create the following yarn links:

* `@uniswap/v3-core` will point to `vendor/uniswap-v3-core`
* `@uniswap/v3-periphery` will point to `vendor/uniswap-v3-periphery`

With this, you can now access types that are not exported in the NPM packages.