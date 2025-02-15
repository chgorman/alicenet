package pendingindex

import (
	"github.com/dgraph-io/badger/v2"

	"github.com/alicenet/alicenet/application/indexer"
	"github.com/alicenet/alicenet/constants/dbprefix"
	"github.com/alicenet/alicenet/utils"
)

// NewPendingTxIndexer makes a new indexer for the pending tx pool
func NewPendingTxIndexer() *PendingTxIndexer {
	return &PendingTxIndexer{
		order: indexer.NewInsertionOrderIndex(
			dbprefix.PrefixPendingTxInsertionOrderIndex,
			dbprefix.PrefixPendingTxInsertionOrderReverseIndex),
		reflink: indexer.NewRefLinkerIndex(
			dbprefix.PrefixUTXORefLinker,
			dbprefix.PrefixUTXORefLinkerRev,
			dbprefix.PrefixUTXOCounter),
		expiration: indexer.NewEpochConstrainedIndex(
			dbprefix.PrefixPendingTxEpochConstraintList,
			dbprefix.PrefixPendingTxEpochConstraintListRef,
		),
	}
}

// PendingTxIndexer is the indexer for the pending tx pool;
// this indexer is used to store valid txs which have not yet been processed.
type PendingTxIndexer struct {
	order      *indexer.InsertionOrderIndexer
	reflink    *indexer.RefLinker
	expiration *indexer.EpochConstrainedList
}

// Add adds a tx to the indexer; it also returns a list of evicted txhashes.
//
// The indexer places a hard limit on the number of txs which may
// reference (consume) a UTXO. Because of this, if an additional reference
// to a UTXO is added, the oldest tx will be evicted (removed)
// from the indexer.
func (pti *PendingTxIndexer) Add(txn *badger.Txn, epoch uint32, txHash []byte, utxoIDs [][]byte) ([][]byte, error) {
	err := pti.order.Add(txn, txHash)
	if err != nil {
		return nil, err
	}
	eviction, evicted, err := pti.reflink.Add(txn, txHash, utxoIDs)
	if err != nil {
		return nil, err
	}
	if eviction {
		for j := 0; j < len(evicted); j++ {
			txHash := utils.CopySlice(evicted[j])
			err := pti.DeleteOne(txn, utils.CopySlice(txHash))
			if err != nil {
				return nil, err
			}
		}
	}
	err = pti.expiration.Append(txn, epoch, txHash)
	if err != nil {
		return nil, err
	}
	return evicted, nil
}

func (pti *PendingTxIndexer) DeleteOne(txn *badger.Txn, txHash []byte) error {
	err := pti.reflink.Delete(txn, txHash)
	if err != nil {
		if err != badger.ErrKeyNotFound {
			return err
		}
	}
	err = pti.order.Delete(txn, txHash)
	if err != nil {
		if err != badger.ErrKeyNotFound {
			return err
		}
	}
	err = pti.expiration.Drop(txn, txHash)
	if err != nil {
		if err != badger.ErrKeyNotFound {
			return err
		}
	}
	return nil
}

// DeleteMined removes the txhash from the indexer as well as all txs
// which reference the utxoIDs it consumed.
func (pti *PendingTxIndexer) DeleteMined(txn *badger.Txn, txHash []byte) ([][]byte, [][]byte, error) {
	txHashes, utxoIDs, err := pti.reflink.DeleteMined(txn, txHash)
	if err != nil {
		if err != badger.ErrKeyNotFound {
			return nil, nil, err
		}
	}
	txHashes = append(txHashes, txHash)
	for j := 0; j < len(txHashes); j++ {
		txHash := utils.CopySlice(txHashes[j])
		err := pti.reflink.Delete(txn, utils.CopySlice(txHash))
		if err != nil {
			if err != badger.ErrKeyNotFound {
				return nil, nil, err
			}
		}
		err = pti.order.Delete(txn, utils.CopySlice(txHash))
		if err != nil {
			if err != badger.ErrKeyNotFound {
				return nil, nil, err
			}
		}
		err = pti.expiration.Drop(txn, utils.CopySlice(txHash))
		if err != nil {
			if err != badger.ErrKeyNotFound {
				return nil, nil, err
			}
		}
	}
	return txHashes, utxoIDs, nil
}

// DropBefore removes all txs from the indexer which expire
// before the specified epoch
func (pti *PendingTxIndexer) DropBefore(txn *badger.Txn, epoch uint32) ([][]byte, error) {
	txHashes, err := pti.expiration.DropBefore(txn, epoch)
	if err != nil {
		if err != badger.ErrKeyNotFound {
			return nil, err
		}
	}
	for j := 0; j < len(txHashes); j++ {
		txHash := utils.CopySlice(txHashes[j])
		err := pti.DeleteOne(txn, utils.CopySlice(txHash))
		if err != nil {
			if err != badger.ErrKeyNotFound {
				return nil, err
			}
		}
	}
	return txHashes, nil
}

// GetEpoch returns the epoch when the tx expires
func (pti *PendingTxIndexer) GetEpoch(txn *badger.Txn, txHash []byte) (uint32, error) {
	return pti.expiration.GetEpoch(txn, txHash)
}

// GetOrderedIter returns an iterator used for iterating through the indexer
func (pti *PendingTxIndexer) GetOrderedIter(txn *badger.Txn) (*badger.Iterator, []byte) {
	return pti.order.NewIter(txn)
}
