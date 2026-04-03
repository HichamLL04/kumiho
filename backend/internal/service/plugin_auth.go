package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	sdkconfig "github.com/kumiho-plugin/kumiho-plugin-sdk/config"
	pluginerrors "github.com/kumiho-plugin/kumiho-plugin-sdk/errors"
)

type PluginAuthService struct {
	client *http.Client
}

type PluginAuthResult struct {
	Secrets  map[string]string
	Metadata map[string]any
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	CreatedAt    int64  `json:"created_at"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
	TokenType    string `json:"token_type"`
	Error        string `json:"error"`
	Description  string `json:"error_description"`
}

const defaultPluginAuthTimeout = 15 * time.Second

func NewPluginAuthService(client *http.Client) *PluginAuthService {
	if client == nil {
		client = &http.Client{Timeout: defaultPluginAuthTimeout}
	}
	return &PluginAuthService{client: client}
}

func (s *PluginAuthService) Execute(ctx context.Context, action sdkconfig.AuthAction, values map[string]string) (*PluginAuthResult, error) {
	switch action.Type {
	case sdkconfig.AuthActionTypePasswordGrant:
		return s.executePasswordGrant(ctx, action, values)
	default:
		return nil, pluginerrors.Newf(pluginerrors.ErrCodeUnsupported, "unsupported auth action type %q", action.Type)
	}
}

func (s *PluginAuthService) executePasswordGrant(ctx context.Context, action sdkconfig.AuthAction, values map[string]string) (*PluginAuthResult, error) {
	endpoint := strings.TrimSpace(action.Endpoint)
	if endpoint == "" {
		return nil, pluginerrors.New(pluginerrors.ErrCodeConfigInvalid, "auth action endpoint is required")
	}

	form := url.Values{}
	for key, value := range action.Params {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			form.Set(key, trimmed)
		}
	}

	for _, field := range action.Fields {
		value := strings.TrimSpace(values[field.Key])
		if field.Required && value == "" {
			return nil, pluginerrors.Newf(pluginerrors.ErrCodeInvalidRequest, "%s is required", field.Key)
		}
		if value != "" {
			form.Set(field.Key, value)
		}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, pluginerrors.New(pluginerrors.ErrCodeUnknown, err.Error())
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, classifyPluginAuthError(err)
	}
	defer resp.Body.Close()

	var payload tokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, pluginerrors.New(pluginerrors.ErrCodeProviderError, err.Error())
	}

	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusBadRequest:
		return nil, pluginerrors.New(pluginerrors.ErrCodeUnauthorized, firstNonEmptyString(payload.Description, payload.Error, "login failed"))
	case http.StatusUnauthorized, http.StatusForbidden:
		return nil, pluginerrors.New(pluginerrors.ErrCodeUnauthorized, firstNonEmptyString(payload.Description, payload.Error, "login unauthorized"))
	default:
		if resp.StatusCode >= 500 {
			return nil, pluginerrors.NewRetryable(pluginerrors.ErrCodeProviderError, fmt.Sprintf("auth endpoint returned status %d", resp.StatusCode))
		}
		return nil, pluginerrors.New(pluginerrors.ErrCodeProviderError, fmt.Sprintf("auth endpoint returned status %d", resp.StatusCode))
	}

	secrets := make(map[string]string, len(action.StoreMappings))
	for targetKey, sourceKey := range action.StoreMappings {
		value := strings.TrimSpace(readTokenField(payload, sourceKey))
		if value != "" {
			secrets[targetKey] = value
		}
	}
	if len(secrets) == 0 {
		return nil, pluginerrors.New(pluginerrors.ErrCodeProviderError, "auth response did not contain any mapped secret values")
	}

	return &PluginAuthResult{
		Secrets: secrets,
		Metadata: map[string]any{
			"expires_in": payload.ExpiresIn,
			"token_type": strings.TrimSpace(payload.TokenType),
		},
	}, nil
}

func readTokenField(payload tokenResponse, field string) string {
	switch strings.TrimSpace(field) {
	case "access_token":
		return payload.AccessToken
	case "refresh_token":
		return payload.RefreshToken
	case "token_type":
		return payload.TokenType
	default:
		return ""
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func classifyPluginAuthError(err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return pluginerrors.NewRetryable(pluginerrors.ErrCodeTimeout, err.Error())
	}

	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return pluginerrors.NewRetryable(pluginerrors.ErrCodeTimeout, err.Error())
	}

	return pluginerrors.NewRetryable(pluginerrors.ErrCodeProviderError, err.Error())
}
