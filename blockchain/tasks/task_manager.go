package tasks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"reflect"
	"sync"

	"github.com/MadBase/MadNet/blockchain"
	"github.com/sirupsen/logrus"
)

var (
	ErrUnknownTaskName = errors.New("Unknown task name")
	ErrUnknownTaskType = errors.New("Unkonwn task type")
)

// ========================================================
// Task interfaces and structs
// ========================================================

// Task the interface requirements of a task
type Task interface {
	DoDone(*logrus.Logger)
	DoRetry(context.Context, *logrus.Logger, blockchain.Ethereum) bool
	DoWork(context.Context, *logrus.Logger, blockchain.Ethereum) bool
	ShouldRetry(context.Context, *logrus.Logger, blockchain.Ethereum) bool
}

// TaskHandler required functionality of a task
type TaskHandler interface {
	Cancel()
	Start()
	Complete() bool
	Successful() bool
}

// TaskWrapper is used when marshalling and unmarshalling tasks
type TaskWrapper struct {
	TaskName string
	TaskRaw  []byte
}

// TaskHandlerDetails contains all the data required to execute a task
type TaskHandlerDetails struct {
	complete   bool
	count      int
	eth        blockchain.Ethereum
	ID         int
	label      string
	logger     *logrus.Logger
	successful bool
	task       Task
	taskCancel context.CancelFunc
	wg         *sync.WaitGroup
}

// ========================================================
// Here are the standard functions that orchestrate tasks
// ========================================================

// Start begins orchestrating the task in a goroutine
func (td *TaskHandlerDetails) Start() {

	td.Logger().Infof("Starting...")
	td.wg.Add(1)

	var taskContext context.Context
	taskContext, td.taskCancel = context.WithCancel(context.Background())

	retryDelay := td.eth.RetryDelay()

	go func(ctx context.Context) {
		if td.wg != nil {
			defer td.wg.Done()
		}
		defer td.wrappedDoDone()
		defer td.taskCancel() // TODO double check

		td.successful = td.wrappedDoWork(ctx)

		for !td.successful && td.wrappedShouldRetry(ctx) {

			err := blockchain.SleepWithContext(ctx, retryDelay)
			if err != nil {
				td.Logger().Warnf("Task interupted: %v", ctx.Err())
				return
			}

			td.successful = td.wrappedDoRetry(ctx)
		}

	}(taskContext)
}

// Cancel stops the task's goroutine
func (td *TaskHandlerDetails) Cancel() {
	td.Logger().Infof("Canceling ...")
	if td.taskCancel != nil {
		td.taskCancel()
	}
}

// Successful returns indication of whether the task was eventually successful
func (td *TaskHandlerDetails) Successful() bool {
	return td.successful
}

// Complete returns indication of whether has completed
func (td *TaskHandlerDetails) Complete() bool {
	return td.complete
}

func (td *TaskHandlerDetails) Logger() *logrus.Entry {
	return td.logger.WithField("TaskID", td.label)
}

// ========================================================
// Here are the methods that invoke task specific functionality
// ========================================================

func (td *TaskHandlerDetails) wrappedDoWork(ctx context.Context) bool {

	td.count++

	var resp bool

	timeout := td.eth.Timeout()

	ctx, cancelFunc := context.WithTimeout(ctx, timeout)
	defer cancelFunc()
	resp = td.task.DoWork(ctx, td.logger, td.eth)

	td.Logger().Infof("wrappedDoWork(...) try %d: %v", td.count, resp)

	return resp
}

func (td *TaskHandlerDetails) wrappedDoRetry(ctx context.Context) bool {

	td.count++

	var resp bool

	timeout := td.eth.Timeout()

	ctx, cancelFunc := context.WithTimeout(ctx, timeout)
	defer cancelFunc()
	resp = td.task.DoRetry(ctx, td.logger, td.eth)

	td.Logger().Infof("wrappedDoRetry(...) try %d: %v", td.count, resp)

	return resp
}

