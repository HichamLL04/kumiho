package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	coreversion "github.com/aha-hyeong/kumiho/backend/internal/version"
	pluginerrors "github.com/kumiho-plugin/kumiho-plugin-sdk/errors"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdkstate "github.com/kumiho-plugin/kumiho-plugin-sdk/state"
	sdkversion "github.com/kumiho-plugin/kumiho-plugin-sdk/version"
)

var (
	ErrPluginRegistryNotConfigured = errors.New("plugin registry url is not configured")
	ErrPluginCatalogEntryNotFound  = errors.New("plugin catalog entry not found")
)

type PluginCatalog struct {
	Plugins []RegistryEntry `json:"plugins"`
}

type ResolvedPluginCatalog struct {
	Plugins []sdkmanifest.Manifest `json:"plugins"`
}

type PluginInstallService struct {
	cfg            *config.Config
	client         *http.Client
	manager        *pluginengine.Manager
	secretService  *PluginSecretService
	manifestLoader ManifestLoader
}

type InstallPluginRequest struct {
	PluginID string `json:"plugin_id"`
}

type UninstallPluginResult struct {
	PluginID string `json:"plugin_id"`
	Removed  bool   `json:"removed"`
}

type InstallPluginResult struct {
	Record          pluginengine.Record `json:"record"`
	ArtifactURL     string              `json:"artifact_url"`
	InstallPath     string              `json:"install_path"`
	RestartRequired bool                `json:"restart_required"`
}

func NewPluginInstallService(cfg *config.Config, client *http.Client, manager *pluginengine.Manager, secretService *PluginSecretService) *PluginInstallService {
	if client == nil {
		client = http.DefaultClient
	}
	svc := &PluginInstallService{
		cfg:           cfg,
		client:        client,
		manager:       manager,
		secretService: secretService,
	}
	svc.manifestLoader = newManifestLoader(svc)
	return svc
}

// LoadManifestFromCatalog fetches the registry catalog, finds the entry for pluginID,
// and resolves its full manifest (via manifest_url or inline fields).
func (s *PluginInstallService) LoadManifestFromCatalog(ctx context.Context, pluginID string) (sdkmanifest.Manifest, error) {
	catalog, err := s.ListCatalog(ctx)
	if err != nil {
		return sdkmanifest.Manifest{}, err
	}
	entry, ok := findRegistryEntry(catalog.Plugins, pluginID)
	if !ok {
		return sdkmanifest.Manifest{}, ErrPluginCatalogEntryNotFound
	}
	return s.manifestLoader.Load(ctx, entry)
}

func (s *PluginInstallService) ListCatalog(ctx context.Context) (*PluginCatalog, error) {
	if strings.TrimSpace(s.cfg.PluginRegistryURL) == "" {
		return nil, ErrPluginRegistryNotConfigured
	}

	var catalog PluginCatalog
	if err := s.getJSON(ctx, s.cfg.PluginRegistryURL, &catalog); err != nil {
		return nil, err
	}
	return &catalog, nil
}

func (s *PluginInstallService) ListResolvedCatalog(ctx context.Context) (*ResolvedPluginCatalog, error) {
	catalog, err := s.ListCatalog(ctx)
	if err != nil {
		return nil, err
	}

	plugins := make([]sdkmanifest.Manifest, 0, len(catalog.Plugins))
	for _, entry := range catalog.Plugins {
		manifest, err := s.manifestLoader.Load(ctx, entry)
		if err != nil {
			return nil, err
		}
		plugins = append(plugins, manifest)
	}

	return &ResolvedPluginCatalog{Plugins: plugins}, nil
}

func (s *PluginInstallService) Install(ctx context.Context, pluginID string) (*InstallPluginResult, error) {
	catalog, err := s.ListCatalog(ctx)
	if err != nil {
		return nil, err
	}

	registryEntry, ok := findRegistryEntry(catalog.Plugins, pluginID)
	if !ok {
		return nil, ErrPluginCatalogEntryNotFound
	}

	manifest, err := s.manifestLoader.Load(ctx, registryEntry)
	if err != nil {
		return nil, err
	}

	if compatible, compatErr := sdkversion.IsCompatible(coreversion.Version, manifest.MinCoreVersion, manifest.MaxCoreVersion); compatErr != nil {
		return nil, compatErr
	} else if !compatible {
		return nil, pluginerrors.New(pluginerrors.ErrCodeIncompatibleVersion, "plugin is not compatible with this core version")
	}

	artifact, err := selectArtifact(manifest)
	if err != nil {
		return nil, err
	}

	if removeErr := s.removeExistingInstallation(ctx, pluginID, true); removeErr != nil {
		return nil, removeErr
	}

	installPath, err := s.prepareInstallPath(ctx, manifest, artifact)
	if err != nil {
		return nil, err
	}
	if manifest.RuntimeType == sdkmanifest.RuntimeTypeBinary || manifest.RuntimeType == sdkmanifest.RuntimeTypeService {
		if chmodErr := os.Chmod(installPath, 0o755); chmodErr != nil {
			return nil, chmodErr
		}
	}

	record, err := s.manager.RegisterInstalled(manifest, installPath)
	if err != nil {
		return nil, err
	}
	record, err = s.manager.MarkRegistered(record.ID)
	if err != nil {
		return nil, err
	}

	return &InstallPluginResult{
		Record:          record,
		ArtifactURL:     artifact.URL,
		InstallPath:     installPath,
		RestartRequired: false,
	}, nil
}

