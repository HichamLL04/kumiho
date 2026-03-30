package handler

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

type SeriesCharacterHandler struct {
	seriesRepo    *repository.SeriesRepository
	characterRepo *repository.SeriesCharacterRepository
	cfg           *config.Config
}

type createSeriesCharacterRequest struct {
	Name     string `json:"name"`
	Role     string `json:"role"`
	ImageURL string `json:"image_url"`
}

type updateSeriesCharacterRequest struct {
	Name     *string `json:"name"`
	Role     *string `json:"role"`
	ImageURL *string `json:"image_url"`
}

type reorderSeriesCharactersRequest struct {
	OrderedIDs []string `json:"ordered_ids"`
}

type importSeriesCharactersRequest struct {
	Characters []sdktypes.MetadataCharacter `json:"characters"`
}

func NewSeriesCharacterHandler(seriesRepo *repository.SeriesRepository, characterRepo *repository.SeriesCharacterRepository, cfg *config.Config) *SeriesCharacterHandler {
	return &SeriesCharacterHandler{
		seriesRepo:    seriesRepo,
		characterRepo: characterRepo,
		cfg:           cfg,
	}
}

func (h *SeriesCharacterHandler) List(c *fiber.Ctx) error {
	ctx := requestContext(c)
	series, err := h.findSeries(ctx, c.Params("id"), middleware.GetUserID(c))
	if err != nil {
		return err
	}

	items, err := h.characterRepo.ListBySeriesID(nil, series.ID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to list series characters"})
	}
	h.assignImageURLs(series.ID, items)
	return c.JSON(fiber.Map{"characters": items})
}

func (h *SeriesCharacterHandler) Create(c *fiber.Ctx) error {
	ctx := requestContext(c)
	series, err := h.findSeries(ctx, c.Params("id"), middleware.GetUserID(c))
	if err != nil {
		return err
	}

	var req createSeriesCharacterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	name := strings.TrimSpace(req.Name)
	normalizedName := repository.NormalizeSeriesCharacterName(name)
	if normalizedName != "" {
		exists, err := h.characterRepo.ExistsNormalizedName(nil, series.ID, normalizedName)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to check existing character"})
		}
		if exists {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "character already exists"})
		}
	}
	if err := h.characterRepo.ShiftSortOrders(nil, series.ID, 1); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to allocate sort order"})
	}

	item := &model.SeriesCharacter{
		SeriesID:         series.ID,
		Name:             name,
		SortOrder:        0,
		Role:             strings.TrimSpace(req.Role),
		ExternalImageURL: strings.TrimSpace(req.ImageURL),
	}
	if err := h.characterRepo.Create(nil, item); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create character"})
	}
	h.assignImageURL(series.ID, item)
	return c.JSON(item)
}

func (h *SeriesCharacterHandler) Update(c *fiber.Ctx) error {
	ctx := requestContext(c)
	series, item, errResp := h.loadCharacter(ctx, c, middleware.GetUserID(c))
	if errResp != nil {
		return errResp
	}

	var req updateSeriesCharacterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	if req.Name != nil {
		item.Name = strings.TrimSpace(*req.Name)
		if item.Name == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name is required"})
		}
		normalizedName := repository.NormalizeSeriesCharacterName(item.Name)
		existing, err := h.characterRepo.ListBySeriesID(nil, series.ID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to validate character"})
		}
		for _, current := range existing {
			if current.ID != item.ID && current.NormalizedName == normalizedName {
				return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "character already exists"})
			}
		}
	}
	if req.Role != nil {
		item.Role = strings.TrimSpace(*req.Role)
	}
	if req.ImageURL != nil {
		item.ExternalImageURL = strings.TrimSpace(*req.ImageURL)
		item.ImagePath = ""
	}
	if err := h.characterRepo.Update(nil, item); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update character"})
	}
	h.assignImageURL(series.ID, item)
	return c.JSON(item)
}

func (h *SeriesCharacterHandler) Delete(c *fiber.Ctx) error {
	ctx := requestContext(c)
	series, item, errResp := h.loadCharacter(ctx, c, middleware.GetUserID(c))
	if errResp != nil {
		return errResp
	}
	if item.ImagePath != "" {
		_ = os.Remove(item.ImagePath)
	}
	if err := h.characterRepo.Delete(nil, series.ID, item.ID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to delete character"})
	}
	return c.JSON(fiber.Map{"deleted": true, "id": item.ID})
}

