// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import './interfaces/IUniswapV3Staker.sol';
import './libraries/IncentiveId.sol';
import '@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol';
import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import 'hardhat/console.sol';

contract UniswapStakerNFT is IERC721Receiver, ERC721 {
    IUniswapV3Staker public immutable staker;

    mapping(bytes32 => IUniswapV3Staker.IncentiveKey) public idToIncentiveKey;

    // id = incentiveIdsByToken[tokenId][i] where i is bound by numberOfStakes inside UniswapV3Staker
    mapping(uint256 => mapping(uint256 => bytes32)) private incentiveIdsByToken;

    event KeyStored(bytes32 incentiveId, IUniswapV3Staker.IncentiveKey incentiveKey);
    event PositionEjected(uint256 indexed tokenId, address to);

    constructor(address _staker) ERC721('Uniswap V3 Staked Position', 'UNI-V3-STK') {
        staker = IUniswapV3Staker(_staker);
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
        (, numStakes, , ) = staker.deposits(tokenId);
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
        if (msg.sender == address(staker.nonfungiblePositionManager())) {
            _mint(from, tokenId);

            if (data.length > 0 && data.length % 32 == 0) {
                IUniswapV3Staker.IncentiveKey[] memory keys = new IUniswapV3Staker.IncentiveKey[](data.length / 32);

                for (uint256 i = 0; i < keys.length; i++) {
                    uint256 start = i * 32;
                    uint256 end = (i + 1) * 32;
                    bytes32 id = abi.decode(data[start:end], (bytes32));
                    keys[i] = _getIncentive(id);
                    incentiveIdsByToken[tokenId][i] = id;
                }

                bytes memory transferData = keys.length == 1 ? abi.encode(keys[0]) : abi.encode(keys);
                staker.nonfungiblePositionManager().safeTransferFrom(address(this), address(staker), tokenId, transferData);
            } else {
                staker.nonfungiblePositionManager().safeTransferFrom(address(this), address(staker), tokenId);
            }
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
        (, uint256 numStakes, , ) = staker.deposits(tokenId);
        
        for (uint256 i = 0; i < numStakes; i += 1) {
            bytes32 id = incentiveIdsByToken[tokenId][i];
            IUniswapV3Staker.IncentiveKey memory key = _getIncentive(id);
            staker.unstakeToken(key, tokenId);
            staker.claimReward(key.rewardToken, owner, type(uint256).max);
            staker.stakeToken(key, tokenId);
        }
    }

    function stakeIncentive(uint256 tokenId, bytes32 id) external onlyOwner(tokenId) {
        IUniswapV3Staker.IncentiveKey memory key = _getIncentive(id);

        staker.stakeToken(key, tokenId);

        (, uint256 numStakes, , ) = staker.deposits(tokenId);
        incentiveIdsByToken[tokenId][numStakes - 1] = id;
    }

    function unstakeIncentive(uint256 tokenId, uint256 i) external onlyOwner(tokenId) {
        require(ownerOf(tokenId) == msg.sender);
        (, uint256 numStakes, , ) = staker.deposits(tokenId);
        require(i < numStakes, 'UniswapStakerNFT::unstakeIncentive: invalid incentive ID');

        bytes32 id = incentiveIdsByToken[tokenId][i];
        IUniswapV3Staker.IncentiveKey memory key = _getIncentive(id);

        staker.unstakeToken(key, tokenId);
        staker.claimReward(key.rewardToken, msg.sender, type(uint256).max);

        if (i != numStakes - 1) {
            // Remove the incentive from the list by swapping the end of the list in
            incentiveIdsByToken[tokenId][i] = incentiveIdsByToken[tokenId][numStakes - 1];
        }
        incentiveIdsByToken[tokenId][numStakes - 1] = bytes32(0);
    }

    function eject(uint256 tokenId) external onlyOwner(tokenId) {
        _burn(tokenId);
        staker.transferDeposit(tokenId, msg.sender);
        emit PositionEjected(tokenId, msg.sender);
    }

    function _claimAndWithdraw(uint256 tokenId, address recipient) private {
        _burn(tokenId);

        (, uint256 numStakes, , ) = staker.deposits(tokenId);

        // If the token has too many stakes, this loop may hit the gas limit
        for (uint256 i = 0; i < numStakes; i += 1) {
            bytes32 id = incentiveIdsByToken[tokenId][i];
            IUniswapV3Staker.IncentiveKey memory key = _getIncentive(id);
            staker.unstakeToken(key, tokenId);
            staker.claimReward(key.rewardToken, recipient, type(uint256).max);
            incentiveIdsByToken[tokenId][i] = bytes32(0); // Not strictly necessary, but we'll clean up the state and get a refund
        }

        staker.withdrawToken(tokenId, recipient, new bytes(0));
    }

    function _getIncentive(bytes32 id) private view returns (IUniswapV3Staker.IncentiveKey memory key) {
        key = idToIncentiveKey[id];
        require(address(key.rewardToken) != address(0), 'UniswapStakerNFT: unknown incentive');
    }
}
