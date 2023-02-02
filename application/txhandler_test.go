package application

import (
	"testing"

	"github.com/dgraph-io/badger/v2"
)

func TestUTXOTrie(t *testing.T) {
	opts := badger.DefaultOptions(t.TempDir())
	db, err := badger.Open(opts)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	//////////////////////////////////////////////////////////////////////////////
	//////////////////////////////////////////////////////////////////////////////
	//////////////////////////////////////////////////////////////////////////////
	//////////////////////////////////////////////////////////////////////////////
	//signer := &crypto.Signer{}
	//verifier := &mockTxSigVerifier{}
	//hndlr := NewUTXOHandler(db, verifier)
	//hndlr.Init(1)
	//_ = constants.HashLen
}
