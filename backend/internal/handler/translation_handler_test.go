package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
)

func TestTranslationHandlerBatchTranslateReturnsBadRequestForInvalidBody(t *testing.T) {
	handler := NewTranslationHandler(nil)
	app := fiber.New()
	app.Post("/translations/batch", handler.BatchTranslate)

	req := httptest.NewRequest(fiber.MethodPost, "/translations/batch", bytes.NewBufferString("{"))
	req.Header.Set("Content-Type", fiber.MIMEApplicationJSON)

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
	}
	assertErrorPayload(t, resp, errInvalidTranslateRequest)
}

func TestTranslationHandlerBatchTranslateReturnsServiceUnavailableWithoutPlugin(t *testing.T) {
	connectTranslationHandlerTestDB(t)

	handler := NewTranslationHandler(service.NewTranslationService(
		pluginengine.NewManager(pluginengine.NewMemoryStore()),
		repository.NewSeriesRepository(),
		repository.NewSettingRepository(),
	))
	app := fiber.New()
	app.Post("/translations/batch", handler.BatchTranslate)

	req := httptest.NewRequest(fiber.MethodPost, "/translations/batch", bytes.NewBufferString(`{"target_lang":"ko"}`))
	req.Header.Set("Content-Type", fiber.MIMEApplicationJSON)

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	if resp.StatusCode != fiber.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusServiceUnavailable)
	}
	assertErrorPayload(t, resp, errNoActiveTranslationPluginMsg)
}

func TestTranslationHandlerTranslateSeriesDescriptionMapsSeriesErrors(t *testing.T) {
	connectTranslationHandlerTestDB(t)

	seriesRepo := repository.NewSeriesRepository()
	series := seedTranslationHandlerSeries(t, seriesRepo, "")
	handler := NewTranslationHandler(service.NewTranslationService(
		pluginengine.NewManager(pluginengine.NewMemoryStore()),
		seriesRepo,
		repository.NewSettingRepository(),
	))

	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("userID", "user-1")
		return c.Next()
	})
	app.Post("/series/:id/translate-description", handler.TranslateSeriesDescription)

	t.Run("series not found", func(t *testing.T) {
		req := httptest.NewRequest(fiber.MethodPost, "/series/missing/translate-description", bytes.NewBufferString(`{"target_lang":"ko"}`))
		req.Header.Set("Content-Type", fiber.MIMEApplicationJSON)

		resp, err := app.Test(req)
		if err != nil {
			t.Fatalf("app.Test() error = %v", err)
		}
		if resp.StatusCode != fiber.StatusNotFound {
			t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusNotFound)
		}
		assertErrorPayload(t, resp, errSeriesNotFoundMsg)
	})

	t.Run("translation source empty", func(t *testing.T) {
		req := httptest.NewRequest(fiber.MethodPost, "/series/"+series.ID+"/translate-description", bytes.NewBufferString(`{"target_lang":"ko"}`))
		req.Header.Set("Content-Type", fiber.MIMEApplicationJSON)

		resp, err := app.Test(req)
		if err != nil {
			t.Fatalf("app.Test() error = %v", err)
		}
		if resp.StatusCode != fiber.StatusBadRequest {
			t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
		}
		assertErrorPayload(t, resp, errTranslationSourceEmptyMsg)
	})
}

func connectTranslationHandlerTestDB(t *testing.T) {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "kumiho.db")
	if err := database.Connect(dbPath); err != nil {
		t.Fatalf("database.Connect() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Fatalf("database.Close() error = %v", err)
		}
		database.DB = nil
	})
}

func seedTranslationHandlerSeries(t *testing.T, seriesRepo *repository.SeriesRepository, description string) *model.Series {
	t.Helper()

	if _, err := database.DB.Exec(`INSERT INTO libraries (id, name, type, library_type) VALUES ('lib-1', 'Library', 'LOCAL', 'book')`); err != nil {
		t.Fatalf("insert library error = %v", err)
	}
	if _, err := database.DB.Exec(`INSERT INTO library_paths (id, library_id, path, sort_order) VALUES ('lib-path-1', 'lib-1', '/library', 0)`); err != nil {
		t.Fatalf("insert library path error = %v", err)
	}

	series := &model.Series{
		ID:          "series-1",
		LibraryID:   "lib-1",
		Title:       "Example Series",
		Path:        "/library/example-series.epub",
		Description: description,
		Metadata: &model.SeriesMetadata{
			Description: description,
		},
	}
	if err := seriesRepo.Create(nil, series); err != nil {
		t.Fatalf("SeriesRepository.Create() error = %v", err)
	}
	return series
}

func assertErrorPayload(t *testing.T, resp *http.Response, want string) {
	t.Helper()

	var payload map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if payload["error"] != want {
		t.Fatalf("payload error = %q, want %q", payload["error"], want)
	}
}
