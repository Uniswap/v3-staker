# External Contract: `MockTimeNonfungiblePositionManager`

Testing depends on `MockTimeNonfungiblePositionManager`, an unreleased Uniswap contract. You probably won't need to do this but I'm including instructions here for posterity:

```sh
$ DIR=/tmp/periphery
# Clone the repo
$ git clone git@github.com:Uniswap/uniswap-v3-periphery.git $DIR
# Compile it
$ cd $DIR && yarn && yarn compile
# Copy the contract ABI
$ cp -Rv $DIR/artifacts/contracts/test/MockTimeNonfungiblePositionManager.sol ./test/contracts/
$ unset $DIR
```