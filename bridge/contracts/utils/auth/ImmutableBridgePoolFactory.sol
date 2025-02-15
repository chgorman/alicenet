// This file is auto-generated by hardhat generate-immutable-auth-contract task. DO NOT EDIT.
// SPDX-License-Identifier: MIT-open-group
pragma solidity ^0.8.16;

import "contracts/utils/DeterministicAddress.sol";
import "contracts/utils/auth/ImmutableFactory.sol";

abstract contract ImmutableBridgePoolFactory is ImmutableFactory {
    address private immutable _bridgePoolFactory;
    error OnlyBridgePoolFactory(address sender, address expected);

    modifier onlyBridgePoolFactory() {
        if (msg.sender != _bridgePoolFactory) {
            revert OnlyBridgePoolFactory(msg.sender, _bridgePoolFactory);
        }
        _;
    }

    constructor() {
        _bridgePoolFactory = getMetamorphicContractAddress(
            0x427269646765506f6f6c466163746f7279000000000000000000000000000000,
            _factoryAddress()
        );
    }

    function _bridgePoolFactoryAddress() internal view returns (address) {
        return _bridgePoolFactory;
    }

    function _saltForBridgePoolFactory() internal pure returns (bytes32) {
        return 0x427269646765506f6f6c466163746f7279000000000000000000000000000000;
    }
}
