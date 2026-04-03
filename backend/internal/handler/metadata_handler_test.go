package handler

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"

	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	pluginerrors "github.com/kumiho-plugin/kumiho-plugin-sdk/errors"
)

func TestWriteMetadataErrorReturnsNotFoundForMissingPlugin(t *testing.T) {
	app := fiber.New()
	app.Get("/metadata-error", func(c *fiber.Ctx) error {
		return writeMetadataError(c, pluginengine.ErrPluginNotFound)
	})

	req := httptest.NewRequest(fiber.MethodGet, "/metadata-error", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	if resp.StatusCode != fiber.StatusNotFound {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusNotFound)
	}

	var payload map[string]string
	if decodeErr := json.NewDecoder(resp.Body).Decode(&payload); decodeErr != nil {
		t.Fatalf("Decode() error = %v", decodeErr)
	}
	if payload["error"] != pluginengine.ErrPluginNotFound.Error() {
		t.Fatalf("error = %q, want %q", payload["error"], pluginengine.ErrPluginNotFound.Error())
	}
}

func TestWriteMetadataErrorMapsRateLimitAndTimeout(t *testing.T) {
	app := fiber.New()
	app.Get("/rate-limited", func(c *fiber.Ctx) error {
		return writeMetadataError(c, pluginerrors.New(pluginerrors.ErrCodeRateLimited, "too many requests"))
	})
	app.Get("/timeout", func(c *fiber.Ctx) error {
		return writeMetadataError(c, pluginerrors.New(pluginerrors.ErrCodeTimeout, "plugin timed out"))
	})

	req := httptest.NewRequest(fiber.MethodGet, "/rate-limited", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("rate-limited app.Test() error = %v", err)
	}
	if resp.StatusCode != fiber.StatusTooManyRequests {
		t.Fatalf("rate-limited status = %d, want %d", resp.StatusCode, fiber.StatusTooManyRequests)
	}

	req = httptest.NewRequest(fiber.MethodGet, "/timeout", nil)
	resp, err = app.Test(req)
	if err != nil {
		t.Fatalf("timeout app.Test() error = %v", err)
	}
	if resp.StatusCode != fiber.StatusGatewayTimeout {
		t.Fatalf("timeout status = %d, want %d", resp.StatusCode, fiber.StatusGatewayTimeout)
	}
}
