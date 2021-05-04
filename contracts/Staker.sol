pragma solidity =0.7.6;

contract Staker {
    mapping(bytes32 => Incentive) incentive;

    struct Incentive {
        uint128 totalRewardUnclaimed;
        uint160 totalSecondsClaimedX128;
        uint32 endTime;
    }

    function end(
        address token,
        uint32 startTime,
        uint32 endTime,
        uint32 claimDeadline,
        uint128 totalReward
    ) {
        /* 
        Check:
        * Only callable by creator
        * Only works when claimDeadline has passed
        
        Effects:
        * Delete Incentive
        
        Interaction:
        * Transfer totalRewardsUnclaimed of token back to creator
        */
    }

    function totalSecondsUnclaimed() public view returns (uint256) {
        // TODO: Make sure this should be uint256
        // (max(endTime, block.timestamp) - startTime - totalSecondsClaimed)
    }

    function rewardRate() public view returns (uint256) {
        // TODO: Make sure this is the right return type
        // totalRewardUnclaimed / totalSecondsUnclaimed
    }

    struct Deposit {
        address owner;
        uint32 numberOfStakes;
    }

    mapping(address => mapping(uint256 => Deposit)) deposits;

    function deposit() public {
        /* To deposit an NFT, you call stake on the Staler contract,
        which transfers the NFT to itself and creates a Deposit for
        the newly added NFT. The deposits mapping is keyed with the
        NFT’s token contract and token ID:
        */
    }

    function stake(
        address tokenContract,
        address tokenId,
        address creator,
        address token,
        uint256 startTime,
        uint256 endTime,
        uint256 claimDeadline
    ) {
        /*
        To stake an NFT in a particular Incentive, you call 
        stake(tokenContract, tokenId, creator, token, startTime, endTime, claimDeadline).

        This looks up your Deposit, checks that you are the owner,
        and increments numberOfStakes.

        It then creates a stake in the stakes mapping. stakes is
        a mapping from the token contract, token ID, and incentive ID
        to the information about that stake.
        */
    }

    struct Stake {
        uint160 secondsPerLiquidityInitialX96;
    }

    mapping(address => mapping(uint256 => mapping(bytes32 => Stake))) stakes;

    function unstake(
        address tokenContract,
        address tokenId,
        address creator,
        address token,
        uint256 startTime,
        uint256 endTime,
        uint256 claimDeadline,
        address to
    ) {
        /*
        Check:
        * It checks that you are the owner of the Deposit, and decrements numberOfStakes by 1.
        * It checks that there exists a Stake for the provided key (with non-zero secondsPerLiquidityInitialX96).

        Effects:
        * It computes secondsPerLiquidityInPeriodX96 by computing secondsPerLiquidityInRangeX96 using the Uniswap v3 core contract and subtracting secondsPerLiquidityInRangeInitialX96.
        * It looks at the liquidity on the NFT itself and multiplies that by secondsPerLiquidityInRangeX96 to get secondsX96.
        * It computes reward rate for the Program and multiplies that by secondsX96 to get reward.
        * totalRewardsUnclaimed is decremented by reward. totalSecondsClaimed is incremented by seconds.

        Interactions:
        * It tries to transfer reward of Program.token to the to. Note: it must be possible to unstake even if this transfer would fail (lest somebody be stuck with an NFT they can’t withdraw)!
        */
    }

    function withdraw(
        address tokenContract,
        address tokenId,
        address to
    ) {
        /* The function checks that the caller is the owner and that numberOfStakes is 0.
 

        The contract transfers the NFT to to. Maybe use safeTransfer
        */
    }
}
