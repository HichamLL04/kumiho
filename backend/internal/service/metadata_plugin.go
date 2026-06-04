package service

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/metadata_engine"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/scanner"
	"github.com/aha-hyeong/kumiho/backend/internal/util"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/capability"
	pluginerrors "github.com/kumiho-plugin/kumiho-plugin-sdk/errors"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdkstate "github.com/kumiho-plugin/kumiho-plugin-sdk/state"
	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

var (
	ErrSeriesNotFound         = errors.New("series not found")
	ErrNoActiveMetadataPlugin = errors.New("no active metadata plugin")
	ErrLibraryNotFound        = errors.New("library not found")
	htmlTagPattern            = regexp.MustCompile(`(?s)<[^>]*>`)
	blockHTMLPattern          = regexp.MustCompile(`(?i)</?(p|div|br|li|ul|ol|h[1-6]|blockquote)[^>]*>`)
	candidateVolumePattern    = regexp.MustCompile(`(?i)(?:^|[\s._:-])(?:vol(?:ume)?\.?\s*)?(\d{1,3})(?:$|[\s._:-])`)

	anilistCache   = make(map[string]*sdktypes.MetadataResult)
	anilistCacheMu sync.RWMutex
	malCache       = make(map[string]*sdktypes.MetadataResult)
	malCacheMu     sync.RWMutex
)

const lowConfidenceProviderOrderThreshold = 0.35

type MetadataPluginFailure struct {
	PluginID   string `json:"plugin_id"`
	PluginName string `json:"plugin_name"`
	Message    string `json:"message"`
}

type MetadataCandidate struct {
	PluginID   string                   `json:"plugin_id"`
	PluginName string                   `json:"plugin_name"`
	Candidate  sdktypes.SearchCandidate `json:"candidate"`
}

type MetadataSearchResult struct {
	Query      sdktypes.SearchRequest  `json:"query"`
	Candidates []MetadataCandidate     `json:"candidates"`
	Failures   []MetadataPluginFailure `json:"failures,omitempty"`
}

type MetadataFetchSelection struct {
	PluginID string             `json:"plugin_id"`
	Source   sdktypes.SourceRef `json:"source"`
}

type MetadataSearchOptions struct {
	Title string `json:"title"`
}

type MetadataFetchResult struct {
	PluginID string                   `json:"plugin_id"`
	Result   *sdktypes.MetadataResult `json:"result"`
}

type MetadataApplyResult struct {
	Series        *model.Series `json:"series"`
	UpdatedFields []string      `json:"updated_fields"`
	CoverURL      string        `json:"cover_url,omitempty"`
	AppliedAt     time.Time     `json:"applied_at"`
}

type MetadataResetResult struct {
	LibraryID   string    `json:"library_id"`
	LibraryName string    `json:"library_name"`
	ResetCount  int64     `json:"reset_count"`
	ResetAt     time.Time `json:"reset_at"`
	Warnings    []string  `json:"warnings,omitempty"`
}

type MetadataService struct {
	seriesRepo    *repository.SeriesRepository
	characterRepo *repository.SeriesCharacterRepository
	volumeRepo    *repository.VolumeRepository
	libraryRepo   *repository.LibraryRepository
	settingRepo   repository.SettingRepository
	manager       *pluginengine.Manager
	cfg           *config.Config
	client        *http.Client
}

func NewMetadataService(
	cfg *config.Config,
	client *http.Client,
	seriesRepo *repository.SeriesRepository,
	characterRepo *repository.SeriesCharacterRepository,
	libraryRepo *repository.LibraryRepository,
	settingRepo repository.SettingRepository,
	manager *pluginengine.Manager,
) *MetadataService {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &MetadataService{
		seriesRepo:    seriesRepo,
		characterRepo: characterRepo,
		volumeRepo:    repository.NewVolumeRepository(),
		libraryRepo:   libraryRepo,
		settingRepo:   settingRepo,
		manager:       manager,
		cfg:           cfg,
		client:        client,
	}
}

func parseExternalID(str string) (anilistID, malID string) {
	str = strings.TrimSpace(str)
	if str == "" {
		return "", ""
	}

	// Check for URL
	if strings.Contains(str, "anilist.co/manga/") {
		re := regexp.MustCompile(`anilist\.co/manga/(\d+)`)
		if m := re.FindStringSubmatch(str); len(m) > 1 {
			return m[1], ""
		}
	}
	if strings.Contains(str, "myanimelist.net/manga/") {
		re := regexp.MustCompile(`myanimelist\.net/manga/(\d+)`)
		if m := re.FindStringSubmatch(str); len(m) > 1 {
			return "", m[1]
		}
	}

	// Check for prefixes
	if strings.HasPrefix(strings.ToLower(str), "anilist:") {
		return strings.TrimPrefix(strings.ToLower(str), "anilist:"), ""
	}
	if strings.HasPrefix(strings.ToLower(str), "mal:") {
		return "", strings.TrimPrefix(strings.ToLower(str), "mal:")
	}

	// Check if pure integer
	if _, err := strconv.Atoi(str); err == nil {
		return str, str
	}

	return "", ""
}

