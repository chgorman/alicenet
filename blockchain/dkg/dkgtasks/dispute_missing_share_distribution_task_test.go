package dkgtasks_test

import (
	"context"
	"testing"

	"github.com/MadBase/MadNet/logging"
	"github.com/stretchr/testify/assert"
)

func TestShouldAccuseOneValidatorWhoDidNotDistributeShares(t *testing.T) {
	n := 5
	suite := StartFromShareDistributionPhase(t, n, 1, 100)
	accounts := suite.eth.GetKnownAccounts()
	ctx := context.Background()
	// currentHeight, err := suite.eth.GetCurrentHeight(ctx)
	// assert.Nil(t, err)
	logger := logging.GetLogger("test").WithField("Test", "Test1")

	for idx := range accounts {
		state := suite.dkgStates[idx]
		task := suite.disputeMissingShareDistTasks[idx]

		err := task.Initialize(ctx, logger, suite.eth, state)
		assert.Nil(t, err)
		err = task.DoWork(ctx, logger, suite.eth)
		assert.Nil(t, err)

		suite.eth.Commit()
		assert.True(t, task.Success)
	}

	badParticipants, err := suite.eth.Contracts().Ethdkg().GetBadParticipants(suite.eth.GetCallOpts(ctx, accounts[0]))
	assert.Nil(t, err)
	assert.Equal(t, uint64(1), badParticipants.Uint64())
}

func TestShouldAccuseAllValidatorsWhoDidNotDistributeShares(t *testing.T) {
	n := 5
	suite := StartFromShareDistributionPhase(t, n, n, 100)
	accounts := suite.eth.GetKnownAccounts()
	ctx := context.Background()
	// currentHeight, err := suite.eth.GetCurrentHeight(ctx)
	// assert.Nil(t, err)
	logger := logging.GetLogger("test").WithField("Test", "Test1")

	for idx := range accounts {
		state := suite.dkgStates[idx]
		task := suite.disputeMissingShareDistTasks[idx]
		err := task.Initialize(ctx, logger, suite.eth, state)
		assert.Nil(t, err)
		err = task.DoWork(ctx, logger, suite.eth)
		assert.Nil(t, err)

		suite.eth.Commit()
		assert.True(t, task.Success)
	}

	badParticipants, err := suite.eth.Contracts().Ethdkg().GetBadParticipants(suite.eth.GetCallOpts(ctx, accounts[0]))
	assert.Nil(t, err)
	assert.Equal(t, uint64(n), badParticipants.Uint64())
}

func TestShouldNotAccuseValidatorsWhoDidDistributeShares(t *testing.T) {
	n := 5
	suite := StartFromShareDistributionPhase(t, n, 0, 100)
	accounts := suite.eth.GetKnownAccounts()
	ctx := context.Background()
	// currentHeight, err := suite.eth.GetCurrentHeight(ctx)
	// assert.Nil(t, err)
	logger := logging.GetLogger("test").WithField("Test", "Test1")

	for idx := range accounts {
		state := suite.dkgStates[idx]
		task := suite.disputeMissingShareDistTasks[idx]
		err := task.Initialize(ctx, logger, suite.eth, state)
		assert.Nil(t, err)

		if idx == n-1 {
			// injecting bad state into this validator
			var emptySharesHash [32]byte
			state.Participants[accounts[0].Address].DistributedSharesHash = emptySharesHash
		}

		err = task.DoWork(ctx, logger, suite.eth)
		if idx == n-1 {
			assert.NotNil(t, err)
		} else {
			assert.Nil(t, err)
		}

		suite.eth.Commit()
		if idx == n-1 {
			assert.False(t, task.Success)
		} else {
			assert.True(t, task.Success)
		}
	}

	badParticipants, err := suite.eth.Contracts().Ethdkg().GetBadParticipants(suite.eth.GetCallOpts(ctx, accounts[0]))
	assert.Nil(t, err)
	assert.Equal(t, uint64(0), badParticipants.Uint64())
}

func TestDisputeMissingShareDistributionTask_ShouldRetryTrue(t *testing.T) {
	n := 5
	suite := StartFromShareDistributionPhase(t, n, 0, 100)
	accounts := suite.eth.GetKnownAccounts()
	ctx := context.Background()
	logger := logging.GetLogger("test").WithField("Test", "Test1")

	for idx := range accounts {
		state := suite.dkgStates[idx]
		task := suite.disputeMissingShareDistTasks[idx]
		err := task.Initialize(ctx, logger, suite.eth, state)
		assert.Nil(t, err)
		err = task.DoWork(ctx, logger, suite.eth)
		assert.Nil(t, err)

		suite.eth.Commit()
		assert.True(t, task.Success)
	}

	for idx := 0; idx < len(suite.dkgStates); idx++ {
		suite.dkgStates[idx].Nonce++
		task := suite.disputeMissingShareDistTasks[idx]
		shouldRetry := task.ShouldRetry(ctx, logger, suite.eth)
		assert.True(t, shouldRetry)
	}
}

func TestDisputeMissingShareDistributionTask_ShouldRetryFalse(t *testing.T) {
	n := 5
	suite := StartFromShareDistributionPhase(t, n, 0, 100)
	accounts := suite.eth.GetKnownAccounts()
	ctx := context.Background()
	logger := logging.GetLogger("test").WithField("Test", "Test1")

	for idx := range accounts {
		state := suite.dkgStates[idx]
		task := suite.disputeMissingShareDistTasks[idx]
		err := task.Initialize(ctx, logger, suite.eth, state)
		assert.Nil(t, err)
		err = task.DoWork(ctx, logger, suite.eth)
		assert.Nil(t, err)

		suite.eth.Commit()
		assert.True(t, task.Success)
	}

	for idx := 0; idx < len(suite.dkgStates); idx++ {
		task := suite.disputeMissingShareDistTasks[idx]
		shouldRetry := task.ShouldRetry(ctx, logger, suite.eth)
		assert.False(t, shouldRetry)
	}
}
