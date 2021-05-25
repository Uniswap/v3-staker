// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import '../UniswapV3Staker.sol';

contract MockTimeUniswapV3Staker is UniswapV3Staker {
    uint256 time;

    constructor(address _factory, address _nonfungiblePositionManager)
        UniswapV3Staker(_factory, _nonfungiblePositionManager)
    {}

    function _blockTimestamp() internal view override returns (uint256) {
        return time;
    }

    function setTime(uint256 _time) external {
        time = _time;
    }
}
