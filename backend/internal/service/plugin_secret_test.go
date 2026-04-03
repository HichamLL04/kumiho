package service

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	sdkconfig "github.com/kumiho-plugin/kumiho-plugin-sdk/config"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
)

const kitsuPluginID = "kumiho-plugin-metadata-kitsu"

func TestPluginSecretServiceStoresEncryptedSecretAndBuildsEnv(t *testing.T) {
	repo := newFakePluginSecretRepo()
	cfg := &config.Config{JWTSecret: "test-secret", PluginSecretKey: "plugin-secret-key"}
	svc, err := NewPluginSecretService(cfg, repo)
	if err != nil {
		t.Fatalf("NewPluginSecretService() error = %v", err)
	}

	manifest := kitsuSecretManifest()
	status, err := svc.SetSecret(kitsuPluginID, manifest, "access_token", "abc123456")
	if err != nil {
		t.Fatalf("SetSecret() error = %v", err)
	}

	if len(status.Fields) != 2 || !status.Fields[0].Configured || status.Fields[1].Configured {
		t.Fatalf("configured = %#v, want configured field", status.Fields)
	}
	if status.Fields[0].Source != "secret" {
		t.Fatalf("source = %q, want %q", status.Fields[0].Source, "secret")
	}
	if status.Fields[0].MaskedHint == "" {
		t.Fatal("MaskedHint = empty")
	}

	env, err := svc.EnvironmentForPlugin(kitsuPluginID, manifest)
	if err != nil {
		t.Fatalf("EnvironmentForPlugin() error = %v", err)
	}
	if got := env["KITSU_ACCESS_TOKEN"]; got != "abc123456" {
		t.Fatalf("env value = %q, want %q", got, "abc123456")
	}
}

func TestPluginSecretServiceFallsBackToProcessEnv(t *testing.T) {
	repo := newFakePluginSecretRepo()
	cfg := &config.Config{JWTSecret: "test-secret", PluginSecretKey: "plugin-secret-key"}
	svc, err := NewPluginSecretService(cfg, repo)
	if err != nil {
		t.Fatalf("NewPluginSecretService() error = %v", err)
	}
	manifest := kitsuSecretManifest()

	t.Setenv("KITSU_ACCESS_TOKEN", "env-secret")

	status, err := svc.Status(kitsuPluginID, manifest)
	if err != nil {
		t.Fatalf("Status() error = %v", err)
	}
	if len(status.Fields) != 2 || !status.Fields[0].Configured || status.Fields[1].Configured {
		t.Fatalf("configured = %#v, want env-configured field", status.Fields)
	}
	if status.Fields[0].Source != "environment" {
		t.Fatalf("source = %q, want %q", status.Fields[0].Source, "environment")
	}

	env, err := svc.EnvironmentForPlugin(kitsuPluginID, manifest)
	if err != nil {
		t.Fatalf("EnvironmentForPlugin() error = %v", err)
	}
	if got := env["KITSU_ACCESS_TOKEN"]; got != "env-secret" {
		t.Fatalf("env value = %q, want %q", got, "env-secret")
	}
}

func TestPluginSecretServiceDeleteSecret(t *testing.T) {
	repo := newFakePluginSecretRepo()
	cfg := &config.Config{JWTSecret: "test-secret", PluginSecretKey: "plugin-secret-key"}
	svc, err := NewPluginSecretService(cfg, repo)
	if err != nil {
		t.Fatalf("NewPluginSecretService() error = %v", err)
	}
	manifest := kitsuSecretManifest()

	if _, setErr := svc.SetSecret(kitsuPluginID, manifest, "access_token", "abc123456"); setErr != nil {
		t.Fatalf("SetSecret() error = %v", setErr)
	}
	if _, deleteErr := svc.DeleteSecret(kitsuPluginID, manifest, "access_token"); deleteErr != nil {
		t.Fatalf("DeleteSecret() error = %v", deleteErr)
	}

	env, err := svc.EnvironmentForPlugin(kitsuPluginID, manifest)
	if err != nil {
		t.Fatalf("EnvironmentForPlugin() error = %v", err)
	}
	if _, ok := env["KITSU_ACCESS_TOKEN"]; ok {
		t.Fatal("env should be empty after delete")
	}
}

