package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	pluginerrors "github.com/kumiho-plugin/kumiho-plugin-sdk/errors"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
)

func TestPluginInstallServiceInstall(t *testing.T) {
	artifactBytes := []byte("#!/bin/sh\necho plugin\n")
	sum := sha256.Sum256(artifactBytes)
	checksum := "sha256:" + hex.EncodeToString(sum[:])

	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/index.json":
			_ = json.NewEncoder(w).Encode(PluginCatalog{
				Plugins: []sdkmanifest.Manifest{
					{
						ID:                 "plugin-googlebooks",
						Name:               "Google Books",
						Version:            "0.1.0",
						RuntimeType:        sdkmanifest.RuntimeTypeBinary,
						SupportedPlatforms: []sdkmanifest.Platform{sdkmanifest.PlatformLinuxBinary},
						MinCoreVersion:     "0.1.0",
						Artifacts: []sdkmanifest.Artifact{
							{Platform: sdkmanifest.PlatformLinuxBinary, URL: server.URL + "/artifact", Checksum: checksum},
						},
					},
				},
			})
		case "/artifact":
			_, _ = w.Write(artifactBytes)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	cfg := &config.Config{
		DataDir:           t.TempDir(),
		PluginDir:         filepath.Join(t.TempDir(), "plugins"),
		PluginRegistryURL: server.URL + "/index.json",
	}
	manager := pluginengine.NewManager(pluginengine.NewMemoryStore())
	svc := NewPluginInstallService(cfg, server.Client(), manager, nil)

	result, err := svc.Install(context.Background(), "plugin-googlebooks")
	if err != nil {
		t.Fatalf("Install() error = %v", err)
	}
	if result.Record.ID != "plugin-googlebooks" {
		t.Fatalf("record id = %q", result.Record.ID)
	}
	if result.InstallPath == "" {
		t.Fatal("install path should not be empty")
	}
	if _, err := os.Stat(result.InstallPath); err != nil {
		t.Fatalf("installed artifact stat error = %v", err)
	}
}

func TestPluginInstallServiceInstallServiceRuntimeArtifact(t *testing.T) {
	artifactBytes := []byte("#!/bin/sh\necho service-plugin\n")
	sum := sha256.Sum256(artifactBytes)
	checksum := "sha256:" + hex.EncodeToString(sum[:])

	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/index.json":
			_ = json.NewEncoder(w).Encode(PluginCatalog{
				Plugins: []sdkmanifest.Manifest{
					{
						ID:                 "plugin-googlebooks-service",
						Name:               "Google Books",
						Version:            "0.1.0",
						RuntimeType:        sdkmanifest.RuntimeTypeService,
						SupportedPlatforms: []sdkmanifest.Platform{sdkmanifest.PlatformLinuxDocker},
						MinCoreVersion:     "0.1.0",
						Artifacts: []sdkmanifest.Artifact{
							{Platform: sdkmanifest.PlatformLinuxDocker, URL: server.URL + "/artifact", Checksum: checksum},
						},
					},
				},
			})
		case "/artifact":
			_, _ = w.Write(artifactBytes)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	cfg := &config.Config{
		DataDir:           t.TempDir(),
		PluginDir:         filepath.Join(t.TempDir(), "plugins"),
		PluginRegistryURL: server.URL + "/index.json",
	}
	manager := pluginengine.NewManager(pluginengine.NewMemoryStore())
	svc := NewPluginInstallService(cfg, server.Client(), manager, nil)

	result, err := svc.Install(context.Background(), "plugin-googlebooks-service")
	if err != nil {
		t.Fatalf("Install() error = %v", err)
	}

	info, err := os.Stat(result.InstallPath)
	if err != nil {
		t.Fatalf("installed artifact stat error = %v", err)
	}

	if runtime.GOOS != "windows" && info.Mode().Perm()&0o111 == 0 {
		t.Fatalf("service artifact mode = %v, want executable bit set", info.Mode().Perm())
	}
}

func TestPluginInstallServiceInstallFailsOnChecksumMismatch(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/index.json":
			_ = json.NewEncoder(w).Encode(PluginCatalog{
				Plugins: []sdkmanifest.Manifest{
					{
						ID:                 "plugin-googlebooks",
						Name:               "Google Books",
						Version:            "0.1.0",
						RuntimeType:        sdkmanifest.RuntimeTypeBinary,
						SupportedPlatforms: []sdkmanifest.Platform{sdkmanifest.PlatformLinuxBinary},
						MinCoreVersion:     "0.1.0",
						Artifacts: []sdkmanifest.Artifact{
							{Platform: sdkmanifest.PlatformLinuxBinary, URL: server.URL + "/artifact", Checksum: "sha256:deadbeef"},
						},
					},
				},
			})
		case "/artifact":
			_, _ = w.Write([]byte("invalid"))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	cfg := &config.Config{
		DataDir:           t.TempDir(),
		PluginDir:         filepath.Join(t.TempDir(), "plugins"),
		PluginRegistryURL: server.URL + "/index.json",
	}
	svc := NewPluginInstallService(cfg, server.Client(), pluginengine.NewManager(pluginengine.NewMemoryStore()), nil)

	_, err := svc.Install(context.Background(), "plugin-googlebooks")
	if err == nil {
		t.Fatal("Install() error = nil")
	}

	var pluginErr *pluginerrors.PluginError
	if !errors.As(err, &pluginErr) {
		t.Fatalf("expected PluginError, got %T", err)
	}
	if pluginErr.Code != pluginerrors.ErrCodeChecksumMismatch {
		t.Fatalf("error code = %q", pluginErr.Code)
	}
}

