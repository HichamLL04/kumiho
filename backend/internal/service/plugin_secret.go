package service

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	sdkconfig "github.com/kumiho-plugin/kumiho-plugin-sdk/config"
	pluginerrors "github.com/kumiho-plugin/kumiho-plugin-sdk/errors"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
)

type PluginConfigFieldStatus struct {
	Key        string `json:"key"`
	Type       string `json:"type"`
	Required   bool   `json:"required"`
	Configured bool   `json:"configured"`
	Source     string `json:"source,omitempty"`
	MaskedHint string `json:"masked_hint,omitempty"`
}

type PluginConfigStatus struct {
	PluginID string                    `json:"plugin_id"`
	Fields   []PluginConfigFieldStatus `json:"fields"`
}

type pluginSecretSpec struct {
	FieldKey string
	EnvKey   string
	Required bool
}

type PluginSecretService struct {
	cfg  *config.Config
	repo repository.PluginSecretRepository
}

func NewPluginSecretService(cfg *config.Config, repo repository.PluginSecretRepository) *PluginSecretService {
	return &PluginSecretService{cfg: cfg, repo: repo}
}

func (s *PluginSecretService) Status(pluginID string, manifest sdkmanifest.Manifest) (*PluginConfigStatus, error) {
	specs := configSpecsForManifest(manifest)
	fields := make([]PluginConfigFieldStatus, 0, len(specs))
	for _, spec := range specs {
		configured, source, masked, err := s.resolveFieldStatus(pluginID, spec)
		if err != nil {
			return nil, err
		}
		fields = append(fields, PluginConfigFieldStatus{
			Key:        spec.FieldKey,
			Type:       "secret",
			Required:   spec.Required,
			Configured: configured,
			Source:     source,
			MaskedHint: masked,
		})
	}

	return &PluginConfigStatus{
		PluginID: pluginID,
		Fields:   fields,
	}, nil
}

func (s *PluginSecretService) SetSecret(pluginID string, manifest sdkmanifest.Manifest, fieldKey, value string) (*PluginConfigStatus, error) {
	spec, ok := findConfigSpec(manifest, fieldKey)
	if !ok {
		return nil, pluginerrors.New(pluginerrors.ErrCodeConfigInvalid, "unsupported plugin config field")
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, pluginerrors.New(pluginerrors.ErrCodeConfigMissingRequired, "config value is required")
	}

	encrypted, err := s.encrypt(value)
	if err != nil {
		return nil, err
	}
	if err := s.repo.Upsert(nil, pluginID, spec.FieldKey, encrypted); err != nil {
		return nil, err
	}
	return s.Status(pluginID, manifest)
}

func (s *PluginSecretService) SetSecrets(pluginID string, manifest sdkmanifest.Manifest, values map[string]string) (*PluginConfigStatus, error) {
	for fieldKey, value := range values {
		spec, ok := findConfigSpec(manifest, fieldKey)
		if !ok {
			return nil, pluginerrors.New(pluginerrors.ErrCodeConfigInvalid, "unsupported plugin config field")
		}
		value = strings.TrimSpace(value)
		if value == "" {
			if spec.Required {
				return nil, pluginerrors.New(pluginerrors.ErrCodeConfigMissingRequired, "config value is required")
			}
			continue
		}

		encrypted, err := s.encrypt(value)
		if err != nil {
			return nil, err
		}
		if err := s.repo.Upsert(nil, pluginID, spec.FieldKey, encrypted); err != nil {
			return nil, err
		}
	}
	return s.Status(pluginID, manifest)
}

func (s *PluginSecretService) DeleteSecret(pluginID string, manifest sdkmanifest.Manifest, fieldKey string) (*PluginConfigStatus, error) {
	if _, ok := findConfigSpec(manifest, fieldKey); !ok {
		return nil, pluginerrors.New(pluginerrors.ErrCodeConfigInvalid, "unsupported plugin config field")
	}
	if err := s.repo.Delete(nil, pluginID, fieldKey); err != nil {
		return nil, err
	}
	return s.Status(pluginID, manifest)
}

func (s *PluginSecretService) DeleteAllForPlugin(pluginID string) error {
	return s.repo.DeleteByPlugin(nil, pluginID)
}

