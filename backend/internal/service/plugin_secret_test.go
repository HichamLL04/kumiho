package service

import (
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
)

func TestPluginSecretServiceStoresEncryptedSecretAndBuildsEnv(t *testing.T) {
	repo := newFakePluginSecretRepo()
	cfg := &config.Config{JWTSecret: "test-secret"}
	svc := NewPluginSecretService(cfg, repo)

	status, err := svc.SetSecret(googleBooksPluginID, "api_key", "abc123456")
	if err != nil {
		t.Fatalf("SetSecret() error = %v", err)
	}

	if len(status.Fields) != 1 || !status.Fields[0].Configured {
		t.Fatalf("configured = %#v, want configured field", status.Fields)
	}
	if status.Fields[0].Source != "secret" {
		t.Fatalf("source = %q, want %q", status.Fields[0].Source, "secret")
	}
	if status.Fields[0].MaskedHint == "" {
		t.Fatal("MaskedHint = empty")
	}

	env, err := svc.EnvironmentForPlugin(googleBooksPluginID, sdkmanifest.Manifest{ID: googleBooksPluginID})
	if err != nil {
		t.Fatalf("EnvironmentForPlugin() error = %v", err)
	}
	if got := env["GOOGLE_BOOKS_API_KEY"]; got != "abc123456" {
		t.Fatalf("env value = %q, want %q", got, "abc123456")
	}
}

func TestPluginSecretServiceFallsBackToProcessEnv(t *testing.T) {
	repo := newFakePluginSecretRepo()
	cfg := &config.Config{JWTSecret: "test-secret"}
	svc := NewPluginSecretService(cfg, repo)

	t.Setenv("GOOGLE_BOOKS_API_KEY", "env-secret")

	status, err := svc.Status(googleBooksPluginID)
	if err != nil {
		t.Fatalf("Status() error = %v", err)
	}
	if len(status.Fields) != 1 || !status.Fields[0].Configured {
		t.Fatalf("configured = %#v, want env-configured field", status.Fields)
	}
	if status.Fields[0].Source != "environment" {
		t.Fatalf("source = %q, want %q", status.Fields[0].Source, "environment")
	}

	env, err := svc.EnvironmentForPlugin(googleBooksPluginID, sdkmanifest.Manifest{ID: googleBooksPluginID})
	if err != nil {
		t.Fatalf("EnvironmentForPlugin() error = %v", err)
	}
	if got := env["GOOGLE_BOOKS_API_KEY"]; got != "env-secret" {
		t.Fatalf("env value = %q, want %q", got, "env-secret")
	}
}

func TestPluginSecretServiceDeleteSecret(t *testing.T) {
	repo := newFakePluginSecretRepo()
	cfg := &config.Config{JWTSecret: "test-secret"}
	svc := NewPluginSecretService(cfg, repo)

	if _, err := svc.SetSecret(googleBooksPluginID, "api_key", "abc123456"); err != nil {
		t.Fatalf("SetSecret() error = %v", err)
	}
	if _, err := svc.DeleteSecret(googleBooksPluginID, "api_key"); err != nil {
		t.Fatalf("DeleteSecret() error = %v", err)
	}

	env, err := svc.EnvironmentForPlugin(googleBooksPluginID, sdkmanifest.Manifest{ID: googleBooksPluginID})
	if err != nil {
		t.Fatalf("EnvironmentForPlugin() error = %v", err)
	}
	if _, ok := env["GOOGLE_BOOKS_API_KEY"]; ok {
		t.Fatal("env should be empty after delete")
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
