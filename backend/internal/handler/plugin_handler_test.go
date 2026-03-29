package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	pluginruntime "github.com/aha-hyeong/kumiho/backend/internal/plugin/runtime"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/healthcheck"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdkstate "github.com/kumiho-plugin/kumiho-plugin-sdk/state"
	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

func TestUpdateConfigReactivatesPluginWhenSecretMutationFails(t *testing.T) {
	store := pluginengine.NewMemoryStore()
	now := time.Now()
	record := pluginengine.Record{
		ID: "kumiho-plugin-metadata-googlebooks",
		Manifest: sdkmanifest.Manifest{
			ID:          "kumiho-plugin-metadata-googlebooks",
			Name:        "Google Books",
			RuntimeType: sdkmanifest.RuntimeTypeBinary,
		},
		State:     sdkstate.Active,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := store.Save(record); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	rt := &handlerTestRuntime{runtimeType: sdkmanifest.RuntimeTypeBinary}
	manager := pluginengine.NewManager(store, rt)

	repo := &handlerTestSecretRepo{
		items: map[string]model.PluginSecret{},
	}
	secretSvc := service.NewPluginSecretService(&config.Config{JWTSecret: "test-secret"}, repo)
	manager.SetEnvProvider(secretSvc)
	if _, err := secretSvc.SetSecret("kumiho-plugin-metadata-googlebooks", "api_key", "existing-key"); err != nil {
		t.Fatalf("SetSecret() error = %v", err)
	}
	repo.upsertErr = errors.New("upsert failed")

	handler := NewPluginHandler(manager, nil, secretSvc)
	app := fiber.New()
	app.Put("/plugins/:id/config", handler.UpdateConfig)

	body, _ := json.Marshal(map[string]string{
		"field": "api_key",
		"value": "next-key",
	})
	req := httptest.NewRequest(fiber.MethodPut, "/plugins/kumiho-plugin-metadata-googlebooks/config", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}

	updated, ok, err := manager.Get("kumiho-plugin-metadata-googlebooks")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !ok {
		t.Fatal("Get() ok = false")
	}
	if updated.State != sdkstate.Active {
		t.Fatalf("state = %q, want %q", updated.State, sdkstate.Active)
	}
	if rt.stopCalls != 1 {
		t.Fatalf("stopCalls = %d, want 1", rt.stopCalls)
	}
	if rt.startCalls != 1 {
		t.Fatalf("startCalls = %d, want 1", rt.startCalls)
	}
}

func TestDeleteConfigReturnsReactivationRequiredForActivePlugin(t *testing.T) {
	store := pluginengine.NewMemoryStore()
	now := time.Now()
	record := pluginengine.Record{
		ID: "kumiho-plugin-metadata-googlebooks",
		Manifest: sdkmanifest.Manifest{
			ID:          "kumiho-plugin-metadata-googlebooks",
			Name:        "Google Books",
			RuntimeType: sdkmanifest.RuntimeTypeBinary,
		},
		State:     sdkstate.Active,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := store.Save(record); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	rt := &handlerTestRuntime{runtimeType: sdkmanifest.RuntimeTypeBinary}
	manager := pluginengine.NewManager(store, rt)

	repo := &handlerTestSecretRepo{
		items: map[string]model.PluginSecret{},
	}
	secretSvc := service.NewPluginSecretService(&config.Config{JWTSecret: "test-secret"}, repo)
	manager.SetEnvProvider(secretSvc)
	if _, err := secretSvc.SetSecret("kumiho-plugin-metadata-googlebooks", "api_key", "existing-key"); err != nil {
		t.Fatalf("SetSecret() error = %v", err)
	}

	handler := NewPluginHandler(manager, nil, secretSvc)
	app := fiber.New()
	app.Delete("/plugins/:id/config/:field", handler.DeleteConfig)

	req := httptest.NewRequest(fiber.MethodDelete, "/plugins/kumiho-plugin-metadata-googlebooks/config/api_key", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}

	var payload struct {
		Config               service.PluginConfigStatus `json:"config"`
		ReactivationRequired bool                       `json:"reactivation_required"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if !payload.ReactivationRequired {
		t.Fatal("reactivation_required = false, want true")
	}

	updated, ok, err := manager.Get("kumiho-plugin-metadata-googlebooks")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !ok {
		t.Fatal("Get() ok = false")
	}
	if updated.State != sdkstate.Disabled {
		t.Fatalf("state = %q, want %q", updated.State, sdkstate.Disabled)
	}
	if rt.stopCalls != 1 {
		t.Fatalf("stopCalls = %d, want 1", rt.stopCalls)
	}
}

type handlerTestRuntime struct {
	runtimeType sdkmanifest.RuntimeType
	startCalls  int
	stopCalls   int
	startErr    error
	stopErr     error
}

func (r *handlerTestRuntime) Type() sdkmanifest.RuntimeType { return r.runtimeType }

func (r *handlerTestRuntime) Start(context.Context, pluginruntime.Instance) error {
	r.startCalls++
	return r.startErr
}

func (r *handlerTestRuntime) Stop(context.Context, pluginruntime.Instance) error {
	r.stopCalls++
	return r.stopErr
}

func (r *handlerTestRuntime) Healthcheck(context.Context, pluginruntime.Instance) (*healthcheck.Response, error) {
	return &healthcheck.Response{Status: healthcheck.StatusOK}, nil
}

func (r *handlerTestRuntime) Search(context.Context, pluginruntime.Instance, *sdktypes.SearchRequest) (*sdktypes.SearchResponse, error) {
	return nil, nil
}

func (r *handlerTestRuntime) Fetch(context.Context, pluginruntime.Instance, *sdktypes.FetchRequest) (*sdktypes.FetchResponse, error) {
	return nil, nil
}

type handlerTestSecretRepo struct {
	items     map[string]model.PluginSecret
	upsertErr error
	deleteErr error
}

func (r *handlerTestSecretRepo) GetByKey(_ database.Queryer, pluginID, fieldKey string) (*model.PluginSecret, error) {
	item, ok := r.items[pluginID+":"+fieldKey]
	if !ok {
		return nil, nil
	}
	copy := item
	return &copy, nil
}

func (r *handlerTestSecretRepo) ListByPlugin(_ database.Queryer, pluginID string) ([]model.PluginSecret, error) {
	items := []model.PluginSecret{}
	for _, item := range r.items {
		if item.PluginID == pluginID {
			items = append(items, item)
		}
	}
	return items, nil
}

func (r *handlerTestSecretRepo) Upsert(_ database.Queryer, pluginID, fieldKey, valueEncrypted string) error {
	if r.upsertErr != nil {
		return r.upsertErr
	}
	r.items[pluginID+":"+fieldKey] = model.PluginSecret{
		PluginID:       pluginID,
		FieldKey:       fieldKey,
		ValueEncrypted: valueEncrypted,
		UpdatedAt:      time.Now(),
	}
	return nil
}

func (r *handlerTestSecretRepo) Delete(_ database.Queryer, pluginID, fieldKey string) error {
	if r.deleteErr != nil {
		return r.deleteErr
	}
	delete(r.items, pluginID+":"+fieldKey)
	return nil
}

func (r *handlerTestSecretRepo) DeleteByPlugin(_ database.Queryer, pluginID string) error {
	if r.deleteErr != nil {
		return r.deleteErr
	}
	for key, item := range r.items {
		if item.PluginID == pluginID {
			delete(r.items, key)
		}
	}
	return nil
}
