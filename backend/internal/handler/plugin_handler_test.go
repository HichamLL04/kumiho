package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
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
	sdkconfig "github.com/kumiho-plugin/kumiho-plugin-sdk/config"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/healthcheck"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdkstate "github.com/kumiho-plugin/kumiho-plugin-sdk/state"
	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

func TestPluginListMasksInstallPathForNonMaster(t *testing.T) {
	store := pluginengine.NewMemoryStore()
	now := time.Now()
	record := pluginengine.Record{
		ID:          "kumiho-plugin-metadata-kitsu",
		Manifest:    sdkmanifest.Manifest{ID: "kumiho-plugin-metadata-kitsu", Name: "Kitsu Manga", RuntimeType: sdkmanifest.RuntimeTypeBinary},
		State:       sdkstate.Registered,
		InstallPath: "/opt/kumiho/plugins/kitsu",
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := store.Save(record); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	handler := NewPluginHandler(pluginengine.NewManager(store), nil, nil)
	app := newPluginHandlerTestApp(model.RoleUser)
	app.Get("/plugins", handler.List)

	req := httptest.NewRequest(fiber.MethodGet, "/plugins", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Plugins []map[string]any `json:"plugins"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if len(payload.Plugins) != 1 {
		t.Fatalf("plugins len = %d, want 1", len(payload.Plugins))
	}
	if _, exists := payload.Plugins[0]["install_path"]; exists {
		t.Fatal("install_path should be masked for non-master")
	}
}

func TestPluginGetReturnsNotFound(t *testing.T) {
	handler := NewPluginHandler(pluginengine.NewManager(pluginengine.NewMemoryStore()), nil, nil)
	app := fiber.New()
	app.Get("/plugins/:id", handler.Get)

	req := httptest.NewRequest(fiber.MethodGet, "/plugins/missing-plugin", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
}

func TestPluginHealthcheckMapsNotRunningToConflict(t *testing.T) {
	store := pluginengine.NewMemoryStore()
	now := time.Now()
	record := pluginengine.Record{
		ID:        "kumiho-plugin-metadata-kitsu",
		Manifest:  sdkmanifest.Manifest{ID: "kumiho-plugin-metadata-kitsu", Name: "Kitsu Manga", RuntimeType: sdkmanifest.RuntimeTypeBinary},
		State:     sdkstate.Active,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := store.Save(record); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	rt := &handlerTestRuntime{
		runtimeType:    sdkmanifest.RuntimeTypeBinary,
		healthcheckErr: pluginruntime.ErrNotRunning,
	}
	handler := NewPluginHandler(pluginengine.NewManager(store, rt), nil, nil)
	app := fiber.New()
	app.Get("/plugins/:id/health", handler.Healthcheck)

	req := httptest.NewRequest(fiber.MethodGet, "/plugins/kumiho-plugin-metadata-kitsu/health", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusConflict)
	}
}

func TestUpdateConfigReactivatesPluginWhenSecretMutationFails(t *testing.T) {
	store := pluginengine.NewMemoryStore()
	now := time.Now()
	record := pluginengine.Record{
		ID: "kumiho-plugin-metadata-kitsu",
		Manifest: sdkmanifest.Manifest{
			ID:           "kumiho-plugin-metadata-kitsu",
			Name:         "Kitsu Manga",
			RuntimeType:  sdkmanifest.RuntimeTypeBinary,
			ConfigSchema: testKitsuConfigSchema(),
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
	secretSvc, secretSvcErr := service.NewPluginSecretService(&config.Config{JWTSecret: "test-secret", PluginSecretKey: "plugin-secret-key"}, repo)
	if secretSvcErr != nil {
		t.Fatalf("NewPluginSecretService() error = %v", secretSvcErr)
	}
	manager.SetEnvProvider(secretSvc)
	if _, setErr := secretSvc.SetSecret("kumiho-plugin-metadata-kitsu", record.Manifest, "access_token", "existing-token"); setErr != nil {
		t.Fatalf("SetSecret() error = %v", setErr)
	}
	repo.upsertErr = errors.New("upsert failed")

	handler := NewPluginHandler(manager, nil, secretSvc)
	app := fiber.New()
	app.Put("/plugins/:id/config", handler.UpdateConfig)

	body, _ := json.Marshal(map[string]string{
		"field": "access_token",
		"value": "next-token",
	})
	req := httptest.NewRequest(fiber.MethodPut, "/plugins/kumiho-plugin-metadata-kitsu/config", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}

	updated, ok, err := manager.Get("kumiho-plugin-metadata-kitsu")
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

func TestUpdateConfigReturnsPluginStateWhenRestoreFails(t *testing.T) {
	store := pluginengine.NewMemoryStore()
	now := time.Now()
	record := pluginengine.Record{
		ID: "kumiho-plugin-metadata-kitsu",
		Manifest: sdkmanifest.Manifest{
			ID:           "kumiho-plugin-metadata-kitsu",
			Name:         "Kitsu Manga",
			RuntimeType:  sdkmanifest.RuntimeTypeBinary,
			ConfigSchema: testKitsuConfigSchema(),
		},
		State:     sdkstate.Active,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := store.Save(record); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	rt := &handlerTestRuntime{
		runtimeType: sdkmanifest.RuntimeTypeBinary,
		startErr:    errors.New("reactivate failed"),
	}
	manager := pluginengine.NewManager(store, rt)

	repo := &handlerTestSecretRepo{
		items: map[string]model.PluginSecret{},
	}
	secretSvc := service.NewPluginSecretService(&config.Config{JWTSecret: "test-secret"}, repo)
	manager.SetEnvProvider(secretSvc)
	if _, err := secretSvc.SetSecret("kumiho-plugin-metadata-kitsu", record.Manifest, "access_token", "existing-token"); err != nil {
		t.Fatalf("SetSecret() error = %v", err)
	}
	repo.upsertErr = errors.New("upsert failed")

	handler := NewPluginHandler(manager, nil, secretSvc)
	app := fiber.New()
	app.Put("/plugins/:id/config", handler.UpdateConfig)

	body, _ := json.Marshal(map[string]string{
		"field": "access_token",
		"value": "next-token",
	})
	req := httptest.NewRequest(fiber.MethodPut, "/plugins/kumiho-plugin-metadata-kitsu/config", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}

	var payload map[string]any
	if decodeErr := json.NewDecoder(resp.Body).Decode(&payload); decodeErr != nil {
		t.Fatalf("Decode() error = %v", decodeErr)
	}
	if payload["plugin_state"] != string(sdkstate.Disabled) {
		t.Fatalf("plugin_state = %#v, want %q", payload["plugin_state"], sdkstate.Disabled)
	}
	if payload["reactivation_required"] != true {
		t.Fatalf("reactivation_required = %#v, want true", payload["reactivation_required"])
	}
	if payload["restore_failed"] != true {
		t.Fatalf("restore_failed = %#v, want true", payload["restore_failed"])
	}
}

func TestDeleteConfigReturnsReactivationRequiredForActivePlugin(t *testing.T) {
	store := pluginengine.NewMemoryStore()
	now := time.Now()
	record := pluginengine.Record{
		ID: "kumiho-plugin-metadata-kitsu",
		Manifest: sdkmanifest.Manifest{
			ID:           "kumiho-plugin-metadata-kitsu",
			Name:         "Kitsu Manga",
			RuntimeType:  sdkmanifest.RuntimeTypeBinary,
			ConfigSchema: testKitsuConfigSchema(),
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
	secretSvc, secretSvcErr := service.NewPluginSecretService(&config.Config{JWTSecret: "test-secret", PluginSecretKey: "plugin-secret-key"}, repo)
	if secretSvcErr != nil {
		t.Fatalf("NewPluginSecretService() error = %v", secretSvcErr)
	}
	manager.SetEnvProvider(secretSvc)
	if _, setErr := secretSvc.SetSecret("kumiho-plugin-metadata-kitsu", record.Manifest, "access_token", "existing-token"); setErr != nil {
		t.Fatalf("SetSecret() error = %v", setErr)
	}

	handler := NewPluginHandler(manager, nil, secretSvc)
	app := fiber.New()
	app.Delete("/plugins/:id/config/:field", handler.DeleteConfig)

	req := httptest.NewRequest(fiber.MethodDelete, "/plugins/kumiho-plugin-metadata-kitsu/config/access_token", nil)
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
	if decodeErr := json.NewDecoder(resp.Body).Decode(&payload); decodeErr != nil {
		t.Fatalf("Decode() error = %v", decodeErr)
	}
	if !payload.ReactivationRequired {
		t.Fatal("reactivation_required = false, want true")
	}

	updated, ok, err := manager.Get("kumiho-plugin-metadata-kitsu")
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
	healthcheckErr error
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
	if r.healthcheckErr != nil {
		return nil, r.healthcheckErr
	}
	return &healthcheck.Response{Status: healthcheck.StatusOK}, nil
}

func (r *handlerTestRuntime) Search(context.Context, pluginruntime.Instance, *sdktypes.SearchRequest) (*sdktypes.SearchResponse, error) {
	return nil, nil
}

func (r *handlerTestRuntime) Fetch(context.Context, pluginruntime.Instance, *sdktypes.FetchRequest) (*sdktypes.FetchResponse, error) {
	return nil, nil
}

func testKitsuConfigSchema() *sdkconfig.Schema {
	return &sdkconfig.Schema{
		Version: "1",
		Fields: []sdkconfig.ConfigField{
			{Key: "access_token", Type: sdkconfig.FieldTypeSecret, Label: "Access Token", EnvKey: "KITSU_ACCESS_TOKEN"},
			{Key: "refresh_token", Type: sdkconfig.FieldTypeSecret, Label: "Refresh Token", EnvKey: "KITSU_REFRESH_TOKEN"},
		},
	}
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

func newPluginHandlerTestApp(role model.Role) *fiber.App {
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("role", role)
		return c.Next()
	})
	return app
}
