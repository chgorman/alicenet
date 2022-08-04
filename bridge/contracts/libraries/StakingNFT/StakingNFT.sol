// SPDX-License-Identifier: MIT-open-group
pragma solidity ^0.8.11;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import "contracts/libraries/governance/GovernanceMaxLock.sol";
import "contracts/libraries/StakingNFT/StakingNFTStorage.sol";
import "contracts/utils/ImmutableAuth.sol";
import "contracts/utils/EthSafeTransfer.sol";
import "contracts/utils/ERC20SafeTransfer.sol";
import "contracts/utils/MagicValue.sol";
import "contracts/interfaces/ICBOpener.sol";
import "contracts/interfaces/IStakingNFT.sol";
import "contracts/interfaces/IStakingNFTDescriptor.sol";
import {StakingNFTErrorCodes} from "contracts/libraries/errorCodes/StakingNFTErrorCodes.sol";
import {
    CircuitBreakerErrorCodes
} from "contracts/libraries/errorCodes/CircuitBreakerErrorCodes.sol";

abstract contract StakingNFT is
    Initializable,
    ERC721Upgradeable,
    StakingNFTStorage,
    MagicValue,
    EthSafeTransfer,
    ERC20SafeTransfer,
    GovernanceMaxLock,
    ICBOpener,
    IStakingNFT,
    ImmutableFactory,
    ImmutableValidatorPool,
    ImmutableAToken,
    ImmutableGovernance,
    ImmutableStakingPositionDescriptor
{
    // withCircuitBreaker is a modifier to enforce the CircuitBreaker must
    // be set for a call to succeed
    modifier withCircuitBreaker() {
        require(
            _circuitBreaker == _CIRCUIT_BREAKER_CLOSED,
            string(abi.encodePacked(CircuitBreakerErrorCodes.CIRCUIT_BREAKER_OPENED))
        );
        _;
    }

    constructor()
        ImmutableFactory(msg.sender)
        ImmutableAToken()
        ImmutableGovernance()
        ImmutableValidatorPool()
        ImmutableStakingPositionDescriptor()
    {}

    /// gets the current value for the Eth accumulator
    function getEthAccumulator() external view returns (uint256 accumulator, uint256 slush) {
        accumulator = _ethState.accumulator;
        slush = _ethState.slush;
    }

    /// gets the current value for the Token accumulator
    function getTokenAccumulator() external view returns (uint256 accumulator, uint256 slush) {
        accumulator = _tokenState.accumulator;
        slush = _tokenState.slush;
    }

    /// @dev tripCB opens the circuit breaker may only be called by _admin
    function tripCB() public override onlyFactory {
        _tripCB();
    }

    /// skimExcessEth will send to the address passed as to_ any amount of Eth
    /// held by this contract that is not tracked by the Accumulator system. This
    /// function allows the Admin role to refund any Eth sent to this contract in
    /// error by a user. This method can not return any funds sent to the contract
    /// via the depositEth method. This function should only be necessary if a
    /// user somehow manages to accidentally selfDestruct a contract with this
    /// contract as the recipient.
    function skimExcessEth(address to_) public onlyFactory returns (uint256 excess) {
        excess = _estimateExcessEth();
        _safeTransferEth(to_, excess);
        return excess;
    }

    /// skimExcessToken will send to the address passed as to_ any amount of
    /// AToken held by this contract that is not tracked by the Accumulator
    /// system. This function allows the Admin role to refund any AToken sent to
    /// this contract in error by a user. This method can not return any funds
    /// sent to the contract via the depositToken method.
    function skimExcessToken(address to_) public onlyFactory returns (uint256 excess) {
        IERC20Transferable aToken;
        (aToken, excess) = _estimateExcessToken();
        _safeTransferERC20(aToken, to_, excess);
        return excess;
    }

    /// lockPosition is called by governance system when a governance
    /// vote is cast. This function will lock the specified Position for up to
    /// _MAX_GOVERNANCE_LOCK. This method may only be called by the governance
    /// contract. This function will fail if the circuit breaker is tripped
    function lockPosition(
        address caller_,
        uint256 tokenID_,
        uint256 lockDuration_
    ) public override withCircuitBreaker onlyGovernance returns (uint256) {
        require(
            caller_ == ownerOf(tokenID_),
            string(abi.encodePacked(StakingNFTErrorCodes.STAKENFT_CALLER_NOT_TOKEN_OWNER))
        );
        require(
            lockDuration_ <= _MAX_GOVERNANCE_LOCK,
            string(
                abi.encodePacked(
                    StakingNFTErrorCodes.STAKENFT_LOCK_DURATION_GREATER_THAN_GOVERNANCE_LOCK
                )
            )
        );
        return _lockPosition(tokenID_, lockDuration_);
    }

    /// This function will lock an owned Position for up to _MAX_GOVERNANCE_LOCK. This method may
    /// only be called by the owner of the Position. This function will fail if the circuit breaker
    /// is tripped
    function lockOwnPosition(uint256 tokenID_, uint256 lockDuration_)
        public
        withCircuitBreaker
        returns (uint256)
    {
        require(
            msg.sender == ownerOf(tokenID_),
            string(abi.encodePacked(StakingNFTErrorCodes.STAKENFT_CALLER_NOT_TOKEN_OWNER))
        );
        require(
            lockDuration_ <= _MAX_GOVERNANCE_LOCK,
            string(
                abi.encodePacked(
                    StakingNFTErrorCodes.STAKENFT_LOCK_DURATION_GREATER_THAN_GOVERNANCE_LOCK
                )
            )
        );
        return _lockPosition(tokenID_, lockDuration_);
    }

    /// This function will lock withdraws on the specified Position for up to
    /// _MAX_GOVERNANCE_LOCK. This function will fail if the circuit breaker is tripped
    function lockWithdraw(uint256 tokenID_, uint256 lockDuration_)
        public
        withCircuitBreaker
        returns (uint256)
    {
        require(
            msg.sender == ownerOf(tokenID_),
            string(abi.encodePacked(StakingNFTErrorCodes.STAKENFT_CALLER_NOT_TOKEN_OWNER))
        );
        require(
            lockDuration_ <= _MAX_GOVERNANCE_LOCK,
            string(
                abi.encodePacked(
                    StakingNFTErrorCodes.STAKENFT_LOCK_DURATION_GREATER_THAN_GOVERNANCE_LOCK
                )
            )
        );
        return _lockWithdraw(tokenID_, lockDuration_);
    }

    /// DO NOT CALL THIS METHOD UNLESS YOU ARE MAKING A DISTRIBUTION AS ALL VALUE
    /// WILL BE DISTRIBUTED TO STAKERS EVENLY. depositToken distributes AToken
    /// to all stakers evenly should only be called during a slashing event. Any
    /// AToken sent to this method in error will be lost. This function will
    /// fail if the circuit breaker is tripped. The magic_ parameter is intended
    /// to stop some one from successfully interacting with this method without
    /// first reading the source code and hopefully this comment
    function depositToken(uint8 magic_, uint256 amount_)
        public
        withCircuitBreaker
        checkMagic(magic_)
    {
        // collect tokens
        _safeTransferFromERC20(IERC20Transferable(_aTokenAddress()), msg.sender, amount_);
        // update state
        _tokenState = _deposit(amount_, _tokenState);
        _reserveToken += amount_;
    }

    /// DO NOT CALL THIS METHOD UNLESS YOU ARE MAKING A DISTRIBUTION ALL VALUE
    /// WILL BE DISTRIBUTED TO STAKERS EVENLY depositEth distributes Eth to all
    /// stakers evenly should only be called by BTokens contract any Eth sent to
    /// this method in error will be lost this function will fail if the circuit
    /// breaker is tripped the magic_ parameter is intended to stop some one from
    /// successfully interacting with this method without first reading the
    /// source code and hopefully this comment
    function depositEth(uint8 magic_) public payable withCircuitBreaker checkMagic(magic_) {
        _ethState = _deposit(msg.value, _ethState);
        _reserveEth += msg.value;
    }

    /// mint allows a staking position to be opened. This function
    /// requires the caller to have performed an approve invocation against
    /// AToken into this contract. This function will fail if the circuit
    /// breaker is tripped.
    function mint(uint256 amount_) public virtual withCircuitBreaker returns (uint256 tokenID) {
        return _mintNFT(msg.sender, amount_);
    }

    /// mintTo allows a staking position to be opened in the name of an
    /// account other than the caller. This method also allows a lock to be
    /// placed on the position up to _MAX_MINT_LOCK . This function requires the
    /// caller to have performed an approve invocation against AToken into
    /// this contract. This function will fail if the circuit breaker is
    /// tripped.
    function mintTo(
        address to_,
        uint256 amount_,
        uint256 lockDuration_
    ) public virtual withCircuitBreaker returns (uint256 tokenID) {
        require(
            lockDuration_ <= _MAX_MINT_LOCK,
            string(
                abi.encodePacked(StakingNFTErrorCodes.STAKENFT_LOCK_DURATION_GREATER_THAN_MINT_LOCK)
            )
        );
        tokenID = _mintNFT(to_, amount_);
        if (lockDuration_ > 0) {
            _lockPosition(tokenID, lockDuration_);
        }
        return tokenID;
    }

    /// burn exits a staking position such that all accumulated value is
    /// transferred to the owner on burn.
    function burn(uint256 tokenID_)
        public
        virtual
        returns (uint256 payoutEth, uint256 payoutAToken)
    {
        return _burn(msg.sender, msg.sender, tokenID_);
    }

    /// burnTo exits a staking position such that all accumulated value
    /// is transferred to a specified account on burn
    function burnTo(address to_, uint256 tokenID_)
        public
        virtual
        returns (uint256 payoutEth, uint256 payoutAToken)
    {
        return _burn(msg.sender, to_, tokenID_);
    }

    /// collectEth returns all due Eth allocations to caller. The caller
    /// of this function must be the owner of the tokenID
    function collectEth(uint256 tokenID_) public returns (uint256 payout) {
        address owner = ownerOf(tokenID_);
        require(
            msg.sender == owner,
            string(abi.encodePacked(StakingNFTErrorCodes.STAKENFT_CALLER_NOT_TOKEN_OWNER))
        );
        Position memory position = _positions[tokenID_];
        require(
            _positions[tokenID_].withdrawFreeAfter < block.number,
            string(
                abi.encodePacked(
                    StakingNFTErrorCodes.STAKENFT_LOCK_DURATION_WITHDRAW_TIME_NOT_REACHED
                )
            )
        );

        // get values and update state
        (_positions[tokenID_], payout) = _collectEth(_sharesEth, position);
        _reserveEth -= payout;
        // perform transfer and return amount paid out
        _safeTransferEth(owner, payout);
        return payout;
    }

    /// collectToken returns all due AToken allocations to caller. The
    /// caller of this function must be the owner of the tokenID
    function collectToken(uint256 tokenID_) public returns (uint256 payout) {
        address owner = ownerOf(tokenID_);
        require(
            msg.sender == owner,
            string(abi.encodePacked(StakingNFTErrorCodes.STAKENFT_CALLER_NOT_TOKEN_OWNER))
        );
        Position memory position = _positions[tokenID_];
        require(
            position.withdrawFreeAfter < block.number,
            string(
                abi.encodePacked(
                    StakingNFTErrorCodes.STAKENFT_LOCK_DURATION_WITHDRAW_TIME_NOT_REACHED
                )
            )
        );

        // get values and update state
        (_positions[tokenID_], payout) = _collectToken(_sharesToken, position);
        _reserveToken -= payout;
        // perform transfer and return amount paid out
        _safeTransferERC20(IERC20Transferable(_aTokenAddress()), owner, payout);
        return payout;
    }

    /// collectEth returns all due Eth allocations to the to_ address. The caller
    /// of this function must be the owner of the tokenID
    function collectEthTo(address to_, uint256 tokenID_) public returns (uint256 payout) {
        address owner = ownerOf(tokenID_);
        require(
            msg.sender == owner,
            string(abi.encodePacked(StakingNFTErrorCodes.STAKENFT_CALLER_NOT_TOKEN_OWNER))
        );
        Position memory position = _positions[tokenID_];
        require(
            _positions[tokenID_].withdrawFreeAfter < block.number,
            string(
                abi.encodePacked(
                    StakingNFTErrorCodes.STAKENFT_LOCK_DURATION_WITHDRAW_TIME_NOT_REACHED
                )
            )
        );

        // get values and update state
        (_positions[tokenID_], payout) = _collectEth(_sharesEth, position);
        _reserveEth -= payout;
        // perform transfer and return amount paid out
        _safeTransferEth(to_, payout);
        return payout;
    }

    /// collectTokenTo returns all due AToken allocations to the to_ address. The
    /// caller of this function must be the owner of the tokenID
    function collectTokenTo(address to_, uint256 tokenID_) public returns (uint256 payout) {
        address owner = ownerOf(tokenID_);
        require(
            msg.sender == owner,
            string(abi.encodePacked(StakingNFTErrorCodes.STAKENFT_CALLER_NOT_TOKEN_OWNER))
        );
        Position memory position = _positions[tokenID_];
        require(
            position.withdrawFreeAfter < block.number,
            string(
                abi.encodePacked(
                    StakingNFTErrorCodes.STAKENFT_LOCK_DURATION_WITHDRAW_TIME_NOT_REACHED
                )
            )
        );

        // get values and update state
        (_positions[tokenID_], payout) = _collectToken(_sharesToken, position);
        _reserveToken -= payout;
        // perform transfer and return amount paid out
        _safeTransferERC20(IERC20Transferable(_aTokenAddress()), to_, payout);
        return payout;
    }

    function circuitBreakerState() public view returns (bool) {
        return _circuitBreaker;
    }

    /// gets the total amount of AToken staked in contract
    function getTotalSharesEth() public view returns (uint256) {
        return _sharesEth;
    }

    /// gets the total amount of AToken staked in contract
    function getTotalSharesToken() public view returns (uint256) {
        return _sharesToken;
    }

    /// gets the total amount of Ether staked in contract
    function getTotalReserveEth() public view returns (uint256) {
        return _reserveEth;
    }

    /// gets the total amount of AToken staked in contract
    function getTotalReserveAToken() public view returns (uint256) {
        return _reserveToken;
    }

    /// estimateEthCollection returns the amount of eth a tokenID may withdraw
    function estimateEthCollection(uint256 tokenID_) public view returns (uint256 payout) {
        Position memory p = _positions[tokenID_];
        Accumulator memory ethState = _ethState;
        uint256 sharesEth = _sharesEth;
        (ethState.accumulator, ethState.slush) = _slushSkim(
            sharesEth,
            ethState.accumulator,
            ethState.slush
        );
        (, , , payout) = _collect(sharesEth, ethState, p, p.accumulatorEth);
        return payout;
    }

    /// estimateTokenCollection returns the amount of AToken a tokenID may withdraw
    function estimateTokenCollection(uint256 tokenID_) public view returns (uint256 payout) {
        Position memory p = _positions[tokenID_];
        Accumulator memory tokenState = _tokenState;
        uint256 sharesToken = _sharesToken;
        (tokenState.accumulator, tokenState.slush) = _slushSkim(
            sharesToken,
            tokenState.accumulator,
            tokenState.slush
        );
        (, , , payout) = _collect(sharesToken, tokenState, p, p.accumulatorToken);
        return payout;
    }

    /// estimateExcessToken returns the amount of AToken that is held in the
    /// name of this contract. The value returned is the value that would be
    /// returned by a call to skimExcessToken.
    function estimateExcessToken() public view returns (uint256 excess) {
        (, excess) = _estimateExcessToken();
        return excess;
    }

    /// estimateExcessEth returns the amount of Eth that is held in the name of
    /// this contract. The value returned is the value that would be returned by
    /// a call to skimExcessEth.
    function estimateExcessEth() public view returns (uint256 excess) {
        return _estimateExcessEth();
    }

    /// gets the position struct given a tokenID. The tokenId must
    /// exist.
    function getPosition(uint256 tokenID_)
        public
        view
        returns (
            uint256 weightedShares,
            bool lockedStakingPosition,
            uint256 shares,
            uint256 freeAfter,
            uint256 withdrawFreeAfter,
            uint256 accumulatorEth,
            uint256 accumulatorToken
        )
    {
        Position memory p = _positions[tokenID_];
        weightedShares = uint256(p.weightedShares);
        lockedStakingPosition = p.lockedStakingPosition;
        shares = uint256(p.shares);
        freeAfter = uint256(p.freeAfter);
        withdrawFreeAfter = uint256(p.withdrawFreeAfter);
        accumulatorEth = p.accumulatorEth;
        accumulatorToken = p.accumulatorToken;
    }

    /// Gets token URI
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721Upgradeable)
        returns (string memory)
    {
        return IStakingNFTDescriptor(_stakingPositionDescriptorAddress()).tokenURI(this, tokenId);
    }

    /// gets the _ACCUMULATOR_SCALE_FACTOR used to scale the ether and tokens
    /// deposited on this contract to reduce the integer division errors.
    function getAccumulatorScaleFactor() public pure returns (uint256) {
        return _ACCUMULATOR_SCALE_FACTOR;
    }

    /// gets the _MAX_MINT_LOCK value. This value is the maximum duration of blocks that we allow a
    /// position to be locked when minted
    function getMaxMintLock() public pure returns (uint256) {
        return _MAX_MINT_LOCK;
    }

    /// gets the _MAX_MINT_LOCK value. This value is the maximum duration of blocks that we allow a
    /// position to be locked
    function getMaxGovernanceLock() public pure returns (uint256) {
        return _MAX_GOVERNANCE_LOCK;
    }

    function __stakingNFTInit(string memory name_, string memory symbol_)
        internal
        onlyInitializing
    {
        __ERC721_init(name_, symbol_);
    }

    // _lockPosition prevents a position from being burned for duration_ number
    // of blocks by setting the freeAfter field on the Position struct returns
    // the number of shares in the locked Position so that governance vote
    // counting may be performed when setting a lock
    //
    // Note well: This function *assumes* that tokenID position exists.
    //            This is because the existance check is performed
    //            at the higher level.
    function _lockPosition(uint256 tokenID_, uint256 duration_) internal returns (uint256 shares) {
        Position memory p = _positions[tokenID_];
        uint32 freeDur = uint32(block.number) + uint32(duration_);
        p.freeAfter = freeDur > p.freeAfter ? freeDur : p.freeAfter;
        _positions[tokenID_] = p;
        return p.shares;
    }

    // _lockWithdraw prevents a position from being collected and burned for duration_ number of blocks
    // by setting the withdrawFreeAfter field on the Position struct.
    // returns the number of shares in the locked Position so that
    //
    // Note well: This function *assumes* that tokenID position exists.
    //            This is because the existance check is performed
    //            at the higher level.
    function _lockWithdraw(uint256 tokenID_, uint256 duration_) internal returns (uint256 shares) {
        Position memory p = _positions[tokenID_];
        uint256 freeDur = block.number + duration_;
        p.withdrawFreeAfter = freeDur > p.withdrawFreeAfter ? freeDur : p.withdrawFreeAfter;
        _positions[tokenID_] = p;
        return p.shares;
    }

    // _mintNFT performs the mint operation and invokes the inherited _mint method
    function _mintNFT(address to_, uint256 amount_) internal returns (uint256 tokenID) {
        // this is to allow struct packing and is safe due to AToken having a
        // total distribution of 220M
        require(
            amount_ > 0,
            string(abi.encodePacked(StakingNFTErrorCodes.STAKENFT_STAKED_AMOUNT_IS_ZERO))
        );
        require(
            amount_ <= 2**224 - 1,
            string(abi.encodePacked(StakingNFTErrorCodes.STAKENFT_MINT_AMOUNT_EXCEEDS_MAX_SUPPLY))
        );
        // transfer the number of tokens specified by amount_ into contract
        // from the callers account
        _safeTransferFromERC20(IERC20Transferable(_aTokenAddress()), msg.sender, amount_);

        // get local copy of storage vars to save gas
        uint256 sharesEth = _sharesEth;
        Accumulator memory ethState = _ethState;
        Accumulator memory tokenState = _tokenState;

        // get new tokenID from counter
        tokenID = _increment();

        // Call _slushSkim on Eth and Token accumulator before minting staked position.
        // This ensures that all stakers receive their appropriate rewards.
        if (sharesEth > 0) {
            (ethState.accumulator, ethState.slush) = _slushSkim(
                sharesEth,
                ethState.accumulator,
                ethState.slush
            );
            _ethState = ethState;
        }

        // update storage
        sharesEth += amount_;
        _sharesEth = sharesEth;
        _positions[tokenID] = Position(
            uint224(amount_),
            false,
            uint224(amount_),
            uint32(block.number) + 1,
            uint32(block.number) + 1,
            ethState.accumulator,
            tokenState.accumulator
        );
        _reserveToken += amount_;
        // invoke inherited method and return
        ERC721Upgradeable._mint(to_, tokenID);
        return tokenID;
    }

    // _burn performs the burn operation and invokes the inherited _burn method
    function _burn(
        address from_,
        address to_,
        uint256 tokenID_
    ) internal returns (uint256 payoutEth, uint256 payoutToken) {
        require(
            from_ == ownerOf(tokenID_),
            string(abi.encodePacked(StakingNFTErrorCodes.STAKENFT_CALLER_NOT_TOKEN_OWNER))
        );

        // collect state
        Position memory p = _positions[tokenID_];
        // enforce freeAfter to prevent burn during lock
        require(
            p.freeAfter < block.number && p.withdrawFreeAfter < block.number,
            string(abi.encodePacked(StakingNFTErrorCodes.STAKENFT_FREE_AFTER_TIME_NOT_REACHED))
        );

        // get copy of storage to save gas
        uint256 sharesEth = _sharesEth;

        // calc Eth amounts due
        (p, payoutEth) = _collectEth(sharesEth, p);

        // calc token amounts due
        if (p.lockedStakingPosition) {
            uint256 sharesToken = _sharesToken;
            (p, payoutToken) = _collectToken(sharesToken, p); // TODO: Should only happen if locked, right?
            _sharesToken -= p.weightedShares;
        }

        // add back to token payout the original stake position
        payoutToken += p.shares;

        // debit global shares counter and delete from mapping
        _sharesEth -= p.shares;
        _reserveToken -= payoutToken;
        _reserveEth -= payoutEth;
        delete _positions[tokenID_];

        // invoke inherited burn method
        ERC721Upgradeable._burn(tokenID_);

        // transfer out all eth and tokens owed
        _safeTransferERC20(IERC20Transferable(_aTokenAddress()), to_, payoutToken);
        _safeTransferEth(to_, payoutEth);
        return (payoutEth, payoutToken);
    }

    function _collectToken(uint256 shares_, Position memory p_)
        internal
        returns (Position memory p, uint256 payout)
    {
        uint256 acc;
        Accumulator memory tokenState = _tokenState;
        (tokenState.accumulator, tokenState.slush) = _slushSkim(
            shares_,
            tokenState.accumulator,
            tokenState.slush
        );
        (tokenState, p, acc, payout) = _collect(shares_, tokenState, p_, p_.accumulatorToken);
        _tokenState = tokenState;
        p.accumulatorToken = acc;
        return (p, payout);
    }

    // _collectEth performs call to _collect and updates state during a request
    // for an eth distribution
    function _collectEth(uint256 shares_, Position memory p_)
        internal
        returns (Position memory p, uint256 payout)
    {
        uint256 acc;
        Accumulator memory ethState = _ethState;
        (ethState.accumulator, ethState.slush) = _slushSkim(
            shares_,
            ethState.accumulator,
            ethState.slush
        );
        (ethState, p, acc, payout) = _collect(shares_, ethState, p_, p_.accumulatorEth);
        _ethState = ethState;
        p.accumulatorEth = acc;
        return (p, payout);
    }

    function _tripCB() internal {
        require(
            _circuitBreaker == _CIRCUIT_BREAKER_CLOSED,
            string(abi.encodePacked(CircuitBreakerErrorCodes.CIRCUIT_BREAKER_OPENED))
        );
        _circuitBreaker = _CIRCUIT_BREAKER_OPENED;
    }

    function _resetCB() internal {
        require(
            _circuitBreaker == _CIRCUIT_BREAKER_OPENED,
            string(abi.encodePacked(CircuitBreakerErrorCodes.CIRCUIT_BREAKER_CLOSED))
        );
        _circuitBreaker = _CIRCUIT_BREAKER_CLOSED;
    }

    // _newTokenID increments the counter and returns the new value
    function _increment() internal returns (uint256 count) {
        count = _counter;
        count += 1;
        _counter = count;
        return count;
    }

    // _estimateExcessEth returns the amount of Eth that is held in the name of
    // this contract
    function _estimateExcessEth() internal view returns (uint256 excess) {
        uint256 reserve = _reserveEth;
        uint256 balance = address(this).balance;
        require(
            balance >= reserve,
            string(abi.encodePacked(StakingNFTErrorCodes.STAKENFT_BALANCE_LESS_THAN_RESERVE))
        );
        excess = balance - reserve;
    }

    // _estimateExcessToken returns the amount of AToken that is held in the
    // name of this contract
    function _estimateExcessToken()
        internal
        view
        returns (IERC20Transferable aToken, uint256 excess)
    {
        uint256 reserve = _reserveToken;
        aToken = IERC20Transferable(_aTokenAddress());
        uint256 balance = aToken.balanceOf(address(this));
        require(
            balance >= reserve,
            string(abi.encodePacked(StakingNFTErrorCodes.STAKENFT_BALANCE_LESS_THAN_RESERVE))
        );
        excess = balance - reserve;
        return (aToken, excess);
    }

    function _getCount() internal view returns (uint256) {
        return _counter;
    }

    // _collect performs calculations necessary to determine any distributions
    // due to an account such that it may be used for both token and eth
    // distributions this prevents the need to keep redundant logic
    function _collect(
        uint256 shares_,
        Accumulator memory state_,
        Position memory p_,
        uint256 positionAccumulatorValue_
    )
        internal
        pure
        returns (
            Accumulator memory,
            Position memory,
            uint256,
            uint256
        )
    {
        // determine number of accumulator steps this Position needs distributions from
        uint256 accumulatorDelta;
        if (positionAccumulatorValue_ > state_.accumulator) {
            accumulatorDelta = 2**168 - positionAccumulatorValue_;
            accumulatorDelta += state_.accumulator;
            positionAccumulatorValue_ = state_.accumulator;
        } else {
            accumulatorDelta = state_.accumulator - positionAccumulatorValue_;
            // update accumulator value for calling method
            positionAccumulatorValue_ += accumulatorDelta;
        }
        // calculate payout based on shares held in position
        uint256 payout = accumulatorDelta * p_.shares;
        // if there are no shares other than this position, flush the slush fund
        // into the payout and update the in memory state object
        if (shares_ == p_.shares) {
            payout += state_.slush;
            state_.slush = 0;
        }

        uint256 payoutRemainder = payout;
        // reduce payout by scale factor
        payout /= _ACCUMULATOR_SCALE_FACTOR;
        // Computing and saving the numeric error from the floor division in the
        // slush.
        payoutRemainder -= payout * _ACCUMULATOR_SCALE_FACTOR;
        state_.slush += payoutRemainder;

        return (state_, p_, positionAccumulatorValue_, payout);
    }

    // _deposit allows an Accumulator to be updated with new value if there are
    // no currently staked positions, all value is stored in the slush
    function _deposit(uint256 delta_, Accumulator memory state_)
        internal
        pure
        returns (Accumulator memory)
    {
        state_.slush += (delta_ * _ACCUMULATOR_SCALE_FACTOR);

        // Slush should be never be above 2**167 to protect against overflow in
        // the later code.
        require(
            state_.slush < 2**167,
            string(abi.encodePacked(StakingNFTErrorCodes.STAKENFT_SLUSH_TOO_LARGE))
        );
        return state_;
    }

    // _slushSkim flushes value from the slush into the accumulator if there are
    // no currently staked positions, all value is stored in the slush
    function _slushSkim(
        uint256 shares_,
        uint256 accumulator_,
        uint256 slush_
    ) internal pure returns (uint256, uint256) {
        if (shares_ > 0) {
            uint256 deltaAccumulator = slush_ / shares_;
            slush_ -= deltaAccumulator * shares_;
            accumulator_ += deltaAccumulator;
            // avoiding accumulator_ overflow.
            if (accumulator_ > type(uint168).max) {
                // The maximum allowed value for the accumulator is 2**168-1.
                // This hard limit was set to not overflow the operation
                // `accumulator * shares` that happens later in the code.
                accumulator_ = accumulator_ % (2**168);
            }
        }
        return (accumulator_, slush_);
    }

    // Computes the additional ATokens which will be distributed
    // as part of the snapshot process.
    // This should *only* be called during the snapshot process
    // and should only be performed *once*.
    function _updateAccumulatorForMinting(
        uint32 epoch_,
        Accumulator memory state_,
        uint256 reserveToken_,
        uint256 additionalNewTokens_,
        uint256 rewardEra_
    ) internal pure returns (Accumulator memory, uint256) {
        uint256 currentEra = epoch_ / rewardEra_;
        uint256 additionalTokens = additionalNewTokens_ / (rewardEra_ * 2**(currentEra + 1));
        state_ = _deposit(additionalTokens, state_);
        reserveToken_ += additionalTokens;
        return (state_, reserveToken_);
    }

    // MUST BE MODIFIED TO ENSURE THIS IS ONLY CALLED ONCE PER EPOCH
    // MUST HAVE RESTRICTION SO CALLED ONLY DURING THE SNAPSHOT PROCESS.
    // THIS MUST ONLY BE CALLED ONCE PER SNAPSHOT/EPOCH
    function mintTokensForEpoch(uint32 epoch_) external {
        // Make copies of state variable to save gas
        Accumulator memory tokenState = _tokenState;
        uint256 reserveToken = _reserveToken;
        (tokenState, reserveToken) = _updateAccumulatorForMinting(
            epoch_,
            tokenState,
            reserveToken,
            _ADDITIONAL_ATOKENS,
            _REWARD_ERA
        );
        // Overwrite state variables
        _tokenState = tokenState;
        _reserveToken = reserveToken;
        return;
    }

    // updateStakingPosition realizes the AToken gains and adds them
    // to the staking position
    function updateStakingPosition(uint256 tokenID_) public {
        // collect state
        Position memory p = _positions[tokenID_];
        // Must not currently be a locked staking position
        require(
            p.lockedStakingPosition == true,
            string(abi.encodePacked(StakingNFTErrorCodes.STAKENFT_POSITION_IS_UNLOCKED))
        );

        // get copy of storage to save gas
        Accumulator memory ethState = _ethState;
        Accumulator memory tokenState = _tokenState;
        uint256 sharesToken = _sharesToken;
        uint256 sharesEth = _sharesEth;
        uint256 payoutToken;
        // calc token amount due; call _slushSkim to ensure all profits
        // are distributed correctly
        (tokenState.accumulator, tokenState.slush) = _slushSkim(
            sharesToken,
            tokenState.accumulator,
            tokenState.slush
        );
        _tokenState = tokenState;
        (ethState.accumulator, ethState.slush) = _slushSkim(
            sharesEth,
            ethState.accumulator,
            ethState.slush
        );
        _ethState = ethState;

        // Compute additional AToken
        (p, payoutToken) = _collectToken(sharesToken, p);

        require(
            p.shares + payoutToken <= 2**224 - 1,
            string(abi.encodePacked(StakingNFTErrorCodes.STAKENFT_MINT_AMOUNT_EXCEEDS_MAX_SUPPLY))
        );
        // Update shares in position
        p.weightedShares += uint224(payoutToken);
        p.shares += uint224(payoutToken);
        // Update total staked shares
        sharesToken += payoutToken;
        sharesEth += payoutToken;

        // Overwrite position
        _positions[tokenID_] = p;
        // Overwrite shares
        _sharesToken = sharesToken;
        _sharesEth = sharesEth;
    }

    // lockStakingPosition allows for Stakers to Lock their staking position
    // in order to earn additional Eth and AToken rewards.
    function lockStakingPosition(uint256 tokenID_, uint32 lockDuration_) public returns (bool) {
        require(
            msg.sender == ownerOf(tokenID_),
            string(abi.encodePacked(StakingNFTErrorCodes.STAKENFT_CALLER_NOT_TOKEN_OWNER))
        );

        Position memory p = _positions[tokenID_];
        // Must not currently be a locked staking position
        require(
            p.lockedStakingPosition == false,
            string(abi.encodePacked(StakingNFTErrorCodes.STAKENFT_POSITION_IS_LOCKED))
        );

        // Compute updated weight
        uint256 weightedShares;
        bool lockedStakingPosition;
        (weightedShares, lockedStakingPosition) = _computeLockedStakingPosition(
            p.shares,
            lockDuration_
        );

        // Did not choose lockDuration_ long enough for the minimum Tier,
        // so nothing happens and the position is not locked.
        if (lockedStakingPosition == false) {
            return lockedStakingPosition;
        }

        // Update withdraw
        uint32 withdrawFreeAfter = uint32(block.number) + uint32(lockDuration_);
        // Determine if Position variable needs be to updated
        p.withdrawFreeAfter = (p.withdrawFreeAfter < withdrawFreeAfter)
            ? withdrawFreeAfter
            : p.withdrawFreeAfter;

        // TODO: think more about what is required.
        // Update state information accordingly;

        // We need to update both sharesEth and sharesToken
        // as well as call _slushSkim
        uint256 sharesEth = _sharesEth;
        uint256 sharesToken = _sharesToken;
        Accumulator memory ethState = _ethState;
        Accumulator memory tokenState = _tokenState;
        (ethState.accumulator, ethState.slush) = _slushSkim(
            sharesEth,
            ethState.accumulator,
            ethState.slush
        );
        (tokenState.accumulator, tokenState.slush) = _slushSkim(
            sharesToken,
            tokenState.accumulator,
            tokenState.slush
        );

        // Update shares and state information
        sharesEth += (weightedShares - p.shares);
        sharesToken += weightedShares;
        _sharesEth = sharesEth;
        _sharesToken = sharesToken;
        _ethState = ethState;
        _tokenState = tokenState;

        // Update Position information
        p.accumulatorToken = tokenState.accumulator;
        p.weightedShares = uint224(weightedShares);
        p.lockedStakingPosition = lockedStakingPosition;

        // Save position
        _positions[tokenID_] = p;
        return lockedStakingPosition;
    }

    // Compute the weighted shares and locked position bool based on
    // amount_ and lockDuration_
    function _computeLockedStakingPosition(uint256 amount_, uint32 lockDuration_)
        internal
        pure
        returns (uint256, bool)
    {
        // denominator used when computing weighted stake
        uint24 lockingTierDenominator = 1000000;
        uint24 lockingTierNumerator1 = 1000001;
        uint24 lockingTierNumerator2 = 1010000;
        uint24 lockingTierNumerator3 = 1100000;
        uint24 lockingTierNumerator4 = 2000000;

        uint32 lockingTier1 = (uint32(_MAX_MINT_LOCK) * 70) / 1825;
        uint32 lockingTier2 = uint32(_MAX_MINT_LOCK) / 6;
        uint32 lockingTier3 = uint32(_MAX_MINT_LOCK) / 2;
        uint32 lockingTier4 = uint32(_MAX_MINT_LOCK);

        uint256 lockingTierNumerator;
        if (lockDuration_ < lockingTier1) {
            return (amount_, false);
        } else if (lockDuration_ < lockingTier2) {
            lockingTierNumerator = lockingTierNumerator1;
        } else if (lockDuration_ < lockingTier3) {
            lockingTierNumerator = lockingTierNumerator2;
        } else if (lockDuration_ < lockingTier4) {
            lockingTierNumerator = lockingTierNumerator3;
        } else {
            lockingTierNumerator = lockingTierNumerator4;
        }

        // Compute weighted shares; this weight is determined by the specific
        // Tier selected.
        uint256 weightedAmount = (lockingTierNumerator * amount_) / lockingTierDenominator;
        //uint256 weightedAmount = (lockingTierNumerator * amount_) / _LOCKING_TIER_DENOMINATOR;
        //return ((lockingTierNumerator * amount_) / lockingTierDenominator, lockedStakingPosition);
        return (weightedAmount, true);
    }
}
