import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Search, Sparkles, AlertCircle, Loader2, Database, ChevronDown } from "lucide-react";
import { libraryAPI, seriesAPI } from "../../api/client";
import type { Library, Series } from "../../types/series";
import type { MetadataFetchResponse, MetadataSearchResult } from "../../types/plugin";
import { ProgressBar } from "../common/ProgressBar";
import { Toast } from "../common/Toast";
import styles from "./MetadataTab.module.css";
import commonStyles from "./SettingsComponents.module.css";

interface SeriesMetadataInfo extends Series {
  scanStatus?: "idle" | "searching" | "matched" | "failed" | "applying" | "applied";
  matchResult?: MetadataFetchResponse;
  error?: string;
}

export function MetadataTab() {
  const { t } = useTranslation();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>("");
  const [seriesList, setSeriesList] = useState<SeriesMetadataInfo[]>([]);
  const [deselectedApplyIds, setDeselectedApplyIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const selectedMatchedCount = seriesList.filter(
    (series) => series.scanStatus === "matched" && !deselectedApplyIds.includes(series.id),
  ).length;

  // Load libraries on mount
  useEffect(() => {
    libraryAPI
      .getAll()
      .then((res: { data: { libraries?: Array<Library & { type?: string }> } }) => {
        const allLibraries = res.data.libraries || [];
        const localLibraries = allLibraries.filter((lib) => lib.type !== "SYSTEM");
        setLibraries(localLibraries);
        if (localLibraries.length > 0) {
          setSelectedLibraryId(localLibraries[0].id);
        }
      })
      .catch((err) => console.error("Failed to load libraries:", err));
  }, []);

  // Load series when selected library changes
  const loadSeries = useCallback(
    async (libraryId: string) => {
      if (!libraryId) return;
      setIsLoading(true);
      try {
        const res = await libraryAPI.getSeries(libraryId);
        setDeselectedApplyIds([]);
        setSeriesList(res.data.series || []);
      } catch (err) {
        console.error("Failed to load series:", err);
        setToast({ type: "error", message: t("settings.metadata.error_load_series") });
      } finally {
        setIsLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (selectedLibraryId) {
      loadSeries(selectedLibraryId);
    }
  }, [selectedLibraryId, loadSeries]);

  const isApplySelected = (series: SeriesMetadataInfo) =>
    series.scanStatus === "matched" && !deselectedApplyIds.includes(series.id);

  const toggleApplySelection = (seriesId: string) => {
    setDeselectedApplyIds((prev) =>
      prev.includes(seriesId) ? prev.filter((id) => id !== seriesId) : [...prev, seriesId],
    );
  };

  const handleScan = async () => {
    if (isScanning || seriesList.length === 0) return;
    setIsScanning(true);
    setScanProgress({ current: 0, total: seriesList.length });

    const updatedList = [...seriesList];

    for (let i = 0; i < updatedList.length; i++) {
      const series = updatedList[i];
      if (series.scanStatus === "matched" || series.scanStatus === "applied") continue;

      setScanProgress((prev) => ({ ...prev, current: i + 1 }));

      // Update status to searching
      updatedList[i] = { ...series, scanStatus: "searching" };
      setSeriesList([...updatedList]);

      try {
        // Search metadata
        const searchRes: MetadataSearchResult = await seriesAPI.metadataSearch(series.id);

        if (searchRes.candidates && searchRes.candidates.length > 0) {
          // Auto-fetch the first high-confidence candidate
          const bestCandidate = searchRes.candidates[0];
          const fetchRes = await seriesAPI.metadataFetch(series.id, {
            plugin_id: bestCandidate.plugin_id,
            source: bestCandidate.candidate.source,
          });

          updatedList[i] = {
            ...series,
            scanStatus: "matched",
            matchResult: fetchRes,
          };
        } else {
          updatedList[i] = { ...series, scanStatus: "failed" };
        }
      } catch (err) {
        console.error(`Failed to scan series ${series.title}:`, err);
        updatedList[i] = { ...series, scanStatus: "failed", error: String(err) };
      }

      setSeriesList([...updatedList]);
      // Small delay to prevent overwhelming the server/plugins
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    setIsScanning(false);
    setToast({ type: "success", message: t("settings.metadata.scan_complete") });
  };

  const handleApplyAll = async () => {
    const matchedItems = seriesList.filter((s) => s.scanStatus === "matched" && !deselectedApplyIds.includes(s.id));
    if (matchedItems.length === 0) return;

    setIsLoading(true);
    let successCount = 0;

    for (const series of matchedItems) {
      if (!series.matchResult) continue;

      try {
        await seriesAPI.metadataApply(series.id, series.matchResult.result);
        if (series.matchResult.plugin_id) {
          await seriesAPI.importCharacters(
            series.id,
            series.matchResult.result.characters || [],
            series.matchResult.plugin_id,
          );
        }
        setSeriesList((prev) => prev.map((s) => (s.id === series.id ? { ...s, scanStatus: "applied" } : s)));
        successCount++;
      } catch (err) {
        console.error(`Failed to apply metadata for ${series.title}:`, err);
      }
    }

    setIsLoading(false);
    setToast({ type: "success", message: t("settings.metadata.apply_complete", { count: successCount }) });
  };

  return (
    <div className={styles.metadataTab}>
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h2>{t("settings.metadata.title")}</h2>
          <p>{t("settings.metadata.description")}</p>
        </div>
        <div className={styles.actions}>
          <div className={styles.librarySelector}>
            <div className={styles.selectorLabel}>
              <Database size={14} />
              <span>{t("settings.tabs.libraries")}</span>
            </div>
            <div className={styles.selectWrap}>
              <select
                className={styles.librarySelect}
                value={selectedLibraryId}
                onChange={(e) => setSelectedLibraryId(e.target.value)}
                disabled={isScanning}
              >
                {libraries.map((lib) => (
                  <option
                    key={lib.id}
                    value={lib.id}
                  >
                    {lib.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={16}
                className={styles.selectIcon}
              />
            </div>
          </div>
          <button
            className={`${commonStyles.settingsButton} ${styles.scanButton} ${styles.primaryAction}`}
            onClick={handleScan}
            disabled={isScanning || isLoading || seriesList.length === 0}
          >
            {isScanning ? (
              <Loader2
                className={styles.spinning}
                size={16}
              />
            ) : (
              <Search size={16} />
            )}
            {t("settings.metadata.start_scan")}
          </button>
          <button
            className={`${commonStyles.settingsButton} ${styles.applyButton}`}
            onClick={handleApplyAll}
            disabled={isScanning || isLoading || selectedMatchedCount === 0}
          >
            <Sparkles size={16} />
            {selectedMatchedCount > 0 && <span className={styles.applyCount}>{selectedMatchedCount}</span>}
            {t("settings.metadata.apply_all")}
          </button>
        </div>
      </div>

      {isScanning && (
        <div className={styles.progressArea}>
          <div className={styles.progressText}>
            <span>
              {t("settings.metadata.scanning_progress", { current: scanProgress.current, total: scanProgress.total })}
            </span>
            <span>{Math.round((scanProgress.current / scanProgress.total) * 100)}%</span>
          </div>
          <ProgressBar value={(scanProgress.current / scanProgress.total) * 100} />
        </div>
      )}

      <div className={styles.content}>
        {isLoading && seriesList.length === 0 ? (
          <div className={styles.loadingState}>
            <Loader2
              className={styles.spinning}
              size={32}
            />
            <p>{t("common.loading")}</p>
          </div>
        ) : seriesList.length === 0 ? (
          <div className={styles.emptyState}>
            <Database
              size={48}
              opacity={0.2}
            />
            <p>{t("settings.metadata.no_series")}</p>
          </div>
        ) : (
          <div className={styles.seriesTableContainer}>
            <table className={styles.seriesTable}>
              <thead>
                <tr>
                  <th>
                    <div className={styles.seriesHeaderLabel}>
                      <span className={styles.seriesCount}>{t("settings.metadata.total_series_count", { count: seriesList.length })}</span>
                      <span>{t("settings.metadata.table.series")}</span>
                    </div>
                  </th>
                  <th>{t("settings.metadata.table.match_status")}</th>
                  <th>{t("settings.metadata.table.match_result")}</th>
                </tr>
              </thead>
              <tbody>
                {seriesList.map((series) => (
                  <tr
                    key={series.id}
                    className={styles[series.scanStatus || ""]}
                  >
                    <td>
                      <button
                        type="button"
                        className={styles.seriesLinkButton}
                        onClick={() => window.open(`/series/${series.id}`, "_blank")}
                        title={t("settings.metadata.view_details")}
                      >
                        <div className={styles.seriesCell}>
                          <div className={styles.thumbnailSmall}>
                            {series.thumbnail_url && (
                              <img
                                src={series.thumbnail_url}
                                alt={series.title}
                              />
                            )}
                          </div>
                          <div className={styles.seriesInfo}>
                            <div className={styles.seriesTitle}>{series.title}</div>
                            <div className={styles.seriesPath}>{series.path}</div>
                          </div>
                        </div>
                      </button>
                    </td>
                    <td>
                      <div className={styles.statusBadge}>
                        <span className={`${styles.statusDot} ${styles[`${series.scanStatus || "idle"}Dot`]}`} />
                        {series.scanStatus === "searching" && (
                          <Loader2
                            size={14}
                            className={styles.spinning}
                          />
                        )}
                        {series.scanStatus === "failed" && (
                          <AlertCircle
                            size={14}
                            color="var(--error-color)"
                          />
                        )}
                        {t(`settings.metadata.status.${series.scanStatus || "idle"}`)}
                      </div>
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        {series.matchResult && (
                          <div className={styles.matchPreview}>
                            <div className={styles.matchThumbnail}>
                              {series.matchResult.result.cover?.url ? (
                                <img
                                  src={series.matchResult.result.cover.url}
                                  alt={series.matchResult.result.title}
                                />
                              ) : (
                                <div className={styles.matchThumbnailFallback}>
                                  <Database size={16} />
                                </div>
                              )}
                            </div>
                            <div className={styles.matchContent}>
                              <span
                                className={styles.matchTitle}
                                title={series.matchResult.result.title}
                              >
                                {series.matchResult.result.title}
                              </span>
                              <span
                                className={styles.matchDescription}
                                title={series.matchResult.result.description || ""}
                              >
                                {series.matchResult.result.description || "-"}
                              </span>
                            </div>
                          </div>
                        )}
                        {series.scanStatus === "matched" && series.matchResult && (
                          <label
                            className={styles.applyCheckboxLabel}
                            title={t("settings.metadata.apply_all")}
                          >
                            <input
                              type="checkbox"
                              className={styles.applyCheckbox}
                              checked={isApplySelected(series)}
                              onChange={() => toggleApplySelection(series.id)}
                            />
                          </label>
                        )}
                        {series.scanStatus === "failed" && (
                          <button
                            className={styles.btnIcon}
                            onClick={() => window.open(`/series/${series.id}?edit=metadata`, "_blank")}
                            title={t("settings.metadata.manual_search")}
                          >
                            <Search size={14} />
                          </button>
                        )}
                        {!series.matchResult && series.scanStatus !== "failed" && <span className={styles.emptyResult}>-</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
