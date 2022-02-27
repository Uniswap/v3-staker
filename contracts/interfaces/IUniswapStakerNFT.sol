// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import '@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol';

import '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import '@openzeppelin/contracts/token/ERC721/IERC721Metadata.sol';

import './IStakedNFTDescriptor.sol';
import './IUniswapV3Staker.sol';
import '../libraries/IncentiveId.sol';


/// @title Uniswap Staked Position NFT Interface
/// @notice Emits ERC721 tokens to represent positions staked in a Uniswap V3 Staker
interface IUniswapStakerNFT is IERC721, IERC721Metadata, IERC721Receiver {
    function staker() external view returns (IUniswapV3Staker);

    function tokenDescriptor() external view returns (IStakedNFTDescriptor);

    function getIncentiveKey(bytes32 id) external view returns (IUniswapV3Staker.IncentiveKey memory);

    // id = incentiveIdsByToken[tokenId][i] where i is bound by numberOfStakes inside UniswapV3Staker
    function stakedIncentiveId(uint256 tokenId, uint256 i) external view returns (bytes32 id);

    function stakedIncentiveIds(uint256 tokenId) external view returns (bytes32[] memory ids);

    function numStakedIncentives(uint256 token) external view returns (uint256 numIncentives);

    function storeIncentiveKey(IUniswapV3Staker.IncentiveKey memory key) external;

    function claimAndWithdraw(uint256 tokenId) external;
    function claimAll(uint256 tokenId) external;
    function stakeIncentive(uint256 tokenId, bytes32 id) external;
    function unstakeIncentive(uint256 tokenId, uint256 i) external;
    function eject(uint256 tokenId) external;

    event KeyStored(bytes32 indexed incentiveId, IUniswapV3Staker.IncentiveKey incentiveKey);
    event PositionEjected(uint256 indexed tokenId, address indexed to);
}
