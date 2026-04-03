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
	"sort"
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
	Characters     []sdktypes.MetadataCharacter `json:"characters"`
	SourceProvider string                       `json:"source_provider,omitempty"`
}

func isAllowedCharacterImageContentType(contentType string) bool {
	switch strings.ToLower(strings.TrimSpace(contentType)) {
	case "image/jpeg", "image/png", "image/gif", "image/webp":
		return true
	default:
		return false
	}
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
	if err = c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name is required"})
	}
	normalizedName := repository.NormalizeSeriesCharacterName(name)
	tx, err := database.DB.BeginTx(ctx, nil)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to start transaction"})
	}
	defer func() { _ = tx.Rollback() }()

	if normalizedName != "" {
		exists, err := h.characterRepo.ExistsNormalizedName(tx, series.ID, normalizedName, "")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to check existing character"})
		}
		if exists {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "character already exists"})
		}
	}
	if err := h.characterRepo.ShiftSortOrders(tx, series.ID, 1); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to allocate sort order"})
	}

	item := &model.SeriesCharacter{
		SeriesID:         series.ID,
		Name:             name,
		SortOrder:        0,
		Role:             strings.TrimSpace(req.Role),
		ExternalImageURL: strings.TrimSpace(req.ImageURL),
	}
	if err := h.characterRepo.Create(tx, item); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create character"})
	}
	if err := tx.Commit(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to commit transaction"})
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
		exists, err := h.characterRepo.ExistsNormalizedName(nil, series.ID, normalizedName, item.ID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to validate character"})
		}
		if exists {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "character already exists"})
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
	if err = c.BodyParser(&req); err != nil {
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
	reorderTx, err := database.DB.BeginTx(ctx, nil)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to start transaction"})
	}
	defer func() { _ = reorderTx.Rollback() }()

	if err = h.characterRepo.Reorder(reorderTx, series.ID, req.OrderedIDs); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to reorder characters"})
	}
	if err = reorderTx.Commit(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to commit reorder"})
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
	if err = c.BodyParser(&req); err != nil {
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
	existingByNormalized := make(map[string]model.SeriesCharacter, len(existing))
	allByID := make(map[string]model.SeriesCharacter, len(existing))
	existingBySourceKey := make(map[string]model.SeriesCharacter, len(existing)*2)
	for _, item := range existing {
		existingByNormalized[item.NormalizedName] = item
		allByID[item.ID] = item
		for _, key := range seriesCharacterSourceKeys(item) {
			existingBySourceKey[key] = item
		}
	}
	added := make([]model.SeriesCharacter, 0)
	pending := make([]sdktypes.MetadataCharacter, 0)
	pendingKnown := make(map[string]struct{}, len(req.Characters))
	for _, character := range req.Characters {
		normalized := repository.NormalizeSeriesCharacterName(character.Name)
		if normalized == "" {
			continue
		}
		if _, ok := pendingKnown[normalized]; ok {
			continue
		}
		pendingKnown[normalized] = struct{}{}
		pending = append(pending, character)
	}

	sourceProvider := strings.TrimSpace(req.SourceProvider)
	seenExistingIDs := make(map[string]struct{}, len(existing))
	incomingSourceKeys := make(map[string]struct{}, len(pending)*2)
	sortMetadataCharacters(pending)
	for _, character := range pending {
		for _, key := range metadataCharacterSourceKeys(character, sourceProvider) {
			incomingSourceKeys[key] = struct{}{}
		}

		normalized := repository.NormalizeSeriesCharacterName(character.Name)
		existingItem, ok := findExistingCharacter(existingBySourceKey, existingByNormalized, character, sourceProvider)
		if ok {
			applyMetadataCharacter(&existingItem, character, sourceProvider)
			if err := h.characterRepo.Update(tx, &existingItem); err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update imported character"})
			}
			seenExistingIDs[existingItem.ID] = struct{}{}
			allByID[existingItem.ID] = existingItem
			existingByNormalized[normalized] = existingItem
			for _, key := range seriesCharacterSourceKeys(existingItem) {
				existingBySourceKey[key] = existingItem
			}
			continue
		}

		item := model.SeriesCharacter{SeriesID: series.ID}
		applyMetadataCharacter(&item, character, sourceProvider)
		if err := h.characterRepo.Create(tx, &item); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to import characters"})
		}
		existingByNormalized[item.NormalizedName] = item
		allByID[item.ID] = item
		for _, key := range seriesCharacterSourceKeys(item) {
			existingBySourceKey[key] = item
		}
		added = append(added, item)
	}

	for _, item := range existing {
		if item.SourceProvider != sourceProvider || sourceProvider == "" {
			continue
		}
		if _, ok := seenExistingIDs[item.ID]; ok {
			continue
		}
		if shouldRetainImportedCharacter(item, incomingSourceKeys) {
			continue
		}
		if item.ImagePath != "" {
			_ = os.Remove(item.ImagePath)
		}
		if err := h.characterRepo.Delete(tx, series.ID, item.ID); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to remove stale imported character"})
		}
		delete(allByID, item.ID)
	}

	all := make([]model.SeriesCharacter, 0, len(allByID))
	for _, item := range allByID {
		all = append(all, item)
	}
	sortSeriesCharactersForMetadata(all)
	orderedIDs := make([]string, 0, len(all))
	for _, item := range all {
		orderedIDs = append(orderedIDs, item.ID)
	}
	if err := h.characterRepo.Reorder(tx, series.ID, orderedIDs); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to reorder imported characters"})
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
	if !isAllowedCharacterImageContentType(contentType) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid file type: only PNG, JPEG, GIF, and WebP images are allowed"})
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
			if metadataCharacterLess(items[j], items[i]) {
				items[i], items[j] = items[j], items[i]
			}
		}
	}
}

