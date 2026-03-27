package plugin

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/plugin/runtime"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/healthcheck"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdkstate "github.com/kumiho-plugin/kumiho-plugin-sdk/state"
	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
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

func TestManagerBootstrapReactivatesPreviouslyActivePlugin(t *testing.T) {
	store := NewMemoryStore()
	installFile, err := os.CreateTemp(t.TempDir(), "plugin-*")
	if err != nil {
		t.Fatalf("CreateTemp() error = %v", err)
	}
	_ = installFile.Close()
	now := time.Now()
	if err := store.Save(Record{
		ID:          "running-plugin",
		Manifest:    sdkmanifest.Manifest{ID: "running-plugin", RuntimeType: sdkmanifest.RuntimeTypeBinary},
		State:       sdkstate.Active,
		InstallPath: installFile.Name(),
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	rt := &fakeRuntime{runtimeType: sdkmanifest.RuntimeTypeBinary}
	manager := NewManager(store, rt)
	if err := manager.Bootstrap(context.Background()); err != nil {
		t.Fatalf("Bootstrap() error = %v", err)
	}

	record, ok, err := manager.Get("running-plugin")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !ok {
		t.Fatal("Get() ok = false")
	}
	if record.State != sdkstate.Active {
		t.Fatalf("state = %q, want %q", record.State, sdkstate.Active)
	}
	if rt.startCalls != 1 {
		t.Fatalf("startCalls = %d, want 1", rt.startCalls)
	}
}

func TestManagerBootstrapMarksErrorWhenReactivationFails(t *testing.T) {
	store := NewMemoryStore()
	installFile, err := os.CreateTemp(t.TempDir(), "plugin-*")
	if err != nil {
		t.Fatalf("CreateTemp() error = %v", err)
	}
	_ = installFile.Close()
	now := time.Now()
	if err := store.Save(Record{
		ID:          "running-plugin",
		Manifest:    sdkmanifest.Manifest{ID: "running-plugin", RuntimeType: sdkmanifest.RuntimeTypeBinary},
		State:       sdkstate.Active,
		InstallPath: installFile.Name(),
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	manager := NewManager(store, &fakeRuntime{
		runtimeType: sdkmanifest.RuntimeTypeBinary,
		startErr:    errors.New("start failed"),
	})
	if err := manager.Bootstrap(context.Background()); err == nil {
		t.Fatal("Bootstrap() error = nil")
	}

	record, ok, err := manager.Get("running-plugin")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !ok {
		t.Fatal("Get() ok = false")
	}
	if record.State != sdkstate.Error {
		t.Fatalf("state = %q, want %q", record.State, sdkstate.Error)
	}
}

func TestManagerBootstrapMarksErrorWhenInstalledArtifactIsMissing(t *testing.T) {
	store := NewMemoryStore()
	now := time.Now()
	if err := store.Save(Record{
		ID:          "missing-plugin",
		Manifest:    sdkmanifest.Manifest{ID: "missing-plugin", RuntimeType: sdkmanifest.RuntimeTypeBinary},
		State:       sdkstate.Disabled,
		InstallPath: "/path/does/not/exist",
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	manager := NewManager(store, &fakeRuntime{runtimeType: sdkmanifest.RuntimeTypeBinary})
	if err := manager.Bootstrap(context.Background()); err != nil {
		t.Fatalf("Bootstrap() error = %v", err)
	}

	record, ok, err := manager.Get("missing-plugin")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !ok {
		t.Fatal("Get() ok = false")
	}
	if record.State != sdkstate.Error {
		t.Fatalf("state = %q, want %q", record.State, sdkstate.Error)
	}
	if record.LastError != "installed artifact is missing" {
		t.Fatalf("LastError = %q", record.LastError)
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

func TestManagerActivateInjectsPluginEnvironment(t *testing.T) {
	store := NewMemoryStore()
	rt := &fakeRuntime{runtimeType: sdkmanifest.RuntimeTypeBinary}
	manager := NewManager(store, rt)
	manager.SetEnvProvider(fakeEnvProvider{
		env: map[string]string{"GOOGLE_BOOKS_API_KEY": "secret-value"},
	})

	record, err := manager.RegisterInstalled(sdkmanifest.Manifest{
		ID:          "configured-plugin",
		Name:        "Configured",
		Version:     "0.1.0",
		RuntimeType: sdkmanifest.RuntimeTypeBinary,
	}, "/plugins/configured")
	if err != nil {
		t.Fatalf("RegisterInstalled() error = %v", err)
	}

	if _, err := manager.Activate(context.Background(), record.ID); err != nil {
		t.Fatalf("Activate() error = %v", err)
	}

	if got := rt.lastInst.Env["GOOGLE_BOOKS_API_KEY"]; got != "secret-value" {
		t.Fatalf("injected env = %q, want %q", got, "secret-value")
	}
}

type fakeRuntime struct {
	runtimeType sdkmanifest.RuntimeType
	startErr    error
	stopErr     error
	startCalls  int
	stopCalls   int
	lastInst    runtime.Instance
}

func (r *fakeRuntime) Type() sdkmanifest.RuntimeType {
	return r.runtimeType
}

func (r *fakeRuntime) Start(_ context.Context, inst runtime.Instance) error {
	r.startCalls++
	r.lastInst = inst
	return r.startErr
}

func (r *fakeRuntime) Stop(context.Context, runtime.Instance) error {
	r.stopCalls++
	return r.stopErr
}

func (r *fakeRuntime) Healthcheck(context.Context, runtime.Instance) (*healthcheck.Response, error) {
	return nil, runtime.ErrNotImplemented
}

func (r *fakeRuntime) Search(context.Context, runtime.Instance, *sdktypes.SearchRequest) (*sdktypes.SearchResponse, error) {
	return nil, runtime.ErrNotImplemented
}

func (r *fakeRuntime) Fetch(context.Context, runtime.Instance, *sdktypes.FetchRequest) (*sdktypes.FetchResponse, error) {
	return nil, runtime.ErrNotImplemented
}

type failingStore struct {
	Store
	saveCalls   int
	failOnSaveN int
}

type fakeEnvProvider struct {
	env map[string]string
}

func (p fakeEnvProvider) EnvironmentForPlugin(string, sdkmanifest.Manifest) (map[string]string, error) {
	return p.env, nil
}

func (p fakeEnvProvider) ValidateActivation(string, sdkmanifest.Manifest) error {
	return nil
}

func (s *failingStore) Save(record Record) error {
	s.saveCalls++
	if s.saveCalls == s.failOnSaveN {
		return errors.New("save failed")
	}
	return s.Store.Save(record)
}

func TestManagerRemoveDeletesRecord(t *testing.T) {
	store := NewMemoryStore()
	manager := NewManager(store)
	now := time.Now()

	if err := store.Save(Record{
		ID:        "plugin-a",
		Manifest:  sdkmanifest.Manifest{ID: "plugin-a", RuntimeType: sdkmanifest.RuntimeTypeBinary},
		State:     sdkstate.Registered,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	if err := manager.Remove("plugin-a"); err != nil {
		t.Fatalf("Remove() error = %v", err)
	}

	_, ok, err := manager.Get("plugin-a")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if ok {
		t.Fatal("plugin should be removed")
	}
}

func TestInstallPathExists(t *testing.T) {
	file, err := os.CreateTemp(t.TempDir(), "plugin-*")
	if err != nil {
		t.Fatalf("CreateTemp() error = %v", err)
	}
	_ = file.Close()

	if !installPathExists(file.Name()) {
		t.Fatal("installPathExists() = false, want true")
	}
	if installPathExists("/path/does/not/exist") {
		t.Fatal("installPathExists() = true, want false")
	}
}
