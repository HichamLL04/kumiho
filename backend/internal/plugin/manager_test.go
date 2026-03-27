package plugin

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/plugin/runtime"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/healthcheck"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdkstate "github.com/kumiho-plugin/kumiho-plugin-sdk/state"
)

func TestManagerRegisterAndActivate(t *testing.T) {
	store := NewMemoryStore()
	manager := NewManager(store, runtime.NewStubRuntime(sdkmanifest.RuntimeTypeBinary))

	record, err := manager.RegisterInstalled(sdkmanifest.Manifest{
		ID:          "kumiho-plugin-metadata-example",
		Name:        "Example",
		Version:     "0.1.0",
		Author:      "tester",
		RuntimeType: sdkmanifest.RuntimeTypeBinary,
	}, "/plugins/example")
	if err != nil {
		t.Fatalf("RegisterInstalled() error = %v", err)
	}

	if record.State != sdkstate.Installed {
		t.Fatalf("state = %q", record.State)
	}

	record, err = manager.Activate(context.Background(), record.ID)
	if err == nil {
		t.Fatal("Activate() error = nil")
	}

	if record.State != sdkstate.Error {
		t.Fatalf("state = %q, want %q", record.State, sdkstate.Error)
	}
}

func TestManagerBootstrapDowngradesRunningStateToRegistered(t *testing.T) {
	store := NewMemoryStore()
	now := time.Now()
	if err := store.Save(Record{
		ID:        "running-plugin",
		Manifest:  sdkmanifest.Manifest{ID: "running-plugin", RuntimeType: sdkmanifest.RuntimeTypeBinary},
		State:     sdkstate.Active,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	manager := NewManager(store)
	if err := manager.Bootstrap(); err != nil {
		t.Fatalf("Bootstrap() error = %v", err)
	}

	record, ok, err := manager.Get("running-plugin")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !ok {
		t.Fatal("Get() ok = false")
	}
	if record.State != sdkstate.Registered {
		t.Fatalf("state = %q, want %q", record.State, sdkstate.Registered)
	}
}

func TestManagerActivateReturnsStartErrorAndMarksState(t *testing.T) {
	store := NewMemoryStore()
	manager := NewManager(store, &fakeRuntime{
		runtimeType: sdkmanifest.RuntimeTypeBinary,
		startErr:    errors.New("start failed"),
	})

	record, err := manager.RegisterInstalled(sdkmanifest.Manifest{
		ID:          "failing-plugin",
		Name:        "Failing",
		Version:     "0.1.0",
		RuntimeType: sdkmanifest.RuntimeTypeBinary,
	}, "/plugins/failing")
	if err != nil {
		t.Fatalf("RegisterInstalled() error = %v", err)
	}

	record, err = manager.Activate(context.Background(), record.ID)
	if err == nil {
		t.Fatal("Activate() error = nil")
	}
	if record.State != sdkstate.Error {
		t.Fatalf("state = %q, want %q", record.State, sdkstate.Error)
	}
	if record.LastError == "" {
		t.Fatal("LastError = empty")
	}
}

func TestManagerActivateRollsBackRuntimeWhenSaveActiveFails(t *testing.T) {
	store := &failingStore{
		Store:       NewMemoryStore(),
		failOnSaveN: 3,
	}
	rt := &fakeRuntime{runtimeType: sdkmanifest.RuntimeTypeBinary}
	manager := NewManager(store, rt)

	record, err := manager.RegisterInstalled(sdkmanifest.Manifest{
		ID:          "rollback-plugin",
		Name:        "Rollback",
		Version:     "0.1.0",
		RuntimeType: sdkmanifest.RuntimeTypeBinary,
	}, "/plugins/rollback")
	if err != nil {
		t.Fatalf("RegisterInstalled() error = %v", err)
	}

	record, err = manager.Activate(context.Background(), record.ID)
	if err == nil {
		t.Fatal("Activate() error = nil")
	}
	if rt.stopCalls != 1 {
		t.Fatalf("stopCalls = %d, want 1", rt.stopCalls)
	}
	if record.State != sdkstate.Error {
		t.Fatalf("state = %q, want %q", record.State, sdkstate.Error)
	}
}

func TestManagerDeactivateReturnsStopErrorAndMarksState(t *testing.T) {
	store := NewMemoryStore()
	now := time.Now()
	if err := store.Save(Record{
		ID:          "active-plugin",
		Manifest:    sdkmanifest.Manifest{ID: "active-plugin", RuntimeType: sdkmanifest.RuntimeTypeBinary},
		State:       sdkstate.Active,
		InstallPath: "/plugins/active",
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	manager := NewManager(store, &fakeRuntime{
		runtimeType: sdkmanifest.RuntimeTypeBinary,
		stopErr:     errors.New("stop failed"),
	})

	record, err := manager.Deactivate(context.Background(), "active-plugin")
	if err == nil {
		t.Fatal("Deactivate() error = nil")
	}
	if record.State != sdkstate.Error {
		t.Fatalf("state = %q, want %q", record.State, sdkstate.Error)
	}
}

type fakeRuntime struct {
	runtimeType sdkmanifest.RuntimeType
	startErr    error
	stopErr     error
	stopCalls   int
}

func (r *fakeRuntime) Type() sdkmanifest.RuntimeType {
	return r.runtimeType
}

func (r *fakeRuntime) Start(context.Context, runtime.Instance) error {
	return r.startErr
}

func (r *fakeRuntime) Stop(context.Context, runtime.Instance) error {
	r.stopCalls++
	return r.stopErr
}

func (r *fakeRuntime) Healthcheck(context.Context, runtime.Instance) (*healthcheck.Response, error) {
	return nil, runtime.ErrNotImplemented
}

type failingStore struct {
	Store
	saveCalls   int
	failOnSaveN int
}

func (s *failingStore) Save(record Record) error {
	s.saveCalls++
	if s.saveCalls == s.failOnSaveN {
		return errors.New("save failed")
	}
	return s.Store.Save(record)
}
