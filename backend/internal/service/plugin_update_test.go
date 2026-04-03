package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
)

func TestPluginInstallServiceCheckUpdates(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/index.json" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(PluginCatalog{
			Plugins: []RegistryEntry{
				{Manifest: sdkmanifest.Manifest{ID: "plugin-a", Name: "Plugin A", Version: "0.2.0"}},
				{Manifest: sdkmanifest.Manifest{ID: "plugin-b", Name: "Plugin B", Version: "0.1.0"}},
			},
		})
	}))
	defer server.Close()

	manager := pluginengine.NewManager(pluginengine.NewMemoryStore())
	for _, plugin := range []sdkmanifest.Manifest{
		{ID: "plugin-a", Name: "Plugin A", Version: "0.1.0", RuntimeType: sdkmanifest.RuntimeTypeService},
		{ID: "plugin-b", Name: "Plugin B", Version: "0.1.0", RuntimeType: sdkmanifest.RuntimeTypeService},
	} {
		record, err := manager.RegisterInstalled(plugin, filepath.Join(t.TempDir(), plugin.ID))
		if err != nil {
			t.Fatalf("RegisterInstalled(%s) error = %v", plugin.ID, err)
		}
		if _, err := manager.MarkRegistered(record.ID); err != nil {
			t.Fatalf("MarkRegistered(%s) error = %v", plugin.ID, err)
		}
	}

	svc := NewPluginInstallService(&config.Config{
		PluginRegistryURL: server.URL + "/index.json",
		PluginDir:         t.TempDir(),
	}, server.Client(), manager, nil)

	summary, err := svc.CheckUpdates(context.Background())
	if err != nil {
		t.Fatalf("CheckUpdates() error = %v", err)
	}
	if !summary.HasUpdates {
		t.Fatal("HasUpdates = false, want true")
	}
	if summary.Count != 1 {
		t.Fatalf("Count = %d, want 1", summary.Count)
	}
	if len(summary.Plugins) != 2 {
		t.Fatalf("Plugins len = %d, want 2", len(summary.Plugins))
	}
	if summary.Plugins[0].PluginID != "plugin-a" || !summary.Plugins[0].UpdateAvailable {
		t.Fatalf("first plugin = %+v, want plugin-a with update", summary.Plugins[0])
	}
	if summary.Plugins[1].PluginID != "plugin-b" || summary.Plugins[1].UpdateAvailable {
		t.Fatalf("second plugin = %+v, want plugin-b without update", summary.Plugins[1])
	}
}
