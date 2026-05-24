package handler

import (
	"bytes"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
)

// SyncHandler gestiona la autenticación con servicios externos (AniList, MAL)
type SyncHandler struct {
	userSettingRepo repository.UserSettingRepository
	httpClient      *http.Client
}

func NewSyncHandler(userSettingRepo repository.UserSettingRepository) *SyncHandler {
	return &SyncHandler{
		userSettingRepo: userSettingRepo,
		httpClient:      &http.Client{Timeout: 15 * time.Second},
	}
}

// ─── Claves de configuración de usuario ────────────────────────────────────

func anilistTokenKey() string      { return "anilist_token" }
func anilistUsernameKey() string   { return "anilist_username" }
func anilistAvatarKey() string     { return "anilist_avatar" }
func anilistClientIDKey() string   { return "anilist_client_id" }
func anilistClientSecretKey() string { return "anilist_client_secret" }

func malAccessTokenKey() string   { return "mal_access_token" }
func malRefreshTokenKey() string  { return "mal_refresh_token" }
func malTokenExpiresKey() string  { return "mal_token_expires" }
func malUsernameKey() string      { return "mal_username" }
func malAvatarKey() string        { return "mal_avatar" }
func malClientIDKey() string      { return "mal_client_id" }
func malClientSecretKey() string  { return "mal_client_secret" }
func malCodeVerifierKey() string  { return "mal_code_verifier" }

// ─── Helpers ────────────────────────────────────────────────────────────────

func (h *SyncHandler) getSetting(userID, key string) string {
	s, err := h.userSettingRepo.GetByKey(nil, userID, key)
	if err != nil || s == nil {
		return ""
	}
	return s.Value
}

func (h *SyncHandler) setSetting(userID, key, value string) error {
	return h.userSettingRepo.Update(nil, userID, key, value)
}

func (h *SyncHandler) deleteSetting(userID, key string) error {
	return h.userSettingRepo.Delete(nil, userID, key)
}

// ─── GET /api/v1/sync/status ────────────────────────────────────────────────

// GetStatus devuelve el estado de conexión de AniList y MAL para el usuario autenticado.
func (h *SyncHandler) GetStatus(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	anilistConnected := h.getSetting(userID, anilistTokenKey()) != ""
	malConnected := h.getSetting(userID, malAccessTokenKey()) != ""

	return c.JSON(fiber.Map{
		"anilist": fiber.Map{
			"connected":     anilistConnected,
			"username":      h.getSetting(userID, anilistUsernameKey()),
			"avatar":        h.getSetting(userID, anilistAvatarKey()),
			"client_id":     h.getSetting(userID, anilistClientIDKey()),
			"client_secret": h.getSetting(userID, anilistClientSecretKey()),
		},
		"mal": fiber.Map{
			"connected":     malConnected,
			"username":      h.getSetting(userID, malUsernameKey()),
			"avatar":        h.getSetting(userID, malAvatarKey()),
			"client_id":     h.getSetting(userID, malClientIDKey()),
			"client_secret": h.getSetting(userID, malClientSecretKey()),
		},
	})
}

// ─── POST /api/v1/sync/anilist/credentials ──────────────────────────────────

type anilistCredentialsRequest struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
}

// SaveAniListCredentials guarda el Client ID y Secret de AniList (sin iniciar sesión todavía).
func (h *SyncHandler) SaveAniList(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	var body anilistCredentialsRequest
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cuerpo de solicitud inválido"})
	}
	if strings.TrimSpace(body.ClientID) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Client ID de AniList requerido"})
	}

	_ = h.setSetting(userID, anilistClientIDKey(), strings.TrimSpace(body.ClientID))
	_ = h.setSetting(userID, anilistClientSecretKey(), strings.TrimSpace(body.ClientSecret))

	return c.JSON(fiber.Map{"success": true})
}

// ─── GET /api/v1/sync/anilist/authorize ─────────────────────────────────────

