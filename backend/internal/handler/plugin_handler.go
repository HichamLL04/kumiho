package handler

import (
	"context"
	"errors"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	pluginruntime "github.com/aha-hyeong/kumiho/backend/internal/plugin/runtime"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
)

type PluginHandler struct {
	manager *pluginengine.Manager
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

func NewPluginHandler(manager *pluginengine.Manager) *PluginHandler {
	return &PluginHandler{manager: manager}
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
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
}
