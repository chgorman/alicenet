package tests

import (
	"strings"
	"testing"

	"github.com/alicenet/alicenet/bridge/bindings"
	"github.com/alicenet/alicenet/layer1/chains/ethereum/events"
	"github.com/alicenet/alicenet/layer1/executor"
	execMocks "github.com/alicenet/alicenet/layer1/executor/mocks"
	"github.com/alicenet/alicenet/layer1/monitor/interfaces"
	"github.com/alicenet/alicenet/layer1/monitor/objects"
	"github.com/alicenet/alicenet/test/mocks"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/stretchr/testify/assert"
)

func TestRegisteringETHDKGEvents(t *testing.T) {
	var em *objects.EventMap = objects.NewEventMap()
	db := mocks.NewTestDB()
	var adminHandler interfaces.AdminHandler = mocks.NewMockAdminHandler()
	var taskHandler executor.TaskHandler = execMocks.NewMockTaskHandler()

	events.RegisterETHDKGEvents(em, db, adminHandler, taskHandler)

	ethDkgABI, err := abi.JSON(strings.NewReader(bindings.ETHDKGMetaData.ABI))
	if err != nil {
		t.Fatal(err)
	}

	for name, event := range ethDkgABI.Events {
		// the Initialized event is not used by the golang code
		if name != "Initialized" {
			eventInfo, ok := em.Lookup(event.ID.String())
			assert.True(t, ok)
			assert.Equal(t, name, eventInfo.Name)
		}
	}
}
