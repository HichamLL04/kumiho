import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Database, Download, Loader2, Search, Sparkles } from "lucide-react";
import { seriesAPI } from "../api/client";
import type { Series } from "../types/series";
import type { MetadataCandidateItem, MetadataFetchResponse, MetadataResult, MetadataSearchResult } from "../types/plugin";
import { localizedOriginalTitle } from "../utils/originalTitles";
import { Toast } from "./common/Toast";
import commonStyles from "./settings/SettingsComponents.module.css";
import styles from "./SeriesMetadataPanel.module.css";

interface SeriesMetadataPanelProps {
  series: Series;
  onApplied: (updated: Series) => void;
}

export function SeriesMetadataPanel({ series, onApplied }: SeriesMetadataPanelProps) {
  const { t, i18n } = useTranslation();
  const [searchResult, setSearchResult] = useState<MetadataSearchResult | null>(null);
  const [fetched, setFetched] = useState<MetadataFetchResponse | null>(null);
  const [busy, setBusy] = useState<"search" | "fetch" | "apply" | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [status, setStatus] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [searchTitle, setSearchTitle] = useState("");

  const selectedCandidate = useMemo(() => {
    if (!selectedKey || !searchResult) return null;
    return searchResult.candidates.find((item) => candidateKey(item) === selectedKey) || null;
  }, [searchResult, selectedKey]);
  const candidatesByProvider = useMemo(() => {
    const grouped = new Map<string, MetadataCandidateItem[]>();
    for (const item of searchResult?.candidates || []) {
      const items = grouped.get(item.plugin_id) || [];
      items.push(item);
      grouped.set(item.plugin_id, items);
    }

    return Array.from(grouped.entries())
      .map(([pluginId, items]) => ({
        pluginId,
        pluginName: items[0]?.plugin_name || pluginId,
        items,
      }))
      .sort((left, right) => left.pluginName.localeCompare(right.pluginName));
  }, [searchResult]);
  const previewOriginalTitle = localizedOriginalTitle(
    fetched?.result.original_titles,
    i18n.language || "ko",
    fetched?.result.original_title || "",
  );

  const handleSearch = async () => {
    setBusy("search");
    setFetched(null);
    try {
      const response = await seriesAPI.metadataSearch(series.id, { title: searchTitle.trim() || undefined });
      setSearchResult(response.data);
      setSelectedKey(response.data.candidates[0] ? candidateKey(response.data.candidates[0]) : null);
      setStatus({ type: "success", message: t("series.metadata.toast.search_success") });
    } catch (error: unknown) {
      console.error("Failed to search metadata:", error);
      const err = error as { response?: { data?: { error?: string } } };
      setStatus({ type: "error", message: err.response?.data?.error || t("series.metadata.toast.search_failed") });
    } finally {
      setBusy(null);
    }
  };

  const handleFetch = async () => {
    if (!selectedCandidate) return;
    setBusy("fetch");
    try {
      const response = await seriesAPI.metadataFetch(series.id, {
        plugin_id: selectedCandidate.plugin_id,
        source: selectedCandidate.candidate.source,
      });
      setFetched(response.data);
      setStatus({ type: "success", message: t("series.metadata.toast.fetch_success") });
    } catch (error: unknown) {
      console.error("Failed to fetch metadata:", error);
      const err = error as { response?: { data?: { error?: string } } };
      setStatus({ type: "error", message: err.response?.data?.error || t("series.metadata.toast.fetch_failed") });
    } finally {
      setBusy(null);
    }
  };

  const handleApply = async (result: MetadataResult) => {
    setBusy("apply");
    try {
      const response = await seriesAPI.metadataApply(series.id, result);
      onApplied(response.data.series);
      setStatus({
        type: "success",
        message: response.data.updated_fields.length > 0
          ? t("series.metadata.toast.apply_success", { count: response.data.updated_fields.length })
          : t("series.metadata.toast.apply_no_changes"),
      });
    } catch (error: unknown) {
      console.error("Failed to apply metadata:", error);
      const err = error as { response?: { data?: { error?: string } } };
      setStatus({ type: "error", message: err.response?.data?.error || t("series.metadata.toast.apply_failed") });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.metadataPanel}>
      {status && (
        <Toast
          type={status.type}
          message={status.message}
          onClose={() => setStatus(null)}
        />
      )}

      <div className={styles.metadataPanelHeader}>
        <div>
          <h2>{t("series.metadata.title")}</h2>
          <p>{t("series.metadata.desc")}</p>
        </div>
        <div className={styles.metadataSearchControls}>
          <input
            className={styles.metadataSearchInput}
            value={searchTitle}
            onChange={(event) => setSearchTitle(event.target.value)}
            placeholder={series.title}
          />
          <button
            className={`${commonStyles.settingsSelect} ${styles.metadataSearchButton}`}
            onClick={() => void handleSearch()}
            disabled={busy !== null}
          >
            {busy === "search" ? <Loader2 size={14} className={commonStyles.loadingSpinner} /> : <Search size={14} />}
            <span>{t("series.metadata.search")}</span>
          </button>
        </div>
      </div>

      {searchResult?.query && (
        <div className={styles.metadataQueryInfo}>
          <strong>검색어</strong>
          <span>{searchResult.query.series_name || searchResult.query.local_title || searchTitle || series.title}</span>
        </div>
      )}

      {searchResult?.failures && searchResult.failures.length > 0 && (
        <div className={styles.metadataFailures}>
          {searchResult.failures.map((failure) => (
            <div key={`${failure.plugin_id}-${failure.message}`} className={styles.metadataFailureItem}>
              <strong>{failure.plugin_name}</strong>
              <span>{failure.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.metadataGrid}>
        <div className={styles.metadataColumn}>
          <div className={styles.metadataColumnHeader}>
            <Sparkles size={16} />
            <span>{t("series.metadata.candidates")}</span>
          </div>
          <div className={styles.metadataProviderGrid}>
            {candidatesByProvider.length ? (
              candidatesByProvider.map((provider) => (
                <section key={provider.pluginId} className={styles.metadataProviderColumn}>
                  <div className={styles.metadataProviderHeader}>
                    <span>{provider.pluginName}</span>
                    <small>{provider.items.length}건</small>
                  </div>
                  <div className={styles.metadataCandidates}>
                    {provider.items.map((item) => {
                      const key = candidateKey(item);
                      const isSelected = selectedKey === key;
                      return (
                        <button key={key} className={`${styles.metadataCandidate} ${isSelected ? styles.selected : ""}`} onClick={() => setSelectedKey(key)}>
                          <div className={styles.metadataCandidateBody}>
                            {item.candidate.cover_url ? (
                              <img
                                className={styles.metadataCandidateCover}
                                src={item.candidate.cover_url}
                                alt={item.candidate.title}
                                loading="lazy"
                              />
                            ) : (
                              <div className={styles.metadataCandidateCoverPlaceholder}>
                                <Database size={18} />
                              </div>
                            )}
                            <div className={styles.metadataCandidateContent}>
                              <div className={styles.metadataCandidateTop}>
                                <strong>{item.candidate.title}</strong>
                                <span>{Math.round(item.candidate.confidence * 100)}%</span>
                              </div>
                              {item.candidate.description && (
                                <p className={styles.metadataCandidateDescription}>{item.candidate.description}</p>
                              )}
                              <p>{item.candidate.authors?.join(", ") || "-"}</p>
                              <p>{item.candidate.reason || "-"}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))
            ) : (
              <div className={styles.metadataEmpty}>{t("series.metadata.empty_candidates")}</div>
            )}
          </div>
          <button className={commonStyles.settingsSelect} onClick={() => void handleFetch()} disabled={!selectedCandidate || busy !== null}>
            {busy === "fetch" ? <Loader2 size={14} className={commonStyles.loadingSpinner} /> : <Download size={14} />}
            <span>{t("series.metadata.fetch")}</span>
          </button>
        </div>

        <div className={styles.metadataColumn}>
          <div className={styles.metadataColumnHeader}>
            <Database size={16} />
            <span>{t("series.metadata.preview")}</span>
          </div>
          {fetched?.result ? (
            <div className={styles.metadataPreview}>
              {fetched.result.cover?.url && (
                <div className={styles.metadataPreviewCoverSection}>
                  <img
                    className={styles.metadataPreviewCover}
                    src={fetched.result.cover.url}
                    alt={fetched.result.title}
                    loading="lazy"
                  />
                </div>
              )}
              <div className={styles.metadataPreviewSection}>
                <label>{t("series.metadata.fields.title")}</label>
                <p>{fetched.result.title}</p>
              </div>
              <div className={styles.metadataPreviewSection}>
                <label>{t("series.metadata.fields.original_title")}</label>
                <p>{previewOriginalTitle || "-"}</p>
              </div>
              <div className={styles.metadataPreviewSection}>
                <label>{t("series.metadata.fields.authors")}</label>
                <p>{fetched.result.authors?.join(", ") || "-"}</p>
              </div>
              <div className={styles.metadataPreviewSection}>
                <label>{t("series.metadata.fields.publisher")}</label>
                <p>{fetched.result.publisher || "-"}</p>
              </div>
              <div className={styles.metadataPreviewSection}>
                <label>{t("series.metadata.fields.publication_date")}</label>
                <p>{fetched.result.publication_date || "-"}</p>
              </div>
              <div className={styles.metadataPreviewSection}>
                <label>{t("series.metadata.fields.language")}</label>
                <p>{fetched.result.language || "-"}</p>
              </div>
              <div className={styles.metadataPreviewSection}>
                <label>{t("series.metadata.fields.description")}</label>
                <p>{fetched.result.description || "-"}</p>
              </div>
              <div className={styles.metadataPreviewSection}>
                <label>{t("series.metadata.fields.tags")}</label>
                <p>{fetched.result.tags?.join(", ") || "-"}</p>
              </div>
              <div className={styles.metadataPreviewSection}>
                <label>{t("series.metadata.fields.identifiers")}</label>
                <p className={styles.metadataIdentifiers}>{formatIdentifiers(fetched.result.identifiers)}</p>
              </div>
              <button className={commonStyles.settingsSelect} onClick={() => void handleApply(fetched.result)} disabled={busy !== null}>
                {busy === "apply" ? <Loader2 size={14} className={commonStyles.loadingSpinner} /> : <Sparkles size={14} />}
                <span>{t("series.metadata.apply")}</span>
              </button>
            </div>
          ) : (
            <div className={styles.metadataEmpty}>{t("series.metadata.empty_preview")}</div>
          )}
        </div>
      </div>
    </section>
  );
}

function candidateKey(item: MetadataCandidateItem) {
  return `${item.plugin_id}:${item.candidate.source.id}`;
}

function formatIdentifiers(identifiers?: Record<string, string>) {
  if (!identifiers) return "-";
  const entries = Object.entries(identifiers)
    .filter(([, value]) => value && value.trim() !== "")
    .map(([key, value]) => `${key}: ${value}`);
  return entries.length ? entries.join("\n") : "-";
}