func TestPluginSecretServiceRejectsSecretFieldWithoutEnvKey(t *testing.T) {
	repo := newFakePluginSecretRepo()
	cfg := &config.Config{JWTSecret: "test-secret", PluginSecretKey: "plugin-secret-key"}
	svc, err := NewPluginSecretService(cfg, repo)
	if err != nil {
		t.Fatalf("NewPluginSecretService() error = %v", err)
	}

	manifest := sdkmanifest.Manifest{
		ID: kitsuPluginID,
		ConfigSchema: &sdkconfig.Schema{
			Version: "1",
			Fields: []sdkconfig.ConfigField{
				{Key: "access_token", Type: sdkconfig.FieldTypeSecret, Label: "Access Token", Required: true},
			},
		},
	}

	if _, err := svc.EnvironmentForPlugin(kitsuPluginID, manifest); err == nil {
		t.Fatal("EnvironmentForPlugin() error = nil, want config invalid error")
	}
	if err := svc.ValidateActivation(kitsuPluginID, manifest); err == nil {
		t.Fatal("ValidateActivation() error = nil, want config invalid error")
	}
}

func TestPluginSecretServiceRejectsReservedRuntimeEnvKey(t *testing.T) {
	repo := newFakePluginSecretRepo()
	cfg := &config.Config{JWTSecret: "test-secret", PluginSecretKey: "plugin-secret-key"}
	svc, err := NewPluginSecretService(cfg, repo)
	if err != nil {
		t.Fatalf("NewPluginSecretService() error = %v", err)
	}

	manifest := sdkmanifest.Manifest{
		ID: kitsuPluginID,
		ConfigSchema: &sdkconfig.Schema{
			Version: "1",
			Fields: []sdkconfig.ConfigField{
				{Key: "access_token", Type: sdkconfig.FieldTypeSecret, Label: "Access Token", EnvKey: "KUMIHO_PLUGIN_PORT", Required: true},
			},
		},
	}

	if _, err := svc.EnvironmentForPlugin(kitsuPluginID, manifest); err == nil {
		t.Fatal("EnvironmentForPlugin() error = nil, want config invalid error")
	}
	if err := svc.ValidateActivation(kitsuPluginID, manifest); err == nil {
		t.Fatal("ValidateActivation() error = nil, want config invalid error")
	}
}

func TestPluginSecretServiceRequiresDedicatedSecretKey(t *testing.T) {
	repo := newFakePluginSecretRepo()

	svc, err := NewPluginSecretService(&config.Config{JWTSecret: "test-secret"}, repo)
	if err == nil {
		t.Fatalf("NewPluginSecretService() error = nil, svc = %#v", svc)
	}
}

func TestPluginSecretServiceSetSecretsDoesNotPartiallyApplyOnValidationError(t *testing.T) {
	repo := newFakePluginSecretRepo()
	cfg := &config.Config{JWTSecret: "test-secret", PluginSecretKey: "plugin-secret-key"}
	svc, err := NewPluginSecretService(cfg, repo)
	if err != nil {
		t.Fatalf("NewPluginSecretService() error = %v", err)
	}

	manifest := kitsuSecretManifest()
	if _, setErr := svc.SetSecrets(context.Background(), kitsuPluginID, manifest, map[string]string{
		"access_token": "abc123456",
		"unknown":      "should-fail",
	}); setErr == nil {
		t.Fatal("SetSecrets() error = nil")
	}

	secret, err := repo.GetByKey(nil, kitsuPluginID, "access_token")
	if err != nil {
		t.Fatalf("GetByKey() error = %v", err)
	}
	if secret != nil {
		t.Fatal("access_token secret should not be stored on validation failure")
	}
}

func TestPluginSecretServiceDeleteSecretsRollsBackOnDeleteError(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "plugin-secrets.db")
	if err := database.Connect(dbPath); err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	repo := &failingPluginSecretRepo{
		PluginSecretRepository: repository.NewPluginSecretRepository(),
		deleteErrKey:           "refresh_token",
	}
	cfg := &config.Config{JWTSecret: "test-secret", PluginSecretKey: "plugin-secret-key"}
	svc, err := NewPluginSecretService(cfg, repo)
	if err != nil {
		t.Fatalf("NewPluginSecretService() error = %v", err)
	}
	manifest := kitsuSecretManifest()

	if _, setErr := svc.SetSecret(kitsuPluginID, manifest, "access_token", "abc123456"); setErr != nil {
		t.Fatalf("SetSecret(access_token) error = %v", setErr)
	}
	if _, setErr := svc.SetSecret(kitsuPluginID, manifest, "refresh_token", "refresh-123"); setErr != nil {
		t.Fatalf("SetSecret(refresh_token) error = %v", setErr)
	}

	if _, deleteErr := svc.DeleteSecrets(context.Background(), kitsuPluginID, manifest, []string{"access_token", "refresh_token"}); deleteErr == nil {
		t.Fatal("DeleteSecrets() error = nil")
	}

	access, err := svc.repo.GetByKey(nil, kitsuPluginID, "access_token")
	if err != nil {
		t.Fatalf("GetByKey(access_token) error = %v", err)
	}
	if access == nil {
		t.Fatal("access_token should remain after rollback")
	}
	refresh, err := svc.repo.GetByKey(nil, kitsuPluginID, "refresh_token")
	if err != nil {
		t.Fatalf("GetByKey(refresh_token) error = %v", err)
	}
	if refresh == nil {
		t.Fatal("refresh_token should remain after rollback")
	}
}

