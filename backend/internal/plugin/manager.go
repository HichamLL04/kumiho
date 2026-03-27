package plugin

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/plugin/runtime"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/healthcheck"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdkstate "github.com/kumiho-plugin/kumiho-plugin-sdk/state"
	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

// Manager orchestrates plugin lifecycle and state transitions.
type Manager struct {
	store    Store
	runtimes map[sdkmanifest.RuntimeType]runtime.Runtime
}

func NewManager(store Store, runtimes ...runtime.Runtime) *Manager {
	registeredRuntimes := make(map[sdkmanifest.RuntimeType]runtime.Runtime, len(runtimes))
	for _, rt := range runtimes {
		if rt == nil {
			continue
		}
		registeredRuntimes[rt.Type()] = rt
	}

	return &Manager{
		store:    store,
		runtimes: registeredRuntimes,
	}
}

func (m *Manager) RegisterInstalled(pluginManifest sdkmanifest.Manifest, installPath string) (Record, error) {
	now := time.Now()
	record := Record{
		ID:          pluginManifest.ID,
		Manifest:    pluginManifest,
		State:       sdkstate.Installed,
		InstallPath: installPath,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	if existing, ok, err := m.store.Get(pluginManifest.ID); err != nil {
		return Record{}, err
	} else if ok {
		record.CreatedAt = existing.CreatedAt
	}

	if err := m.store.Save(record); err != nil {
		return Record{}, err
	}
	return record, nil
}

func (m *Manager) MarkRegistered(id string) (Record, error) {
	return m.transition(id, sdkstate.Registered, "")
}

func (m *Manager) MarkActivationPending(id string) (Record, error) {
	return m.transition(id, sdkstate.ActivationPending, "")
}

func (m *Manager) Disable(id string) (Record, error) {
	return m.transition(id, sdkstate.Disabled, "")
}

func (m *Manager) MarkUnhealthy(id string, reason string) (Record, error) {
	return m.transition(id, sdkstate.Unhealthy, reason)
}

func (m *Manager) MarkError(id string, reason string) (Record, error) {
	return m.transition(id, sdkstate.Error, reason)
}

func (m *Manager) MarkIncompatible(id string, reason string) (Record, error) {
	return m.transition(id, sdkstate.Incompatible, reason)
}

func (m *Manager) Activate(ctx context.Context, id string) (Record, error) {
	record, err := m.require(id)
	if err != nil {
		return Record{}, err
	}

	rt, ok := m.runtimes[record.Manifest.RuntimeType]
	if !ok {
		runtimeErr := fmt.Errorf("runtime %q is not registered", record.Manifest.RuntimeType)
		errorRecord, markErr := m.MarkError(id, runtimeErr.Error())
		if markErr != nil {
			return Record{}, markErr
		}
		return errorRecord, runtimeErr
	}

	record.State = sdkstate.ActivationPending
	record.LastError = ""
	record.UpdatedAt = time.Now()
	if err := m.store.Save(record); err != nil {
		return Record{}, err
	}

	if err := rt.Start(ctx, toInstance(record)); err != nil {
		errorRecord, markErr := m.MarkError(id, err.Error())
		if markErr != nil {
			return Record{}, markErr
		}
		return errorRecord, fmt.Errorf("plugin start failed: %w", err)
	}

	record.State = sdkstate.Active
	record.UpdatedAt = time.Now()
	if err := m.store.Save(record); err != nil {
		stopErr := rt.Stop(ctx, toInstance(record))
		if stopErr != nil {
			errorRecord, markErr := m.MarkError(id, err.Error())
			if markErr != nil {
				return Record{}, fmt.Errorf("save active state: %w (additionally failed to stop runtime: %v and mark error: %v)", err, stopErr, markErr)
			}
			return errorRecord, fmt.Errorf("save active state: %w (additionally failed to stop runtime: %v)", err, stopErr)
		}

		errorRecord, markErr := m.MarkError(id, err.Error())
		if markErr != nil {
			return Record{}, fmt.Errorf("save active state: %w (runtime rolled back, but failed to mark error: %v)", err, markErr)
		}
		return errorRecord, fmt.Errorf("save active state: %w (runtime rolled back)", err)
	}
	return record, nil
}

func (m *Manager) Deactivate(ctx context.Context, id string) (Record, error) {
	record, err := m.require(id)
	if err != nil {
		return Record{}, err
	}

	rt, ok := m.runtimes[record.Manifest.RuntimeType]
	if !ok {
		return m.Disable(id)
	}

	if err := rt.Stop(ctx, toInstance(record)); err != nil {
		errorRecord, markErr := m.MarkError(id, err.Error())
		if markErr != nil {
			return Record{}, fmt.Errorf("failed to stop plugin: %w (also failed to mark error: %v)", err, markErr)
		}
		return errorRecord, err
	}
	return m.Disable(id)
}

func (m *Manager) Healthcheck(ctx context.Context, id string) (*healthcheck.Response, error) {
	record, err := m.require(id)
	if err != nil {
		return nil, err
	}

	rt, ok := m.runtimes[record.Manifest.RuntimeType]
	if !ok {
		return nil, fmt.Errorf("runtime %q is not registered", record.Manifest.RuntimeType)
	}

	return rt.Healthcheck(ctx, toInstance(record))
}

func (m *Manager) Search(ctx context.Context, id string, req *sdktypes.SearchRequest) (*sdktypes.SearchResponse, error) {
	record, rt, err := m.requireActiveRuntime(id)
	if err != nil {
		return nil, err
	}
	return rt.Search(ctx, toInstance(record), req)
}

func (m *Manager) Fetch(ctx context.Context, id string, req *sdktypes.FetchRequest) (*sdktypes.FetchResponse, error) {
	record, rt, err := m.requireActiveRuntime(id)
	if err != nil {
		return nil, err
	}
	return rt.Fetch(ctx, toInstance(record), req)
}

func (m *Manager) Get(id string) (Record, bool, error) {
	return m.store.Get(id)
}

func (m *Manager) List() ([]Record, error) {
	return m.store.List()
}

func (m *Manager) Remove(id string) error {
	return m.store.Delete(id)
}

// Bootstrap reconciles persisted plugin states on process startup.
// Plugins that were active before shutdown are started again so a core restart
// does not silently disable usable plugins. Newly installed plugins still
// require an explicit activation step.
func (m *Manager) Bootstrap(ctx context.Context) error {
	records, err := m.store.List()
	if err != nil {
		return err
	}
	for _, record := range records {
		if shouldCheckInstallPath(record) && !installPathExists(record.InstallPath) {
			if _, err := m.MarkError(record.ID, "installed artifact is missing"); err != nil {
				return err
			}
			continue
		}

		switch record.State {
		case sdkstate.Installed, sdkstate.Unhealthy:
			if _, err := m.transition(record.ID, sdkstate.Registered, ""); err != nil {
				return err
			}
		case sdkstate.ActivationPending, sdkstate.Active:
			if _, err := m.Activate(ctx, record.ID); err != nil {
				return err
			}
		}
	}
	return nil
}

func (m *Manager) transition(id string, next sdkstate.State, lastError string) (Record, error) {
	record, err := m.require(id)
	if err != nil {
		return Record{}, err
	}
	record.State = next
	record.LastError = lastError
	record.UpdatedAt = time.Now()
	if err := m.store.Save(record); err != nil {
		return Record{}, err
	}
	return record, nil
}

func (m *Manager) require(id string) (Record, error) {
	record, ok, err := m.store.Get(id)
	if err != nil {
		return Record{}, err
	}
	if !ok {
		return Record{}, ErrPluginNotFound
	}
	return record, nil
}

func (m *Manager) requireActiveRuntime(id string) (Record, runtime.Runtime, error) {
	record, err := m.require(id)
	if err != nil {
		return Record{}, nil, err
	}
	if record.State != sdkstate.Active {
		return Record{}, nil, fmt.Errorf("plugin %q is not active", id)
	}

	rt, ok := m.runtimes[record.Manifest.RuntimeType]
	if !ok {
		return Record{}, nil, fmt.Errorf("runtime %q is not registered", record.Manifest.RuntimeType)
	}
	return record, rt, nil
}

func toInstance(record Record) runtime.Instance {
	return runtime.Instance{
		ID:          record.ID,
		Manifest:    record.Manifest,
		InstallPath: record.InstallPath,
	}
}

func shouldCheckInstallPath(record Record) bool {
	return sdkstate.IsInstalled(record.State)
}

func installPathExists(installPath string) bool {
	installPath = strings.TrimSpace(installPath)
	if installPath == "" {
		return false
	}
	_, err := os.Stat(installPath)
	return err == nil
}