func (td *TaskHandlerDetails) wrappedShouldRetry(ctx context.Context) bool {

	var resp bool

	timeout := td.eth.Timeout()

	ctx, cancelFunc := context.WithTimeout(ctx, timeout)
	defer cancelFunc()
	resp = td.task.ShouldRetry(ctx, td.logger, td.eth)

	td.Logger().Infof("wrappedShouldRetry(...): %v", resp)

	return resp
}

func (td *TaskHandlerDetails) wrappedDoDone() {
	td.Logger().Infof("wrappedDoDone(...) tries %d", td.count)
	td.task.DoDone(td.logger)
	td.complete = true
}

// ========================================================
// Manager interfaces and structs
// ========================================================

// Manager describtes the basic functionality of a task Manager
type Manager interface {
	NewTaskHandler(logger *logrus.Logger, eth blockchain.Ethereum, t Task) TaskHandler
	WaitForTasks()
}

// ManagerDetails contains information required for implmentation of task Manager
type ManagerDetails struct {
	wg sync.WaitGroup
}

// ========================================================
// Manager implementation
// ========================================================

// NewManager creates a new Manager
func NewManager() Manager {
	return &ManagerDetails{wg: sync.WaitGroup{}}
}

// NewTaskHandler creates a new task handler, where each phase can take upto 'timeout'
// duration and there is a delay of 'retryDelay' before a retry.
func (md *ManagerDetails) NewTaskHandler(logger *logrus.Logger, eth blockchain.Ethereum, task Task) TaskHandler {

	taskID := rand.Intn(0x10000)
	taskLabel := fmt.Sprintf("0x%04x", taskID)

	logger.Infof("Creating task %v with timeout of %v and retryDelay of %v", taskID, eth.Timeout(), eth.RetryDelay())

	return &TaskHandlerDetails{
		ID:     taskID,
		eth:    eth,
		task:   task,
		label:  taskLabel,
		logger: logger,
		wg:     &md.wg}
}

// WaitForTasks blocks until all tasks associated withis Manager have completed
func (md *ManagerDetails) WaitForTasks() {
	md.wg.Wait()
}

// ========================================================
// Custom Marshal/Unmarshal for tasks
// ========================================================
var taskRegistry struct {
	sync.RWMutex
	a map[reflect.Type]string
	b map[string]reflect.Type
}

func RegisterTask(t Task) {
	taskRegistry.Lock()
	defer taskRegistry.Unlock()

	if taskRegistry.a == nil {
		taskRegistry.a = make(map[reflect.Type]string)
	}

	if taskRegistry.b == nil {
		taskRegistry.b = make(map[string]reflect.Type)
	}

	tipe := reflect.TypeOf(t)
	if tipe.Kind() == reflect.Ptr {
		tipe = tipe.Elem()
	}

	taskRegistry.a[tipe] = tipe.String()
	taskRegistry.b[tipe.String()] = tipe
}

func lookupName(tipe reflect.Type) (string, bool) {
	taskRegistry.RLock()
	defer taskRegistry.RUnlock()

	present, name := taskRegistry.a[tipe]

	return present, name
}

func lookupType(name string) (reflect.Type, bool) {
	taskRegistry.Lock()
	defer taskRegistry.Unlock()

	present, tipe := taskRegistry.b[name]

	return present, tipe
}

func WrapTask(t Task) (TaskWrapper, error) {

	tipe := reflect.TypeOf(t)
	if tipe.Kind() == reflect.Ptr {
		tipe = tipe.Elem()
	}

	name, present := lookupName(tipe)
	if !present {
		return TaskWrapper{}, ErrUnknownTaskType
	}
	fmt.Printf("Marshaling %v...\n", name)

	rawTask, err := json.Marshal(t)
	if err != nil {
		return TaskWrapper{}, err
	}

	return TaskWrapper{TaskName: name, TaskRaw: rawTask}, nil
}

func UnwrapTask(wrapper TaskWrapper) (Task, error) {

	tipe, present := lookupType(wrapper.TaskName)
	if !present {
		return nil, ErrUnknownTaskName
	}
	val := reflect.New(tipe)

	err := json.Unmarshal(wrapper.TaskRaw, val.Interface())
	if err != nil {
		return nil, err
	}

	return val.Interface().(Task), nil
}