func (s *PluginInstallService) SyncLocalDevelopmentInstallPath(ctx context.Context, pluginID string) (*InstallPluginResult, error) {
	catalog, err := s.ListCatalog(ctx)
	if err != nil {
		return nil, err
	}
	registryEntry, ok := findRegistryEntry(catalog.Plugins, pluginID)
	if !ok {
		return nil, ErrPluginCatalogEntryNotFound
	}
	manifest, err := s.manifestLoader.Load(ctx, registryEntry)
	if err != nil {
		return nil, err
	}
	artifact, err := selectArtifact(manifest)
	if err != nil {
		return nil, err
	}
	installPath, isLocalFile, err := s.resolveLocalFileInstallPath(artifact)
	if err != nil {
		return nil, err
	}
	if !isLocalFile {
		return nil, nil
	}
	if manifest.RuntimeType == sdkmanifest.RuntimeTypeBinary || manifest.RuntimeType == sdkmanifest.RuntimeTypeService {
		if chmodErr := os.Chmod(installPath, 0o755); chmodErr != nil {
			return nil, chmodErr
		}
	}
	record, err := s.manager.RegisterInstalled(manifest, installPath)
	if err != nil {
		return nil, err
	}
	record, err = s.manager.MarkRegistered(record.ID)
	if err != nil {
		return nil, err
	}
	return &InstallPluginResult{
		Record:          record,
		ArtifactURL:     artifact.URL,
		InstallPath:     installPath,
		RestartRequired: false,
	}, nil
}

func (s *PluginInstallService) Uninstall(ctx context.Context, pluginID string) (*UninstallPluginResult, error) {
	record, ok, err := s.manager.Get(pluginID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, pluginengine.ErrPluginNotFound
	}

	if err := s.removeRecordAndArtifacts(ctx, record, false); err != nil {
		return nil, err
	}

	return &UninstallPluginResult{
		PluginID: pluginID,
		Removed:  true,
	}, nil
}

func (s *PluginInstallService) getJSON(ctx context.Context, endpoint string, out any) error {
	reader, err := s.openURL(ctx, endpoint)
	if err != nil {
		return err
	}
	defer func() { _ = reader.Close() }()
	return json.NewDecoder(reader).Decode(out)
}

func (s *PluginInstallService) prepareInstallPath(ctx context.Context, entry sdkmanifest.Manifest, artifact sdkmanifest.Artifact) (string, error) {
	if installPath, isLocalFile, err := s.resolveLocalFileInstallPath(artifact); err != nil {
		return "", err
	} else if isLocalFile {
		return installPath, nil
	}

	installDir := filepath.Join(s.cfg.PluginDir, entry.ID, entry.Version)
	if mkdirErr := os.MkdirAll(installDir, 0o755); mkdirErr != nil {
		return "", mkdirErr
	}

	filename := artifactFilename(entry, artifact)
	installPath := filepath.Join(installDir, filename)
	if downloadErr := s.downloadArtifact(ctx, artifact, installPath); downloadErr != nil {
		return "", downloadErr
	}
	return installPath, nil
}

func (s *PluginInstallService) resolveLocalFileInstallPath(artifact sdkmanifest.Artifact) (string, bool, error) {
	parsed, err := url.Parse(strings.TrimSpace(artifact.URL))
	if err != nil {
		return "", false, err
	}
	if parsed.Scheme != "file" {
		return "", false, nil
	}
	installPath := filepath.Clean(parsed.Path)
	if !filepath.IsAbs(installPath) {
		var absPath string
		absPath, err = filepath.Abs(installPath)
		if err != nil {
			return "", false, err
		}
		installPath = absPath
	}
	file, err := os.Open(installPath)
	if err != nil {
		return "", false, err
	}
	defer func() { _ = file.Close() }()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", false, err
	}
	if err := verifyChecksum(hex.EncodeToString(hasher.Sum(nil)), artifact.Checksum); err != nil {
		return "", false, err
	}
	return installPath, true, nil
}

func (s *PluginInstallService) downloadArtifact(ctx context.Context, artifact sdkmanifest.Artifact, installPath string) error {
	reader, err := s.openURL(ctx, artifact.URL)
	if err != nil {
		return err
	}
	defer func() { _ = reader.Close() }()

	tmpPath := installPath + ".tmp"
	file, err := os.Create(tmpPath)
	if err != nil {
		return err
	}

	hasher := sha256.New()
	if _, err := io.Copy(io.MultiWriter(file, hasher), reader); err != nil {
		_ = file.Close()
		_ = os.Remove(tmpPath)
		return err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}

	if err := verifyChecksum(hex.EncodeToString(hasher.Sum(nil)), artifact.Checksum); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}

	if err := os.Rename(tmpPath, installPath); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return nil
}

