package handler

import (
	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
)

type DangoIntegrationHandler struct {
	service *service.DangoReadingService
}

func NewDangoIntegrationHandler(service *service.DangoReadingService) *DangoIntegrationHandler {
	return &DangoIntegrationHandler{service: service}
}

func (h *DangoIntegrationHandler) Get(c *fiber.Ctx) error {
	status, err := h.service.Status(middleware.GetUserID(c))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to load Dango integration"})
	}
	return c.JSON(status)
}

func (h *DangoIntegrationHandler) Save(c *fiber.Ctx) error {
	var body struct {
		Endpoint string `json:"endpoint"`
		APIKey   string `json:"api_key"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	if err := h.service.Save(middleware.GetUserID(c), body.Endpoint, body.APIKey); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return h.Get(c)
}

func (h *DangoIntegrationHandler) Revoke(c *fiber.Ctx) error {
	if err := h.service.Revoke(middleware.GetUserID(c)); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to revoke Dango integration"})
	}
	return c.JSON(fiber.Map{"status": "revoked"})
}
