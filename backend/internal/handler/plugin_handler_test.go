package handler

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/model"
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	pluginruntime "github.com/aha-hyeong/kumiho/backend/internal/plugin/runtime"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/healthcheck"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

func newPluginTestApp(role model.Role, manager *pluginengine.Manager) *fiber.App {
	app := fiber.New()
	handler := NewPluginHandler(manager, nil, nil)

	app.Use(func(c *fiber.Ctx) error {
		c.Locals("role", role)
		return c.Next()
	})

	app.Get("/plugins", handler.List)
	app.Get("/plugins/:id", handler.Get)
	app.Get("/plugins/:id/health", handler.Healthcheck)

	return app
}

func TestPluginListHidesInstallPathForNonMaster(t *testing.T) {
	manager := pluginengine.NewManager(pluginengine.NewMemoryStore(), &pluginHandlerRuntime{runtimeType: sdkmanifest.RuntimeTypeBinary})
	record, err := manager.RegisterInstalled(sdkmanifest.Manifest{
		ID:          "plugin-a",
		Name:        "Plugin A",
		Version:     "0.1.0",
		RuntimeType: sdkmanifest.RuntimeTypeBinary,
	}, "/plugins/plugin-a")
	if err != nil {
		t.Fatalf("RegisterInstalled() error = %v", err)
	}
	_, markErr := manager.MarkRegistered(record.ID)
	if markErr != nil {
		t.Fatalf("MarkRegistered() error = %v", markErr)
	}

	app := newPluginTestApp(model.RoleUser, manager)
	req := httptest.NewRequest("GET", "/plugins", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}

	var body struct {
		Plugins []map[string]any `json:"plugins"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("json decode error = %v", err)
	}
	if len(body.Plugins) != 1 {
		t.Fatalf("plugins len = %d, want 1", len(body.Plugins))
	}
	if _, ok := body.Plugins[0]["install_path"]; ok {
		t.Fatal("install_path should be hidden for non-master")
	}
}

func TestPluginGetReturnsNotFound(t *testing.T) {
	manager := pluginengine.NewManager(pluginengine.NewMemoryStore(), &pluginHandlerRuntime{runtimeType: sdkmanifest.RuntimeTypeBinary})
	app := newPluginTestApp(model.RoleMaster, manager)

	req := httptest.NewRequest("GET", "/plugins/missing", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	if resp.StatusCode != fiber.StatusNotFound {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusNotFound)
	}
}

func TestPluginHealthcheckMapsNotRunningToConflict(t *testing.T) {
	manager := pluginengine.NewManager(pluginengine.NewMemoryStore(), &pluginHandlerRuntime{
		runtimeType: sdkmanifest.RuntimeTypeBinary,
		healthErr:   pluginruntime.ErrNotRunning,
	})
	record, err := manager.RegisterInstalled(sdkmanifest.Manifest{
		ID:          "plugin-a",
		Name:        "Plugin A",
		Version:     "0.1.0",
		RuntimeType: sdkmanifest.RuntimeTypeBinary,
	}, "/plugins/plugin-a")
	if err != nil {
		t.Fatalf("RegisterInstalled() error = %v", err)
	}
	_, markErr := manager.MarkRegistered(record.ID)
	if markErr != nil {
		t.Fatalf("MarkRegistered() error = %v", markErr)
	}

	app := newPluginTestApp(model.RoleMaster, manager)
	req := httptest.NewRequest("GET", "/plugins/plugin-a/health", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	if resp.StatusCode != fiber.StatusConflict {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusConflict)
	}
}

type pluginHandlerRuntime struct {
	runtimeType sdkmanifest.RuntimeType
	healthErr   error
}

func (r *pluginHandlerRuntime) Type() sdkmanifest.RuntimeType {
	return r.runtimeType
}

func (r *pluginHandlerRuntime) Start(context.Context, pluginruntime.Instance) error {
	return nil
}

func (r *pluginHandlerRuntime) Stop(context.Context, pluginruntime.Instance) error {
	return nil
}

func (r *pluginHandlerRuntime) Healthcheck(context.Context, pluginruntime.Instance) (*healthcheck.Response, error) {
	if r.healthErr != nil {
		return nil, r.healthErr
	}
	return &healthcheck.Response{Status: healthcheck.StatusOK}, nil
}

func (r *pluginHandlerRuntime) Search(context.Context, pluginruntime.Instance, *sdktypes.SearchRequest) (*sdktypes.SearchResponse, error) {
	return nil, pluginruntime.ErrNotImplemented
}

func (r *pluginHandlerRuntime) Fetch(context.Context, pluginruntime.Instance, *sdktypes.FetchRequest) (*sdktypes.FetchResponse, error) {
	return nil, pluginruntime.ErrNotImplemented
}
