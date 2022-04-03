// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import '@uniswap/v3-core/contracts/interfaces/IERC20Minimal.sol';
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
import "./interfaces/IUniswapV3Staker.sol";

contract BulkIncentiveCreator {
    IUniswapV3Staker public immutable staker;
    IERC20Minimal public immutable reward;
    uint256 public immutable startTime;
    uint256 public immutable endTime;
    address public immutable refundee;

    IUniswapV3Pool[] public pools;
    uint256[] public minTickWidths;
    uint256[] public weights;

    // Cheaper to store this as an immutable instead of reading storage
    uint256 private immutable numPools;

    constructor(
        IUniswapV3Staker _staker,
        IERC20Minimal _reward,
        uint256 _startTime,
        uint256 _endTime,
        address _refundee,
        IUniswapV3Pool[] memory _pools,
        uint256[] memory _minTickWidths,
        uint256[] memory _weights
    ) {
        require(_pools.length == _minTickWidths.length && _pools.length == _weights.length);

        staker = _staker;
        reward = _reward;
        startTime = _startTime;
        endTime = _endTime;
        refundee = _refundee;

        numPools = _pools.length;

        pools = _pools;
        minTickWidths = _minTickWidths;
        weights = _weights;
    }

    function setup() external {
        uint256 totalReward = reward.balanceOf(address(this));
        require(totalReward > 0, "NOREW");

        reward.approve(address(staker), totalReward);

        uint256 totalWeights = 0;
        uint256[] memory _weights = new uint256[](numPools);

        for (uint256 i = 0; i < numPools; i += 1) {
            uint256 weight = weights[i];
            totalWeights += weight;
            _weights[i] = weight;
        }

        for (uint256 i = 0; i < numPools; i += 1) {
            uint256 poolReward = totalReward * _weights[i] / totalWeights;
            staker.createIncentive(
                IUniswapV3Staker.IncentiveKey({
                    rewardToken: reward,
                    pool: pools[i],
                    startTime: startTime,
                    endTime: endTime,
                    refundee: refundee,
                    minimumTickWidth: minTickWidths[i]
                }),
                poolReward
            );
        }
    }
}
