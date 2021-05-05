pragma solidity =0.7.6;

import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
import '@uniswap/v3-core/contracts/interfaces/IERC20Minimal.sol';
import '@openzeppelin/contracts/token/ERC721/IERC721.sol';

/**
@title Uniswap V3 canonical staking interface
@author Omar Bohsali <omar.bohsali@gmail.com>
@author Dan Robinson <dan@paradigm.xyz>
*/
contract UniswapV3Staker {
    // TODO(DEV): Make sure these are set properly
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    address public immutable creator;

    constructor() {
        creator = msg.sender;
    }

    //
    // Part 1: Incentives
    //

    /// @notice A staking incentive.
    struct Incentive {
        uint128 totalRewardUnclaimed;
        uint160 totalSecondsClaimedX128;
        uint32 endTime;
    }

    /// @notice Incentives are indexed by a hash of (creator, rewardToken, pair, startTime, claimDeadline)
    mapping(bytes32 => Incentive) public incentives;

    event IncentiveCreated(
        address indexed rewardToken,
        address indexed pair,
        address startTime,
        address endTime,
        uint32 claimDeadline,
        uint128 indexed totalReward
    );

    // TODO: probably need to pass include more params in this event
    event IncentiveEnded(address indexed rewardToken, address indexed pair);

    /**
    @notice Creates a new liquidity mining incentive program.
    @param rewardToken The token being distributed as a reward
    @param pair The Uniswap V3 pair
    @param startTime When rewards should begin accruing
    @param endTime When rewards stop accruing
    @param claimDeadline
    @param totalReward Total reward to be distributed
    */
    function create(
        address rewardToken,
        address pair,
        uint32 startTime,
        uint32 endTime,
        uint32 claimDeadline,
        uint128 totalReward
    ) {
        /*
        Check:
        * Make sure this incentive does not already exist
        * claimDeadline must be no earlier than endTime, which must be later than startTime
        * Possibly: check that pair is a uniswap v3 pair?
        
        Effects:
        * Transfers totalRewardsUnclaimed of token from the caller to itself

        Interactions:
        * emit IncentiveCreated()
        */
        require(claimDeadline >= endTime, 'claimDeadline_not_gte_endTime');
        require(endTime < startTime, 'endTime_not_gte_startTime');

        // TODO: Do I need any security checks around msg.sender?
        bytes32 memory key =
            _getIncentiveId(
                msg.sender,
                rewardToken,
                pair,
                startTime,
                claimDeadline
            );

        // Check: this incentive does not already exist
        require(!incentives[key], 'INCENTIVE_EXISTS');

        // Check + Effect: transfer reward token
        require(
            IERC20Minimal(rewardToken).transferFrom(
                msg.sender,
                address(this),
                totalReward
            ),
            'REWARD_TRANSFER_FAILED'
        );

        emit IncentiveCreated(
            rewardToken,
            pair,
            startTime,
            endTime,
            claimDeadline,
            totalReward
        );
    }

    /**
    @notice Deletes an incentive whose claimDeadline has passed.
    */
    function end(
        address rewardToken,
        address pair,
        uint32 startTime,
        uint32 claimDeadline
    ) public {
        /* 
        Check:
        * Only callable by creator (msg.sender is hashed)
        * Only works when claimDeadline has passed
        
        Effects:
        * Transfer totalRewardsUnclaimed of token back to creator
        * Delete Incentive
        
        Interaction:
        */
        require(block.timestamp > claimDeadline, 'TIMESTAMP_LTE_CLAIMDEADLINE');
        bytes32 memory key =
            _getIncentiveId(
                msg.sender,
                rewardToken,
                pair,
                startTime,
                claimDeadline
            );

        Incentive memory incentive = incentives[key];
        require(incentives[key], 'INVALID_INCENTIVE');

        IERC20Minimal.transferFrom(
            address(this),
            msg.sender,
            incentive.totalRewardUnclaimed
        );
        // TODO: Thinking if this should go before or after the transferFrom, maybe it doesnt matter.
        delete incentives[key];

        emit IncentiveEnded(rewardToken, pair);
    }

    // TODO(Security): Am I signing up for pain by being DRY and doing this here instead of in the function bodies?
    function _getIncentiveId(
        address creator,
        address rewardToken,
        address pair,
        uint32 startTime,
        uint32 claimDeadline
    ) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(creator, rewardToken, pair, startTime, claimDeadline)
            );
    }

    //
    // Part 2: Deposits, Withdrawals
    //
    struct Deposit {
        address owner;
        uint32 numberOfStakes;
    }

    mapping(address => mapping(uint256 => Deposit)) deposits;
    event Deposited(address tokenContract, uint256 tokenId);

    function deposit(address tokenContract, uint256 tokenId) public {
        // TODO: Make sure the transfer succeeds and is a uniswap erc721
        require(
            IERC721(tokenContract).safeTransferFrom(
                msg.sender,
                address(this),
                tokenId
            ),
            'ERC721_TRANSFER_FAILED'
        );

        deposits[tokenContract][tokenId] = Deposit(msg.sender, 0);

        emit Deposited(tokenContract, tokenId);
    }

    event Withdrawal(address tokenContract, uint256 tokenId);

    function withdraw(
        address tokenContract,
        uint256 tokenId,
        address to
    ) {
        require(
            deposits[tokenContract][tokenId].numberOfStakes == 0,
            'NUMBER_OF_STAKES_NOT_ZERO'
        );
        IERC721(tokenContract).transferFrom(address(this), to, tokenId);
        emit Withdrawal(tokenContract, tokenId);
    }

    //
    // Part 3: Staking, Unstaking
    //

    struct Stake {
        uint160 secondsPerLiquidityInitialX96;
    }

    mapping(address => mapping(uint256 => mapping(bytes32 => Stake))) stakes;

    function stake(
        address tokenContract,
        uint256 tokenId,
        address creator,
        address token,
        uint32 startTime,
        uint32 endTime,
        uint32 claimDeadline
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
        * It checks that you are the owner of the Deposit, and decrements
            numberOfStakes by 1.
        * It checks that there exists a Stake for the provided key
            (with non-zero secondsPerLiquidityInitialX96).

        Effects:
        * It computes secondsPerLiquidityInPeriodX96 by computing
            secondsPerLiquidityInRangeX96 using the Uniswap v3 core contract
            and subtracting secondsPerLiquidityInRangeInitialX96.
        * It looks at the liquidity on the NFT itself and multiplies
            that by secondsPerLiquidityInRangeX96 to get secondsX96.
        * It computes reward rate for the Program and multiplies that
            by secondsX96 to get reward.
        * totalRewardsUnclaimed is decremented by reward. totalSecondsClaimed
            is incremented by seconds.

        Interactions:
        * It tries to transfer `reward` of Program.token to the to. 
            Note: it must be possible to unstake even if this transfer
            would fail (lest somebody be stuck with an NFT they can’t withdraw)!
        */
    }

    // TODO: Still need to implement these parts.

    function totalSecondsUnclaimed() public view returns (uint32) {
        return (max(endTime, block.timestamp) -
            startTime -
            totalSecondsClaimed);
    }

    function rewardRate() public view returns (uint256) {
        // TODO: Make sure this is the right return type
        // totalRewardUnclaimed / totalSecondsUnclaimed
    }
}
