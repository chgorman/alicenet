package dynamics

import (
	"errors"
	"fmt"
	"math/big"
	"sync"
	"time"

	"github.com/alicenet/alicenet/constants"
	"github.com/alicenet/alicenet/utils"
	"github.com/dgraph-io/badger/v2"
	"github.com/sirupsen/logrus"
)

// Ensuring interface check
var _ StorageGetter = (*Storage)(nil)

/*
 * PROPOSAL ON CHAIN PROPOSAL GETS VOTED ON IF PROPOSAL PASSES IT BECOMES ACTIVE
 * IN FUTURE ( EPOCH OF ACTIVE > EPOCH OF FINAL VOTE + 2 ) WHEN PROPOSAL PASSES
 * AND ITS EXECUTED AN EVENT IS EMITTED FROM THE DYNAMICS CONTRACT THIS EVENT IS
 * OBSERVED BY THE NODES THE NODES FETCH THE NEW VALUES AND STORE IN THE
 * DATABASE FOR FUTURE USE ON THE EPOCH BOUNDARY OF NOT ACTIVE TO ACTIVE, THE
 * STORAGE STRUCT MUST BE UPDATED IN MEMORY FROM THE VALUES STORED IN THE DB
 */

// Dynamics contains the list of "constants" which may be changed dynamically to
// reflect protocol updates. The point is that these values are essentially
// constant but may be changed in future.

// StorageGetter is the interface that all Storage structs must match to be
// valid. These will be used to store the constants which may change each epoch
// as governance determines.
//
//go:generate go-mockgen -f -i StorageGetter -o mocks/storage.mockgen.go .
type StorageGetter interface {
	GetMaxBlockSize() uint32
	GetMaxProposalSize() uint32
	GetProposalTimeout() time.Duration
	GetPreVoteTimeout() time.Duration
	GetPreCommitTimeout() time.Duration
	GetDeadBlockRoundNextRoundTimeout() time.Duration
	GetDownloadTimeout() time.Duration
	GetMinScaledTransactionFee() *big.Int
	GetDataStoreFee() *big.Int
	GetValueStoreFee() *big.Int
	ChangeDynamicValues(txn *badger.Txn, epoch uint32, rawDynamics []byte) error
	UpdateCurrentDynamicValue(*badger.Txn, uint32) error
	GetDynamicValueInThePast(txn *badger.Txn, epoch uint32) (uint32, *DynamicValues, error)
}

// Storage is the struct which will implement the StorageGetter interface.
type Storage struct {
	sync.RWMutex
	database      *Database
	startChan     chan struct{}
	startOnce     sync.Once
	DynamicValues *DynamicValues
	logger        *logrus.Logger
}

// Init initializes the Storage structure.
func (s *Storage) Init(rawDB rawDataBase, logger *logrus.Logger) error {
	// initialize channel
	s.startChan = make(chan struct{})

	// initialize database
	s.database = &Database{rawDB: rawDB}

	// initialize logger
	s.logger = logger

	// check if already have a linked list stored in our database
	err := s.database.rawDB.View(func(txn *badger.Txn) error {
		linkedList, err := s.database.GetLinkedList(txn)
		if err != nil {
			utils.DebugTrace(s.logger, err)
			return err
		}

		currentNode, err := s.database.GetNode(txn, linkedList.GetEpochLastUpdated())
		if err != nil {
			utils.DebugTrace(s.logger, err)
			return err
		}

		s.DynamicValues, err = currentNode.dynamicValues.Copy()
		if err != nil {
			utils.DebugTrace(s.logger, err)
			return err
		}
		return nil
	})
	// if err == nil, dynamicValues was set and the linked list exists, it means
	// that we can allow requests to this service. Otherwise, we will need to wait
	// for an event to create and set the linked list and s.dynamicValues
	if err == nil {
		s.startOnce.Do(func() {
			close(s.startChan)
		})
	}
	return nil
}

