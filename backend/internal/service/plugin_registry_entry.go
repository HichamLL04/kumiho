package service

import sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"

// RegistryEntry is a single entry in the plugin registry index (index.json).
//
// If ManifestURL is set, it points to a manifest.json published alongside the plugin's
// release artifacts and is the source of truth for all manifest data except Artifacts.
// Inline manifest fields (embedded sdkmanifest.Manifest) are used only when ManifestURL
// is absent — this is the legacy path and will be removed in Phase D.
//
// Artifacts always come from the registry entry itself (the deployment index),
// not from the plugin's manifest.json.
type RegistryEntry struct {
	// ManifestURL points to a manifest.json published as a release asset.
	// When present, it is fetched at install/update time. Fetch failure is a hard error —
	// there is no silent fallback to inline fields.
	ManifestURL string `json:"manifest_url,omitempty"`

	// Inline manifest fields (legacy, used only when ManifestURL is empty).
	sdkmanifest.Manifest
}
