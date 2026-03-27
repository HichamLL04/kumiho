package handler

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	pluginruntime "github.com/aha-hyeong/kumiho/backend/internal/plugin/runtime"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	pluginerrors "github.com/kumiho-plugin/kumiho-plugin-sdk/errors"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdkstate "github.com/kumiho-plugin/kumiho-plugin-sdk/state"
)

type PluginHandler struct {
	manager        *pluginengine.Manager
	installService *service.PluginInstallService
	secretService  *service.PluginSecretService
	updateCache    *service.PluginUpdateSummary
	updateChecked  time.Time
	updateMutex    sync.RWMutex
	manualChecks   map[string]int
	manualMutex    sync.Mutex
}

type RegisterPluginRequest struct {
	Manifest    sdkmanifest.Manifest `json:"manifest"`
	InstallPath string               `json:"install_path"`
}

type pluginRecordResponse struct {
	ID          string               `json:"id"`
	Manifest    sdkmanifest.Manifest `json:"manifest"`
	State       string               `json:"state"`
	InstallPath string               `json:"install_path,omitempty"`
	LastError   string               `json:"last_error,omitempty"`
	CreatedAt   string               `json:"created_at"`
	UpdatedAt   string               `json:"updated_at"`
}

type updatePluginConfigRequest struct {
	Field string `json:"field"`
	Value string `json:"value"`
}

func NewPluginHandler(manager *pluginengine.Manager, installService *service.PluginInstallService, secretService *service.PluginSecretService) *PluginHandler {
	return &PluginHandler{
		manager:        manager,
		installService: installService,
		secretService:  secretService,
		manualChecks:   make(map[string]int),
	}
}

const pluginUpdateCacheTTL = 12 * time.Hour

func (h *PluginHandler) invalidateUpdateCache() {
	h.updateMutex.Lock()
	defer h.updateMutex.Unlock()
	h.updateCache = nil
	h.updateChecked = time.Time{}
}

// List plugins
// GET /api/v1/plugins
func (h *PluginHandler) List(c *fiber.Ctx) error {
	records, err := h.manager.List()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	includePath := middleware.GetUserRole(c) == model.RoleMaster
	items := make([]pluginRecordResponse, 0, len(records))
	for _, record := range records {
		items = append(items, toPluginRecordResponse(record, includePath))
	}

	return c.JSON(fiber.Map{
		"plugins": items,
	})
}

// Get plugin details
// GET /api/v1/plugins/:id
func (h *PluginHandler) Get(c *fiber.Ctx) error {
	record, ok, err := h.manager.Get(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "plugin not found"})
	}

	return c.JSON(toPluginRecordResponse(record, middleware.GetUserRole(c) == model.RoleMaster))
}

// RegisterInstalled registers a plugin that is already present on disk.
// POST /api/v1/plugins/register-installed
func (h *PluginHandler) RegisterInstalled(c *fiber.Ctx) error {
	var req RegisterPluginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	if req.Manifest.ID == "" || req.Manifest.Name == "" || req.Manifest.RuntimeType == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "manifest.id, manifest.name, and manifest.runtime_type are required"})
	}
	if req.Manifest.RuntimeType == sdkmanifest.RuntimeTypeBinary {
		if strings.TrimSpace(req.InstallPath) == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "install_path is required for binary runtime"})
		}
		if !filepath.IsAbs(req.InstallPath) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "install_path must be an absolute path for binary runtime"})
		}
	}

	record, err := h.manager.RegisterInstalled(req.Manifest, req.InstallPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	record, err = h.manager.MarkRegistered(record.ID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	h.invalidateUpdateCache()

	return c.Status(fiber.StatusCreated).JSON(toPluginRecordResponse(record, true))
}

// Activate starts the plugin runtime.
// POST /api/v1/plugins/:id/activate
func (h *PluginHandler) Activate(c *fiber.Ctx) error {
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}

	record, err := h.manager.Activate(ctx, c.Params("id"))
	if err != nil {
		return writePluginError(c, err)
	}

	return c.JSON(toPluginRecordResponse(record, true))
}

// Deactivate stops the plugin runtime.
// POST /api/v1/plugins/:id/deactivate
func (h *PluginHandler) Deactivate(c *fiber.Ctx) error {
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}

	record, err := h.manager.Deactivate(ctx, c.Params("id"))
	if err != nil {
		return writePluginError(c, err)
	}

	return c.JSON(toPluginRecordResponse(record, true))
}

// Healthcheck checks current plugin health.
// GET /api/v1/plugins/:id/health
func (h *PluginHandler) Healthcheck(c *fiber.Ctx) error {
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}

	resp, err := h.manager.Healthcheck(ctx, c.Params("id"))
	if err != nil {
		return writePluginError(c, err)
	}

	return c.JSON(resp)
}

// Catalog lists installable plugins from the registry.
// GET /api/v1/plugins/catalog
func (h *PluginHandler) Catalog(c *fiber.Ctx) error {
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}

	if h.installService == nil {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{"error": "plugin install service is not configured"})
	}

	catalog, err := h.installService.ListCatalog(ctx)
	if err != nil {
		return writePluginError(c, err)
	}
	return c.JSON(catalog)
}