// ChangeDynamicValues adds new dynamic values to the linked list to be future
// changed. In case the linked list in empty, this function initializes the
// database, the linked list and closes the start channel. The dynamic service
// is only allowed to return values after the first node has been added to the
// list.
func (s *Storage) ChangeDynamicValues(txn *badger.Txn, epoch uint32, rawDynamics []byte) error {
	s.Lock()
	defer s.Unlock()

	newDynamicValue, err := DecodeDynamicValues(rawDynamics)
	if err != nil {
		return err
	}

	if epoch == 1 {
		s.logger.Infof("Adding initial dynamic values %+v to start on block %v", *newDynamicValue, 1)
	} else {
		s.logger.Infof("Adding dynamic values %+v to change on block %v", *newDynamicValue, epoch*constants.EpochLength+1)
	}

	linkedList, err := s.database.GetLinkedList(txn)
	if err != nil {
		if !errors.Is(err, ErrKeyNotPresent) {
			utils.DebugTrace(s.logger, err)
			return err
		}
		// Creates linked list in case it doesn't exist already and update
		// s.DynamicsValue
		err := s.createLinkedList(txn, epoch, newDynamicValue)
		if err != nil {
			return err
		}
		s.startOnce.Do(func() {
			close(s.startChan)
		})
		return nil
	}

	err = s.addNode(txn, linkedList, epoch, newDynamicValue)
	if err != nil {
		utils.DebugTrace(s.logger, err)
		return err
	}

	return nil
}

// LoadStorage updates DynamicValues to the correct value defined by the epoch.
// We will attempt to load the correct storage struct. If we receive
// ErrKeyNotPresent, then we return DynamicValues with the standard parameters.
// We use Lock and Unlock rather than RLock and RUnlock because we modify
// Storage.
func (s *Storage) UpdateCurrentDynamicValue(txn *badger.Txn, epoch uint32) error {
	<-s.startChan

	s.Lock()
	defer s.Unlock()

	err := s.loadDynamicValues(txn, epoch)
	if err != nil {
		utils.DebugTrace(s.logger, err)
		return err
	}

	return nil
}

// GetDynamicValueInThePast gets a dynamic value in the past for accusations purposes.
func (s *Storage) GetDynamicValueInThePast(txn *badger.Txn, epoch uint32) (uint32, *DynamicValues, error) {
	<-s.startChan

	s.Lock()
	defer s.Unlock()

	return s.getDynamicValueInThePast(txn, epoch)
}

// GetMaxBlockSize returns the maximum allowed bytes
func (s *Storage) GetMaxBlockSize() uint32 {
	<-s.startChan

	s.RLock()
	defer s.RUnlock()
	return s.DynamicValues.GetMaxBlockSize()
}

// GetMaxProposalSize returns the maximum size of bytes allowed in a proposal
func (s *Storage) GetMaxProposalSize() uint32 {
	<-s.startChan

	s.RLock()
	defer s.RUnlock()
	return s.DynamicValues.GetMaxProposalSize()
}

// GetProposalStepTimeout returns the proposal step timeout
func (s *Storage) GetProposalTimeout() time.Duration {
	<-s.startChan

	s.RLock()
	defer s.RUnlock()
	return s.DynamicValues.GetProposalTimeout()
}

// GetPreVoteStepTimeout returns the prevote step timeout
func (s *Storage) GetPreVoteTimeout() time.Duration {
	<-s.startChan

	s.RLock()
	defer s.RUnlock()
	return s.DynamicValues.GetPreVoteTimeout()
}

// GetPreCommitStepTimeout returns the precommit step timeout
func (s *Storage) GetPreCommitTimeout() time.Duration {
	<-s.startChan

	s.RLock()
	defer s.RUnlock()
	return s.DynamicValues.GetPreCommitTimeout()
}

// GetDeadBlockRoundNextRoundTimeout returns the timeout required before
// moving into the DeadBlockRound
func (s *Storage) GetDeadBlockRoundNextRoundTimeout() time.Duration {
	<-s.startChan

	s.RLock()
	defer s.RUnlock()
	return s.DynamicValues.GetDeadBlockRoundNextRoundTimeout()
}

// GetDownloadTimeout returns the timeout for downloads
func (s *Storage) GetDownloadTimeout() time.Duration {
	<-s.startChan

	s.RLock()
	defer s.RUnlock()
	return s.DynamicValues.GetDownloadTimeout()
}

// GetMinTxFee returns the minimum transaction fee.
func (s *Storage) GetMinScaledTransactionFee() *big.Int {
	<-s.startChan

	s.RLock()
	defer s.RUnlock()
	return s.DynamicValues.GetMinScaledTransactionFee()
}