// AuthorizeAniList redirige al popup de autenticación de AniList OAuth2.
func (h *SyncHandler) AuthorizeAniList(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	clientID := h.getSetting(userID, anilistClientIDKey())
	if clientID == "" {
		return c.Status(fiber.StatusBadRequest).SendString("<h1>Error</h1><p>Configura el Client ID de AniList primero.</p>")
	}

	scheme := "http"
	if c.Protocol() == "https" {
		scheme = "https"
	}
	redirectURI := fmt.Sprintf("%s://%s/api/v1/sync/anilist/callback", scheme, c.Get("Host"))

	anilistURL := fmt.Sprintf(
		"https://anilist.co/api/v2/oauth/authorize?client_id=%s&redirect_uri=%s&response_type=code&state=%s",
		url.QueryEscape(clientID),
		url.QueryEscape(redirectURI),
		url.QueryEscape(userID),
	)

	return c.Redirect(anilistURL)
}

// ─── GET /api/v1/sync/anilist/callback ──────────────────────────────────────

// AniListCallback intercambia el código OAuth por tokens y guarda el perfil del usuario.
func (h *SyncHandler) AniListCallback(c *fiber.Ctx) error {
	code := c.Query("code")
	userID := c.Query("state")
	if code == "" || userID == "" {
		return c.Status(fiber.StatusBadRequest).SendString("<h1>Error</h1><p>Parámetros de callback inválidos.</p>")
	}

	clientID := h.getSetting(userID, anilistClientIDKey())
	clientSecret := h.getSetting(userID, anilistClientSecretKey())
	if clientID == "" {
		return c.Status(fiber.StatusBadRequest).SendString("<h1>Error</h1><p>Credenciales de AniList no encontradas. Inicia el proceso desde Ajustes.</p>")
	}

	scheme := "http"
	if c.Protocol() == "https" {
		scheme = "https"
	}
	redirectURI := fmt.Sprintf("%s://%s/api/v1/sync/anilist/callback", scheme, c.Get("Host"))

	// Intercambiar code por access_token
	tokenBody, _ := json.Marshal(map[string]string{
		"grant_type":    "authorization_code",
		"client_id":     clientID,
		"client_secret": clientSecret,
		"redirect_uri":  redirectURI,
		"code":          code,
	})

	tokenReq, _ := http.NewRequest(http.MethodPost, "https://anilist.co/api/v2/oauth/token", bytes.NewBuffer(tokenBody))
	tokenReq.Header.Set("Content-Type", "application/json")
	tokenReq.Header.Set("Accept", "application/json")

	tokenResp, err := h.httpClient.Do(tokenReq)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).SendString("<h1>Error</h1><p>No se pudo conectar con AniList.</p>")
	}
	defer func() { _ = tokenResp.Body.Close() }()

	rawBody, _ := io.ReadAll(tokenResp.Body)
	var tokenData struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
	}
	if err := json.Unmarshal(rawBody, &tokenData); err != nil || tokenData.AccessToken == "" {
		return c.Status(fiber.StatusUnauthorized).SendString(fmt.Sprintf("<h1>Error</h1><p>Respuesta de AniList inválida: %s</p>", string(rawBody)))
	}

	_ = h.setSetting(userID, anilistTokenKey(), tokenData.AccessToken)

	// Obtener perfil del usuario de AniList
	gqlQuery := `{"query":"query { Viewer { name avatar { large } } }"}`
	profileReq, _ := http.NewRequest(http.MethodPost, "https://graphql.anilist.co", bytes.NewBufferString(gqlQuery))
	profileReq.Header.Set("Authorization", "Bearer "+tokenData.AccessToken)
	profileReq.Header.Set("Content-Type", "application/json")
	profileReq.Header.Set("Accept", "application/json")

	profileResp, err := h.httpClient.Do(profileReq)
	if err == nil && profileResp.StatusCode == http.StatusOK {
		defer func() { _ = profileResp.Body.Close() }()
		var gqlResp struct {
			Data struct {
				Viewer struct {
					Name   string `json:"name"`
					Avatar struct {
						Large string `json:"large"`
					} `json:"avatar"`
				} `json:"Viewer"`
			} `json:"data"`
		}
		if err := json.NewDecoder(profileResp.Body).Decode(&gqlResp); err == nil {
			_ = h.setSetting(userID, anilistUsernameKey(), gqlResp.Data.Viewer.Name)
			_ = h.setSetting(userID, anilistAvatarKey(), gqlResp.Data.Viewer.Avatar.Large)
		}
	}

	return c.Type("html").SendString(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Conectado con AniList</title>
  <style>
    body { background: #0f172a; color: #f1f5f9; font-family: sans-serif;
           display: flex; flex-direction: column; align-items: center;
           justify-content: center; height: 100vh; margin: 0; text-align: center; }
    h1 { color: #02a9ff; font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #94a3b8; }
    .spinner { border: 3px solid rgba(255,255,255,0.1); width: 32px; height: 32px;
               border-radius: 50%; border-left-color: #02a9ff;
               animation: spin 1s linear infinite; margin: 1rem auto; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <h1>¡Conexión Exitosa!</h1>
  <p>Cuenta de AniList vinculada correctamente.</p>
  <div class="spinner"></div>
  <script>
    if (window.opener) { window.opener.postMessage({ type: 'ANILIST_AUTH_SUCCESS' }, '*'); }
    setTimeout(() => window.close(), 1500);
  </script>
</body>
</html>`)
}

// ─── POST /api/v1/sync/anilist/disconnect ───────────────────────────────────

// DisconnectAniList elimina los datos de sesión de AniList del usuario.
func (h *SyncHandler) DisconnectAniList(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	_ = h.deleteSetting(userID, anilistTokenKey())
	_ = h.deleteSetting(userID, anilistUsernameKey())
	_ = h.deleteSetting(userID, anilistAvatarKey())
	// No borramos client_id/secret para que el usuario no tenga que reintroducirlos
	return c.JSON(fiber.Map{"success": true})
}

// ─── POST /api/v1/sync/mal/credentials ──────────────────────────────────────

type malCredentialsRequest struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
}

// SaveMALCredentials guarda el Client ID y Secret de MAL (sin iniciar sesión todavía).
func (h *SyncHandler) SaveMALCredentials(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	var body malCredentialsRequest
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cuerpo de solicitud inválido"})
	}

	_ = h.setSetting(userID, malClientIDKey(), strings.TrimSpace(body.ClientID))
	_ = h.setSetting(userID, malClientSecretKey(), strings.TrimSpace(body.ClientSecret))

	return c.JSON(fiber.Map{"success": true})
}

// ─── GET /api/v1/sync/mal/authorize ─────────────────────────────────────────

// AuthorizeMAL genera el code_verifier PKCE y redirige al popup de MAL.
func (h *SyncHandler) AuthorizeMAL(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	clientID := h.getSetting(userID, malClientIDKey())
	if clientID == "" {
		return c.Status(fiber.StatusBadRequest).SendString("<h1>Error</h1><p>Configura el Client ID de MyAnimeList primero.</p>")
	}

	// Generar code_verifier aleatorio (PKCE plain)
	buf := make([]byte, 32)
	_, _ = rand.Read(buf)
	codeVerifier := hex.EncodeToString(buf)
	_ = h.setSetting(userID, malCodeVerifierKey(), codeVerifier)

	scheme := "http"
	if c.Protocol() == "https" {
		scheme = "https"
	}
	redirectURI := fmt.Sprintf("%s://%s/api/v1/sync/mal/callback", scheme, c.Get("Host"))

	malURL := fmt.Sprintf(
		"https://myanimelist.net/v1/oauth2/authorize?response_type=code&client_id=%s&code_challenge=%s&code_challenge_method=plain&redirect_uri=%s&state=%s",
		url.QueryEscape(clientID),
		url.QueryEscape(codeVerifier),
		url.QueryEscape(redirectURI),
		url.QueryEscape(userID),
	)

	return c.Redirect(malURL)
}

// ─── GET /api/v1/sync/mal/callback ──────────────────────────────────────────

// MALCallback intercambia el código OAuth por tokens y guarda el perfil del usuario.
// NOTA: Este endpoint es accedido desde el navegador vía redirección desde MAL.
//
//	El JWT viene como query param (state) porque las cookies no viajan cross-origin.
func (h *SyncHandler) MALCallback(c *fiber.Ctx) error {
	code := c.Query("code")
	userID := c.Query("state") // el user_id se pasa como state
	if code == "" || userID == "" {
		return c.Status(fiber.StatusBadRequest).SendString("<h1>Error</h1><p>Parámetros de callback inválidos.</p>")
	}

	clientID := h.getSetting(userID, malClientIDKey())
	clientSecret := h.getSetting(userID, malClientSecretKey())
	codeVerifier := h.getSetting(userID, malCodeVerifierKey())

	if clientID == "" || codeVerifier == "" {
		return c.Status(fiber.StatusBadRequest).SendString("<h1>Error</h1><p>Credenciales de MAL no encontradas. Inicia el proceso desde Ajustes.</p>")
	}

	scheme := "http"
	if c.Protocol() == "https" {
		scheme = "https"
	}
	redirectURI := fmt.Sprintf("%s://%s/api/v1/sync/mal/callback", scheme, c.Get("Host"))

	// Intercambiar code por access_token
	formData := url.Values{}
	formData.Set("client_id", clientID)
	formData.Set("client_secret", clientSecret)
	formData.Set("grant_type", "authorization_code")
	formData.Set("code", code)
	formData.Set("code_verifier", codeVerifier)
	formData.Set("redirect_uri", redirectURI)

	tokenReq, _ := http.NewRequest(http.MethodPost, "https://myanimelist.net/v1/oauth2/token", strings.NewReader(formData.Encode()))
	tokenReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	tokenResp, err := h.httpClient.Do(tokenReq)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).SendString("<h1>Error</h1><p>No se pudo conectar con MyAnimeList.</p>")
	}
	defer func() { _ = tokenResp.Body.Close() }()

	rawBody, _ := io.ReadAll(tokenResp.Body)
	var tokenData struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.Unmarshal(rawBody, &tokenData); err != nil || tokenData.AccessToken == "" {
		return c.Status(fiber.StatusUnauthorized).SendString(fmt.Sprintf("<h1>Error</h1><p>Respuesta de MAL inválida: %s</p>", string(rawBody)))
	}

	expiresAt := fmt.Sprintf("%d", time.Now().Unix()+int64(tokenData.ExpiresIn))

	_ = h.setSetting(userID, malAccessTokenKey(), tokenData.AccessToken)
	_ = h.setSetting(userID, malRefreshTokenKey(), tokenData.RefreshToken)
	_ = h.setSetting(userID, malTokenExpiresKey(), expiresAt)
	_ = h.deleteSetting(userID, malCodeVerifierKey())

	// Obtener perfil del usuario de MAL
	profileReq, _ := http.NewRequest(http.MethodGet, "https://api.myanimelist.net/v2/users/@me", nil)
	profileReq.Header.Set("Authorization", "Bearer "+tokenData.AccessToken)

	profileResp, err := h.httpClient.Do(profileReq)
	if err == nil && profileResp.StatusCode == http.StatusOK {
		defer func() { _ = profileResp.Body.Close() }()
		var profile struct {
			Name    string `json:"name"`
			Picture string `json:"picture"`
		}
		if err := json.NewDecoder(profileResp.Body).Decode(&profile); err == nil {
			_ = h.setSetting(userID, malUsernameKey(), profile.Name)
			_ = h.setSetting(userID, malAvatarKey(), profile.Picture)
		}
	}

	// Responder con HTML que notifica al padre y se cierra
	return c.Type("html").SendString(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Conectado con MyAnimeList</title>
  <style>
    body { background: #0f172a; color: #f1f5f9; font-family: sans-serif;
           display: flex; flex-direction: column; align-items: center;
           justify-content: center; height: 100vh; margin: 0; text-align: center; }
    h1 { color: #6366f1; font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #94a3b8; }
    .spinner { border: 3px solid rgba(255,255,255,0.1); width: 32px; height: 32px;
               border-radius: 50%; border-left-color: #6366f1;
               animation: spin 1s linear infinite; margin: 1rem auto; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <h1>¡Conexión Exitosa!</h1>
  <p>Cuenta de MyAnimeList vinculada correctamente.</p>
  <div class="spinner"></div>
  <script>
    if (window.opener) { window.opener.postMessage({ type: 'MAL_AUTH_SUCCESS' }, '*'); }
    setTimeout(() => window.close(), 1500);
  </script>
</body>
</html>`)
}

// ─── POST /api/v1/sync/mal/disconnect ───────────────────────────────────────

// DisconnectMAL elimina todos los datos de sesión de MAL del usuario.
func (h *SyncHandler) DisconnectMAL(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	for _, key := range []string{malAccessTokenKey(), malRefreshTokenKey(), malTokenExpiresKey(), malUsernameKey(), malAvatarKey()} {
		_ = h.deleteSetting(userID, key)
	}
	return c.JSON(fiber.Map{"success": true})
}

func parseSQLiteTime(str string) (time.Time, error) {
	str = strings.TrimSpace(str)
	if str == "" {
		return time.Time{}, fmt.Errorf("empty time string")
	}
	formats := []string{
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05",
		time.RFC3339,
		"2006-01-02T15:04:05.999999999Z07:00",
		"2006-01-02",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, str); err == nil {
			return t, nil
		}
	}
	if t, err := time.Parse(time.RFC3339, strings.Replace(str, " ", "T", 1)); err == nil {
		return t, nil
	}
	return time.Time{}, fmt.Errorf("failed to parse time: %s", str)
}