func (s *MetadataService) fetchAniListCandidate(ctx context.Context, id string) (*sdktypes.MetadataResult, error) {
	anilistCacheMu.RLock()
	if cached, ok := anilistCache[id]; ok {
		anilistCacheMu.RUnlock()
		return cached, nil
	}
	anilistCacheMu.RUnlock()

	var query = `
	query ($id: Int) {
		Media (id: $id, type: MANGA) {
			id
			title {
				romaji
				english
				native
			}
			description
			status
			startDate {
				year
				month
				day
			}
			genres
			staff {
				edges {
					role
					node {
						name {
							full
						}
					}
				}
			}
			coverImage {
				extraLarge
			}
			characters {
				edges {
					role
					node {
						id
						name {
							full
						}
						image {
							large
						}
					}
				}
			}
		}
	}
	`

	idInt, err := strconv.Atoi(id)
	if err != nil {
		return nil, err
	}

	reqBody, err := json.Marshal(map[string]interface{}{
		"query": query,
		"variables": map[string]interface{}{
			"id": idInt,
		},
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", "https://graphql.anilist.co", bytes.NewBuffer(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("anilist api error status %d: %s", resp.StatusCode, string(body))
	}

	var data struct {
		Data struct {
			Media struct {
				ID    int `json:"id"`
				Title struct {
					Romaji  string `json:"romaji"`
					English string `json:"english"`
					Native  string `json:"native"`
				} `json:"title"`
				Description string `json:"description"`
				Status      string `json:"status"`
				StartDate   struct {
					Year  int `json:"year"`
					Month int `json:"month"`
					Day   int `json:"day"`
				} `json:"startDate"`
				Genres []string `json:"genres"`
				Staff  struct {
					Edges []struct {
						Role string `json:"role"`
						Node struct {
							Name struct {
								Full string `json:"full"`
							} `json:"name"`
						} `json:"node"`
					} `json:"edges"`
				} `json:"staff"`
				CoverImage struct {
					ExtraLarge string `json:"extraLarge"`
				} `json:"coverImage"`
				Characters struct {
					Edges []struct {
						Role string `json:"role"`
						Node struct {
							ID   int `json:"id"`
							Name struct {
								Full string `json:"full"`
							} `json:"name"`
							Image struct {
								Large string `json:"large"`
							} `json:"image"`
						} `json:"node"`
					} `json:"edges"`
				} `json:"characters"`
			} `json:"Media"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}

	media := data.Data.Media
	if media.ID == 0 {
		return nil, fmt.Errorf("media not found")
	}

	var authors []string
	for _, edge := range media.Staff.Edges {
		if strings.Contains(strings.ToLower(edge.Role), "story") || strings.Contains(strings.ToLower(edge.Role), "art") || strings.Contains(strings.ToLower(edge.Role), "original") {
			authors = append(authors, edge.Node.Name.Full)
		}
	}
	if len(authors) == 0 {
		for _, edge := range media.Staff.Edges {
			authors = append(authors, edge.Node.Name.Full)
		}
	}

	originalTitles := map[string]string{
		"en": media.Title.English,
		"ja": media.Title.Native,
		"ko": media.Title.Romaji,
	}

	var characters []sdktypes.MetadataCharacter
	for _, edge := range media.Characters.Edges {
		role := "supporting"
		if strings.EqualFold(edge.Role, "MAIN") {
			role = "main"
		}
		charImage := &sdktypes.CoverInfo{URL: edge.Node.Image.Large}
		characters = append(characters, sdktypes.MetadataCharacter{
			ID:    strconv.Itoa(edge.Node.ID),
			Name:  edge.Node.Name.Full,
			Role:  role,
			Image: charImage,
		})
	}

	pubDate := ""
	if media.StartDate.Year > 0 {
		pubDate = fmt.Sprintf("%d", media.StartDate.Year)
		if media.StartDate.Month > 0 {
			pubDate = fmt.Sprintf("%d-%02d", media.StartDate.Year, media.StartDate.Month)
			if media.StartDate.Day > 0 {
				pubDate = fmt.Sprintf("%d-%02d-%02d", media.StartDate.Year, media.StartDate.Month, media.StartDate.Day)
			}
		}
	}

	res := &sdktypes.MetadataResult{
		Source: sdktypes.SourceRef{
			ID:   strconv.Itoa(media.ID),
			Name: "AniList",
		},
		Title:          media.Title.English,
		OriginalTitle:  media.Title.Native,
		OriginalTitles: originalTitles,
		Authors:        authors,
		Description:    media.Description,
		Tags:           media.Genres,
		PublicationDate: pubDate,
		Identifiers: map[string]string{
			"anilist_id": strconv.Itoa(media.ID),
		},
		Cover: &sdktypes.CoverInfo{
			URL: media.CoverImage.ExtraLarge,
		},
		Characters: characters,
	}
	if res.Title == "" {
		res.Title = media.Title.Romaji
	}

	anilistCacheMu.Lock()
	anilistCache[id] = res
	anilistCacheMu.Unlock()

	return res, nil
}

func (s *MetadataService) fetchMALCandidate(ctx context.Context, id string, clientID string) (*sdktypes.MetadataResult, error) {
	malCacheMu.RLock()
	if cached, ok := malCache[id]; ok {
		malCacheMu.RUnlock()
		return cached, nil
	}
	malCacheMu.RUnlock()

	if clientID == "" {
		return nil, fmt.Errorf("mal_client_id is not configured in user settings")
	}

	urlStr := fmt.Sprintf("https://api.myanimelist.net/v2/manga/%s?fields=id,title,main_picture,alternative_titles,synopsis,start_date,end_date,status,genres,authors{first_name,last_name}", id)
	req, err := http.NewRequestWithContext(ctx, "GET", urlStr, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-MAL-CLIENT-ID", clientID)

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("mal api error status %d: %s", resp.StatusCode, string(body))
	}

	var media struct {
		ID          int    `json:"id"`
		Title       string `json:"title"`
		MainPicture struct {
			Medium string `json:"medium"`
			Large  string `json:"large"`
		} `json:"main_picture"`
		AlternativeTitles struct {
			Synonyms []string `json:"synonyms"`
			English  string   `json:"english"`
			Japanese string   `json:"japanese"`
		} `json:"alternative_titles"`
		Synopsis  string `json:"synopsis"`
		StartDate string `json:"start_date"`
		Status    string `json:"status"`
		Genres    []struct {
			ID   int    `json:"id"`
			Name string `json:"name"`
		} `json:"genres"`
		Authors []struct {
			Author struct {
				ID        int    `json:"id"`
				FirstName string `json:"first_name"`
				LastName  string `json:"last_name"`
			} `json:"author"`
			Role string `json:"role"`
		} `json:"authors"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&media); err != nil {
		return nil, err
	}

	if media.ID == 0 {
		return nil, fmt.Errorf("manga not found")
	}


	var authors []string
	for _, a := range media.Authors {
		name := strings.TrimSpace(a.Author.FirstName + " " + a.Author.LastName)
		if name == "" {
			name = strings.TrimSpace(a.Author.LastName + " " + a.Author.FirstName)
		}
		if name != "" {
			authors = append(authors, name)
		}
	}

	var tags []string
	for _, g := range media.Genres {
		tags = append(tags, g.Name)
	}

	originalTitles := map[string]string{
		"en": media.AlternativeTitles.English,
		"ja": media.AlternativeTitles.Japanese,
	}

	coverURL := media.MainPicture.Large
	if coverURL == "" {
		coverURL = media.MainPicture.Medium
	}

	// Fetch characters for MAL
	characters, charErr := s.fetchMALCharacters(ctx, id, clientID)
	if charErr != nil {
		log.Printf("[fetchMALCandidate] Warn: failed to fetch MAL characters: %v", charErr)
	}

	res := &sdktypes.MetadataResult{
		Source: sdktypes.SourceRef{
			ID:   strconv.Itoa(media.ID),
			Name: "MyAnimeList",
		},
		Title:          media.Title,
		OriginalTitle:  media.AlternativeTitles.Japanese,
		OriginalTitles: originalTitles,
		Authors:        authors,
		Description:    media.Synopsis,
		Tags:           tags,
		PublicationDate: media.StartDate,
		Identifiers: map[string]string{
			"mal_id": strconv.Itoa(media.ID),
		},
		Cover: &sdktypes.CoverInfo{
			URL: coverURL,
		},
		Characters: characters,
	}
	if res.OriginalTitle == "" {
		res.OriginalTitle = media.Title
	}

	malCacheMu.Lock()
	malCache[id] = res
	malCacheMu.Unlock()

	return res, nil
}

func (s *MetadataService) fetchMALCharacters(ctx context.Context, id string, clientID string) ([]sdktypes.MetadataCharacter, error) {
	urlStr := fmt.Sprintf("https://api.myanimelist.net/v2/manga/%s/characters", id)
	req, err := http.NewRequestWithContext(ctx, "GET", urlStr, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-MAL-CLIENT-ID", clientID)

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("mal characters api error status %d", resp.StatusCode)
	}

	var data struct {
		Data []struct {
			Node struct {
				ID          int    `json:"id"`
				Name        string `json:"name"`
				MainPicture struct {
					Medium string `json:"medium"`
					Large  string `json:"large"`
				} `json:"main_picture"`
			} `json:"node"`
			Role string `json:"role"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}

	var characters []sdktypes.MetadataCharacter
	for _, item := range data.Data {
		role := "supporting"
		if strings.EqualFold(item.Role, "Main") {
			role = "main"
		}
		coverURL := item.Node.MainPicture.Large
		if coverURL == "" {
			coverURL = item.Node.MainPicture.Medium
		}
		charImage := &sdktypes.CoverInfo{URL: coverURL}
		characters = append(characters, sdktypes.MetadataCharacter{
			ID:    strconv.Itoa(item.Node.ID),
			Name:  item.Node.Name,
			Role:  role,
			Image: charImage,
		})
	}
	return characters, nil
}

func (s *MetadataService) SearchSeries(ctx context.Context, seriesID string, userID string, opts MetadataSearchOptions) (*MetadataSearchResult, error) {
	series, err := s.seriesRepo.FindByID(nil, seriesID, userID)
	if err != nil {
		return nil, err
	}
	if series == nil {
		return nil, ErrSeriesNotFound
	}

	searchTitle := strings.TrimSpace(opts.Title)
	if searchTitle == "" {
		searchTitle = series.Title
	}

	req := metadata_engine.BuildSearchRequest(searchTitle, series.Path, mapContentType(series.LibraryType), "")
	req.Language = inferSearchLanguage(searchTitle)
	if strings.TrimSpace(opts.Title) == "" && series.Metadata != nil && strings.TrimSpace(series.Metadata.ISBN) != "" {
		req.Identifiers = map[string]string{"isbn": strings.TrimSpace(series.Metadata.ISBN)}
	}

	records, err := s.manager.List()
	if err != nil {
		return nil, err
	}

	result := &MetadataSearchResult{Query: req}
	activeCount := 0

	for _, record := range records {
		if record.State != sdkstate.Active || !hasCapability(record.Manifest, capability.MetadataSearch) {
			continue
		}
		activeCount++

		resp, callErr := s.manager.Search(ctx, record.ID, &req)
		if callErr != nil {
			result.Failures = append(result.Failures, MetadataPluginFailure{
				PluginID:   record.ID,
				PluginName: record.Manifest.Name,
				Message:    callErr.Error(),
			})
			continue
		}
		if resp == nil {
			result.Failures = append(result.Failures, MetadataPluginFailure{
				PluginID:   record.ID,
				PluginName: record.Manifest.Name,
				Message:    "empty search response",
			})
			continue
		}
		if resp.Error != nil {
			result.Failures = append(result.Failures, MetadataPluginFailure{
				PluginID:   record.ID,
				PluginName: record.Manifest.Name,
				Message:    resp.Error.Error(),
			})
			continue
		}

		for _, candidate := range resp.Candidates {
			result.Candidates = append(result.Candidates, MetadataCandidate{
				PluginID:   record.ID,
				PluginName: record.Manifest.Name,
				Candidate:  candidate,
			})
		}
	}

	// ─── Direct ID matching ───
	var directCandidates []MetadataCandidate

	var dbAnilistID, dbMalID string
	if series.Metadata != nil {
		dbAnilistID = strings.Trim(strings.TrimSpace(series.Metadata.AnilistID), `'"`)
		dbMalID = strings.Trim(strings.TrimSpace(series.Metadata.MalID), `'"`)
	}

	queryAnilistID, queryMalID := parseExternalID(searchTitle)

	targetAnilistID := dbAnilistID
	if targetAnilistID == "" {
		targetAnilistID = queryAnilistID
	}
	if targetAnilistID != "" {
		var res *sdktypes.MetadataResult
		var err error
		if targetAnilistID == dbAnilistID && series.Metadata != nil && (series.Metadata.OriginalTitle != "" || series.Metadata.Description != "" || series.Metadata.Authors != "" || series.Metadata.Tags != "") {
			var authors []string
			if series.Metadata.Authors != "" {
				authors = strings.Split(series.Metadata.Authors, ", ")
			}
			var tags []string
			if series.Metadata.Tags != "" {
				tags = strings.Split(series.Metadata.Tags, ", ")
			}
			var originalTitles map[string]string
			if series.Metadata.OriginalTitles != "" {
				_ = json.Unmarshal([]byte(series.Metadata.OriginalTitles), &originalTitles)
			}
			res = &sdktypes.MetadataResult{
				Source: sdktypes.SourceRef{
					ID:   targetAnilistID,
					Name: "AniList",
				},
				Title:          series.Title,
				OriginalTitle:  series.Metadata.OriginalTitle,
				OriginalTitles: originalTitles,
				Authors:        authors,
				Description:    series.Metadata.Description,
				Tags:           tags,
				PublicationDate: series.Metadata.PublishedAt,
				Identifiers: map[string]string{
					"anilist_id": targetAnilistID,
				},
			}
			if series.ThumbnailPath != nil && *series.ThumbnailPath != "" {
				res.Cover = &sdktypes.CoverInfo{
					URL: util.BuildSeriesThumbnailURL(series.ID, series.ThumbnailPath, series.UpdatedAt),
				}
			}
		} else {
			res, err = s.fetchAniListCandidate(ctx, targetAnilistID)
		}

		if err == nil && res != nil {
			coverURL := ""
			if res.Cover != nil {
				coverURL = res.Cover.URL
			}
			directCandidates = append(directCandidates, MetadataCandidate{
				PluginID:   "anilist-direct",
				PluginName: "AniList (Direct)",
				Candidate: sdktypes.SearchCandidate{
					Source:        res.Source,
					Title:         res.Title,
					OriginalTitle: res.OriginalTitle,
					Authors:       res.Authors,
					Description:   res.Description,
					CoverURL:      coverURL,
					Score:         1.0,
					Confidence:    1.0,
					Reason:        "ID de AniList coincidente",
				},
			})
		} else if err != nil {
			log.Printf("[SearchSeries] AniList direct fetch error for ID %s: %v", targetAnilistID, err)
		}
	}

	targetMalID := dbMalID
	if targetMalID == "" {
		targetMalID = queryMalID
	}
	if targetMalID != "" {
		var res *sdktypes.MetadataResult
		var err error
		if targetMalID == dbMalID && series.Metadata != nil && (series.Metadata.OriginalTitle != "" || series.Metadata.Description != "" || series.Metadata.Authors != "" || series.Metadata.Tags != "") {
			var authors []string
			if series.Metadata.Authors != "" {
				authors = strings.Split(series.Metadata.Authors, ", ")
			}
			var tags []string
			if series.Metadata.Tags != "" {
				tags = strings.Split(series.Metadata.Tags, ", ")
			}
			var originalTitles map[string]string
			if series.Metadata.OriginalTitles != "" {
				_ = json.Unmarshal([]byte(series.Metadata.OriginalTitles), &originalTitles)
			}
			res = &sdktypes.MetadataResult{
				Source: sdktypes.SourceRef{
					ID:   targetMalID,
					Name: "MyAnimeList",
				},
				Title:          series.Title,
				OriginalTitle:  series.Metadata.OriginalTitle,
				OriginalTitles: originalTitles,
				Authors:        authors,
				Description:    series.Metadata.Description,
				Tags:           tags,
				PublicationDate: series.Metadata.PublishedAt,
				Identifiers: map[string]string{
					"mal_id": targetMalID,
				},
			}
			if series.ThumbnailPath != nil && *series.ThumbnailPath != "" {
				res.Cover = &sdktypes.CoverInfo{
					URL: util.BuildSeriesThumbnailURL(series.ID, series.ThumbnailPath, series.UpdatedAt),
				}
			}
		} else {
			var malClientID string
			_ = database.DB.QueryRow("SELECT value FROM user_settings WHERE user_id = ? AND key = 'mal_client_id'", userID).Scan(&malClientID)
			if malClientID != "" {
				res, err = s.fetchMALCandidate(ctx, targetMalID, malClientID)
			} else {
				err = errors.New("missing mal_client_id")
			}
		}

		if err == nil && res != nil {
			coverURL := ""
			if res.Cover != nil {
				coverURL = res.Cover.URL
			}
			directCandidates = append(directCandidates, MetadataCandidate{
				PluginID:   "mal-direct",
				PluginName: "MyAnimeList (Direct)",
				Candidate: sdktypes.SearchCandidate{
					Source:        res.Source,
					Title:         res.Title,
					OriginalTitle: res.OriginalTitle,
					Authors:       res.Authors,
					Description:   res.Description,
					CoverURL:      coverURL,
					Score:         1.0,
					Confidence:    1.0,
					Reason:        "ID de MyAnimeList coincidente",
				},
			})
		} else if err != nil {
			log.Printf("[SearchSeries] MAL direct fetch error for ID %s: %v", targetMalID, err)
		}
	}

	if len(directCandidates) > 0 {
		result.Candidates = append(directCandidates, result.Candidates...)
	}

	if activeCount == 0 && len(directCandidates) == 0 {
		return nil, ErrNoActiveMetadataPlugin
	}

	sort.SliceStable(result.Candidates, func(i, j int) bool {
		left := result.Candidates[i].Candidate
		right := result.Candidates[j].Candidate
		if left.Confidence != right.Confidence {
			return left.Confidence > right.Confidence
		}
		if left.Confidence <= lowConfidenceProviderOrderThreshold {
			return false
		}

		leftVolume, leftHasVolume := candidateVolumeNumber(left.Title)
		rightVolume, rightHasVolume := candidateVolumeNumber(right.Title)
		switch {
		case leftHasVolume && rightHasVolume && leftVolume != rightVolume:
			return leftVolume < rightVolume
		case leftHasVolume != rightHasVolume:
			return leftHasVolume
		}

		if left.Score != right.Score {
			return left.Score > right.Score
		}
		return false
	})

	return result, nil
}

func (s *MetadataService) FetchSeriesMetadata(ctx context.Context, seriesID string, userID string, selection MetadataFetchSelection) (*MetadataFetchResult, error) {
	series, err := s.seriesRepo.FindByID(nil, seriesID, userID)
	if err != nil {
		return nil, err
	}
	if series == nil {
		return nil, ErrSeriesNotFound
	}

	var dbAnilistID, dbMalID string
	if series.Metadata != nil {
		dbAnilistID = strings.Trim(strings.TrimSpace(series.Metadata.AnilistID), `'"`)
		dbMalID = strings.Trim(strings.TrimSpace(series.Metadata.MalID), `'"`)
	}

	if strings.TrimSpace(selection.PluginID) == "" {
		return nil, errors.New("plugin_id is required")
	}
	if strings.TrimSpace(selection.Source.ID) == "" || strings.TrimSpace(selection.Source.Name) == "" {
		return nil, errors.New("source.id and source.name are required")
	}

	// ─── Direct ID fetch handlers ───
	if selection.PluginID == "anilist-direct" {
		var aniRes *sdktypes.MetadataResult
		var aniErr error
		if selection.Source.ID == dbAnilistID && series.Metadata != nil && (series.Metadata.OriginalTitle != "" || series.Metadata.Description != "" || series.Metadata.Authors != "" || series.Metadata.Tags != "") {
			var authors []string
			if series.Metadata.Authors != "" {
				authors = strings.Split(series.Metadata.Authors, ", ")
			}
			var tags []string
			if series.Metadata.Tags != "" {
				tags = strings.Split(series.Metadata.Tags, ", ")
			}
			var originalTitles map[string]string
			if series.Metadata.OriginalTitles != "" {
				_ = json.Unmarshal([]byte(series.Metadata.OriginalTitles), &originalTitles)
			}
			aniRes = &sdktypes.MetadataResult{
				Source: sdktypes.SourceRef{
					ID:   selection.Source.ID,
					Name: "AniList",
				},
				Title:          series.Title,
				OriginalTitle:  series.Metadata.OriginalTitle,
				OriginalTitles: originalTitles,
				Authors:        authors,
				Description:    series.Metadata.Description,
				Tags:           tags,
				PublicationDate: series.Metadata.PublishedAt,
				Identifiers: map[string]string{
					"anilist_id": selection.Source.ID,
				},
			}
			if series.ThumbnailPath != nil && *series.ThumbnailPath != "" {
				aniRes.Cover = &sdktypes.CoverInfo{
					URL: util.BuildSeriesThumbnailURL(series.ID, series.ThumbnailPath, series.UpdatedAt),
				}
			}
		} else {
			aniRes, aniErr = s.fetchAniListCandidate(ctx, selection.Source.ID)
		}

		if aniErr != nil {
			return nil, aniErr
		}
		return &MetadataFetchResult{
			PluginID: selection.PluginID,
			Result:   aniRes,
		}, nil
	}

	if selection.PluginID == "mal-direct" {
		var malRes *sdktypes.MetadataResult
		var malErr error
		if selection.Source.ID == dbMalID && series.Metadata != nil && (series.Metadata.OriginalTitle != "" || series.Metadata.Description != "" || series.Metadata.Authors != "" || series.Metadata.Tags != "") {
			var authors []string
			if series.Metadata.Authors != "" {
				authors = strings.Split(series.Metadata.Authors, ", ")
			}
			var tags []string
			if series.Metadata.Tags != "" {
				tags = strings.Split(series.Metadata.Tags, ", ")
			}
			var originalTitles map[string]string
			if series.Metadata.OriginalTitles != "" {
				_ = json.Unmarshal([]byte(series.Metadata.OriginalTitles), &originalTitles)
			}
			malRes = &sdktypes.MetadataResult{
				Source: sdktypes.SourceRef{
					ID:   selection.Source.ID,
					Name: "MyAnimeList",
				},
				Title:          series.Title,
				OriginalTitle:  series.Metadata.OriginalTitle,
				OriginalTitles: originalTitles,
				Authors:        authors,
				Description:    series.Metadata.Description,
				Tags:           tags,
				PublicationDate: series.Metadata.PublishedAt,
				Identifiers: map[string]string{
					"mal_id": selection.Source.ID,
				},
			}
			if series.ThumbnailPath != nil && *series.ThumbnailPath != "" {
				malRes.Cover = &sdktypes.CoverInfo{
					URL: util.BuildSeriesThumbnailURL(series.ID, series.ThumbnailPath, series.UpdatedAt),
				}
			}
		} else {
			var malClientID string
			_ = database.DB.QueryRow("SELECT value FROM user_settings WHERE user_id = ? AND key = 'mal_client_id'", userID).Scan(&malClientID)
			malRes, malErr = s.fetchMALCandidate(ctx, selection.Source.ID, malClientID)
		}

		if malErr != nil {
			return nil, malErr
		}
		return &MetadataFetchResult{
			PluginID: selection.PluginID,
			Result:   malRes,
		}, nil
	}

	record, ok, err := s.manager.Get(selection.PluginID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, pluginengine.ErrPluginNotFound
	}
	if record.State != sdkstate.Active {
		return nil, pluginerrors.Newf(pluginerrors.ErrCodePluginNotReady, "plugin %q is not active", selection.PluginID)
	}
	if !hasCapability(record.Manifest, capability.MetadataFetch) {
		return nil, pluginerrors.Newf(pluginerrors.ErrCodeUnsupported, "plugin %q does not support metadata.fetch", selection.PluginID)
	}

	resp, err := s.manager.Fetch(ctx, selection.PluginID, &sdktypes.FetchRequest{Source: selection.Source})
	if err != nil {
		return nil, err
	}
	if resp == nil || resp.Result == nil {
		if resp != nil && resp.Error != nil {
			return nil, resp.Error
		}
		return nil, errors.New("empty fetch response")
	}
	if resp.Error != nil {
		return nil, resp.Error
	}

	return &MetadataFetchResult{
		PluginID: selection.PluginID,
		Result:   resp.Result,
	}, nil
}

func (s *MetadataService) ApplySeriesMetadata(ctx context.Context, seriesID string, userID string, result *sdktypes.MetadataResult) (*MetadataApplyResult, error) {
	series, err := s.seriesRepo.FindByID(nil, seriesID, userID)
	if err != nil {
		return nil, err
	}
	if series == nil {
		return nil, ErrSeriesNotFound
	}
	if result == nil {
		return nil, errors.New("result is required")
	}

	if series.Metadata == nil {
		series.Metadata = &model.SeriesMetadata{SeriesID: series.ID}
	}

	var updatedFields []string

	// 수동 원제 여부를 먼저 판별한 뒤에만 fallback title 적용 여부를 결정한다.
	manualOriginalTitle := ""
	isManualOriginalTitle := scanner.IsManualOriginalTitle(series.Metadata.OriginalTitles, series.Metadata.OriginalTitle)
	if existingTitle := strings.TrimSpace(series.Metadata.OriginalTitle); isManualOriginalTitle {
		manualOriginalTitle = existingTitle
	}
	if !isManualOriginalTitle {
		applyFetchedTitle(series, result, &updatedFields)
	}
	previousDescription := strings.TrimSpace(series.Description)
	applyString(&series.Description, sanitizeDescription(result.Description), "description", &updatedFields)
	if strings.TrimSpace(series.Description) != previousDescription {
		series.Metadata.Description = series.Description
		series.Metadata.DescriptionTranslated = ""
	}

	// original_titles raw 저장

	if len(result.OriginalTitles) > 0 {
		if originalTitles := encodeOriginalTitles(result.OriginalTitles, manualOriginalTitle); originalTitles != "" {
			applyString(&series.Metadata.OriginalTitles, originalTitles, "original_titles", &updatedFields)
		}
	} else if manualOriginalTitle != "" {
		if originalTitles := scanner.WithManualOriginalTitle(series.Metadata.OriginalTitles, manualOriginalTitle); originalTitles != "" {
			applyString(&series.Metadata.OriginalTitles, originalTitles, "original_titles", &updatedFields)
		}
	}

	// locale 우선순위로 해석한 값을 original_title에 저장
	// 단, 기존 original_title이 비어있지 않고 original_titles에 없는 값이면 수동 입력으로 간주 → 덮어쓰지 않음
	locale := repository.PreferredOriginalTitleLocale(s.settingRepo)
	resolvedOriginalTitle := resolveFetchedOriginalTitle(result, locale)
	if resolvedOriginalTitle != "" {
		if !isManualOriginalTitle {
			applyString(&series.Metadata.OriginalTitle, resolvedOriginalTitle, "original_title", &updatedFields)
		}
	} else if fetchedOriginalTitle := strings.TrimSpace(result.OriginalTitle); fetchedOriginalTitle != "" {
		applyString(&series.Metadata.OriginalTitle, fetchedOriginalTitle, "original_title", &updatedFields)
	}

	applyString(&series.Metadata.Publisher, strings.TrimSpace(result.Publisher), "publisher", &updatedFields)
	applyString(&series.Metadata.PublishedAt, strings.TrimSpace(result.PublicationDate), "published_at", &updatedFields)
	if publicationYear := yearFromDate(result.PublicationDate); publicationYear != "" {
		applyString(&series.Metadata.PublicationYear, publicationYear, "publication_year", &updatedFields)
	}
	if authors := strings.Join(filterNonEmpty(result.Authors), ", "); authors != "" {
		applyString(&series.Metadata.Authors, authors, "authors", &updatedFields)
	}
	if tags := strings.Join(normalizeTags(result.Tags), ", "); tags != "" {
		applyString(&series.Metadata.Tags, tags, "tags", &updatedFields)
	}

	isbn := firstIdentifier(result.Identifiers, "isbn13", "isbn", "isbn10")
	if isbn != "" {
		applyString(&series.Metadata.ISBN, isbn, "isbn", &updatedFields)
	}
	if anilistID := result.Identifiers["anilist_id"]; anilistID != "" {
		applyString(&series.Metadata.AnilistID, anilistID, "anilist_id", &updatedFields)
	}
	if malID := result.Identifiers["mal_id"]; malID != "" {
		applyString(&series.Metadata.MalID, malID, "mal_id", &updatedFields)
	}

	coverURL := coverURL(result)
	if coverURL != "" {
		if applied, err := s.applySeriesThumbnail(ctx, series, coverURL); err != nil {
			return nil, err
		} else if applied {
			updatedFields = append(updatedFields, "thumbnail")
		}
	}

	if len(updatedFields) == 0 {
		s.enrichSeriesThumbnail(series)
		s.assignSeriesDisplayTitle(series)
		return &MetadataApplyResult{
			Series:        series,
			UpdatedFields: updatedFields,
			AppliedAt:     time.Now(),
			CoverURL:      coverURL,
		}, nil
	}

	if err := s.seriesRepo.UpdatePreservingUpdatedAt(nil, series); err != nil {
		return nil, err
	}

	s.enrichSeriesThumbnail(series)
	s.assignSeriesDisplayTitle(series)

	return &MetadataApplyResult{
		Series:        series,
		UpdatedFields: updatedFields,
		AppliedAt:     time.Now(),
		CoverURL:      coverURL,
	}, nil
}

func (s *MetadataService) ResetLibraryMetadata(ctx context.Context, libraryID string) (*MetadataResetResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	if strings.TrimSpace(libraryID) == "" {
		return nil, ErrLibraryNotFound
	}

	library, err := s.libraryRepo.FindByID(nil, libraryID)
	if err != nil {
		return nil, err
	}
	if library == nil {
		return nil, ErrLibraryNotFound
	}

	seriesList, err := s.seriesRepo.FindByLibraryID(nil, libraryID, "")
	if err != nil {
		return nil, err
	}

	fileSet := make(map[string]struct{})
	for i := range seriesList {
		if seriesList[i].ThumbnailPath != nil {
			thumbnailPath := strings.TrimSpace(*seriesList[i].ThumbnailPath)
			if thumbnailPath != "" {
				fileSet[thumbnailPath] = struct{}{}
			}
		}

	}
	if s.characterRepo != nil {
		characterImagePaths, charErr := s.characterRepo.ListImagePathsByLibraryID(nil, libraryID)
		if charErr != nil {
			return nil, charErr
		}
		for _, imagePath := range characterImagePaths {
			trimmedPath := strings.TrimSpace(imagePath)
			if trimmedPath == "" {
				continue
			}
			fileSet[trimmedPath] = struct{}{}
		}
	}

	tx, err := database.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	resetCount, err := s.seriesRepo.ResetMetadataByLibrary(tx, libraryID)
	if err != nil {
		return nil, err
	}
	if s.characterRepo != nil {
		if err := s.characterRepo.DeleteByLibraryID(tx, libraryID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	result := &MetadataResetResult{
		LibraryID:   library.ID,
		LibraryName: library.Name,
		ResetCount:  resetCount,
		ResetAt:     time.Now(),
	}
	sanitizeAssetWarningName := func(assetPath string) string {
		name := filepath.Base(filepath.Clean(assetPath))
		if name == "" || name == "." || name == string(filepath.Separator) {
			return "asset"
		}
		return name
	}
	for path := range fileSet {
		removed, removeErr := util.RemoveManagedAsset(s.cfg.DataDir, path)
		assetName := sanitizeAssetWarningName(path)
		if !removed {
			result.Warnings = append(result.Warnings, fmt.Sprintf("asset_unmanaged:%s", assetName))
			continue
		}
		if removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			result.Warnings = append(result.Warnings, fmt.Sprintf("asset_remove_failed:%s", assetName))
		}
	}

	return result, nil
}

func hasCapability(manifest sdkmanifest.Manifest, wanted capability.Capability) bool {
	for _, current := range manifest.Capabilities {
		if current == wanted {
			return true
		}
	}
	return false
}

func mapContentType(libraryType string) sdktypes.ContentType {
	switch strings.ToLower(strings.TrimSpace(libraryType)) {
	case string(sdktypes.ContentTypeComic):
		return sdktypes.ContentTypeComic
	case string(sdktypes.ContentTypeNovel):
		return sdktypes.ContentTypeNovel
	case string(sdktypes.ContentTypeAudiobook):
		return sdktypes.ContentTypeAudiobook
	default:
		return ""
	}
}

func applyString(target *string, next string, field string, updatedFields *[]string) bool {
	if next == "" || *target == next {
		return false
	}
	*target = next
	*updatedFields = append(*updatedFields, field)
	return true
}

func applyFetchedTitle(series *model.Series, result *sdktypes.MetadataResult, updatedFields *[]string) {
	if series == nil || result == nil || series.Metadata == nil {
		return
	}
	if strings.TrimSpace(series.Metadata.OriginalTitle) != "" {
		return
	}
	if strings.TrimSpace(result.OriginalTitle) != "" || len(result.OriginalTitles) > 0 {
		return
	}

	fetchedTitle := strings.TrimSpace(result.Title)
	if fetchedTitle == "" {
		return
	}

	applyString(&series.Metadata.OriginalTitle, fetchedTitle, "original_title", updatedFields)
}

func encodeOriginalTitles(values map[string]string, manualOriginalTitle string) string {
	return scanner.EncodeOriginalTitlesPayload(values, manualOriginalTitle)
}

func (s *MetadataService) assignSeriesDisplayTitle(series *model.Series) {
	if series == nil {
		return
	}

	displayTitle := strings.TrimSpace(series.Title)
	library, err := s.libraryRepo.FindByID(nil, series.LibraryID)
	if err == nil && library != nil && library.OriginalTitleOverride {
		locale := repository.PreferredOriginalTitleLocale(s.settingRepo)
		if resolved := scanner.ResolveSeriesTitleFromOriginalTitle(series.Path, "", series.Metadata, true, locale); resolved != "" {
			displayTitle = resolved
		}
	}
	series.DisplayTitle = displayTitle
}

func resolveFetchedOriginalTitle(result *sdktypes.MetadataResult, locale string) string {
	if result == nil {
		return ""
	}

	for _, key := range scanner.PreferredOriginalTitleOrder(locale) {
		if title := strings.TrimSpace(result.OriginalTitles[key]); title != "" {
			return title
		}
	}
	if title := strings.TrimSpace(result.OriginalTitle); title != "" {
		return title
	}
	return ""
}

func filterNonEmpty(values []string) []string {
	filtered := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			filtered = append(filtered, trimmed)
		}
	}
	return filtered
}

func firstIdentifier(identifiers map[string]string, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(identifiers[key]); value != "" {
			return value
		}
	}
	return ""
}

func yearFromDate(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 4 {
		return value[:4]
	}
	return ""
}

func candidateVolumeNumber(title string) (int, bool) {
	matches := candidateVolumePattern.FindAllStringSubmatch(title, -1)
	if len(matches) == 0 {
		return 0, false
	}

	last := matches[len(matches)-1]
	if len(last) < 2 {
		return 0, false
	}

	value := strings.TrimSpace(last[1])
	if value == "" {
		return 0, false
	}

	volume, err := strconv.Atoi(value)
	if err != nil || volume <= 0 {
		return 0, false
	}
	return volume, true
}

func coverURL(result *sdktypes.MetadataResult) string {
	if result == nil || result.Cover == nil {
		return ""
	}
	return strings.TrimSpace(result.Cover.URL)
}

func sanitizeDescription(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = blockHTMLPattern.ReplaceAllString(value, "\n")
	value = htmlTagPattern.ReplaceAllString(value, "")
	value = html.UnescapeString(value)

	lines := strings.Split(value, "\n")
	cleaned := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			cleaned = append(cleaned, line)
		}
	}
	return strings.Join(cleaned, "\n\n")
}

