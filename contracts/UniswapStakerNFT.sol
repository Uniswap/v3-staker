// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import '@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol';
import './interfaces/IUniswapV3Staker.sol';
import './libraries/IncentiveId.sol';
import '@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol';
import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import '@openzeppelin/contracts/utils/Address.sol';
import './PositionHolder.sol';

contract UniswapStakerNFT is IERC721Receiver, ERC721 {
    IUniswapV3Staker public immutable staker;

    mapping(bytes32 => IUniswapV3Staker.IncentiveKey) public idToIncentiveKey;

    // id = incentiveIdsByToken[tokenId][i] where i is bound by numberOfStakes inside UniswapV3Staker
    mapping(uint256 => mapping(uint256 => bytes32)) private incentiveIdsByToken;
    mapping(uint256 => uint256) private numIncentivesPerToken;

    bytes32 private immutable POSITION_HOLDER_BYTECODE_HASH;

    event KeyStored(bytes32 indexed incentiveId, IUniswapV3Staker.IncentiveKey incentiveKey);
    event PositionEjected(uint256 indexed tokenId, address indexed to);

    constructor(IUniswapV3Staker _staker) ERC721('Uniswap V3 Staked Position', 'UNI-V3-STK') {
        staker = _staker;

        // Pre-calculate this hash for Create2 address calculation
        POSITION_HOLDER_BYTECODE_HASH = keccak256(abi.encodePacked(
            type(PositionHolder).creationCode,
            abi.encode(_staker)
        ));
    }

    modifier onlyOwner(uint256 tokenId) {
        require(ownerOf(tokenId) == msg.sender, 'UniswapStakerNFT::unstakeIncentive: must be token owner');
        _;
    }

    function stakedIncentiveIds(uint256 tokenId) external view returns (bytes32[] memory ids) {
        (, uint256 numStakes, , ) = staker.deposits(tokenId);
        ids = new bytes32[](numStakes);

        for (uint256 i = 0; i < numStakes; i += 1) {
            ids[i] = incentiveIdsByToken[tokenId][i];
        }
    }

    function numStakedIncentives(uint256 tokenId) external view returns (uint256 numStakes) {
        return numIncentivesPerToken[tokenId];
    }

    // Only necessary if incentiveIds runs out of gas
    function stakedIncentiveId(uint256 tokenId, uint256 i) external view returns (bytes32 id) {
        return incentiveIdsByToken[tokenId][i];
    }

    function storeIncentiveKey(IUniswapV3Staker.IncentiveKey memory key) external {
        bytes32 id = IncentiveId.compute(key);
        idToIncentiveKey[id] = key;
        emit KeyStored(id, key);
    }

    /// @notice Upon receiving a Uniswap V3 ERC721, creates the token deposit setting owner to `from`. Also stakes token
    /// in one or more incentives if properly formatted `data` has a length > 0.
    /// @inheritdoc IERC721Receiver
    function onERC721Received(
        address,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external override returns (bytes4) {
        INonfungiblePositionManager positionManager = staker.nonfungiblePositionManager();

        if (msg.sender == address(positionManager)) {
            _mint(from, tokenId);

            if (data.length > 0 && data.length % 32 == 0) {
                IUniswapV3Staker.IncentiveKey[] memory keys = new IUniswapV3Staker.IncentiveKey[](data.length / 32);

                for (uint256 i = 0; i < keys.length; i++) {
                    uint256 start = i * 32;
                    uint256 end = start + 32;
                    bytes32 id = abi.decode(data[start:end], (bytes32));
                    keys[i] = _getIncentive(id);
                    incentiveIdsByToken[tokenId][i] = id;
                }

                bytes memory transferData = keys.length == 1 ? abi.encode(keys[0]) : abi.encode(keys);
                positionManager.safeTransferFrom(address(this), address(staker), tokenId, transferData);

                numIncentivesPerToken[tokenId] = keys.length;
            } else {
                positionManager.safeTransferFrom(address(this), address(staker), tokenId);
            }

            // We need to transfer the deposit to our PositionHolder proxy, so rewards don't get mixed with other users
            staker.transferDeposit(tokenId, address(getPositionHolder(tokenId)));
        } else if (msg.sender == address(this)) {
            _claimAndWithdraw(tokenId, from);
        } else {
            revert('UniswapStakerNFT::onERC721Received: unknown NFT');
        }
        return this.onERC721Received.selector;
    }

    function claimAndWithdraw(uint256 tokenId) external onlyOwner(tokenId) {
        _claimAndWithdraw(tokenId, msg.sender);
    }

    function claimAll(uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        uint256 numStakes = numIncentivesPerToken[tokenId];

        IUniswapV3Staker positionHolder = getPositionHolder(tokenId);

        for (uint256 i = 0; i < numStakes; i += 1) {
            bytes32 id = incentiveIdsByToken[tokenId][i];
            IUniswapV3Staker.IncentiveKey memory key = _getIncentive(id);

            (, uint128 liquidity) = staker.stakes(tokenId, id);
            if (liquidity > 0) {
                positionHolder.unstakeToken(key, tokenId);
            }

            positionHolder.claimReward(key.rewardToken, owner, type(uint256).max);

            if (block.timestamp < key.endTime) {
                positionHolder.stakeToken(key, tokenId);
            }
        }
    }

    function stakeIncentive(uint256 tokenId, bytes32 id) external onlyOwner(tokenId) {
        IUniswapV3Staker.IncentiveKey memory key = _getIncentive(id);

        IUniswapV3Staker positionHolder = getPositionHolder(tokenId);

        positionHolder.stakeToken(key, tokenId);

        uint256 numStakes = numIncentivesPerToken[tokenId];
        incentiveIdsByToken[tokenId][numStakes] = id;
        numIncentivesPerToken[tokenId] = numStakes + 1;
    }

    function unstakeIncentive(uint256 tokenId, uint256 i) external onlyOwner(tokenId) {
        uint256 numStakes = numIncentivesPerToken[tokenId];
        require(i < numStakes, 'UniswapStakerNFT::unstakeIncentive: invalid incentive ID');

        bytes32 id = incentiveIdsByToken[tokenId][i];
        IUniswapV3Staker.IncentiveKey memory key = _getIncentive(id);

        IUniswapV3Staker positionHolder = getPositionHolder(tokenId);

        (, uint128 liquidity) = staker.stakes(tokenId, id);
        if (liquidity > 0) {
            positionHolder.unstakeToken(key, tokenId);
        }

        positionHolder.claimReward(key.rewardToken, msg.sender, type(uint256).max);

        if (i != numStakes - 1) {
            // Remove the incentive from the list by swapping the end of the list in
            incentiveIdsByToken[tokenId][i] = incentiveIdsByToken[tokenId][numStakes - 1];
        }
        incentiveIdsByToken[tokenId][numStakes - 1] = bytes32(0);
        numIncentivesPerToken[tokenId] = numStakes - 1;
    }

    function eject(uint256 tokenId) external onlyOwner(tokenId) {
        _burn(tokenId);

        IUniswapV3Staker positionHolder = getPositionHolder(tokenId);
        positionHolder.transferDeposit(tokenId, msg.sender);

        emit PositionEjected(tokenId, msg.sender);
    }

    function _claimAndWithdraw(uint256 tokenId, address recipient) private {
        _burn(tokenId);

        uint256 numStakes = numIncentivesPerToken[tokenId];

        IUniswapV3Staker positionHolder = getPositionHolder(tokenId);

        // If the token has too many stakes, this loop may hit the gas limit
        for (uint256 i = 0; i < numStakes; i += 1) {
            bytes32 id = incentiveIdsByToken[tokenId][i];
            IUniswapV3Staker.IncentiveKey memory key = _getIncentive(id);

            (, uint128 liquidity) = staker.stakes(tokenId, id);
            if (liquidity > 0) {
                positionHolder.unstakeToken(key, tokenId);
            }

            positionHolder.claimReward(key.rewardToken, recipient, type(uint256).max);
            incentiveIdsByToken[tokenId][i] = bytes32(0); // Not strictly necessary, but we'll clean up the state and get a refund
        }
        numIncentivesPerToken[tokenId] = 0;

        positionHolder.withdrawToken(tokenId, recipient, new bytes(0));
    }

    function _getIncentive(bytes32 id) private view returns (IUniswapV3Staker.IncentiveKey memory key) {
        key = idToIncentiveKey[id];
        require(address(key.rewardToken) != address(0), 'UniswapStakerNFT: unknown incentive');
    }

    function getPositionHolderAddress(uint256 tokenId) public view returns (IUniswapV3Staker holderAddress) {
        holderAddress = IUniswapV3Staker(address(uint160(uint(keccak256(abi.encodePacked(
            bytes1(0xff),
            address(this),
            bytes32(tokenId),
            POSITION_HOLDER_BYTECODE_HASH
        ))))));
    }

    function getPositionHolder(uint256 tokenId) private returns (IUniswapV3Staker holder) {
        holder = getPositionHolderAddress(tokenId);

        if (!Address.isContract(address(holder))) {
            address newHolder = address(new PositionHolder{ salt: bytes32(tokenId) }(address(staker)));
            assert(newHolder == address(holder));
        }
    }
}
