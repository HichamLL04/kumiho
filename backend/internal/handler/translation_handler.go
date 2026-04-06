package handler

import (
	"errors"
	"log"

	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/service"
)

type TranslationHandler struct {
	translationSvc *service.TranslationService
}

func NewTranslationHandler(translationSvc *service.TranslationService) *TranslationHandler {
	return &TranslationHandler{translationSvc: translationSvc}
}

type translateRequest struct {
	TargetLang string `json:"target_lang"`
}

const (
	errInvalidTranslateRequest      = "invalid request body"
	errNoActiveTranslationPluginMsg = "no active translation plugin"
	errSeriesNotFoundMsg            = "series not found"
	errTranslationSourceEmptyMsg    = "translation source text is empty"
	errBatchTranslateFailedMsg      = "failed to process batch translation"
	errSeriesTranslateFailedMsg     = "failed to translate series description"
)

func (h *TranslationHandler) BatchTranslate(c *fiber.Ctx) error {
	ctx := c.UserContext()

	var req translateRequest
	if len(c.Body()) > 0 {
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": errInvalidTranslateRequest})
		}
	}

	result, err := h.translationSvc.BatchTranslate(ctx, req.TargetLang)
	if err != nil {
		if errors.Is(err, service.ErrNoActiveTranslationPlugin) {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": errNoActiveTranslationPluginMsg})
		}
		log.Printf("Failed to process batch translation: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": errBatchTranslateFailedMsg})
	}

	return c.JSON(result)
}

func (h *TranslationHandler) TranslateSeriesDescription(c *fiber.Ctx) error {
	ctx := c.UserContext()

	var req translateRequest
	if len(c.Body()) > 0 {
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": errInvalidTranslateRequest})
		}
	}

	result, err := h.translationSvc.TranslateSeriesDescription(
		ctx,
		c.Params("id"),
		middleware.GetUserID(c),
		req.TargetLang,
	)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrNoActiveTranslationPlugin):
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": errNoActiveTranslationPluginMsg})
		case errors.Is(err, service.ErrSeriesNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": errSeriesNotFoundMsg})
		case errors.Is(err, service.ErrTranslationSourceEmpty):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": errTranslationSourceEmptyMsg})
		default:
			log.Printf("Failed to translate series %s description: %v", c.Params("id"), err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": errSeriesTranslateFailedMsg})
		}
	}

	return c.JSON(result)
}
