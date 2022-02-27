// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
import '@uniswap/lib/contracts/libraries/SafeERC20Namer.sol';

import '@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol';
import '@uniswap/v3-periphery/contracts/interfaces/IERC20Metadata.sol';
import '@uniswap/v3-periphery/contracts/libraries/PoolAddress.sol';
import '@uniswap/v3-periphery/contracts/libraries/TokenRatioSortOrder.sol';
import '../interfaces/IUniswapStakerNFT.sol';
import '../interfaces/IStakedNFTDescriptor.sol';
import './StakedNFTDescriptorGenerator.sol';

/// @title Describes NFT token positions
/// @notice Produces a string containing the data URI for a JSON metadata string
contract StakedNFTDescriptor is IStakedNFTDescriptor {
    address private immutable DAI;
    address private immutable USDC;
    address private immutable USDT;
    address private immutable WBTC;

    address public immutable WETH9;
    /// @dev A null-terminated string
    bytes32 public immutable nativeCurrencyLabelBytes;

    constructor(address _WETH9, bytes32 _nativeCurrencyLabelBytes, address dai, address usdc, address usdt, address wbtc) {
        WETH9 = _WETH9;
        nativeCurrencyLabelBytes = _nativeCurrencyLabelBytes;
        DAI = dai;
        USDC = usdc;
        USDT = usdt;
        WBTC = wbtc;
    }

    /// @notice Returns the native currency label as a string
    function nativeCurrencyLabel() public view returns (string memory) {
        uint256 len = 0;
        while (len < 32 && nativeCurrencyLabelBytes[len] != 0) {
            len++;
        }
        bytes memory b = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            b[i] = nativeCurrencyLabelBytes[i];
        }
        return string(b);
    }

    /// @inheritdoc IStakedNFTDescriptor
    function tokenURI(IUniswapStakerNFT stakerNft, uint256 tokenId)
        external
        view
        override
        returns (string memory)
    {
        address quoteTokenAddress;
        address baseTokenAddress;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        IUniswapV3Pool pool;
        bool _flipRatio;

        { // Prevent stack too deep
        address token0;
        address token1;
        (, , token0, token1, fee, tickLower, tickUpper, , , , , ) =
            stakerNft.staker().nonfungiblePositionManager().positions(tokenId);

        _flipRatio = flipRatio(token0, token1);
        quoteTokenAddress = !_flipRatio ? token1 : token0;
        baseTokenAddress = !_flipRatio ? token0 : token1;

        pool =
            IUniswapV3Pool(
                PoolAddress.computeAddress(
                    stakerNft.staker().nonfungiblePositionManager().factory(),
                    PoolAddress.PoolKey({token0: token0, token1: token1, fee: fee})
                )
            );
        }
        (, int24 tick, , , , , ) = pool.slot0();

        return
            StakedNFTDescriptorGenerator.constructTokenURI(
                StakedNFTDescriptorGenerator.ConstructTokenURIParams({
                    tokenId: tokenId,
                    quoteTokenAddress: quoteTokenAddress,
                    baseTokenAddress: baseTokenAddress,
                    quoteTokenSymbol: quoteTokenAddress == WETH9
                        ? nativeCurrencyLabel()
                        : SafeERC20Namer.tokenSymbol(quoteTokenAddress),
                    baseTokenSymbol: baseTokenAddress == WETH9
                        ? nativeCurrencyLabel()
                        : SafeERC20Namer.tokenSymbol(baseTokenAddress),
                    earningSymbols: earningSymbols(stakerNft, tokenId),
                    quoteTokenDecimals: IERC20Metadata(quoteTokenAddress).decimals(),
                    baseTokenDecimals: IERC20Metadata(baseTokenAddress).decimals(),
                    flipRatio: _flipRatio,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    tickCurrent: tick,
                    tickSpacing: pool.tickSpacing(),
                    fee: fee,
                    poolAddress: address(pool)
                })
            );
    }

    function flipRatio(
        address token0,
        address token1
    ) public view returns (bool) {
        return tokenRatioPriority(token0) > tokenRatioPriority(token1);
    }

    function tokenRatioPriority(address token) public view returns (int256) {
        if (token == WETH9) {
            return TokenRatioSortOrder.DENOMINATOR;
        }
        if (token == USDC) {
            return TokenRatioSortOrder.NUMERATOR_MOST;
        } else if (token == USDT) {
            return TokenRatioSortOrder.NUMERATOR_MORE;
        } else if (token == DAI) {
            return TokenRatioSortOrder.NUMERATOR;
        // } else if (token == TBTC) {
        //     return TokenRatioSortOrder.DENOMINATOR_MORE;
        } else if (token == WBTC) {
            return TokenRatioSortOrder.DENOMINATOR_MOST;
        } else {
            return 0;
        }
    }

    function earningSymbols(IUniswapStakerNFT stakerNft, uint256 tokenId) public view returns (string[] memory symbols) {
        uint256 numStaked = stakerNft.numStakedIncentives(tokenId);
        symbols = new string[](numStaked > 2 ? 2 : numStaked);

        for (uint256 i = 0; i < numStaked && i < 2; i += 1) {
            bytes32 incentiveId = stakerNft.stakedIncentiveId(tokenId, i);
            address rewardToken = address(stakerNft.getIncentiveKey(incentiveId).rewardToken);
            symbols[i] = SafeERC20Namer.tokenSymbol(rewardToken);
        }
    }
}
