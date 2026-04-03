package service

import (
	"slices"
	"testing"
)

func TestBuildCommandEnvOverridesExistingValues(t *testing.T) {
	t.Setenv("KITSU_ACCESS_TOKEN", "parent-token")
	t.Setenv(EnvPluginHost, "0.0.0.0")
	t.Setenv("UNCHANGED_VAR", "keep")

	env := buildCommandEnv("127.0.0.1", 43210, map[string]string{
		"KITSU_ACCESS_TOKEN": "plugin-token",
		"EXTRA_VALUE":        "extra",
		"":                   "ignored",
	})

	if !slices.Contains(env, EnvPluginHost+"=127.0.0.1") {
		t.Fatalf("env missing plugin host override: %v", env)
	}
	if !slices.Contains(env, EnvPluginPort+"=43210") {
		t.Fatalf("env missing plugin port override: %v", env)
	}
	if !slices.Contains(env, "KITSU_ACCESS_TOKEN=plugin-token") {
		t.Fatalf("env missing plugin override: %v", env)
	}
	if slices.Contains(env, "KITSU_ACCESS_TOKEN=parent-token") {
		t.Fatalf("env kept parent value for overridden key: %v", env)
	}
	if !slices.Contains(env, "UNCHANGED_VAR=keep") {
		t.Fatalf("env missing inherited variable: %v", env)
	}
	if !slices.Contains(env, "EXTRA_VALUE=extra") {
		t.Fatalf("env missing extra override: %v", env)
	}
}
