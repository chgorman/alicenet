// Generated by ifacemaker. DO NOT EDIT.

package bindings

import (
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/event"
)

// IALCAFilterer ...
type IALCAFilterer interface {
	// FilterApproval is a free log retrieval operation binding the contract event 0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925.
	//
	// Solidity: event Approval(address indexed owner, address indexed spender, uint256 value)
	FilterApproval(opts *bind.FilterOpts, owner []common.Address, spender []common.Address) (*ALCAApprovalIterator, error)
	// WatchApproval is a free log subscription operation binding the contract event 0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925.
	//
	// Solidity: event Approval(address indexed owner, address indexed spender, uint256 value)
	WatchApproval(opts *bind.WatchOpts, sink chan<- *ALCAApproval, owner []common.Address, spender []common.Address) (event.Subscription, error)
	// ParseApproval is a log parse operation binding the contract event 0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925.
	//
	// Solidity: event Approval(address indexed owner, address indexed spender, uint256 value)
	ParseApproval(log types.Log) (*ALCAApproval, error)
	// FilterTransfer is a free log retrieval operation binding the contract event 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef.
	//
	// Solidity: event Transfer(address indexed from, address indexed to, uint256 value)
	FilterTransfer(opts *bind.FilterOpts, from []common.Address, to []common.Address) (*ALCATransferIterator, error)
	// WatchTransfer is a free log subscription operation binding the contract event 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef.
	//
	// Solidity: event Transfer(address indexed from, address indexed to, uint256 value)
	WatchTransfer(opts *bind.WatchOpts, sink chan<- *ALCATransfer, from []common.Address, to []common.Address) (event.Subscription, error)
	// ParseTransfer is a log parse operation binding the contract event 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef.
	//
	// Solidity: event Transfer(address indexed from, address indexed to, uint256 value)
	ParseTransfer(log types.Log) (*ALCATransfer, error)
}