func normalizeTags(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	normalized := make([]string, 0, len(values))

	for _, value := range values {
		for _, part := range splitHierarchicalTag(value) {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			key := strings.ToLower(part)
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			normalized = append(normalized, part)
		}
	}

	return normalized
}

func splitHierarchicalTag(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}

	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == '/' || r == ','
	})
	if len(parts) == 0 {
		return []string{value}
	}
	return parts
}

func (s *MetadataService) applySeriesThumbnail(ctx context.Context, series *model.Series, rawURL string) (bool, error) {
	if s.cfg == nil || strings.TrimSpace(s.cfg.DataDir) == "" {
		return false, nil
	}
	if series == nil || strings.TrimSpace(series.Path) == "" {
		return false, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; KumihoMetadataBot/0.1)")
	req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")

	resp, err := s.client.Do(req)
	if err != nil {
		return false, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("failed to download cover image: status code %d", resp.StatusCode)
	}

	contentType := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") {
		return false, fmt.Errorf("cover url is not an image")
	}

	thumbnailsDir := filepath.Join(s.cfg.DataDir, "thumbnails", "series")
	if mkdirErr := os.MkdirAll(thumbnailsDir, 0o755); mkdirErr != nil {
		return false, mkdirErr
	}

	hash := md5.Sum([]byte(series.Path))
	hashString := hex.EncodeToString(hash[:])
	deleteHashFiles(thumbnailsDir, hashString)

	path := filepath.Join(thumbnailsDir, hashString+thumbnailExtFromMediaType(contentType))
	outFile, err := os.Create(path)
	if err != nil {
		return false, err
	}

	if _, err := io.Copy(outFile, io.LimitReader(resp.Body, 10*1024*1024)); err != nil {
		_ = outFile.Close()
		_ = os.Remove(path)
		return false, err
	}
	if err := outFile.Close(); err != nil {
		_ = os.Remove(path)
		return false, err
	}

	series.ThumbnailPath = &path
	url := util.BuildSeriesThumbnailURL(series.ID, series.ThumbnailPath, time.Now())
	series.ThumbnailURL = &url
	return true, nil
}