func (h *SeriesCharacterHandler) Reorder(c *fiber.Ctx) error {
	ctx := requestContext(c)
	series, err := h.findSeries(ctx, c.Params("id"), middleware.GetUserID(c))
	if err != nil {
		return err
	}
	var req reorderSeriesCharactersRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	if len(req.OrderedIDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ordered_ids is required"})
	}
	items, err := h.characterRepo.ListBySeriesID(nil, series.ID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to list characters"})
	}
	if len(items) != len(req.OrderedIDs) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ordered_ids length mismatch"})
	}
	existing := make(map[string]struct{}, len(items))
	for _, item := range items {
		existing[item.ID] = struct{}{}
	}
	for _, id := range req.OrderedIDs {
		if _, ok := existing[id]; !ok {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ordered_ids contains unknown character"})
		}
	}
	if err := h.characterRepo.Reorder(nil, series.ID, req.OrderedIDs); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to reorder characters"})
	}
	items, err = h.characterRepo.ListBySeriesID(nil, series.ID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to reload characters"})
	}
	h.assignImageURLs(series.ID, items)
	return c.JSON(fiber.Map{"characters": items})
}

func (h *SeriesCharacterHandler) Import(c *fiber.Ctx) error {
	ctx := requestContext(c)
	series, err := h.findSeries(ctx, c.Params("id"), middleware.GetUserID(c))
	if err != nil {
		return err
	}
	var req importSeriesCharactersRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	if len(req.Characters) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "characters is required"})
	}

	tx, err := database.DB.BeginTx(ctx, nil)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to start import transaction"})
	}
	defer func() { _ = tx.Rollback() }()

	existing, err := h.characterRepo.ListBySeriesID(tx, series.ID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to load existing characters"})
	}
	known := make(map[string]struct{}, len(existing))
	for _, item := range existing {
		known[item.NormalizedName] = struct{}{}
	}
	nextSortOrder := len(existing)
	added := make([]model.SeriesCharacter, 0)
	pending := make([]sdktypes.MetadataCharacter, 0)
	for _, character := range req.Characters {
		normalized := repository.NormalizeSeriesCharacterName(character.Name)
		if normalized == "" {
			continue
		}
		if _, ok := known[normalized]; ok {
			continue
		}
		known[normalized] = struct{}{}
		pending = append(pending, character)
	}

	sortMetadataCharacters(pending)
	for _, character := range pending {
		item := model.SeriesCharacter{
			SeriesID:         series.ID,
			Name:             strings.TrimSpace(character.Name),
			Role:             strings.TrimSpace(character.Role),
			SortOrder:        nextSortOrder,
			ExternalImageURL: coverURLFromMetadataCharacter(character),
			SourceProvider:   "kitsu",
		}
		if character.ID != "" {
			item.SourceCharacterID = character.ID
		}
		if relationID := strings.TrimSpace(character.Identifiers["kitsu_media_character_id"]); relationID != "" {
			item.SourceRelationID = relationID
		}
		if sourceID := strings.TrimSpace(character.Identifiers["kitsu_character_id"]); sourceID != "" {
			item.SourceCharacterID = sourceID
		}
		if err := h.characterRepo.Create(tx, &item); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to import characters"})
		}
		added = append(added, item)
		nextSortOrder++
	}

	if err := tx.Commit(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to commit import"})
	}
	h.assignImageURLs(series.ID, added)
	return c.JSON(fiber.Map{"added": added, "count": len(added)})
}

func (h *SeriesCharacterHandler) UploadImage(c *fiber.Ctx) error {
	ctx := requestContext(c)
	series, item, errResp := h.loadCharacter(ctx, c, middleware.GetUserID(c))
	if errResp != nil {
		return errResp
	}
	file, err := c.FormFile("image")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "image file is required"})
	}
	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to open uploaded image"})
	}
	defer func() { _ = src.Close() }()

	buffer := make([]byte, 512)
	_, err = src.Read(buffer)
	if err != nil && err != io.EOF {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to read file header"})
	}
	_, _ = src.Seek(0, 0)
	contentType := http.DetectContentType(buffer)
	if !strings.HasPrefix(contentType, "image/") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid file type: only images are allowed"})
	}
	dir := filepath.Join(h.cfg.DataDir, "thumbnails", "series-characters")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create image directory"})
	}
	hash := md5.Sum([]byte(series.ID + ":" + item.ID))
	hashString := hex.EncodeToString(hash[:])
	deleteHashFiles(dir, hashString)
	path := filepath.Join(dir, hashString+thumbnailExtFromMediaType(contentType))
	if err := c.SaveFile(file, path); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to save image"})
	}
	if item.ImagePath != "" && item.ImagePath != path {
		_ = os.Remove(item.ImagePath)
	}
	item.ImagePath = path
	if err := h.characterRepo.Update(nil, item); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update character image"})
	}
	h.assignImageURL(series.ID, item)
	return c.JSON(item)
}

