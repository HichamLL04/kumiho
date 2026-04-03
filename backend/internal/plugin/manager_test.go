package plugin

import (
	"context"
	"errors"
	"os"
	"strings"
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
	if saveErr := store.Save(Record{
		ID:          "running-plugin",
		Manifest:    sdkmanifest.Manifest{ID: "running-plugin", RuntimeType: sdkmanifest.RuntimeTypeBinary},
		State:       sdkstate.Active,
		InstallPath: installFile.Name(),
		CreatedAt:   now,
		UpdatedAt:   now,
	}); saveErr != nil {
		t.Fatalf("Save() error = %v", saveErr)
	}

	rt := &fakeRuntime{runtimeType: sdkmanifest.RuntimeTypeBinary, healthErr: runtime.ErrNotRunning}
	manager := NewManager(store, rt)
	if bootstrapErr := manager.Bootstrap(context.Background()); bootstrapErr != nil {
		t.Fatalf("Bootstrap() error = %v", bootstrapErr)
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
	if saveErr := store.Save(Record{
		ID:          "running-plugin",
		Manifest:    sdkmanifest.Manifest{ID: "running-plugin", RuntimeType: sdkmanifest.RuntimeTypeBinary},
		State:       sdkstate.Active,
		InstallPath: installFile.Name(),
		CreatedAt:   now,
		UpdatedAt:   now,
	}); saveErr != nil {
		t.Fatalf("Save() error = %v", saveErr)
	}

	manager := NewManager(store, &fakeRuntime{
		runtimeType: sdkmanifest.RuntimeTypeBinary,
		startErr:    errors.New("start failed"),
		healthErr:   runtime.ErrNotRunning,
	})
	if bootstrapErr := manager.Bootstrap(context.Background()); bootstrapErr != nil {
		t.Fatalf("Bootstrap() error = %v", bootstrapErr)
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

func TestManagerBootstrapContinuesAfterActivationFailure(t *testing.T) {
	store := NewMemoryStore()
	failedInstallFile, err := os.CreateTemp(t.TempDir(), "plugin-failed-*")
	if err != nil {
		t.Fatalf("CreateTemp() error = %v", err)
	}
	_ = failedInstallFile.Close()
	healthyInstallFile, err := os.CreateTemp(t.TempDir(), "plugin-healthy-*")
	if err != nil {
		t.Fatalf("CreateTemp() error = %v", err)
	}
	_ = healthyInstallFile.Close()

	now := time.Now()
	for _, record := range []Record{
		{
			ID:          "failed-plugin",
			Manifest:    sdkmanifest.Manifest{ID: "failed-plugin", RuntimeType: sdkmanifest.RuntimeTypeBinary},
			State:       sdkstate.Active,
			InstallPath: failedInstallFile.Name(),
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		{
			ID:          "healthy-plugin",
			Manifest:    sdkmanifest.Manifest{ID: "healthy-plugin", RuntimeType: sdkmanifest.RuntimeTypeBinary},
			State:       sdkstate.Active,
			InstallPath: healthyInstallFile.Name(),
			CreatedAt:   now,
			UpdatedAt:   now,
		},
	} {
		if saveErr := store.Save(record); saveErr != nil {
			t.Fatalf("Save() error = %v", saveErr)
		}
	}

	rt := &selectiveFakeRuntime{
		runtimeType: sdkmanifest.RuntimeTypeBinary,
		startErrByID: map[string]error{
			"failed-plugin": errors.New("start failed"),
		},
	}
	manager := NewManager(store, rt)
	if bootstrapErr := manager.Bootstrap(context.Background()); bootstrapErr != nil {
		t.Fatalf("Bootstrap() error = %v", bootstrapErr)
	}

	failedRecord, ok, err := manager.Get("failed-plugin")
	if err != nil {
		t.Fatalf("Get(failed-plugin) error = %v", err)
	}
	if !ok {
		t.Fatal("Get(failed-plugin) ok = false")
	}
	if failedRecord.State != sdkstate.Error {
		t.Fatalf("failed-plugin state = %q, want %q", failedRecord.State, sdkstate.Error)
	}

	healthyRecord, ok, err := manager.Get("healthy-plugin")
	if err != nil {
		t.Fatalf("Get(healthy-plugin) error = %v", err)
	}
	if !ok {
		t.Fatal("Get(healthy-plugin) ok = false")
	}
	if healthyRecord.State != sdkstate.Active {
		t.Fatalf("healthy-plugin state = %q, want %q", healthyRecord.State, sdkstate.Active)
	}
	if rt.startCallsByID["healthy-plugin"] != 1 {
		t.Fatalf("healthy-plugin startCalls = %d, want 1", rt.startCallsByID["healthy-plugin"])
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

func TestManagerActivateReturnsExistingRecordWhenAlreadyActive(t *testing.T) {
	store := NewMemoryStore()
	now := time.Now()
	record := Record{
		ID:          "active-plugin",
		Manifest:    sdkmanifest.Manifest{ID: "active-plugin", RuntimeType: sdkmanifest.RuntimeTypeBinary},
		State:       sdkstate.Active,
		InstallPath: "/plugins/active",
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := store.Save(record); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	rt := &fakeRuntime{runtimeType: sdkmanifest.RuntimeTypeBinary}
	manager := NewManager(store, rt)

	got, err := manager.Activate(context.Background(), record.ID)
	if err != nil {
		t.Fatalf("Activate() error = %v", err)
	}
	if got.State != sdkstate.Active {
		t.Fatalf("state = %q, want %q", got.State, sdkstate.Active)
	}
	if rt.startCalls != 0 {
		t.Fatalf("startCalls = %d, want 0", rt.startCalls)
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
		env: map[string]string{"KITSU_ACCESS_TOKEN": "secret-value"},
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

	if got := rt.lastInst.Env["KITSU_ACCESS_TOKEN"]; got != "secret-value" {
		t.Fatalf("injected env = %q, want %q", got, "secret-value")
	}
}

func TestManagerActivatePreservesStartErrorWhenMarkErrorFails(t *testing.T) {
	store := &failingStore{
		Store:       NewMemoryStore(),
		failOnSaveN: 3,
	}
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

	_, err = manager.Activate(context.Background(), record.ID)
	if err == nil {
		t.Fatal("Activate() error = nil")
	}
	if !strings.Contains(err.Error(), "plugin start failed: start failed") {
		t.Fatalf("error = %q, want original start failure", err)
	}
	if !strings.Contains(err.Error(), "also failed to mark error state: save failed") {
		t.Fatalf("error = %q, want mark error failure", err)
	}
}

type fakeRuntime struct {
	runtimeType sdkmanifest.RuntimeType
	startErr    error
	stopErr     error
	healthErr   error
	startCalls  int
	stopCalls   int
	lastInst    runtime.Instance
}

type selectiveFakeRuntime struct {
	runtimeType    sdkmanifest.RuntimeType
	startErrByID   map[string]error
	startCallsByID map[string]int
}

func (r *selectiveFakeRuntime) Type() sdkmanifest.RuntimeType {
	return r.runtimeType
}

func (r *selectiveFakeRuntime) Start(_ context.Context, inst runtime.Instance) error {
	if r.startCallsByID == nil {
		r.startCallsByID = make(map[string]int)
	}
	r.startCallsByID[inst.ID]++
	return r.startErrByID[inst.ID]
}

func (r *selectiveFakeRuntime) Stop(context.Context, runtime.Instance) error {
	return nil
}

func (r *selectiveFakeRuntime) Healthcheck(context.Context, runtime.Instance) (*healthcheck.Response, error) {
	return nil, runtime.ErrNotImplemented
}

func (r *selectiveFakeRuntime) Search(context.Context, runtime.Instance, *sdktypes.SearchRequest) (*sdktypes.SearchResponse, error) {
	return nil, runtime.ErrNotImplemented
}

func (r *selectiveFakeRuntime) Fetch(context.Context, runtime.Instance, *sdktypes.FetchRequest) (*sdktypes.FetchResponse, error) {
	return nil, runtime.ErrNotImplemented
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
	if r.healthErr != nil {
		return nil, r.healthErr
	}
	return &healthcheck.Response{Status: "ok"}, nil
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
	env         map[string]string
	envErr      error
	validateErr error
}

func (p fakeEnvProvider) EnvironmentForPlugin(string, sdkmanifest.Manifest) (map[string]string, error) {
	return p.env, p.envErr
}

func (p fakeEnvProvider) ValidateActivation(string, sdkmanifest.Manifest) error {
	return p.validateErr
}

func TestManagerActivateMarksErrorWhenActivationValidationFails(t *testing.T) {
	store := NewMemoryStore()
	manager := NewManager(store, &fakeRuntime{runtimeType: sdkmanifest.RuntimeTypeBinary})
	manager.SetEnvProvider(fakeEnvProvider{validateErr: errors.New("missing secret")})

	record, err := manager.RegisterInstalled(sdkmanifest.Manifest{
		ID:          "validation-failing-plugin",
		Name:        "Validation Failing",
		Version:     "0.1.0",
		RuntimeType: sdkmanifest.RuntimeTypeBinary,
	}, "/plugins/validation-failing")
	if err != nil {
		t.Fatalf("RegisterInstalled() error = %v", err)
	}

	record, err = manager.Activate(context.Background(), record.ID)
	if err == nil {
		t.Fatal("Activate() error = nil")
	}
	if !strings.Contains(err.Error(), "validate activation") {
		t.Fatalf("Activate() error = %v, want validation context", err)
	}
	if record.State != sdkstate.Error {
		t.Fatalf("state = %q, want %q", record.State, sdkstate.Error)
	}
	if record.LastError != "missing secret" {
		t.Fatalf("LastError = %q, want %q", record.LastError, "missing secret")
	}
}

func TestManagerActivateMarksErrorWhenBuildingEnvironmentFails(t *testing.T) {
	store := NewMemoryStore()
	manager := NewManager(store, &fakeRuntime{runtimeType: sdkmanifest.RuntimeTypeBinary})
	manager.SetEnvProvider(fakeEnvProvider{envErr: errors.New("secret decryption failed")})

	record, err := manager.RegisterInstalled(sdkmanifest.Manifest{
		ID:          "env-failing-plugin",
		Name:        "Env Failing",
		Version:     "0.1.0",
		RuntimeType: sdkmanifest.RuntimeTypeBinary,
	}, "/plugins/env-failing")
	if err != nil {
		t.Fatalf("RegisterInstalled() error = %v", err)
	}

	record, err = manager.Activate(context.Background(), record.ID)
	if err == nil {
		t.Fatal("Activate() error = nil")
	}
	if !strings.Contains(err.Error(), "build plugin environment") {
		t.Fatalf("Activate() error = %v, want environment context", err)
	}
	if record.State != sdkstate.Error {
		t.Fatalf("state = %q, want %q", record.State, sdkstate.Error)
	}
	if record.LastError != "secret decryption failed" {
		t.Fatalf("LastError = %q, want %q", record.LastError, "secret decryption failed")
	}
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

	exists, statErr := installPathExists(file.Name())
	if statErr != nil {
		t.Fatalf("installPathExists() error = %v", statErr)
	}
	if !exists {
		t.Fatal("installPathExists() = false, want true")
	}

	exists, statErr = installPathExists("/path/does/not/exist")
	if statErr != nil {
		t.Fatalf("installPathExists() error = %v", statErr)
	}
	if exists {
		t.Fatal("installPathExists() = true, want false")
	}
}