func thumbnailExtFromMediaType(mediaType string) string {
	switch {
	case strings.Contains(mediaType, "png"):
		return ".png"
	case strings.Contains(mediaType, "gif"):
		return ".gif"
	case strings.Contains(mediaType, "webp"):
		return ".webp"
	case strings.Contains(mediaType, "svg"):
		return ".svg"
	default:
		return ".jpg"
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

func (s *MetadataService) enrichSeriesThumbnail(series *model.Series) {
	if series == nil || s.seriesRepo == nil {
		return
	}
	if series.ThumbnailPath != nil && strings.TrimSpace(*series.ThumbnailPath) != "" {
		url := util.BuildSeriesThumbnailURL(series.ID, series.ThumbnailPath, series.UpdatedAt)
		series.ThumbnailURL = &url
		return
	}

	pageID, err := s.seriesRepo.GetFirstPageID(nil, series.ID)
	if err == nil && pageID != "" {
		url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
		series.ThumbnailURL = &url
		return
	}

	if s.volumeRepo == nil {
		return
	}
	vol, volErr := s.volumeRepo.GetFirstVolume(nil, series.ID)
	if volErr == nil && vol != nil && vol.ThumbnailPath != nil && strings.TrimSpace(*vol.ThumbnailPath) != "" {
		url := util.BuildVolumeThumbnailURL(vol.ID, vol.ThumbnailPath, vol.UpdatedAt)
		series.ThumbnailURL = &url
	}
}

func inferSearchLanguage(title string) sdktypes.Language {
	title = strings.TrimSpace(title)
	if title == "" {
		return ""
	}

	for _, r := range title {
		switch {
		case r >= 0xAC00 && r <= 0xD7A3:
			return sdktypes.Language("ko")
		case r >= 0x3040 && r <= 0x30FF:
			return sdktypes.Language("ja")
		case r >= 0x4E00 && r <= 0x9FFF:
			return sdktypes.Language("ja")
		case (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z'):
			return sdktypes.Language("en")
		}
	}

	return ""
}
