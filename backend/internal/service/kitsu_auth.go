package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	pluginerrors "github.com/kumiho-plugin/kumiho-plugin-sdk/errors"
)

const (
	kitsuOAuthTokenURL   = "https://kitsu.io/api/oauth/token"
	kitsuDefaultClientID = "dd031b32d2f56c990b1425efe6c42ad847e7fe3ab46bf1299f05ecd856bdb7dd"
	kitsuDefaultSecret   = "54d7307928f63414defd96399fc31ba847961ceaecef3a5fd93144e960c0e151"
)

type KitsuAuthService struct {
	client *http.Client
}

type KitsuTokenPair struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    int
	TokenType    string
}

type kitsuTokenResponse struct {
	AccessToken  string `json:"access_token"`
	CreatedAt    int64  `json:"created_at"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
	TokenType    string `json:"token_type"`
	Error        string `json:"error"`
	Description  string `json:"error_description"`
}

func NewKitsuAuthService(client *http.Client) *KitsuAuthService {
	if client == nil {
		client = http.DefaultClient
	}
	return &KitsuAuthService{client: client}
}

func (s *KitsuAuthService) PasswordGrant(ctx context.Context, username, password string) (*KitsuTokenPair, error) {
	username = strings.TrimSpace(username)
	password = strings.TrimSpace(password)
	if username == "" || password == "" {
		return nil, pluginerrors.New(pluginerrors.ErrCodeInvalidRequest, "username and password are required")
	}

	values := url.Values{}
	values.Set("grant_type", "password")
	values.Set("username", username)
	values.Set("password", password)
	values.Set("client_id", kitsuDefaultClientID)
	values.Set("client_secret", kitsuDefaultSecret)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, kitsuOAuthTokenURL, strings.NewReader(values.Encode()))
	if err != nil {
		return nil, pluginerrors.New(pluginerrors.ErrCodeUnknown, err.Error())
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, pluginerrors.NewRetryable(pluginerrors.ErrCodeTimeout, err.Error())
	}
	defer resp.Body.Close()

	var payload kitsuTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, pluginerrors.New(pluginerrors.ErrCodeProviderError, err.Error())
	}

	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusBadRequest:
		return nil, pluginerrors.New(pluginerrors.ErrCodeUnauthorized, firstNonEmptyString(payload.Description, payload.Error, "kitsu login failed"))
	case http.StatusUnauthorized, http.StatusForbidden:
		return nil, pluginerrors.New(pluginerrors.ErrCodeUnauthorized, firstNonEmptyString(payload.Description, payload.Error, "kitsu login unauthorized"))
	default:
		if resp.StatusCode >= 500 {
			return nil, pluginerrors.NewRetryable(pluginerrors.ErrCodeProviderError, fmt.Sprintf("kitsu token endpoint returned status %d", resp.StatusCode))
		}
		return nil, pluginerrors.New(pluginerrors.ErrCodeProviderError, fmt.Sprintf("kitsu token endpoint returned status %d", resp.StatusCode))
	}

	if strings.TrimSpace(payload.AccessToken) == "" {
		return nil, pluginerrors.New(pluginerrors.ErrCodeProviderError, "kitsu token response is missing access_token")
	}

	return &KitsuTokenPair{
		AccessToken:  strings.TrimSpace(payload.AccessToken),
		RefreshToken: strings.TrimSpace(payload.RefreshToken),
		ExpiresIn:    payload.ExpiresIn,
		TokenType:    strings.TrimSpace(payload.TokenType),
	}, nil
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
