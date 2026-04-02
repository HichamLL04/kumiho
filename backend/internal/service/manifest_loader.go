package service

import (
	"context"
	"encoding/json"
	"fmt"

	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
)

// ManifestFetcher reads raw manifest data from a registry entry.
// It is responsible only for "where to read from" — not for validation or normalization.
type ManifestFetcher interface {
	Fetch(ctx context.Context, entry RegistryEntry) (sdkmanifest.Manifest, error)
}

// ManifestLoader orchestrates fetch → validate → normalize.
// Callers use ManifestLoader; ManifestFetcher is an internal implementation detail.
type ManifestLoader interface {
	Load(ctx context.Context, entry RegistryEntry) (sdkmanifest.Manifest, error)
}

// inlineManifestFetcher returns the manifest embedded directly in the registry entry.
// This is the legacy path, used only when ManifestURL is absent.
type inlineManifestFetcher struct{}

func (f *inlineManifestFetcher) Fetch(_ context.Context, entry RegistryEntry) (sdkmanifest.Manifest, error) {
	return entry.Manifest, nil
}

// urlManifestFetcher fetches manifest.json from entry.ManifestURL.
type urlManifestFetcher struct {
	svc *PluginInstallService
}

func (f *urlManifestFetcher) Fetch(ctx context.Context, entry RegistryEntry) (sdkmanifest.Manifest, error) {
	reader, err := f.svc.openURL(ctx, entry.ManifestURL)
	if err != nil {
		return sdkmanifest.Manifest{}, fmt.Errorf("manifest fetch failed for %q: %w", entry.ManifestURL, err)
	}
	defer func() { _ = reader.Close() }()

	var m sdkmanifest.Manifest
	if err := json.NewDecoder(reader).Decode(&m); err != nil {
		return sdkmanifest.Manifest{}, fmt.Errorf("manifest decode failed for %q: %w", entry.ManifestURL, err)
	}
	return m, nil
}

// adaptiveManifestFetcher uses urlManifestFetcher when ManifestURL is set,
// and inlineManifestFetcher only when ManifestURL is empty.
//
// If ManifestURL is set but fetch fails, an error is returned.
// There is no silent fallback to inline fields.
type adaptiveManifestFetcher struct {
	inline *inlineManifestFetcher
	url    *urlManifestFetcher
}

func (f *adaptiveManifestFetcher) Fetch(ctx context.Context, entry RegistryEntry) (sdkmanifest.Manifest, error) {
	if entry.ManifestURL != "" {
		return f.url.Fetch(ctx, entry)
	}
	return f.inline.Fetch(ctx, entry)
}

// manifestValidator checks that a resolved manifest has the required fields.
type manifestValidator struct{}

func (v *manifestValidator) validate(m sdkmanifest.Manifest) error {
	if m.ID == "" {
		return fmt.Errorf("manifest missing required field: id")
	}
	if m.Version == "" {
		return fmt.Errorf("manifest missing required field: version")
	}
	if m.RuntimeType == "" {
		return fmt.Errorf("manifest missing required field: runtime_type")
	}
	return nil
}

// defaultManifestLoader implements ManifestLoader with the full fetch → validate pipeline.
//
// After fetching, Artifacts are always taken from the registry entry (the deployment index),
// not from the fetched manifest.json. This keeps download URLs and checksums registry-authoritative.
type defaultManifestLoader struct {
	fetcher   ManifestFetcher
	validator *manifestValidator
}

func newManifestLoader(svc *PluginInstallService) ManifestLoader {
	return &defaultManifestLoader{
		fetcher: &adaptiveManifestFetcher{
			inline: &inlineManifestFetcher{},
			url:    &urlManifestFetcher{svc: svc},
		},
		validator: &manifestValidator{},
	}
}

func (l *defaultManifestLoader) Load(ctx context.Context, entry RegistryEntry) (sdkmanifest.Manifest, error) {
	m, err := l.fetcher.Fetch(ctx, entry)
	if err != nil {
		return sdkmanifest.Manifest{}, err
	}
	if err := l.validator.validate(m); err != nil {
		return sdkmanifest.Manifest{}, err
	}
	// Artifacts live in the registry entry (deployment index), not in manifest.json.
	// Always overwrite to ensure the registry's download URLs and checksums are used.
	m.Artifacts = entry.Artifacts
	return m, nil
}
