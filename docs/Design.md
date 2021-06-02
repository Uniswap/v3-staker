# Uniswap v3 Staker

There is a canonical position staking contract, Staker.

## Data Structures

```solidity
struct Incentive {
  uint128 totalRewardUnclaimed;
  uint160 totalSecondsClaimedX128;
  address rewardToken;
}

struct Deposit {
  address owner;
  uint32 numberOfStakes;
}

struct Stake {
  uint160 secondsPerLiquidityInitialX128;
  uint128 liquidity;
  bool exists;
}

```

## API (Core)

### `createIncentive(CreateIncentiveParams memory params)`

`createIncentive` creates a liquidity mining incentive program. The key used to look up an Incentive is the hash of its immutable properties, see `getIncentiveId`.

**Check:**

- Incentive with these params does not already exist
- Transfers `params.totalReward` from `msg.sender` to self.
- Timestamps: `params.claimDeadline >= params.endTime >= params.startTime`
- Incentive with this ID does not already exist. See `getIncentiveId`.

**Effects:**

- Sets `incentives[key] = Incentive(totalRewardUnclaimed=totalReward, totalSecondsClaimedX128=0, rewardToken=rewardToken)`

**Interaction:**

- Emits `IncentiveCreated`

### `endIncentive(EndIncentiveParams memory params)`

`endIncentive` can be called by a `creator` to delete an Incentive whose `claimDeadline` has passed, transferring `totalRewardUnclaimed` of `rewardToken` back to `creator`.

**Check:**

- Implicit check: the caller is incentiveCreator since it gets passed to getIncentiveId
- `block.timestamp` > `params.claimDeadline`
- Incentive exists (incentive.rewardToken != address(0))

**Effects:**

- deletes `incentives[key]` (This is a new change)
- safeTransfers `totalRewardUnclaimed` of `rewardToken` to the incentive creator `msg.sender`

**Interactions:**

- emits `IncentiveEnded`

### `depositToken(uint256 tokenId)`

Effects:

`nonfungiblePositionManager.safeTransferFrom(sender, this, tokenId)`

### `stakeToken`

**Check:**

- `deposits[params.tokenId].owner == msg.sender`
- Make sure incentive actually exists
- Make sure token not already staked

### unstakeToken

## Others

### `onERC721Received`

**Check:**

- Make sure sender is univ3 nft

**Effects:**

- if `data.length>0`, stakes the token as well

### getRewardAmount

### claimReward

### totalSecondsUnclaimed

`totalSecondsUnclaimed` is computed as `(max(endTime, block.timestamp) - startTime - totalSecondsClaimed)`.

### rewardRate

`rewardRate` is computed as `totalRewardUnclaimed / totalSecondsUnclaimed`.

This means that as soon as the Incentive ends, the reward rate begins to decrease as additional seconds are added.

### deposit

To deposit an NFT, you call `deposit` on the Staker contract, which transfers the NFT to itself and creates a Deposit for the newly added NFT. The `deposits` mapping is keyed with the NFT's token contract and token ID:

```
mapping (address => mapping (uint256 => Deposit)) deposits;

struct Deposit {
    address owner;
    uint32 numberOfStakes;
}
```

`numberOfStakes` is initialized to zero.

### stake

To stake an NFT in a particular Incentive, you call `stake(tokenContract, tokenId, creator, token, startTime, endTime, claimDeadline)`.

This looks up your Deposit, checks that you are the owner, and increments numberOfStakes.

It then creates a stake in the `stakes` mapping. `stakes` is a mapping from the token contract, token ID, and incentive ID to the information about that stake.

```
mapping (address => mapping (uint256 => mapping (bytes32 => Stake)))


struct Stake {
    uint160 secondsPerLiquidityInitialX128
}
```

`uint160 secondsPerLiquidityInitialX128` is a QU32.128.

### unstake

To unstake an NFT, you call `unstake`, which takes all the same arguments as `stake`, as well as a `to` address.

It checks that you are the owner of the Deposit, and decrements `numberOfStakes` by 1.

It checks that there exists a `Stake` for the provided key (with non-zero secondsPerLiquidityInitialX96). It zeroes out that Stake.

It computes `secondsPerLiquidityInPeriodX96` by computing `secondsPerLiquidityInRangeX96` using the Uniswap v3 core contract and subtracting `secondsPerLiquidityInRangeInitialX96`.

It looks at the `liquidity` on the NFT itself and multiplies that by `secondsPerLiquidityInRangeX96` to get `secondsX96`.

It computes [reward rate](#rewardRate) for the Incentive and multiplies that by `secondsX96` to get `reward`.

It tries to transfer `reward` of `Incentive.token` to the `to`. Note: it must be possible to unstake even if this transfer would fail (lest somebody be stuck with an NFT they can't withdraw)!

`totalRewardsUnclaimed` is decremented by `reward`. `totalSecondsClaimed` is incremented by `seconds`.

### withdraw

To withdraw an NFT, you call `withdraw(tokenContract, tokenId, to)`.

The function checks that the caller is the owner and that `numberOfStakes` is 0.

The contract transfers the NFT to `to`.

(TBD: use safeTransfer?)

## `getIncentiveId(address incentiveCreator, address rewardToken, address pool, uint32 startTime, uint32 endTime, uint32 claimDeadline): bytes32`
