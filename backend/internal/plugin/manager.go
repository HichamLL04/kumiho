package plugin

import (
	"context"
	"fmt"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/plugin/runtime"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/healthcheck"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdkstate "github.com/kumiho-plugin/kumiho-plugin-sdk/state"
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
		return m.MarkError(id, fmt.Sprintf("runtime %q is not registered", record.Manifest.RuntimeType))
	}

	record.State = sdkstate.ActivationPending
	record.LastError = ""
	record.UpdatedAt = time.Now()
	if err := m.store.Save(record); err != nil {
		return Record{}, err
	}

	if err := rt.Start(ctx, toInstance(record)); err != nil {
		return m.MarkError(id, err.Error())
	}

	record.State = sdkstate.Active
	record.UpdatedAt = time.Now()
	if err := m.store.Save(record); err != nil {
		return Record{}, err
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
		return m.MarkError(id, err.Error())
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

func (m *Manager) Get(id string) (Record, bool, error) {
	return m.store.Get(id)
}

func (m *Manager) List() ([]Record, error) {
	return m.store.List()
}

// Bootstrap reconciles persisted plugin states on process startup.
// Phase 1 does not support hot registration, so previously running plugins are
// restored to the registered state and must be activated explicitly.
func (m *Manager) Bootstrap() error {
	records, err := m.store.List()
	if err != nil {
		return err
	}
	for _, record := range records {
		switch record.State {
		case sdkstate.Installed, sdkstate.ActivationPending, sdkstate.Active, sdkstate.Unhealthy:
			if _, err := m.transition(record.ID, sdkstate.Registered, ""); err != nil {
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

func toInstance(record Record) runtime.Instance {
	return runtime.Instance{
		ID:          record.ID,
		Manifest:    record.Manifest,
		InstallPath: record.InstallPath,
	}
}