// GetValueStoreFee returns the transaction fee for ValueStore
func (s *Storage) GetValueStoreFee() *big.Int {
	<-s.startChan

	s.RLock()
	defer s.RUnlock()
	return s.DynamicValues.GetValueStoreFee()
}

// GetDataStoreFee returns the DataStore fee per epoch
func (s *Storage) GetDataStoreFee() *big.Int {
	<-s.startChan

	s.RLock()
	defer s.RUnlock()
	return s.DynamicValues.GetDataStoreFee()
}

// createLinkedList creates the linked list and store a DynamicValue for epoch 1
// as the first node. This function also update s.DynamicValues.
func (s *Storage) createLinkedList(txn *badger.Txn, epoch uint32, newDynamicValue *DynamicValues) error {
	if epoch != 1 {
		return fmt.Errorf(
			"dynamics: expected epoch 1 but epoch got %v, possible incorrect ethereum starting block", epoch)
	}
	node, linkedList, err := CreateLinkedList(epoch, newDynamicValue)
	if err != nil {
		utils.DebugTrace(s.logger, err)
		return err
	}
	err = s.database.SetLinkedList(txn, linkedList)
	if err != nil {
		utils.DebugTrace(s.logger, err)
		return err
	}
	err = s.database.SetNode(txn, node)
	if err != nil {
		utils.DebugTrace(s.logger, err)
		return err
	}
	// finally assign the value to memory
	s.DynamicValues, err = newDynamicValue.Copy()
	if err != nil {
		utils.DebugTrace(s.logger, err)
		return err
	}
	return nil
}

// addNode adds an additional node to the database. This node can only be added
// after the tail (latest node).
func (s *Storage) addNode(txn *badger.Txn, linkedList *LinkedList, epoch uint32, newDynamicValue *DynamicValues) error {
	newTailNode, err := CreateNode(epoch, newDynamicValue)
	if err != nil {
		utils.DebugTrace(s.logger, err)
		return err
	}
	prevTailNode, err := s.database.GetNode(txn, linkedList.GetMostFutureUpdate())
	if err != nil {
		utils.DebugTrace(s.logger, err)
		return err
	}

	if !prevTailNode.IsTail() {
		s.logger.Error("Previous node is not tail")
		utils.DebugTrace(s.logger, err)
		return ErrInvalidPrevNode
	}

	// node to be added is strictly ahead of most future node
	if newTailNode.thisEpoch <= prevTailNode.thisEpoch {
		s.logger.Errorf("New tail node: %+v is older than current tail: %+v", newTailNode, prevTailNode)
		utils.DebugTrace(s.logger, err)
		return &ErrInvalidNode{newTailNode}
	}

	err = newTailNode.SetEpochs(prevTailNode, nil)
	if err != nil {
		s.logger.Error("Error setting epochs")
		utils.DebugTrace(s.logger, err)
		return err
	}

	// validating nodes after the link's update
	err = prevTailNode.Validate()
	if err != nil {
		s.logger.Error("Error validating previous node after link update")
		utils.DebugTrace(s.logger, err)
		return err
	}

	err = newTailNode.Validate()
	if err != nil {
		s.logger.Error("Error validating new node after link update")
		utils.DebugTrace(s.logger, err)
		return err
	}

	// Store the nodes after changes have been made
	err = s.database.SetNode(txn, prevTailNode)
	if err != nil {
		s.logger.Error("Error on saving previous node on database")
		utils.DebugTrace(s.logger, err)
		return err
	}
	err = s.database.SetNode(txn, newTailNode)
	if err != nil {
		s.logger.Error("Error on saving new node on database")
		utils.DebugTrace(s.logger, err)
		return err
	}
	// Update EpochLastUpdated
	err = linkedList.SetMostFutureUpdate(newTailNode.thisEpoch)
	if err != nil {
		s.logger.Error("Error setting the most future node on the linked list")
		utils.DebugTrace(s.logger, err)
		return err
	}
	err = s.database.SetLinkedList(txn, linkedList)
	if err != nil {
		s.logger.Error("Error saving linked list on the database")
		utils.DebugTrace(s.logger, err)
		return err
	}
	return nil
}