func TestPluginInstallServiceUninstallRemovesArtifactAndRecord(t *testing.T) {
	cfg := &config.Config{
		DataDir:           t.TempDir(),
		PluginDir:         filepath.Join(t.TempDir(), "plugins"),
		PluginRegistryURL: "https://example.com/index.json",
	}
	store := pluginengine.NewMemoryStore()
	manager := pluginengine.NewManager(store)
	svc := NewPluginInstallService(cfg, nil, manager, nil)

	installDir := filepath.Join(cfg.PluginDir, "plugin-googlebooks", "0.1.0")
	if err := os.MkdirAll(installDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	installPath := filepath.Join(installDir, "plugin-googlebooks")
	if err := os.WriteFile(installPath, []byte("plugin"), 0o755); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	record, err := manager.RegisterInstalled(sdkmanifest.Manifest{
		ID:          "plugin-googlebooks",
		Name:        "Google Books",
		Version:     "0.1.0",
		RuntimeType: sdkmanifest.RuntimeTypeBinary,
	}, installPath)
	if err != nil {
		t.Fatalf("RegisterInstalled() error = %v", err)
	}
	if _, err := manager.MarkRegistered(record.ID); err != nil {
		t.Fatalf("MarkRegistered() error = %v", err)
	}

	result, err := svc.Uninstall(context.Background(), "plugin-googlebooks")
	if err != nil {
		t.Fatalf("Uninstall() error = %v", err)
	}
	if !result.Removed {
		t.Fatal("Removed = false, want true")
	}
	if _, err := os.Stat(installPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("artifact stat error = %v, want not exist", err)
	}
	if _, ok, err := manager.Get("plugin-googlebooks"); err != nil {
		t.Fatalf("Get() error = %v", err)
	} else if ok {
		t.Fatal("record should be deleted")
	}
}

func TestPluginInstallServiceInstallReplacesExistingRecordAndArtifact(t *testing.T) {
	oldBytes := []byte("old plugin")
	newBytes := []byte("new plugin")
	sum := sha256.Sum256(newBytes)
	checksum := "sha256:" + hex.EncodeToString(sum[:])

	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/index.json":
			_ = json.NewEncoder(w).Encode(PluginCatalog{
				Plugins: []sdkmanifest.Manifest{
					{
						ID:                 "plugin-googlebooks",
						Name:               "Google Books",
						Version:            "0.1.1",
						RuntimeType:        sdkmanifest.RuntimeTypeBinary,
						SupportedPlatforms: []sdkmanifest.Platform{sdkmanifest.PlatformLinuxBinary},
						MinCoreVersion:     "0.1.0",
						Artifacts: []sdkmanifest.Artifact{
							{Platform: sdkmanifest.PlatformLinuxBinary, URL: server.URL + "/artifact", Checksum: checksum},
						},
					},
				},
			})
		case "/artifact":
			_, _ = w.Write(newBytes)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	cfg := &config.Config{
		DataDir:           t.TempDir(),
		PluginDir:         filepath.Join(t.TempDir(), "plugins"),
		PluginRegistryURL: server.URL + "/index.json",
	}
	store := pluginengine.NewMemoryStore()
	manager := pluginengine.NewManager(store)
	svc := NewPluginInstallService(cfg, server.Client(), manager, nil)

	oldInstallDir := filepath.Join(cfg.PluginDir, "plugin-googlebooks", "0.1.0")
	if err := os.MkdirAll(oldInstallDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	oldInstallPath := filepath.Join(oldInstallDir, "plugin-googlebooks")
	if err := os.WriteFile(oldInstallPath, oldBytes, 0o755); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	now := time.Now()
	if err := store.Save(pluginengine.Record{
		ID:          "plugin-googlebooks",
		Manifest:    sdkmanifest.Manifest{ID: "plugin-googlebooks", Name: "Google Books", Version: "0.1.0", RuntimeType: sdkmanifest.RuntimeTypeBinary},
		State:       "disabled",
		InstallPath: oldInstallPath,
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	result, err := svc.Install(context.Background(), "plugin-googlebooks")
	if err != nil {
		t.Fatalf("Install() error = %v", err)
	}

	if result.Record.Manifest.Version != "0.1.1" {
		t.Fatalf("version = %q, want 0.1.1", result.Record.Manifest.Version)
	}
	if _, err := os.Stat(oldInstallPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("old artifact stat error = %v, want not exist", err)
	}
	contents, err := os.ReadFile(result.InstallPath)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if string(contents) != string(newBytes) {
		t.Fatalf("artifact contents = %q", string(contents))
	}
}
