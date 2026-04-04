import { useState, useEffect, useCallback, useId, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Search, Sparkles, Loader2, Database, ChevronDown } from "lucide-react";
import { libraryAPI, seriesAPI, settingAPI } from "../../api/client";
import type { Library, Series } from "../../types/series";
import type { MetadataFetchResponse, MetadataSearchResult } from "../../types/plugin";
import { ProgressBar } from "../common/ProgressBar";
import { Toast } from "../common/Toast";
import { EditSeriesModal } from "../modals/EditSeriesModal";
import styles from "./MetadataTab.module.css";
import commonStyles from "./SettingsComponents.module.css";

interface SeriesMetadataInfo extends Series {
  scanStatus?: "idle" | "searching" | "matched" | "failed" | "applied";
  matchResult?: MetadataFetchResponse;
  error?: string;
}

interface MetadataSettingsData {
  epub_title_override?: string;
}

export function MetadataTab() {
  const { t } = useTranslation();
  const progressLabelId = useId();
  const librarySelectorLabelId = useId();
  const cancelScanRequestedRef = useRef(false);
  const isMountedRef = useRef(true);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>("");
  const [seriesList, setSeriesList] = useState<SeriesMetadataInfo[]>([]);
  const [deselectedApplyIds, setDeselectedApplyIds] = useState<string[]>([]);
  const [editingSeries, setEditingSeries] = useState<SeriesMetadataInfo | null>(null);
  const [expandedResultId, setExpandedResultId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [epubTitleOverride, setEpubTitleOverride] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const deselectedApplySet = useMemo(() => new Set(deselectedApplyIds), [deselectedApplyIds]);
  const selectedMatchedCount = useMemo(
    () => seriesList.filter((series) => series.scanStatus === "matched" && !deselectedApplySet.has(series.id)).length,
    [deselectedApplySet, seriesList],
  );
  const scanPercent = scanProgress.total > 0 ? Math.round((scanProgress.current / scanProgress.total) * 100) : 0;

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      cancelScanRequestedRef.current = true;
    };
  }, []);

  // Load libraries on mount
  useEffect(() => {
    libraryAPI
      .getAll()
      .then((res: { data: { libraries?: Array<Library & { type?: string }> } }) => {
        if (!isMountedRef.current) return;
        const allLibraries = res.data.libraries || [];
        const localLibraries = allLibraries.filter((lib) => lib.type !== "SYSTEM");
        setLibraries(localLibraries);
        if (localLibraries.length > 0) {
          setSelectedLibraryId(localLibraries[0].id);
        }
      })
      .catch((err) => console.error("Failed to load libraries:", err));

    settingAPI
      .list()
      .then((data: MetadataSettingsData) => {
        if (!isMountedRef.current) return;
        if (data.epub_title_override) {
          setEpubTitleOverride(data.epub_title_override === "true");
        }
      })
      .catch((err) => console.error("Failed to load metadata settings:", err));
  }, []);

  // Load series when selected library changes
  const loadSeries = useCallback(
    async (libraryId: string) => {
      if (!libraryId) return;
      if (isMountedRef.current) {
        setDeselectedApplyIds([]);
        setExpandedResultId(null);
        setSeriesList([]);
        setIsLoading(true);
      }
      try {
        const res = await libraryAPI.getSeries(libraryId);
        if (!isMountedRef.current) return;
        setSeriesList(res.data.series || []);
      } catch (err) {
        console.error("Failed to load series:", err);
        if (!isMountedRef.current) return;
        setSeriesList([]);
        setToast({ type: "error", message: t("settings.metadata.error_load_series") });
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [t],
  );

  useEffect(() => {
    if (selectedLibraryId) {
      loadSeries(selectedLibraryId);
    }
  }, [selectedLibraryId, loadSeries]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const touchPreviewQuery = window.matchMedia("(hover: none), (pointer: coarse)");
    const syncExpandedResultState = () => {
      if (!touchPreviewQuery.matches) {
        setExpandedResultId(null);
      }
    };

    syncExpandedResultState();
    touchPreviewQuery.addEventListener("change", syncExpandedResultState);

    return () => {
      touchPreviewQuery.removeEventListener("change", syncExpandedResultState);
    };
  }, []);

  useEffect(() => {
    if (!expandedResultId) return;

    const isTouchPreviewMode =
      typeof window !== "undefined" && window.matchMedia("(hover: none), (pointer: coarse)").matches;

    if (!isTouchPreviewMode) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest("[data-match-preview='true']")) return;
      setExpandedResultId(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [expandedResultId]);

  const isApplySelected = (series: SeriesMetadataInfo) =>
    series.scanStatus === "matched" && !deselectedApplyIds.includes(series.id);

  const toggleApplySelection = (seriesId: string) => {
    setDeselectedApplyIds((prev) =>
      prev.includes(seriesId) ? prev.filter((id) => id !== seriesId) : [...prev, seriesId],
    );
  };

  const toggleResultPreview = (seriesId: string) => {
    setExpandedResultId((prev) => (prev === seriesId ? null : seriesId));
  };

  const handleMetadataSettingChange = async (value: string) => {
    try {
      await settingAPI.update("epub_title_override", { value });
      if (!isMountedRef.current) return;
      setEpubTitleOverride(value === "true");
      setToast({ type: "success", message: t("settings.viewer.toast.saved") });
    } catch (error) {
      console.error("Failed to update metadata setting:", error);
      if (isMountedRef.current) {
        setToast({ type: "error", message: t("settings.viewer.toast.save_failed") });
      }
    }
  };

  const handleScan = async () => {
    if (isScanning || seriesList.length === 0) return;
    const scanTargets = seriesList
      .map((series, index) => ({ series, index }))
      .filter(({ series }) => series.scanStatus !== "matched" && series.scanStatus !== "applied");
    if (scanTargets.length === 0) return;

    cancelScanRequestedRef.current = false;
    setIsScanning(true);
    setScanProgress({ current: 0, total: scanTargets.length });

    const updatedList = [...seriesList];

    for (let processedCount = 0; processedCount < scanTargets.length; processedCount++) {
      if (cancelScanRequestedRef.current) {
        break;
      }

      const { series, index } = scanTargets[processedCount];

      if (isMountedRef.current) {
        setScanProgress((prev) => ({ ...prev, current: processedCount + 1 }));
      }

      // Update status to searching
      updatedList[index] = { ...series, scanStatus: "searching" };
      if (isMountedRef.current) {
        setSeriesList([...updatedList]);
      }

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

          if (cancelScanRequestedRef.current) {
            updatedList[index] = { ...series, scanStatus: series.scanStatus || "idle" };
            break;
          }

          updatedList[index] = {
            ...series,
            scanStatus: "matched",
            matchResult: fetchRes,
          };
        } else {
          updatedList[index] = { ...series, scanStatus: "failed" };
        }
      } catch (err) {
        if (cancelScanRequestedRef.current) {
          updatedList[index] = { ...series, scanStatus: series.scanStatus || "idle" };
          break;
        }
        console.error(`Failed to scan series ${series.title}:`, err);
        updatedList[index] = {
          ...series,
          scanStatus: "failed",
          error: err instanceof Error ? err.message : String(err),
        };
      }

      if (isMountedRef.current) {
        setSeriesList([...updatedList]);
      }
      // Small delay to prevent overwhelming the server/plugins
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (isMountedRef.current) {
      setIsScanning(false);
      setSeriesList([...updatedList]);
      setToast({
        type: cancelScanRequestedRef.current ? "info" : "success",
        message: cancelScanRequestedRef.current
          ? t("settings.metadata.scan_cancelled")
          : t("settings.metadata.scan_complete"),
      });
    }
    cancelScanRequestedRef.current = false;
  };

  const handleScanButtonClick = () => {
    if (isScanning) {
      cancelScanRequestedRef.current = true;
      return;
    }

    void handleScan();
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
      {editingSeries && (
        <EditSeriesModal
          isOpen={Boolean(editingSeries)}
          onClose={() => setEditingSeries(null)}
          series={editingSeries}
          onUpdate={(updatedSeries) => {
            setSeriesList((prev) => prev.map((series) => (series.id === updatedSeries.id ? { ...series, ...updatedSeries } : series)));
            setEditingSeries((prev) => (prev?.id === updatedSeries.id ? { ...prev, ...updatedSeries } : prev));
          }}
        />
      )}

      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      <section className={styles.metadataSettingsCard}>
        <div className={styles.metadataSettingsHeader}>
          <h3>{t("settings.viewer.subsections.metadata")}</h3>
          <p>{t("settings.metadata.settings_description")}</p>
        </div>
        <div className={commonStyles.settingsItem}>
          <div className={commonStyles.itemInfo}>
            <label htmlFor="epub_title_override">{t("settings.viewer.epub.title_override_label")}</label>
            <p>{t("settings.viewer.epub.title_override_desc")}</p>
          </div>
          <div className={commonStyles.itemControl}>
            <select
              id="epub_title_override"
              value={epubTitleOverride ? "true" : "false"}
              onChange={(e) => void handleMetadataSettingChange(e.target.value)}
              className={commonStyles.settingsSelect}
            >
              <option value="true">{t("common.on", { defaultValue: "켜기" })}</option>
              <option value="false">{t("common.off", { defaultValue: "끄기" })}</option>
            </select>
          </div>
        </div>
      </section>

      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h2>{t("settings.metadata.title")}</h2>
          <p>{t("settings.metadata.description")}</p>
        </div>
        <div className={styles.actions}>
          <div className={styles.librarySelector}>
            <div id={librarySelectorLabelId} className={styles.selectorLabel}>
              <Database size={14} />
              <span>{t("settings.tabs.libraries")}</span>
            </div>
            <div className={styles.selectWrap}>
              <select
                className={styles.librarySelect}
                value={selectedLibraryId}
                onChange={(e) => setSelectedLibraryId(e.target.value)}
                disabled={isScanning}
                aria-labelledby={librarySelectorLabelId}
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
            onClick={handleScanButtonClick}
            disabled={isLoading || (!isScanning && seriesList.length === 0)}
          >
            {isScanning ? (
              <Loader2
                className={styles.spinning}
                size={16}
              />
            ) : (
              <Search size={16} />
            )}
            {isScanning ? t("settings.metadata.cancel_scan") : t("settings.metadata.start_scan")}
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
        <div className={styles.progressArea} role="status" aria-live="polite">
          <div className={styles.progressText}>
            <span id={progressLabelId}>
              {t("settings.metadata.scanning_progress", { current: scanProgress.current, total: scanProgress.total })}
            </span>
            <span>{scanPercent}%</span>
          </div>
          <ProgressBar
            value={scanPercent}
            ariaLabelledBy={progressLabelId}
          />
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
                {seriesList.map((series, index) => {
                  const rowStatusClass = series.scanStatus ? styles[series.scanStatus] || "" : "";
                  const statusDotClass = styles[`${series.scanStatus || "idle"}Dot`] || styles.idleDot;
                  return (
                  <tr
                    key={series.id}
                    className={`${rowStatusClass} ${!series.matchResult && series.scanStatus !== "failed" ? styles.mobileNoResult : ""}`.trim()}
                  >
                    <td data-label={t("settings.metadata.table.series")}>
                      <button
                        type="button"
                        className={styles.seriesLinkButton}
                        onClick={() => window.open(`/series/${series.id}`, "_blank", "noopener,noreferrer")}
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
                    <td data-label={t("settings.metadata.table.match_status")}>
                      <div className={styles.statusBadge}>
                        <span
                          className={`${styles.statusDot} ${statusDotClass}`}
                          aria-hidden="true"
                        />
                        {series.scanStatus === "searching" && (
                          <Loader2
                            size={14}
                            className={styles.spinning}
                          />
                        )}
                        {t(`settings.metadata.status.${series.scanStatus || "idle"}`)}
                      </div>
                    </td>
                    <td data-label={t("settings.metadata.table.match_result")}>
                      <div className={styles.rowActions}>
                        {series.matchResult && (
                          <div
                            className={`${styles.matchPreview} ${index >= Math.max(seriesList.length - 2, 0) ? styles.matchPreviewUp : ""} ${expandedResultId === series.id ? styles.matchPreviewExpanded : ""}`}
                            data-match-preview="true"
                            tabIndex={0}
                            role="button"
                            aria-expanded={expandedResultId === series.id}
                            aria-label={t("settings.metadata.preview_result_for", {
                              title: series.matchResult.result.title,
                            })}
                            onClick={() => toggleResultPreview(series.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                toggleResultPreview(series.id);
                              }
                            }}
                          >
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
                              <span className={styles.matchTitle}>
                                {series.matchResult.result.title}
                              </span>
                              <span className={styles.matchDescription}>
                                {series.matchResult.result.description || "-"}
                              </span>
                            </div>
                            <div className={styles.matchPopover}>
                              <div className={styles.matchPopoverMedia}>
                                <div className={styles.matchPopoverThumbnail}>
                                  {series.matchResult.result.cover?.url ? (
                                    <img
                                      src={series.matchResult.result.cover.url}
                                      alt={series.matchResult.result.title}
                                    />
                                  ) : (
                                    <div className={styles.matchThumbnailFallback}>
                                      <Database size={18} />
                                    </div>
                                  )}
                                </div>
                                <div className={styles.matchPopoverContent}>
                                  <strong>{series.matchResult.result.title}</strong>
                                  {series.matchResult.result.authors && series.matchResult.result.authors.length > 0 && (
                                    <span className={styles.matchPopoverAuthors}>
                                      {series.matchResult.result.authors.join(", ")}
                                    </span>
                                  )}
                                  <p>{series.matchResult.result.description || "-"}</p>
                                </div>
                              </div>
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
                              aria-label={`${series.title} - ${t("settings.metadata.apply_all")}`}
                            />
                          </label>
                        )}
                        {series.scanStatus === "failed" && (
                          <button
                            className={`${styles.btnIcon} ${styles.failedActionButton}`}
                            onClick={() => setEditingSeries(series)}
                            title={t("settings.metadata.manual_search")}
                          >
                            <Search size={14} />
                            <span>{t("settings.metadata.manual_search")}</span>
                          </button>
                        )}
                        {!series.matchResult && series.scanStatus !== "failed" && <span className={styles.emptyResult}>-</span>}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