// loadDynamicValues looks for the appropriate DynamicValues value in the
// database and returns that value.
func (s *Storage) loadDynamicValues(txn *badger.Txn, epoch uint32) error {
	if epoch == 0 {
		return ErrZeroEpoch
	}
	linkedList, err := s.database.GetLinkedList(txn)
	if err != nil {
		utils.DebugTrace(s.logger, err)
		return err
	}

	currentNode, err := s.database.GetNode(txn, linkedList.GetEpochLastUpdated())
	if err != nil {
		utils.DebugTrace(s.logger, err)
		return err
	}

	// if the currentNode is tail or the epoch for the next update is not over yet,
	// we return
	if currentNode.IsTail() || epoch <= currentNode.nextEpoch {
		return nil
	}

	tailNode, err := s.database.GetNode(txn, linkedList.GetMostFutureUpdate())
	if err != nil {
		utils.DebugTrace(s.logger, err)
		return err
	}

	// iterate from the latest node to find which is the latest valid dynamic value
	executionEpoch, nextDynamicValue, err := s.iterateBackwardFromNode(txn, epoch, tailNode)
	if err != nil {
		utils.DebugTrace(s.logger, err)
		return err
	}

	err = linkedList.SetEpochLastUpdated(executionEpoch)
	if err != nil {
		utils.DebugTrace(s.logger, err)
		return err
	}

	err = s.database.SetLinkedList(txn, linkedList)
	if err != nil {
		utils.DebugTrace(s.logger, err)
		return err
	}
	s.DynamicValues, err = nextDynamicValue.Copy()
	if err != nil {
		utils.DebugTrace(s.logger, err)
		return err
	}
	s.logger.Infof(
		"Dynamic values updated to %+v",
		*s.DynamicValues,
	)
	return nil
}

// getDynamicValueInThePast gets a dynamic value in the past for accusations purposes.
func (s *Storage) getDynamicValueInThePast(txn *badger.Txn, epoch uint32) (uint32, *DynamicValues, error) {
	if epoch == 0 {
		return 0, nil, ErrZeroEpoch
	}
	// if epoch is 1, return the dynamic value at the head of the linked list
	// (always epoch 1). The first epoch is an edge case. Normally, a value for
	// dynamics is set at the end of epoch, e.g dynamic value for epoch 10 will be
	// valid after the first block of the next epoch 11 (block 10241, assuming epoch
	// length 1024). However, since we didn't have a value before, the head of the
	// linked list is added to the epoch 1, making its dynamic value valid from the
	// whole epoch 1 until at least the end of epoch 2 (block 1 to 2048, assuming
	// epoch length 1024).
	if epoch == 1 {
		headNode, err := s.database.GetNode(txn, epoch)
		if err != nil {
			utils.DebugTrace(s.logger, err)
			return 0, nil, err
		}
		dv, err := headNode.dynamicValues.Copy()
		if err != nil {
			utils.DebugTrace(s.logger, err)
			return 0, nil, err
		}
		return epoch, dv, nil
	}
	linkedList, err := s.database.GetLinkedList(txn)
	if err != nil {
		utils.DebugTrace(s.logger, err)
		return 0, nil, err
	}

	currentNode, err := s.database.GetNode(txn, linkedList.GetEpochLastUpdated())
	if err != nil {
		utils.DebugTrace(s.logger, err)
		return 0, nil, err
	}
	return s.iterateBackwardFromNode(txn, epoch, currentNode)
}

// iterateBackwardFromNode loops backwards through the LinkedList
func (s *Storage) iterateBackwardFromNode(txn *badger.Txn, epoch uint32, currentNode *Node) (uint32, *DynamicValues, error) {
	var err error
	for {
		if epoch > currentNode.thisEpoch {
			dv, err := currentNode.dynamicValues.Copy()
			if err != nil {
				utils.DebugTrace(s.logger, err)
				return 0, nil, err
			}
			return currentNode.thisEpoch, dv, nil
		}
		// If we have reached the head node, then we do not have a node
		// for this specific epoch; we raise an error.
		if currentNode.IsHead() {
			utils.DebugTrace(s.logger, ErrInvalid)
			return 0, nil, ErrInvalid
		}
		// We proceed backward in the linked list of nodes
		prevEpoch := currentNode.prevEpoch
		currentNode, err = s.database.GetNode(txn, prevEpoch)
		if err != nil {
			utils.DebugTrace(s.logger, err)
			return 0, nil, err
		}
	}
}