var (
	chOnlyPattern     = regexp.MustCompile(`(?i)(?:chapter|ch|ep|episode|#)\.?\s*(\d+(?:\.\d+)?)`)
	volOnlyPattern    = regexp.MustCompile(`(?i)(?:volume|vol|v)\.?\s*(\d+(?:\.\d+)?)`)
	allNumbersPattern = regexp.MustCompile(`\d+(?:\.\d+)?`)
)

func parseNumberFromString(s string) (float64, bool) {
	if matches := chOnlyPattern.FindStringSubmatch(s); len(matches) > 1 {
		if val, err := strconv.ParseFloat(matches[1], 64); err == nil {
			return val, true
		}
	}
	if matches := volOnlyPattern.FindStringSubmatch(s); len(matches) > 1 {
		if val, err := strconv.ParseFloat(matches[1], 64); err == nil {
			return val, true
		}
	}
	matches := allNumbersPattern.FindAllString(s, -1)
	if len(matches) > 0 {
		lastMatch := matches[len(matches)-1]
		if val, err := strconv.ParseFloat(lastMatch, 64); err == nil {
			return val, true
		}
	}
	return 0, false
}

// SyncSeriesProgress se ejecuta en segundo plano para sincronizar el progreso de lectura del usuario en AniList y/o MAL
func (h *SyncHandler) SyncSeriesProgress(userID, seriesID string) {
	log.Printf("[SyncSeriesProgress] Starting sync for user %s and series %s", userID, seriesID)
	// 1. Obtener IDs externos desde la base de datos
	var anilistID, malID string
	err := database.DB.QueryRow(
		`SELECT COALESCE(anilist_id, ''), COALESCE(mal_id, '') FROM series_metadata WHERE series_id = ?`,
		seriesID,
	).Scan(&anilistID, &malID)
	if err != nil {
		log.Printf("[SyncSeriesProgress] Error fetching external IDs: %v", err)
		return
	}
	log.Printf("[SyncSeriesProgress] External IDs: AniList=%s, MAL=%s", anilistID, malID)
	if anilistID == "" && malID == "" {
		log.Printf("[SyncSeriesProgress] No external IDs configured for series %s", seriesID)
		return // Sin IDs de servicios externos configurados
	}

	// 2. Obtener progreso de lectura de Kumiho (capítulos leídos, capítulo máximo leído y total de capítulos)
	var completedCount, totalChapters int
	progress := 0

	rows, err := database.DB.Query(
		`SELECT c.chapter_number, v.volume_number, c.title, v.title FROM chapter_completions cc
		 JOIN chapters c ON cc.chapter_id = c.id
		 JOIN volumes v ON c.volume_id = v.id
		 WHERE cc.user_id = ? AND v.series_id = ?`,
		userID, seriesID,
	)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var chNum, volNum int
			var chTitle, volTitle string
			if err := rows.Scan(&chNum, &volNum, &chTitle, &volTitle); err == nil {
				candidate := float64(chNum)
				if num, ok := parseNumberFromString(chTitle); ok {
					if num > candidate {
						candidate = num
					}
				}
				if num, ok := parseNumberFromString(volTitle); ok {
					if num > candidate {
						candidate = num
					}
				}
				if float64(volNum) > candidate {
					candidate = float64(volNum)
				}
				if int(candidate) > progress {
					progress = int(candidate)
				}
			}
		}
	}

	_ = database.DB.QueryRow(
		`SELECT COUNT(*) FROM chapter_completions cc
		 JOIN chapters c ON cc.chapter_id = c.id
		 JOIN volumes v ON c.volume_id = v.id
		 WHERE cc.user_id = ? AND v.series_id = ?`,
		userID, seriesID,
	).Scan(&completedCount)

	_ = database.DB.QueryRow(
		`SELECT COUNT(*) FROM chapters c
		 JOIN volumes v ON c.volume_id = v.id
		 WHERE v.series_id = ?`,
		seriesID,
	).Scan(&totalChapters)

	log.Printf("[SyncSeriesProgress] progress=%d (max chapter number), completedCount=%d, totalChapters=%d", progress, completedCount, totalChapters)
	if totalChapters == 0 {
		return
	}

	isComplete := completedCount >= totalChapters
	status := "CURRENT"
	malStatus := "reading"
	if isComplete {
		status = "COMPLETED"
		malStatus = "completed"
	}

	// 3. Obtener fechas de inicio y finalización
	var minStr, maxStr sql.NullString
	_ = database.DB.QueryRow(
		`SELECT MIN(completed_at), MAX(completed_at) FROM chapter_completions cc
		 JOIN chapters c ON cc.chapter_id = c.id
		 JOIN volumes v ON c.volume_id = v.id
		 WHERE cc.user_id = ? AND v.series_id = ?`,
		userID, seriesID,
	).Scan(&minStr, &maxStr)

	var minCompletedAt, maxCompletedAt sql.NullTime
	if minStr.Valid {
		if t, err := parseSQLiteTime(minStr.String); err == nil {
			minCompletedAt.Time = t
			minCompletedAt.Valid = true
		} else {
			log.Printf("[SyncSeriesProgress] Failed to parse minCompletedAt string %q: %v", minStr.String, err)
		}
	}
	if maxStr.Valid {
		if t, err := parseSQLiteTime(maxStr.String); err == nil {
			maxCompletedAt.Time = t
			maxCompletedAt.Valid = true
		} else {
			log.Printf("[SyncSeriesProgress] Failed to parse maxCompletedAt string %q: %v", maxStr.String, err)
		}
	}

	// 4. Sincronizar con AniList
	if anilistID != "" {
		token := h.getSetting(userID, anilistTokenKey())
		if token != "" {
			log.Printf("[SyncSeriesProgress] Syncing to AniList: mediaID=%s, progress=%d, status=%s", anilistID, progress, status)
			h.syncToAniList(token, anilistID, progress, status, minCompletedAt, maxCompletedAt)
		} else {
			log.Printf("[SyncSeriesProgress] AniList token not found for user %s", userID)
		}
	}

	// 5. Sincronizar con MyAnimeList
	if malID != "" {
		accessToken := h.getSetting(userID, malAccessTokenKey())
		if accessToken != "" {
			// Comprobar expiración del token de MAL y refrescar si es necesario
			expiresStr := h.getSetting(userID, malTokenExpiresKey())
			var expires int64
			_, _ = fmt.Sscanf(expiresStr, "%d", &expires)
			log.Printf("[SyncSeriesProgress] MAL token expires at: %d (now=%d)", expires, time.Now().Unix())
			if expires > 0 && time.Now().Unix() >= expires {
				log.Printf("[SyncSeriesProgress] MAL token expired. Refreshing...")
				newAccess, newRefresh, newExpires, refreshErr := h.refreshMALToken(userID)
				if refreshErr == nil {
					log.Printf("[SyncSeriesProgress] MAL token refreshed successfully")
					accessToken = newAccess
					_ = h.setSetting(userID, malAccessTokenKey(), newAccess)
					_ = h.setSetting(userID, malRefreshTokenKey(), newRefresh)
					_ = h.setSetting(userID, malTokenExpiresKey(), fmt.Sprintf("%d", newExpires))
				} else {
					log.Printf("[SyncSeriesProgress] Error refreshing MAL token: %v", refreshErr)
					accessToken = ""
				}
			}

			if accessToken != "" {
				log.Printf("[SyncSeriesProgress] Syncing to MAL: malID=%s, progress=%d, status=%s", malID, progress, malStatus)
				h.syncToMAL(accessToken, malID, progress, malStatus, minCompletedAt, maxCompletedAt)
			}
		} else {
			log.Printf("[SyncSeriesProgress] MAL accessToken not found for user %s", userID)
		}
	}
}

