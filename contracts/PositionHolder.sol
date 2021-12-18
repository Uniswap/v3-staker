// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

contract PositionHolder {
    address private immutable parent;
    address private immutable staker;

    constructor(address _staker) {
        parent = msg.sender;
        staker = _staker;
    }

    // Basic proxy, allows any call from the parent UniswapStakerNFT contract to be redirected to the UniswapV3Staker contract
    fallback() external {
        require(msg.sender == parent);

        address _staker = staker;
        assembly {
            let ptr := mload(0x40)
            calldatacopy(ptr, 0, calldatasize())
            let result := call(gas(), _staker, 0, ptr, calldatasize(), 0, 0)
            let size := returndatasize()
            returndatacopy(ptr, 0, size)

            switch result
            case 0 { revert(ptr, size) }
            default { return(ptr, size) }
        }
    }
}
