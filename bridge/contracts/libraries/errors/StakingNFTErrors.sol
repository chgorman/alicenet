// SPDX-License-Identifier: MIT-open-group
pragma solidity ^0.8.11;

library StakingNFTErrors {
    error CallerNotTokenOwner(address caller);
    error LockDurationGreaterThanGovernanceLock();
    error LockDurationGreaterThanMintLock();
    error LockDurationWithdrawTimeNotReached();
    error InvalidTokenId(uint256 tokenID);
    error MintAmountExceedsMaximumSupply();
    error FreeAfterTimeNotReached();
    error BalanceLessThanReserve(uint256 balance, uint256 reserve);
    error SlushTooLarge(uint256 slush);
    error MintAmountZero();
    error PositionIsLocked(uint256 tokenID);
    error PositionIsUnlocked(uint256 tokenID);
}
