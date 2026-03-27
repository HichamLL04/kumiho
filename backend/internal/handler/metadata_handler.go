package handler

import (
	"context"
	"errors"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	pluginerrors "github.com/kumiho-plugin/kumiho-plugin-sdk/errors"
	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

type MetadataHandler struct {
	metadataSvc *service.MetadataService
}

type metadataApplyRequest struct {
	Result *sdktypes.MetadataResult `json:"result"`
}

func NewMetadataHandler(metadataSvc *service.MetadataService) *MetadataHandler {
	return &MetadataHandler{metadataSvc: metadataSvc}
}

func (h *MetadataHandler) Search(c *fiber.Ctx) error {
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}

	result, err := h.metadataSvc.SearchSeries(ctx, c.Params("id"), middleware.GetUserID(c))
	if err != nil {
		return writeMetadataError(c, err)
	}
	return c.JSON(result)
}

func (h *MetadataHandler) Fetch(c *fiber.Ctx) error {
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}

	var req service.MetadataFetchSelection
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	result, err := h.metadataSvc.FetchSeriesMetadata(ctx, c.Params("id"), middleware.GetUserID(c), req)
	if err != nil {
		return writeMetadataError(c, err)
	}
	return c.JSON(result)
}

func (h *MetadataHandler) Apply(c *fiber.Ctx) error {
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}

	var req metadataApplyRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	result, err := h.metadataSvc.ApplySeriesMetadata(ctx, c.Params("id"), middleware.GetUserID(c), req.Result)
	if err != nil {
		return writeMetadataError(c, err)
	}
	return c.JSON(result)
}

func writeMetadataError(c *fiber.Ctx, err error) error {
	switch {
	case errors.Is(err, service.ErrSeriesNotFound):
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	case errors.Is(err, service.ErrNoActiveMetadataPlugin):
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": err.Error()})
	}

	var pluginErr *pluginerrors.PluginError
	if errors.As(err, &pluginErr) {
		status := fiber.StatusBadGateway
		switch pluginErr.Code {
		case pluginerrors.ErrCodeInvalidRequest:
			status = fiber.StatusBadRequest
		case pluginerrors.ErrCodeNotFound:
			status = fiber.StatusNotFound
		case pluginerrors.ErrCodeUnauthorized:
			status = fiber.StatusUnauthorized
		case pluginerrors.ErrCodeTimeout, pluginerrors.ErrCodeRateLimited:
			status = fiber.StatusBadGateway
		}
		return c.Status(status).JSON(fiber.Map{"error": pluginErr.Message, "code": pluginErr.Code})
	}

	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
}
