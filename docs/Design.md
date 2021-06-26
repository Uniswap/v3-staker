# Uniswap V3 Staker

There is a canonical position staking contract, Staker.

## Data Structures

```solidity
struct Incentive {
  uint128 totalRewardUnclaimed;
  uint128 numberOfStakes;
  uint160 totalSecondsClaimedX128;
}

struct Deposit {
  address owner;
  uint96 numberOfStakes;
}

struct Stake {
  uint160 secondsPerLiquidityInsideInitialX128;
  uint128 liquidity;
}
```

State:

```solidity
IUniswapV3Factory public immutable factory;
INonfungiblePositionManager public immutable nonfungiblePositionManager;

/// @dev bytes32 refers to the return value of IncentiveId.compute
mapping(bytes32 => Incentive) public incentives;

/// @dev deposits[tokenId] => Deposit
mapping(uint256 => Deposit) public deposits;

/// @dev stakes[tokenId][incentiveHash] => Stake
mapping(uint256 => mapping(bytes32 => Stake)) public stakes;

/// @dev rewards[rewardToken][msg.sender] => uint256
mapping(address => mapping(address => uint256)) public rewards;
```

Params:

```solidity
struct CreateIncentiveParams {
  address rewardToken;
  address pool;
  uint256 startTime;
  uint256 endTime;
  uint128 totalReward;
}

struct EndIncentiveParams {
  address creator;
  address rewardToken;
  address pool;
  uint256 startTime;
  uint256 endTime;
}

```

## Incentives

### `createIncentive(CreateIncentiveParams memory params)`

`createIncentive` creates a liquidity mining incentive program. The key used to look up an Incentive is the hash of its immutable properties.

**Check:**

- Incentive with these params does not already exist
- Timestamps: `params.endTime >= params.startTime`, `params.startTime >= block.timestamp`
- Incentive with this ID does not already exist.

**Effects:**

- Sets `incentives[key] = Incentive(totalRewardUnclaimed=totalReward, totalSecondsClaimedX128=0, rewardToken=rewardToken)`

**Interaction:**

- Transfers `params.totalReward` from `msg.sender` to self.
  - Make sure there is a check here and it fails if the transfer fails
- Emits `IncentiveCreated`

### `endIncentive(EndIncentiveParams memory params)`

`endIncentive` can be called by anyone to end an Incentive after the `endTime` has passed, transferring `totalRewardUnclaimed` of `rewardToken` back to `refundee`.

**Check:**

- `block.timestamp > params.endTime`
- Incentive exists (`incentive.totalRewardUnclaimed != 0`)

**Effects:**

- deletes `incentives[key]` (This is a new change)

**Interactions:**

- safeTransfers `totalRewardUnclaimed` of `rewardToken` to the incentive creator `msg.sender`
- emits `IncentiveEnded`

## Deposit/Withdraw Token

**Interactions**

- `nonfungiblePositionManager.safeTransferFrom(sender, this, tokenId)`
  - This transfer triggers the onERC721Received hook

### `onERC721Received(address, address from, uint256 tokenId, bytes calldata data)`

**Check:**

- Make sure sender is univ3 nft

**Effects:**

- Creates a deposit for the token setting deposit `owner` to `from`.
  - Setting `owner` to `from` ensures that the owner of the token also owns the deposit. Approved addresses and operators may first transfer the token to themselves before depositing for deposit ownership.
- If `data.length>0`, stakes the token in one or more incentives

### `withdrawToken(uint256 tokenId, address to, bytes memory data)`

**Checks**

- Check that a Deposit exists for the token and that `msg.sender` is the `owner` on that Deposit.
- Check that `numberOfStakes` on that Deposit is 0.

**Effects**

- Delete the Deposit `delete deposits[tokenId]`.

**Interactions**

- `safeTransferFrom` the token to `to` with `data`.
- emit `DepositTransferred(token, deposit.owner, address(0))`

## Stake/Unstake/Rewards

### `stakeToken`

**Check:**

- `deposits[params.tokenId].owner == msg.sender`
- Make sure incentive actually exists and has reward that could be claimed (incentive.rewardToken != address(0))
  - Check if this check can check totalRewardUnclaimed instead
- Make sure token not already staked

### `claimReward`

**Interactions**

- `msg.sender` to withdraw all of their reward balance in a specific token to a specified `to` address.

- emit RewardClaimed(to, reward)

### `unstakeToken`

To unstake an NFT, you call `unstakeToken`, which takes all the same arguments as `stake`.

**Checks**

- It checks that you are the owner of the Deposit
- It checks that there exists a `Stake` for the provided key (with exists=true).

**Effects**

- Deletes the Stake.
- Decrements `numberOfStakes` for the Deposit by 1.
- `totalRewardsUnclaimed` is decremented by `reward`.
- `totalSecondsClaimed` is incremented by `seconds`.
- Increments `rewards[rewardToken][msg.sender]` by the amount given by `getRewardInfo`.

### `getRewardInfo`

- It computes `secondsInsideX128` (the total liquidity seconds for which rewards are owed) for a given Stake, by:
  - using`snapshotCumulativesInside` from the Uniswap v3 core contract to get `secondsPerLiquidityInRangeX128`, and subtracting `secondsPerLiquidityInRangeInitialX128`.
  - Multiplying that by `stake.liquidity` to get the total seconds accrued by the liquidity in that period
- Note that X128 means it's a `UQ32X128`.

- It computes `totalSecondsUnclaimed` by taking `max(endTime, block.timestamp) - startTime`, casting it as a Q128, and subtracting `totalSecondsClaimedX128`.

- It computes `rewardRate` for the Incentive casting `incentive.totalRewardUnclaimed` as a Q128, then dividing it by `totalSecondsUnclaimedX128`.

- `reward` is then calculated as `secondsInsideX128` times the `rewardRate`, scaled down to a regular uint128.
