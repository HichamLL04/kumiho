package handler

import (
	"errors"

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

func (h *TranslationHandler) BatchTranslate(c *fiber.Ctx) error {
	ctx := c.UserContext()

	var req translateRequest
	if len(c.Body()) > 0 {
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "요청 형식이 올바르지 않습니다."})
		}
	}

	result, err := h.translationSvc.BatchTranslate(ctx, req.TargetLang)
	if err != nil {
		if errors.Is(err, service.ErrNoActiveTranslationPlugin) {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "활성화된 번역 플러그인이 없습니다."})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(result)
}

func (h *TranslationHandler) TranslateSeriesDescription(c *fiber.Ctx) error {
	ctx := c.UserContext()

	var req translateRequest
	if len(c.Body()) > 0 {
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "요청 형식이 올바르지 않습니다."})
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
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "활성화된 번역 플러그인이 없습니다."})
		case errors.Is(err, service.ErrSeriesNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "시리즈를 찾을 수 없습니다."})
		case errors.Is(err, service.ErrTranslationSourceEmpty):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "번역할 줄거리가 없습니다."})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
	}

	return c.JSON(result)
}
