package config

import (
	"path/filepath"
	"testing"
)

func TestLoadUsesDataDirForDefaultPaths(t *testing.T) {
	t.Setenv("DATA_DIR", "/tmp/kumiho-data")
	t.Setenv("DATABASE_PATH", "")
	t.Setenv("PLUGIN_DIR", "")

	cfg := Load()

	if cfg.DatabasePath != filepath.Join("/tmp/kumiho-data", "kumiho.db") {
		t.Fatalf("DatabasePath = %q", cfg.DatabasePath)
	}
	if cfg.PluginDir != filepath.Join("/tmp/kumiho-data", "plugins") {
		t.Fatalf("PluginDir = %q", cfg.PluginDir)
	}
}
