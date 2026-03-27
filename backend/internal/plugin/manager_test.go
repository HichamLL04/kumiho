package plugin

import (
	"context"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/plugin/runtime"
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
	if err != nil {
		t.Fatalf("Activate() error = %v", err)
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