func (h *SeriesCharacterHandler) UpdateImageURL(c *fiber.Ctx) error {
	ctx := requestContext(c)
	series, item, errResp := h.loadCharacter(ctx, c, middleware.GetUserID(c))
	if errResp != nil {
		return errResp
	}
	var req struct {
		URL string `json:"url"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	if strings.TrimSpace(req.URL) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "url is required"})
	}
	item.ExternalImageURL = strings.TrimSpace(req.URL)
	if item.ImagePath != "" {
		_ = os.Remove(item.ImagePath)
		item.ImagePath = ""
	}
	if err := h.characterRepo.Update(nil, item); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update character image"})
	}
	h.assignImageURL(series.ID, item)
	return c.JSON(item)
}

func (h *SeriesCharacterHandler) DeleteImage(c *fiber.Ctx) error {
	ctx := requestContext(c)
	series, item, errResp := h.loadCharacter(ctx, c, middleware.GetUserID(c))
	if errResp != nil {
		return errResp
	}
	if item.ImagePath != "" {
		_ = os.Remove(item.ImagePath)
		item.ImagePath = ""
	}
	item.ExternalImageURL = ""
	if err := h.characterRepo.Update(nil, item); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to clear character image"})
	}
	h.assignImageURL(series.ID, item)
	return c.JSON(item)
}

func (h *SeriesCharacterHandler) GetImage(c *fiber.Ctx) error {
	ctx := requestContext(c)
	_, item, errResp := h.loadCharacter(ctx, c, middleware.GetUserID(c))
	if errResp != nil {
		return errResp
	}
	if strings.TrimSpace(item.ImagePath) == "" {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "image not found"})
	}
	return c.SendFile(item.ImagePath)
}

func requestContext(c *fiber.Ctx) context.Context {
	if ctx := c.UserContext(); ctx != nil {
		return ctx
	}
	return context.Background()
}

func (h *SeriesCharacterHandler) findSeries(_ context.Context, seriesID string, userID string) (*model.Series, error) {
	series, err := h.seriesRepo.FindByID(nil, seriesID, userID)
	if err != nil {
		return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to fetch series")
	}
	if series == nil {
		return nil, fiber.NewError(fiber.StatusNotFound, "series not found")
	}
	return series, nil
}

func (h *SeriesCharacterHandler) loadCharacter(ctx context.Context, c *fiber.Ctx, userID string) (*model.Series, *model.SeriesCharacter, error) {
	series, err := h.findSeries(ctx, c.Params("id"), userID)
	if err != nil {
		return nil, nil, err
	}
	item, err := h.characterRepo.FindByID(nil, series.ID, c.Params("characterId"))
	if err != nil {
		return nil, nil, fiber.NewError(fiber.StatusInternalServerError, "failed to fetch character")
	}
	if item == nil {
		return nil, nil, fiber.NewError(fiber.StatusNotFound, "character not found")
	}
	return series, item, nil
}

func (h *SeriesCharacterHandler) assignImageURLs(seriesID string, items []model.SeriesCharacter) {
	for i := range items {
		h.assignImageURL(seriesID, &items[i])
	}
}

func (h *SeriesCharacterHandler) assignImageURL(seriesID string, item *model.SeriesCharacter) {
	if item == nil {
		return
	}
	if strings.TrimSpace(item.ImagePath) != "" {
		item.ImageURL = fmt.Sprintf("/api/v1/series/%s/characters/%s/image?t=%d", seriesID, item.ID, item.UpdatedAt.Unix())
		return
	}
	item.ImageURL = strings.TrimSpace(item.ExternalImageURL)
}

func coverURLFromMetadataCharacter(character sdktypes.MetadataCharacter) string {
	if character.Image == nil {
		return ""
	}
	return strings.TrimSpace(character.Image.URL)
}

func sortMetadataCharacters(items []sdktypes.MetadataCharacter) {
	for i := 0; i < len(items); i++ {
		for j := i + 1; j < len(items); j++ {
			if strings.ToLower(strings.TrimSpace(items[j].Name)) < strings.ToLower(strings.TrimSpace(items[i].Name)) {
				items[i], items[j] = items[j], items[i]
			}
		}
	}
}

func deleteHashFiles(dir string, hash string) {
	pattern := filepath.Join(dir, hash+".*")
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return
	}
	for _, match := range matches {
		_ = os.Remove(match)
	}
}
