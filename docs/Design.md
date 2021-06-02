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
  uint96 numberOfStakes;
}

struct Stake {
  uint160 secondsPerLiquidityInitialX128;
  uint128 liquidity;
}

```

## Incentives

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

## Deposit/Withdraw Token

### `depositToken(uint256 tokenId)`

Effects:

- `nonfungiblePositionManager.safeTransferFrom(sender, this, tokenId)`

### `withdrawToken(uint256 tokenId, address to)`

TODO

## Stake/Unstake/Rewards

### `stakeToken`

**Check:**

- `deposits[params.tokenId].owner == msg.sender`
- Make sure incentive actually exists (incentive.rewardToken != address(0))
- Make sure token not already staked

### `claimReward`

TODO

### `unstakeToken`

To unstake an NFT, you call `unstakeToken`, which takes all the same arguments as `stake`, as well as a `to` address.

- It checks that you are the owner of the Deposit, and decrements `numberOfStakes` by 1.
- It checks that there exists a `Stake` for the provided key (with exists=true). It then deletes the `Stake` object.

It tries to transfer `reward` of `Incentive.token` to the `to`. Note: it must be possible to unstake even if this transfer would fail (lest somebody be stuck with an NFT they can't withdraw)!

`totalRewardsUnclaimed` is decremented by `reward`. `totalSecondsClaimed` is incremented by `seconds`.

### `getRewardAmount`

- It computes `secondsInPeriodX128` by computing :
  - `secondsPerLiquidityInRangeX96` using the Uniswap v3 core contract and subtracting `secondsPerLiquidityInRangeInitialX96`.
  - Multiplying that by `stake.liquidity` to get the total seconds in the period
- Note that X128 means it's a `UQ32X128`.

- It computes `rewardRate` for the Incentive casting `incentive.totalRewardUnclaimed` as a Q128, then dividing it by `totalSecondsUnclaimedX128`.

- `reward` is then calculated as `secondsInPeriodX128` times the `rewardRate`, scaled down to a regular uint128.

## Misc

### `onERC721Received`

**Check:**

- Make sure sender is univ3 nft

**Effects:**

- if `data.length>0`, stakes the token as well

#### `getIncentiveId(address incentiveCreator, address rewardToken, address pool, uint32 startTime, uint32 endTime, uint32 claimDeadline): bytes32`
