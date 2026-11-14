package handler

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/aha-hyeong/kumiho/backend/internal/util"
	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

type DangoIntegrationHandler struct {
	service     *service.DangoReadingService
	metadataSvc *service.MetadataService
	seriesRepo  *repository.SeriesRepository
}

func NewDangoIntegrationHandler(dangoService *service.DangoReadingService, metadataService *service.MetadataService, seriesRepo *repository.SeriesRepository) *DangoIntegrationHandler {
	return &DangoIntegrationHandler{service: dangoService, metadataSvc: metadataService, seriesRepo: seriesRepo}
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

func (h *DangoIntegrationHandler) ApplySeriesMetadata(c *fiber.Ctx) error {
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}
	userID := middleware.GetUserID(c)
	if h.seriesRepo == nil || h.metadataSvc == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "Dango metadata integration is unavailable"})
	}
	series, err := h.seriesRepo.FindByID(nil, c.Params("id"), userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to load series"})
	}
	if series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "series not found"})
	}
	identifiers := service.ReadCatalogIdentifiers(series.Path)
	title := util.ReadCatalogPreferredTitle(series.Path)
	if title == "" {
		title = series.Title
	}
	catalog, err := h.service.FetchCatalogMetadata(ctx, userID, title, "manga", identifiers)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
	}
	if catalog == nil || !catalog.Found {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Dango could not resolve catalog metadata from the sidecar IDs or title"})
	}
	result := dangoMetadataResult(catalog)
	applied, err := h.metadataSvc.ApplySeriesMetadata(ctx, series.ID, userID, result)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to apply Dango metadata"})
	}
	if applied.Series.Metadata != nil {
		if status := dangoSeriesStatus(catalog.Metadata.Status); status != "" && applied.Series.Metadata.Status != status {
			applied.Series.Metadata.Status = status
			if err := h.seriesRepo.UpdatePreservingUpdatedAt(nil, applied.Series); err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to save Dango series status"})
			}
			applied.UpdatedFields = append(applied.UpdatedFields, "status")
		}
	}
	return c.JSON(applied)
}

func dangoSeriesStatus(status string) string {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "FINISHED":
		return "COMPLETED"
	case "RELEASING", "NOT_YET_RELEASED":
		return "ONGOING"
	case "HIATUS", "CANCELLED":
		return "HIATUS"
	default:
		return ""
	}
}

func dangoMetadataResult(response *service.DangoCatalogMetadataResponse) *sdktypes.MetadataResult {
	metadata := response.Metadata
	originalTitles := make(map[string]string)
	if value := strings.TrimSpace(metadata.Title.Romaji); value != "" {
		originalTitles["romaji"] = value
	}
	if metadata.Title.English != nil && strings.TrimSpace(*metadata.Title.English) != "" {
		originalTitles["en"] = strings.TrimSpace(*metadata.Title.English)
	}
	if metadata.Title.Native != nil && strings.TrimSpace(*metadata.Title.Native) != "" {
		originalTitles["ja"] = strings.TrimSpace(*metadata.Title.Native)
	}
	identifiers := map[string]string{}
	if metadata.AniListID > 0 {
		identifiers["anilist_id"] = fmt.Sprint(metadata.AniListID)
	}
	if metadata.MALID != nil && *metadata.MALID > 0 {
		identifiers["mal_id"] = fmt.Sprint(*metadata.MALID)
	}
	publicationDate := ""
	if metadata.StartDate.Year != nil && *metadata.StartDate.Year > 0 {
		date := time.Date(*metadata.StartDate.Year, time.January, 1, 0, 0, 0, 0, time.UTC)
		if metadata.StartDate.Month != nil && *metadata.StartDate.Month > 0 {
			date = time.Date(*metadata.StartDate.Year, time.Month(*metadata.StartDate.Month), 1, 0, 0, 0, 0, time.UTC)
		}
		if metadata.StartDate.Month != nil && *metadata.StartDate.Month > 0 && metadata.StartDate.Day != nil && *metadata.StartDate.Day > 0 {
			date = time.Date(*metadata.StartDate.Year, time.Month(*metadata.StartDate.Month), *metadata.StartDate.Day, 0, 0, 0, 0, time.UTC)
			publicationDate = date.Format("2006-01-02")
		} else if metadata.StartDate.Month != nil && *metadata.StartDate.Month > 0 {
			publicationDate = date.Format("2006-01")
		} else {
			publicationDate = date.Format("2006")
		}
	}
	if publicationDate == "" && metadata.SeasonYear != nil && *metadata.SeasonYear > 0 {
		publicationDate = fmt.Sprint(*metadata.SeasonYear)
	}
	coverURL := firstDangoCover(metadata.Cover.ExtraLarge, metadata.Cover.Large, metadata.Cover.Medium)
	var cover *sdktypes.CoverInfo
	if coverURL != "" {
		cover = &sdktypes.CoverInfo{URL: coverURL}
	}
	return &sdktypes.MetadataResult{
		Source: sdktypes.SourceRef{ID: fmt.Sprint(metadata.AniListID), Name: "Dango / AniList", URL: metadata.CatalogURL},
		Title:  "", OriginalTitles: originalTitles, Description: metadata.Description, Tags: metadata.Genres,
		PublicationDate: publicationDate, Identifiers: identifiers, Cover: cover,
	}
}

func firstDangoCover(values ...*string) string {
	for _, value := range values {
		if value != nil && strings.TrimSpace(*value) != "" {
			return strings.TrimSpace(*value)
		}
	}
	return ""
}
