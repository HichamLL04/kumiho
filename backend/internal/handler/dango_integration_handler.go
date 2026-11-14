package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/aha-hyeong/kumiho/backend/internal/util"
	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

type DangoIntegrationHandler struct {
	service      *service.DangoReadingService
	metadataSvc  *service.MetadataService
	seriesRepo   *repository.SeriesRepository
	queueCtx     context.Context
	metadataJobs chan dangoMetadataJob
	metadataMu   sync.Mutex
	metadataSeen map[string]struct{}
}

type dangoMetadataJob struct {
	userID   string
	seriesID string
	series   string
	key      string
}

func NewDangoIntegrationHandler(ctx context.Context, dangoService *service.DangoReadingService, metadataService *service.MetadataService, seriesRepo *repository.SeriesRepository) *DangoIntegrationHandler {
	if ctx == nil {
		ctx = context.Background()
	}
	handler := &DangoIntegrationHandler{
		service: dangoService, metadataSvc: metadataService, seriesRepo: seriesRepo,
		queueCtx: ctx, metadataJobs: make(chan dangoMetadataJob, 10000), metadataSeen: make(map[string]struct{}),
	}
	go handler.runMetadataQueue()
	return handler
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

func (h *DangoIntegrationHandler) IsConfigured(userID string) bool {
	if h == nil || h.service == nil {
		return false
	}
	status, err := h.service.Status(userID)
	return err == nil && status != nil && status.TokenConfigured
}

func (h *DangoIntegrationHandler) ApplySeriesMetadata(c *fiber.Ctx) error {
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}
	userID := middleware.GetUserID(c)
	applied, err := h.importSeriesMetadata(ctx, userID, c.Params("id"))
	if err != nil {
		status := fiber.StatusInternalServerError
		if strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "could not resolve") {
			status = fiber.StatusNotFound
		} else if strings.Contains(err.Error(), "Dango") {
			status = fiber.StatusBadGateway
		}
		return c.Status(status).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(applied)
}

func (h *DangoIntegrationHandler) importSeriesMetadata(ctx context.Context, userID, seriesID string) (*service.MetadataApplyResult, error) {
	if h.seriesRepo == nil || h.metadataSvc == nil || h.service == nil {
		return nil, fmt.Errorf("Dango metadata integration is unavailable")
	}
	series, err := h.seriesRepo.FindByID(nil, seriesID, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to load series: %w", err)
	}
	if series == nil {
		return nil, fmt.Errorf("series not found")
	}
	identifiers := service.ReadCatalogIdentifiers(series.Path)
	title := util.ReadCatalogPreferredTitle(series.Path)
	if title == "" {
		title = series.Title
	}
	catalog, err := h.service.FetchCatalogMetadata(ctx, userID, title, "manga", identifiers)
	if err != nil {
		return nil, err
	}
	if catalog == nil || !catalog.Found {
		return nil, fmt.Errorf("Dango could not resolve catalog metadata from the sidecar IDs or title")
	}
	applied, err := h.metadataSvc.ApplySeriesMetadata(ctx, series.ID, userID, dangoMetadataResult(catalog))
	if err != nil {
		return nil, fmt.Errorf("failed to apply Dango metadata: %w", err)
	}
	if applied.Series.Metadata != nil {
		if status := dangoSeriesStatus(catalog.Metadata.Status); status != "" && applied.Series.Metadata.Status != status {
			applied.Series.Metadata.Status = status
			if err := h.seriesRepo.UpdatePreservingUpdatedAt(nil, applied.Series); err != nil {
				return nil, fmt.Errorf("failed to save Dango series status: %w", err)
			}
			applied.UpdatedFields = append(applied.UpdatedFields, "status")
		}
	}
	return applied, nil
}

// EnqueueLibraryMetadata schedules sidecar-backed series for catalog import
// after a scan. A single worker avoids spawning a goroutine per series. Dango
// owns the shared upstream request pacing and queue limits across all clients.
func (h *DangoIntegrationHandler) EnqueueLibraryMetadata(ctx context.Context, userID, libraryID string) int {
	if h == nil || h.seriesRepo == nil || h.service == nil || strings.TrimSpace(userID) == "" {
		return 0
	}
	status, err := h.service.Status(userID)
	if err != nil || status == nil || !status.TokenConfigured {
		return 0
	}
	seriesList, err := h.seriesRepo.FindByLibraryID(nil, libraryID, userID)
	if err != nil {
		log.Printf("[DANGO METADATA] Could not list series for library %s: %v", libraryID, err)
		return 0
	}
	queued := 0
	for _, series := range seriesList {
		identifiers := service.ReadCatalogIdentifiers(series.Path)
		if len(identifiers) == 0 || dangoSidecarAlreadyImported(series.Metadata, identifiers) {
			continue
		}
		key := userID + ":" + series.ID + ":" + identifiers["anilist_id"] + ":" + identifiers["mal_id"]
		h.metadataMu.Lock()
		if _, exists := h.metadataSeen[key]; exists {
			h.metadataMu.Unlock()
			continue
		}
		h.metadataSeen[key] = struct{}{}
		h.metadataMu.Unlock()
		job := dangoMetadataJob{userID: userID, seriesID: series.ID, series: series.Title, key: key}
		select {
		case h.metadataJobs <- job:
			queued++
		default:
			h.metadataMu.Lock()
			delete(h.metadataSeen, key)
			h.metadataMu.Unlock()
			log.Printf("[DANGO METADATA] Queue full; skipped %q", series.Title)
		}
	}
	if queued > 0 {
		log.Printf("[DANGO METADATA] Queued %d series from library %s", queued, libraryID)
	}
	return queued
}

func (h *DangoIntegrationHandler) runMetadataQueue() {
	for {
		select {
		case <-h.queueCtx.Done():
			return
		case job := <-h.metadataJobs:
			_, err := h.importSeriesMetadata(h.queueCtx, job.userID, job.seriesID)
			if err != nil {
				h.metadataMu.Lock()
				delete(h.metadataSeen, job.key)
				h.metadataMu.Unlock()
				log.Printf("[DANGO METADATA] Import failed for %q (%s): %v", job.series, job.seriesID, err)
				continue
			}
			log.Printf("[DANGO METADATA] Imported catalog metadata for %q", job.series)
		}
	}
}

func dangoSidecarAlreadyImported(metadata *model.SeriesMetadata, identifiers map[string]string) bool {
	if metadata == nil || strings.TrimSpace(metadata.OriginalTitles) == "" {
		return false
	}
	var values map[string]string
	if json.Unmarshal([]byte(metadata.OriginalTitles), &values) != nil {
		return false
	}
	marker := values["_dango_catalog_ids"]
	if marker == "" {
		return false
	}
	for _, importedID := range strings.Split(marker, "|") {
		if importedID == "anilist:"+identifiers["anilist_id"] && identifiers["anilist_id"] != "" {
			return true
		}
		if importedID == "mal:"+identifiers["mal_id"] && identifiers["mal_id"] != "" {
			return true
		}
	}
	return false
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
	var catalogIDs []string
	if metadata.AniListID > 0 {
		identifiers["anilist_id"] = fmt.Sprint(metadata.AniListID)
		catalogIDs = append(catalogIDs, "anilist:"+identifiers["anilist_id"])
	}
	if metadata.MALID != nil && *metadata.MALID > 0 {
		identifiers["mal_id"] = fmt.Sprint(*metadata.MALID)
		catalogIDs = append(catalogIDs, "mal:"+identifiers["mal_id"])
	}
	if len(catalogIDs) > 0 {
		originalTitles["_dango_catalog_ids"] = strings.Join(catalogIDs, "|")
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