func TestPluginSecretServiceSetSecretsHonorsCanceledContext(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "plugin-secrets.db")
	if err := database.Connect(dbPath); err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	cfg := &config.Config{JWTSecret: "test-secret", PluginSecretKey: "plugin-secret-key"}
	svc, err := NewPluginSecretService(cfg, repository.NewPluginSecretRepository())
	if err != nil {
		t.Fatalf("NewPluginSecretService() error = %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := svc.SetSecrets(ctx, kitsuPluginID, kitsuSecretManifest(), map[string]string{
		"access_token": "abc123456",
	}); !errors.Is(err, context.Canceled) {
		t.Fatalf("SetSecrets() error = %v, want context.Canceled", err)
	}
}

func TestPluginSecretServiceDeleteSecretsHonorsCanceledContext(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "plugin-secrets.db")
	if err := database.Connect(dbPath); err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	cfg := &config.Config{JWTSecret: "test-secret", PluginSecretKey: "plugin-secret-key"}
	svc, err := NewPluginSecretService(cfg, repository.NewPluginSecretRepository())
	if err != nil {
		t.Fatalf("NewPluginSecretService() error = %v", err)
	}
	manifest := kitsuSecretManifest()
	if _, err := svc.SetSecret(kitsuPluginID, manifest, "access_token", "abc123456"); err != nil {
		t.Fatalf("SetSecret() error = %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := svc.DeleteSecrets(ctx, kitsuPluginID, manifest, []string{"access_token"}); !errors.Is(err, context.Canceled) {
		t.Fatalf("DeleteSecrets() error = %v, want context.Canceled", err)
	}
}

func TestMaskSecret(t *testing.T) {
	if got := maskSecret("abcd1234"); got != "••••1234" {
		t.Fatalf("maskSecret() = %q", got)
	}
	if got := maskSecret("abc"); got != "••••" {
		t.Fatalf("maskSecret short = %q", got)
	}
}

func kitsuSecretManifest() sdkmanifest.Manifest {
	return sdkmanifest.Manifest{
		ID: kitsuPluginID,
		ConfigSchema: &sdkconfig.Schema{
			Version: "1",
			Fields: []sdkconfig.ConfigField{
				{Key: "access_token", Type: sdkconfig.FieldTypeSecret, Label: "Access Token", EnvKey: "KITSU_ACCESS_TOKEN", Required: false},
				{Key: "refresh_token", Type: sdkconfig.FieldTypeSecret, Label: "Refresh Token", EnvKey: "KITSU_REFRESH_TOKEN", Required: false},
			},
		},
	}
}

type fakePluginSecretRepo struct {
	items map[string]model.PluginSecret
}

func newFakePluginSecretRepo() *fakePluginSecretRepo {
	return &fakePluginSecretRepo{items: make(map[string]model.PluginSecret)}
}

func (r *fakePluginSecretRepo) GetByKey(_ database.Queryer, pluginID, fieldKey string) (*model.PluginSecret, error) {
	item, ok := r.items[pluginID+":"+fieldKey]
	if !ok {
		return nil, nil
	}
	copy := item
	return &copy, nil
}

func (r *fakePluginSecretRepo) ListByPlugin(_ database.Queryer, pluginID string) ([]model.PluginSecret, error) {
	items := []model.PluginSecret{}
	for _, item := range r.items {
		if item.PluginID == pluginID {
			items = append(items, item)
		}
	}
	return items, nil
}

func (r *fakePluginSecretRepo) Upsert(_ database.Queryer, pluginID, fieldKey, valueEncrypted string) error {
	r.items[pluginID+":"+fieldKey] = model.PluginSecret{
		PluginID:       pluginID,
		FieldKey:       fieldKey,
		ValueEncrypted: valueEncrypted,
		UpdatedAt:      time.Now(),
	}
	return nil
}

func (r *fakePluginSecretRepo) Delete(_ database.Queryer, pluginID, fieldKey string) error {
	delete(r.items, pluginID+":"+fieldKey)
	return nil
}

func (r *fakePluginSecretRepo) DeleteByPlugin(_ database.Queryer, pluginID string) error {
	for key, item := range r.items {
		if item.PluginID == pluginID {
			delete(r.items, key)
		}
	}
	return nil
}

type failingPluginSecretRepo struct {
	repository.PluginSecretRepository
	deleteErrKey string
}

func (r *failingPluginSecretRepo) Delete(q database.Queryer, pluginID, fieldKey string) error {
	if fieldKey == r.deleteErrKey {
		return errors.New("delete failed")
	}
	return r.PluginSecretRepository.Delete(q, pluginID, fieldKey)
}