func (h *SyncHandler) syncToAniList(token, mediaID string, progress int, status string, minTime, maxTime sql.NullTime) {
	var mediaIDInt int
	if _, err := fmt.Sscanf(mediaID, "%d", &mediaIDInt); err != nil {
		log.Printf("[syncToAniList] Error parsing mediaID %s: %v", mediaID, err)
		return
	}

	vars := map[string]interface{}{
		"mediaId":  mediaIDInt,
		"progress": progress,
		"status":   status,
	}

	if minTime.Valid {
		t := minTime.Time
		vars["startedAt"] = map[string]int{
			"year":  t.Year(),
			"month": int(t.Month()),
			"day":   t.Day(),
		}
	}
	if maxTime.Valid && status == "COMPLETED" {
		t := maxTime.Time
		vars["completedAt"] = map[string]int{
			"year":  t.Year(),
			"month": int(t.Month()),
			"day":   t.Day(),
		}
	}

	reqBody, _ := json.Marshal(map[string]interface{}{
		"query": `mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
			SaveMediaListEntry (mediaId: $mediaId, progress: $progress, status: $status, startedAt: $startedAt, completedAt: $completedAt) {
				id
				progress
				status
			}
		}`,
		"variables": vars,
	})

	req, _ := http.NewRequest(http.MethodPost, "https://graphql.anilist.co", bytes.NewBuffer(reqBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := h.httpClient.Do(req)
	if err != nil {
		log.Printf("[syncToAniList] Network error calling AniList API: %v", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()

	bodyBytes, _ := io.ReadAll(resp.Body)
	log.Printf("[syncToAniList] Response: Status=%s, Body=%s", resp.Status, string(bodyBytes))
}

func (h *SyncHandler) syncToMAL(accessToken, mangaID string, progress int, status string, minTime, maxTime sql.NullTime) {
	endpoint := fmt.Sprintf("https://api.myanimelist.net/v2/manga/%s/my_list_status", mangaID)

	formData := url.Values{}
	formData.Set("num_chapters_read", fmt.Sprintf("%d", progress))
	formData.Set("status", status)

	if minTime.Valid {
		formData.Set("start_date", minTime.Time.Format("2006-01-02"))
	}
	if maxTime.Valid && status == "completed" {
		formData.Set("finish_date", maxTime.Time.Format("2006-01-02"))
	}

	req, _ := http.NewRequest(http.MethodPut, endpoint, strings.NewReader(formData.Encode()))
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := h.httpClient.Do(req)
	if err != nil {
		log.Printf("[syncToMAL] Network error calling MAL API: %v", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()

	bodyBytes, _ := io.ReadAll(resp.Body)
	log.Printf("[syncToMAL] Response: Status=%s, Body=%s", resp.Status, string(bodyBytes))
}

func (h *SyncHandler) refreshMALToken(userID string) (string, string, int64, error) {
	clientID := h.getSetting(userID, malClientIDKey())
	clientSecret := h.getSetting(userID, malClientSecretKey())
	refreshToken := h.getSetting(userID, malRefreshTokenKey())

	if clientID == "" || refreshToken == "" {
		return "", "", 0, fmt.Errorf("missing credentials")
	}

	formData := url.Values{}
	formData.Set("client_id", clientID)
	formData.Set("client_secret", clientSecret)
	formData.Set("grant_type", "refresh_token")
	formData.Set("refresh_token", refreshToken)

	req, _ := http.NewRequest(http.MethodPost, "https://myanimelist.net/v1/oauth2/token", strings.NewReader(formData.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return "", "", 0, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return "", "", 0, fmt.Errorf("mal returned status %d", resp.StatusCode)
	}

	var data struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", "", 0, err
	}

	expiresAt := time.Now().Unix() + int64(data.ExpiresIn)
	return data.AccessToken, data.RefreshToken, expiresAt, nil
}