func (s *PluginSecretService) EnvironmentForPlugin(id string, manifest sdkmanifest.Manifest) (map[string]string, error) {
	specs := configSpecsForManifest(manifest)
	if len(specs) == 0 {
		return nil, nil
	}

	env := make(map[string]string, len(specs))
	for _, spec := range specs {
		if err := validateSecretSpec(spec); err != nil {
			return nil, err
		}
		secret, err := s.repo.GetByKey(nil, id, spec.FieldKey)
		if err != nil {
			return nil, err
		}
		if secret != nil {
			decrypted, err := s.decrypt(secret.ValueEncrypted)
			if err != nil {
				return nil, err
			}
			env[spec.EnvKey] = decrypted
			continue
		}

		if value := strings.TrimSpace(os.Getenv(spec.EnvKey)); value != "" {
			env[spec.EnvKey] = value
		}
	}

	if len(env) == 0 {
		return nil, nil
	}
	return env, nil
}

func (s *PluginSecretService) ValidateActivation(id string, manifest sdkmanifest.Manifest) error {
	for _, spec := range configSpecsForManifest(manifest) {
		if err := validateSecretSpec(spec); err != nil {
			return err
		}
		if !spec.Required {
			continue
		}
		configured, _, _, err := s.resolveFieldStatus(id, spec)
		if err != nil {
			return err
		}
		if !configured {
			return pluginerrors.Newf(pluginerrors.ErrCodeConfigMissingRequired, "%s is required before activating this plugin", spec.FieldKey)
		}
	}
	return nil
}

func (s *PluginSecretService) resolveFieldStatus(pluginID string, spec pluginSecretSpec) (configured bool, source string, masked string, err error) {
	if validateErr := validateSecretSpec(spec); validateErr != nil {
		return false, "", "", validateErr
	}
	secret, err := s.repo.GetByKey(nil, pluginID, spec.FieldKey)
	if err != nil {
		return false, "", "", err
	}
	if secret != nil {
		decrypted, err := s.decrypt(secret.ValueEncrypted)
		if err != nil {
			return false, "", "", err
		}
		return true, "secret", maskSecret(decrypted), nil
	}

	if envValue := strings.TrimSpace(os.Getenv(spec.EnvKey)); envValue != "" {
		return true, "environment", maskSecret(envValue), nil
	}

	return false, "", "", nil
}

func (s *PluginSecretService) encrypt(value string) (string, error) {
	block, err := aes.NewCipher(s.secretKey())
	if err != nil {
		return "", fmt.Errorf("create secret cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("create secret gcm: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("generate secret nonce: %w", err)
	}

	ciphertext := gcm.Seal(nil, nonce, []byte(value), nil)
	payload := append(nonce, ciphertext...)
	return base64.StdEncoding.EncodeToString(payload), nil
}

func (s *PluginSecretService) decrypt(valueEncrypted string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(valueEncrypted)
	if err != nil {
		return "", fmt.Errorf("decode secret: %w", err)
	}

	block, err := aes.NewCipher(s.secretKey())
	if err != nil {
		return "", fmt.Errorf("create secret cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("create secret gcm: %w", err)
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("encrypted secret payload is too short")
	}

	nonce := raw[:gcm.NonceSize()]
	ciphertext := raw[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt secret: %w", err)
	}
	return string(plaintext), nil
}

func (s *PluginSecretService) secretKey() []byte {
	seed := strings.TrimSpace(s.cfg.PluginSecretKey)
	if seed == "" {
		seed = s.cfg.JWTSecret
	}
	sum := sha256.Sum256([]byte(seed))
	return sum[:]
}

func configSpecsForManifest(manifest sdkmanifest.Manifest) []pluginSecretSpec {
	if manifest.ConfigSchema == nil {
		return nil
	}

	specs := make([]pluginSecretSpec, 0, len(manifest.ConfigSchema.Fields))
	for _, field := range manifest.ConfigSchema.Fields {
		if field.Type != sdkconfig.FieldTypeSecret {
			continue
		}
		specs = append(specs, pluginSecretSpec{
			FieldKey: field.Key,
			EnvKey:   strings.TrimSpace(field.EnvKey),
			Required: field.Required,
		})
	}
	return specs
}

func findConfigSpec(manifest sdkmanifest.Manifest, fieldKey string) (pluginSecretSpec, bool) {
	for _, spec := range configSpecsForManifest(manifest) {
		if spec.FieldKey == fieldKey {
			return spec, true
		}
	}
	return pluginSecretSpec{}, false
}

func validateSecretSpec(spec pluginSecretSpec) error {
	if spec.EnvKey == "" {
		return pluginerrors.New(pluginerrors.ErrCodeConfigInvalid, "secret config field is missing env_key")
	}
	return nil
}

func maskSecret(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if len(value) <= 4 {
		return "••••"
	}
	return "••••" + value[len(value)-4:]
}