func (s *PluginInstallService) openURL(ctx context.Context, rawURL string) (io.ReadCloser, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}

	switch parsed.Scheme {
	case "file":
		return os.Open(parsed.Path)
	case "http", "https":
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
		if err != nil {
			return nil, err
		}
		resp, err := s.client.Do(req)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusOK {
			defer resp.Body.Close()
			return nil, fmt.Errorf("download failed with status %d", resp.StatusCode)
		}
		return resp.Body, nil
	default:
		return nil, fmt.Errorf("unsupported url scheme %q", parsed.Scheme)
	}
}

func findRegistryEntry(plugins []RegistryEntry, pluginID string) (RegistryEntry, bool) {
	for _, entry := range plugins {
		if entry.Manifest.ID == pluginID {
			return entry, true
		}
	}
	return RegistryEntry{}, false
}

func selectArtifact(manifest sdkmanifest.Manifest) (sdkmanifest.Artifact, error) {
	target := currentPlatform(manifest.RuntimeType)
	for _, artifact := range manifest.Artifacts {
		if artifact.Platform == target {
			return artifact, nil
		}
	}
	return sdkmanifest.Artifact{}, pluginerrors.New(pluginerrors.ErrCodeArtifactNotFound, "no artifact available for current platform")
}

func currentPlatform(runtimeType sdkmanifest.RuntimeType) sdkmanifest.Platform {
	if runtimeType == sdkmanifest.RuntimeTypeService {
		return sdkmanifest.PlatformLinuxDocker
	}

	switch runtime.GOOS {
	case "windows":
		return sdkmanifest.PlatformWindowsBinary
	case "darwin":
		return sdkmanifest.PlatformMacOSBinary
	default:
		return sdkmanifest.PlatformLinuxBinary
	}
}

func verifyChecksum(actual string, expected string) error {
	expected = strings.TrimSpace(expected)
	if expected == "" {
		return pluginerrors.New(pluginerrors.ErrCodeChecksumMismatch, "missing checksum")
	}

	parts := strings.SplitN(expected, ":", 2)
	if len(parts) != 2 || parts[0] != "sha256" {
		return pluginerrors.New(pluginerrors.ErrCodeChecksumMismatch, "unsupported checksum format")
	}
	if !strings.EqualFold(parts[1], actual) {
		return pluginerrors.New(pluginerrors.ErrCodeChecksumMismatch, "downloaded artifact checksum mismatch")
	}
	return nil
}

func artifactFilename(manifest sdkmanifest.Manifest, artifact sdkmanifest.Artifact) string {
	if parsed, err := url.Parse(artifact.URL); err == nil {
		if base := filepath.Base(parsed.Path); base != "." && base != "/" && base != "" {
			return base
		}
	}
	if manifest.RuntimeType == sdkmanifest.RuntimeTypeBinary && runtime.GOOS == "windows" {
		return manifest.ID + ".exe"
	}
	return manifest.ID
}

func (s *PluginInstallService) removeExistingInstallation(ctx context.Context, pluginID string, preserveSecrets bool) error {
	record, ok, err := s.manager.Get(pluginID)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	return s.removeRecordAndArtifacts(ctx, record, preserveSecrets)
}

func (s *PluginInstallService) removeRecordAndArtifacts(ctx context.Context, record pluginengine.Record, preserveSecrets bool) error {
	if record.State == sdkstate.Active || record.State == sdkstate.ActivationPending {
		if _, err := s.manager.Deactivate(ctx, record.ID); err != nil {
			return err
		}
	}

	if s.secretService != nil && !preserveSecrets {
		if err := s.secretService.DeleteAllForPlugin(record.ID); err != nil {
			return err
		}
	}
	if err := s.removeInstallArtifacts(record.InstallPath); err != nil {
		return err
	}
	return s.manager.Remove(record.ID)
}

func (s *PluginInstallService) removeInstallArtifacts(installPath string) error {
	installPath = strings.TrimSpace(installPath)
	if installPath == "" {
		return nil
	}
	if strings.TrimSpace(s.cfg.PluginDir) != "" {
		cleanPluginDir := filepath.Clean(s.cfg.PluginDir)
		cleanInstallPath := filepath.Clean(installPath)
		rel, err := filepath.Rel(cleanPluginDir, cleanInstallPath)
		if err != nil || strings.HasPrefix(rel, "..") || rel == "." {
			return nil
		}
	}

	if err := os.Remove(installPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}

	versionDir := filepath.Dir(installPath)
	pluginDir := filepath.Dir(versionDir)
	_ = os.Remove(versionDir)
	_ = os.Remove(pluginDir)
	return nil
}