// Updates returns installed plugin update availability from the registry.
// GET /api/v1/plugins/updates
func (h *PluginHandler) Updates(c *fiber.Ctx) error {
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}

	if h.installService == nil {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{"error": "plugin install service is not configured"})
	}

	force := c.Query("force") == "true"
	if force {
		today := time.Now().Format("2006-01-02")
		h.manualMutex.Lock()
		if h.manualChecks[today] >= 10 {
			h.manualMutex.Unlock()
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error": "오늘의 수동 업데이트 확인 횟수(10회)를 초과했습니다.",
			})
		}
		h.manualChecks[today]++
		h.manualMutex.Unlock()
	}

	h.updateMutex.RLock()
	if !force && h.updateCache != nil && time.Since(h.updateChecked) < pluginUpdateCacheTTL {
		cached := *h.updateCache
		h.updateMutex.RUnlock()
		return c.JSON(cached)
	}
	h.updateMutex.RUnlock()

	summary, err := h.installService.CheckUpdates(ctx)
	if err != nil {
		h.updateMutex.RLock()
		if h.updateCache != nil {
			cached := *h.updateCache
			h.updateMutex.RUnlock()
			return c.JSON(cached)
		}
		h.updateMutex.RUnlock()
		return writePluginError(c, err)
	}

	h.updateMutex.Lock()
	h.updateCache = summary
	h.updateChecked = time.Now()
	h.updateMutex.Unlock()

	return c.JSON(summary)
}

// Install downloads, verifies, and registers a plugin from the registry.
// POST /api/v1/plugins/install
func (h *PluginHandler) Install(c *fiber.Ctx) error {
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}
	if h.installService == nil {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{"error": "plugin install service is not configured"})
	}

	var req service.InstallPluginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	if strings.TrimSpace(req.PluginID) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "plugin_id is required"})
	}

	result, err := h.installService.Install(ctx, req.PluginID)
	if err != nil {
		return writePluginError(c, err)
	}
	h.invalidateUpdateCache()

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"record":           toPluginRecordResponse(result.Record, true),
		"artifact_url":     result.ArtifactURL,
		"install_path":     result.InstallPath,
		"restart_required": result.RestartRequired,
	})
}

// Uninstall removes a plugin installation and its persisted record.
// DELETE /api/v1/plugins/:id
func (h *PluginHandler) Uninstall(c *fiber.Ctx) error {
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}
	if h.installService == nil {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{"error": "plugin install service is not configured"})
	}

	result, err := h.installService.Uninstall(ctx, c.Params("id"))
	if err != nil {
		return writePluginError(c, err)
	}
	h.invalidateUpdateCache()

	return c.JSON(result)
}

// GetConfig returns safe plugin configuration status without exposing secrets.
// GET /api/v1/plugins/:id/config
func (h *PluginHandler) GetConfig(c *fiber.Ctx) error {
	if h.secretService == nil {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{"error": "plugin secret service is not configured"})
	}

	status, err := h.secretService.Status(c.Params("id"))
	if err != nil {
		return writePluginError(c, err)
	}
	return c.JSON(status)
}

// UpdateConfig stores an encrypted plugin secret and leaves the plugin disabled
// until the next activation so the new env takes effect on process start.
// PUT /api/v1/plugins/:id/config
func (h *PluginHandler) UpdateConfig(c *fiber.Ctx) error {
	if h.secretService == nil {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{"error": "plugin secret service is not configured"})
	}

	var req updatePluginConfigRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	if strings.TrimSpace(req.Field) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "field is required"})
	}

	status, err := h.secretService.SetSecret(c.Params("id"), req.Field, req.Value)
	if err != nil {
		return writePluginError(c, err)
	}

	record, ok, err := h.manager.Get(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	reactivationRequired := false
	if ok && record.State == sdkstate.Active {
		ctx := c.UserContext()
		if ctx == nil {
			ctx = context.Background()
		}
		if _, err := h.manager.Deactivate(ctx, record.ID); err != nil {
			return writePluginError(c, err)
		}
		reactivationRequired = true
	}

	return c.JSON(fiber.Map{
		"config":                status,
		"reactivation_required": reactivationRequired,
		"message":               "config saved; activate the plugin again to apply it",
	})
}

// DeleteConfig removes a stored plugin secret. Environment variable fallback may still apply.
// DELETE /api/v1/plugins/:id/config/:field
func (h *PluginHandler) DeleteConfig(c *fiber.Ctx) error {
	if h.secretService == nil {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{"error": "plugin secret service is not configured"})
	}

	status, err := h.secretService.DeleteSecret(c.Params("id"), c.Params("field"))
	if err != nil {
		return writePluginError(c, err)
	}
	return c.JSON(fiber.Map{"config": status})
}

func toPluginRecordResponse(record pluginengine.Record, includePath bool) pluginRecordResponse {
	resp := pluginRecordResponse{
		ID:        record.ID,
		Manifest:  record.Manifest,
		State:     string(record.State),
		LastError: record.LastError,
		CreatedAt: record.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt: record.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
	if includePath {
		resp.InstallPath = record.InstallPath
	}
	return resp
}

func writePluginError(c *fiber.Ctx, err error) error {
	switch {
	case errors.Is(err, pluginengine.ErrPluginNotFound):
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	case errors.Is(err, pluginruntime.ErrNotRunning):
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": err.Error()})
	default:
		var pluginErr *pluginerrors.PluginError
		if errors.As(err, &pluginErr) {
			status := fiber.StatusBadRequest
			switch pluginErr.Code {
			case pluginerrors.ErrCodeArtifactNotFound:
				status = fiber.StatusNotFound
			case pluginerrors.ErrCodeChecksumMismatch, pluginerrors.ErrCodeIncompatibleVersion:
				status = fiber.StatusConflict
			}
			return c.Status(status).JSON(fiber.Map{"error": pluginErr.Message, "code": pluginErr.Code})
		}
		switch {
		case errors.Is(err, service.ErrPluginRegistryNotConfigured):
			return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{"error": err.Error()})
		case errors.Is(err, service.ErrPluginCatalogEntryNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
}