func applyMetadataCharacter(item *model.SeriesCharacter, character sdktypes.MetadataCharacter, sourceProvider string) {
	item.Name = strings.TrimSpace(character.Name)
	item.Role = strings.TrimSpace(character.Role)
	item.ExternalImageURL = coverURLFromMetadataCharacter(character)
	item.SourceProvider = sourceProvider
	item.SourceCharacterID = strings.TrimSpace(character.ID)
	item.SourceRelationID = ""

	switch sourceProvider {
	case "kumiho-plugin-metadata-kitsu":
		if relationID := strings.TrimSpace(character.Identifiers["kitsu_media_character_id"]); relationID != "" {
			item.SourceRelationID = relationID
		}
		if sourceID := strings.TrimSpace(character.Identifiers["kitsu_character_id"]); sourceID != "" {
			item.SourceCharacterID = sourceID
		}
	}
}

func findExistingCharacter(
	existingBySourceKey map[string]model.SeriesCharacter,
	existingByNormalized map[string]model.SeriesCharacter,
	character sdktypes.MetadataCharacter,
	sourceProvider string,
) (model.SeriesCharacter, bool) {
	for _, key := range metadataCharacterSourceKeys(character, sourceProvider) {
		if item, ok := existingBySourceKey[key]; ok {
			return item, true
		}
	}

	normalized := repository.NormalizeSeriesCharacterName(character.Name)
	item, ok := existingByNormalized[normalized]
	return item, ok
}

func metadataCharacterSourceKeys(character sdktypes.MetadataCharacter, sourceProvider string) []string {
	keys := make([]string, 0, 3)
	if sourceProvider == "kumiho-plugin-metadata-kitsu" {
		if relationID := strings.TrimSpace(character.Identifiers["kitsu_media_character_id"]); relationID != "" {
			keys = append(keys, sourceProvider+":relation:"+relationID)
		}
		if sourceID := strings.TrimSpace(character.Identifiers["kitsu_character_id"]); sourceID != "" {
			keys = append(keys, sourceProvider+":character:"+sourceID)
		}
	}
	if normalized := repository.NormalizeSeriesCharacterName(character.Name); normalized != "" {
		keys = append(keys, sourceProvider+":name:"+normalized)
	}
	return keys
}

func seriesCharacterSourceKeys(item model.SeriesCharacter) []string {
	keys := make([]string, 0, 3)
	if item.SourceProvider != "" && item.SourceRelationID != "" {
		keys = append(keys, item.SourceProvider+":relation:"+strings.TrimSpace(item.SourceRelationID))
	}
	if item.SourceProvider != "" && item.SourceCharacterID != "" {
		keys = append(keys, item.SourceProvider+":character:"+strings.TrimSpace(item.SourceCharacterID))
	}
	if normalized := repository.NormalizeSeriesCharacterName(item.Name); normalized != "" {
		keys = append(keys, item.SourceProvider+":name:"+normalized)
	}
	return keys
}

func shouldRetainImportedCharacter(item model.SeriesCharacter, incomingSourceKeys map[string]struct{}) bool {
	for _, key := range seriesCharacterSourceKeys(item) {
		if _, ok := incomingSourceKeys[key]; ok {
			return true
		}
	}
	return false
}

func metadataCharacterLess(left, right sdktypes.MetadataCharacter) bool {
	leftMain := isMainCharacterRole(left.Role)
	rightMain := isMainCharacterRole(right.Role)
	if leftMain != rightMain {
		return leftMain
	}

	leftName := strings.ToLower(strings.TrimSpace(left.Name))
	rightName := strings.ToLower(strings.TrimSpace(right.Name))
	if leftName != rightName {
		if leftName == "" {
			return false
		}
		if rightName == "" {
			return true
		}
		return leftName < rightName
	}

	return strings.TrimSpace(left.ID) < strings.TrimSpace(right.ID)
}

func isMainCharacterRole(role string) bool {
	return strings.EqualFold(strings.TrimSpace(role), "main")
}

func sortSeriesCharactersForMetadata(items []model.SeriesCharacter) {
	sort.SliceStable(items, func(i, j int) bool {
		leftMain := isMainCharacterRole(items[i].Role)
		rightMain := isMainCharacterRole(items[j].Role)
		if leftMain != rightMain {
			return leftMain
		}

		leftName := strings.ToLower(strings.TrimSpace(items[i].Name))
		rightName := strings.ToLower(strings.TrimSpace(items[j].Name))
		if leftName != rightName {
			if leftName == "" {
				return false
			}
			if rightName == "" {
				return true
			}
			return leftName < rightName
		}

		if !items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].CreatedAt.Before(items[j].CreatedAt)
		}

		return items[i].ID < items[j].ID
	})
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
