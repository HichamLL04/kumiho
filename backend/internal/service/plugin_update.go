package service

import (
	"context"
	"sort"

	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	"github.com/aha-hyeong/kumiho/backend/internal/version"
)

type PluginUpdateItem struct {
	PluginID        string `json:"plugin_id"`
	Name            string `json:"name"`
	CurrentVersion  string `json:"current_version"`
	LatestVersion   string `json:"latest_version,omitempty"`
	UpdateAvailable bool   `json:"update_available"`
}

type PluginUpdateSummary struct {
	HasUpdates bool               `json:"has_updates"`
	Count      int                `json:"count"`
	Plugins    []PluginUpdateItem `json:"plugins"`
}

func (s *PluginInstallService) CheckUpdates(ctx context.Context) (*PluginUpdateSummary, error) {
	catalog, err := s.ListCatalog(ctx)
	if err != nil {
		return nil, err
	}

	records, err := s.manager.List()
	if err != nil {
		return nil, err
	}

	catalogByID := make(map[string]string, len(catalog.Plugins))
	catalogNames := make(map[string]string, len(catalog.Plugins))
	for _, plugin := range catalog.Plugins {
		catalogByID[plugin.Manifest.ID] = plugin.Manifest.Version
		catalogNames[plugin.Manifest.ID] = plugin.Manifest.Name
	}

	items := make([]PluginUpdateItem, 0, len(records))
	updateCount := 0
	for _, record := range records {
		latestVersion := catalogByID[record.ID]
		updateAvailable := isPluginUpdateAvailable(record, latestVersion)
		if updateAvailable {
			updateCount++
		}

		name := record.Manifest.Name
		if catalogNames[record.ID] != "" {
			name = catalogNames[record.ID]
		}

		items = append(items, PluginUpdateItem{
			PluginID:        record.ID,
			Name:            name,
			CurrentVersion:  record.Manifest.Version,
			LatestVersion:   latestVersion,
			UpdateAvailable: updateAvailable,
		})
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].UpdateAvailable != items[j].UpdateAvailable {
			return items[i].UpdateAvailable
		}
		return items[i].Name < items[j].Name
	})

	return &PluginUpdateSummary{
		HasUpdates: updateCount > 0,
		Count:      updateCount,
		Plugins:    items,
	}, nil
}

func isPluginUpdateAvailable(record pluginengine.Record, latestVersion string) bool {
	if latestVersion == "" || record.Manifest.Version == "" {
		return false
	}

	cmp, err := version.Compare(latestVersion, record.Manifest.Version)
	if err == nil {
		return cmp > 0
	}

	return latestVersion != record.Manifest.Version
}
