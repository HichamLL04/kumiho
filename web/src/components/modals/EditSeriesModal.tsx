import { useState, useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { ChevronDown, Link, RotateCcw, RefreshCw, Save, Search, Upload, Users, X } from "lucide-react";
import type { Series } from "../../types/series";
import { seriesAPI, settingAPI } from "../../api/client";
import type { MetadataApplyResponse } from "../../types/plugin";
import { SeriesMetadataPanel } from "../SeriesMetadataPanel";
import { SeriesCharactersDrawer } from "../SeriesCharactersDrawer";
import { AlertModal, type AlertType } from "./AlertModal";
import { orderedOriginalTitles } from "../../utils/originalTitles";
import { normalizeAppLanguage } from "../../utils/language";
import styles from "./EditSeriesModal.module.css";

interface EditSeriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  series: Series;
  onUpdate: (updatedSeries: Series) => void;
}

export function EditSeriesModal({ isOpen, onClose, series, onUpdate }: EditSeriesModalProps) {
  const { t, i18n } = useTranslation();
  const storedOriginalTitle = series.metadata?.original_title || "";
  const originalTitleLanguageLabel = (language: string) =>
    language === "unknown" ? t("common.unknown") : t(`settings.general.language.${language}`);
  const [formData, setFormData] = useState({
    title: "",
    authors: "",
    status: "ONGOING",
    tags: "",
    description: "",
    publication_year: "",
    original_title: "",
    publisher: "",
    published_at: "",
    isbn: "",
    anilist_id: "",
    mal_id: "",
    generate_chapter_covers: false,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isResettingMetadata, setIsResettingMetadata] = useState(false);
  const [isTranslatingDescription, setIsTranslatingDescription] = useState(false);
  const [isGeneratingCovers, setIsGeneratingCovers] = useState(false);
  const [thumbnailMode, setThumbnailMode] = useState<"file" | "url">("file");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isOriginalTitleMenuOpen, setIsOriginalTitleMenuOpen] = useState(false);
  const [isMetadataOpen, setIsMetadataOpen] = useState(false);
  const [isCharactersOpen, setIsCharactersOpen] = useState(false);
  const [charactersReloadToken, setCharactersReloadToken] = useState(0);
  const [translationLanguage, setTranslationLanguage] = useState("ko");
  const [descriptionView, setDescriptionView] = useState<"translated" | "original">("original");
  const [translatedDescription, setTranslatedDescription] = useState("");
  const [isDescriptionViewMenuOpen, setIsDescriptionViewMenuOpen] = useState(false);
  const wasOpenRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const originalTitleMenuRef = useRef<HTMLDivElement>(null);
  const descriptionViewMenuRef = useRef<HTMLDivElement>(null);
  const descriptionViewButtonRef = useRef<HTMLButtonElement>(null);
  const descriptionViewOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // AlertModal 상태
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    type: AlertType;
    title?: string;
    message: string;
    showCancel?: boolean;
    onConfirm: () => void | Promise<void>;
    onCancel?: () => void;
  }>({
    isOpen: false,
    type: "info",
    message: "",
    onConfirm: () => {},
  });

  const showAlert = (type: AlertType, message: string, title?: string) => {
    setAlertModal({
      isOpen: true,
      type,
      title,
      message,
      showCancel: false,
      onConfirm: () => setAlertModal((prev) => ({ ...prev, isOpen: false })),
    });
  };

  const showConfirm = (message: string, onConfirm: () => void | Promise<void>, title?: string) => {
    setAlertModal({
      isOpen: true,
      type: "warning",
      title,
      message,
      showCancel: true,
      onConfirm: async () => {
        await onConfirm();
        setAlertModal((prev) => (prev.type === "warning" ? { ...prev, isOpen: false } : prev));
      },
      onCancel: () => setAlertModal((prev) => ({ ...prev, isOpen: false })),
    });
  };

  const formatResetWarnings = (warnings?: string[]) => {
    if (!warnings || warnings.length === 0) return "";

    const lines = warnings.map((warning) => {
      const [code, ...rest] = warning.split(":");
      const asset = rest.join(":");

      switch (code) {
        case "asset_unmanaged":
          return t("series.edit.alert.reset_warning_unmanaged_asset", { asset });
        case "asset_remove_failed":
          return t("series.edit.alert.reset_warning_remove_failed", { asset });
        default:
          return warning;
      }
    });

    return `\n\n- ${lines.join("\n- ")}`;
  };

  useEffect(() => {
    if (isOpen && series) {
      setFormData({
        title: series.title || "",
        authors: series.metadata?.authors || "",
        status: series.metadata?.status || "ONGOING",
        tags: series.metadata?.tags || "",
        description: series.description || "",
        publication_year: series.metadata?.publication_year || "",
        original_title: storedOriginalTitle,
        publisher: series.metadata?.publisher || "",
        published_at: series.metadata?.published_at || "",
        isbn: series.metadata?.isbn || "",
        anilist_id: series.metadata?.anilist_id || "",
        mal_id: series.metadata?.mal_id || "",
        generate_chapter_covers: series.metadata?.generate_chapter_covers || false,
      });
      setThumbnailUrl("");
      setTranslatedDescription(series.metadata?.description_translated || "");
      setDescriptionView(series.metadata?.description_translated?.trim() ? "translated" : "original");
    }
  }, [isOpen, series, storedOriginalTitle]);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setThumbnailMode("file");
      setIsDragging(false);
      setIsOriginalTitleMenuOpen(false);
      setIsDescriptionViewMenuOpen(false);
      setIsMetadataOpen(false);
      setIsCharactersOpen(false);
      setCharactersReloadToken(0);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    settingAPI
      .list()
      .then((settings) => {
        setTranslationLanguage(normalizeAppLanguage(settings.app_language));
      })
      .catch((error) => {
        console.error("Failed to load translation language:", error);
      });
  }, [isOpen]);

  const originalTitleOptions = useMemo(() => {
    return orderedOriginalTitles(
      series.metadata?.original_titles,
      i18n.language || "ko",
      series.metadata?.original_title || "",
    ).map((entry) => ({
      key: entry.language,
      value: entry.title,
    }));
  }, [i18n.language, series.metadata?.original_title, series.metadata?.original_titles]);

  useEffect(() => {
    if (!isOriginalTitleMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!originalTitleMenuRef.current?.contains(event.target as Node)) {
        setIsOriginalTitleMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [isOriginalTitleMenuOpen]);

  useEffect(() => {
    if (!isDescriptionViewMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!descriptionViewMenuRef.current?.contains(event.target as Node)) {
        setIsDescriptionViewMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [isDescriptionViewMenuOpen]);

  useEffect(() => {
    if (!isDescriptionViewMenuOpen) {
      descriptionViewOptionRefs.current = [];
      return;
    }

    requestAnimationFrame(() => {
      const selectedIndex = descriptionView === "translated" ? 0 : 1;
      descriptionViewOptionRefs.current[selectedIndex]?.focus();
    });
  }, [descriptionView, isDescriptionViewMenuOpen]);

  useEffect(() => {
    const handleWindowDragEvent = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    if (isOpen) {
      window.addEventListener("dragenter", handleWindowDragEvent);
      window.addEventListener("dragover", handleWindowDragEvent);
      window.addEventListener("dragleave", handleWindowDragEvent);
      window.addEventListener("drop", handleWindowDragEvent);
    }

    return () => {
      window.removeEventListener("dragenter", handleWindowDragEvent);
      window.removeEventListener("dragover", handleWindowDragEvent);
      window.removeEventListener("dragleave", handleWindowDragEvent);
      window.removeEventListener("drop", handleWindowDragEvent);
    };
  }, [isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { value } = e.target;
    if (descriptionView === "translated") {
      setTranslatedDescription(value);
      return;
    }
    setFormData((prev) => ({ ...prev, description: value }));
  };

  const applyOriginalTitleOption = (value: string) => {
    setFormData((prev) => ({ ...prev, original_title: value }));
    setIsOriginalTitleMenuOpen(false);
  };

  const handleThumbnailChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      await uploadFile(file);
    }
  };

  const uploadFile = async (file: File) => {
    try {
      await seriesAPI.uploadThumbnail(series.id, file);
      const refreshed = await seriesAPI.get(series.id);
      onUpdate(refreshed.data);
    } catch (error) {
      console.error("Failed to upload thumbnail:", error);
      showAlert("error", t("series.edit.alert.upload_failed"));
    }
  };

  const [isSyncingID, setIsSyncingID] = useState(false);

  const handleSyncDirectID = async (platform: "anilist" | "mal", idValue: string) => {
    const trimmed = (idValue || "").trim();
    if (!trimmed) {
      showAlert("error", "Por favor ingresa un ID válido antes de sincronizar.");
      return;
    }
    setIsSyncingID(true);
    try {
      const searchTitle = platform === "anilist" ? `anilist:${trimmed}` : `mal:${trimmed}`;
      const searchRes = await seriesAPI.metadataSearch(series.id, { title: searchTitle });
      
      if (!searchRes.candidates || searchRes.candidates.length === 0) {
        showAlert("error", "No se encontraron resultados para ese ID.");
        return;
      }

      const candidate = searchRes.candidates[0];
      const fetchRes = await seriesAPI.metadataFetch(series.id, {
        plugin_id: candidate.plugin_id,
        source: candidate.candidate.source,
      });

      if (!fetchRes.result) {
        showAlert("error", "No se pudo recuperar la información detallada.");
        return;
      }

      await seriesAPI.metadataApply(series.id, fetchRes.result);
      const refreshed = await seriesAPI.get(series.id);
      
      // Update form fields with newly fetched metadata
      setFormData({
        title: refreshed.data.title || "",
        authors: refreshed.data.metadata?.authors || "",
        status: refreshed.data.status || "ONGOING",
        tags: refreshed.data.metadata?.tags || "",
        description: refreshed.data.metadata?.description || "",
        publication_year: refreshed.data.metadata?.publication_year || "",
        original_title: refreshed.data.metadata?.original_title || "",
        publisher: refreshed.data.metadata?.publisher || "",
        published_at: refreshed.data.metadata?.published_at || "",
        isbn: refreshed.data.metadata?.isbn || "",
        anilist_id: refreshed.data.metadata?.anilist_id || trimmed,
        mal_id: refreshed.data.metadata?.mal_id || (platform === "mal" ? trimmed : ""),
        generate_chapter_covers: refreshed.data.metadata?.generate_chapter_covers || false,
      });
      
      onUpdate(refreshed.data);
      showAlert("success", "¡Metadatos importados y aplicados con éxito!");
    } catch (error) {
      console.error("Sync direct ID failed:", error);
      showAlert("error", "Error al intentar importar metadatos desde el ID.");
    } finally {
      setIsSyncingID(false);
    }
  };

  const handleGenerateChapterCovers = async () => {
    if (!series) return;
    setIsGeneratingCovers(true);
    try {
      const res = await seriesAPI.generateChapterCovers(series.id);
      showAlert("success", t("series.edit.form.generate_chapter_covers_manual_success", { count: res.count }));
    } catch (error) {
      console.error("Manual generate covers failed:", error);
      showAlert("error", t("series.edit.form.generate_chapter_covers_manual_error"));
    } finally {
      setIsGeneratingCovers(false);
    }
  };

  const handleUrlUpload = async () => {
    if (!thumbnailUrl) return;
    try {
      await seriesAPI.uploadThumbnailFromUrl(series.id, thumbnailUrl);
      const refreshed = await seriesAPI.get(series.id);
      onUpdate(refreshed.data);
      setThumbnailUrl("");
    } catch (error) {
      console.error("Failed to upload thumbnail from URL:", error);
      showAlert("error", t("series.edit.alert.url_failed"));
    }
  };

  const handleResetThumbnail = () => {
    showConfirm(
      t("series.edit.alert.reset_confirm_msg"),
      async () => {
        try {
          await seriesAPI.deleteThumbnail(series.id);
          const refreshed = await seriesAPI.get(series.id);
          onUpdate(refreshed.data);
          showAlert("success", t("series.edit.alert.reset_success"));
        } catch (error) {
          console.error("Failed to reset thumbnail:", error);
          showAlert("error", t("series.edit.alert.reset_failed"));
        }
      },
      t("series.edit.alert.reset_confirm_title"),
    );
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await uploadFile(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const descriptionDirty = formData.description.trim() !== (series.description || "").trim();
      const translatedDirty = translatedDescription.trim() !== (series.metadata?.description_translated || "").trim();
      const shouldClearTranslatedDescription = descriptionDirty && !translatedDirty;
      const shouldSendTranslatedDescription = translatedDirty || shouldClearTranslatedDescription;
      const updatePayload = {
        ...formData,
        ...(shouldSendTranslatedDescription
          ? { description_translated: shouldClearTranslatedDescription ? "" : translatedDescription }
          : {}),
      };

      const res = await seriesAPI.update(series.id, updatePayload);
      onUpdate(res.data);
      window.location.reload();
    } catch (error) {
      console.error("Failed to update series:", error);
      showAlert("error", t("series.edit.alert.update_failed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleTranslateDescription = async () => {
    const translatedDirty = translatedDescription.trim() !== (series.metadata?.description_translated || "").trim();

    if (!formData.description.trim()) {
      showAlert("info", t("series.edit.alert.translate_empty"));
      return;
    }

    if (formData.description.trim() !== (series.description || "").trim()) {
      showAlert("info", t("series.edit.alert.translate_save_first"));
      return;
    }

    if (translatedDirty) {
      showAlert("info", t("series.edit.alert.translate_save_translated_first"));
      return;
    }

    setIsTranslatingDescription(true);
    try {
      const response = await seriesAPI.translateDescription(series.id, translationLanguage);
      onUpdate(response.series);
      setTranslatedDescription(response.translated_text);
      setDescriptionView("translated");
      showAlert(
        "success",
        t("series.edit.alert.translate_success", {
          language: originalTitleLanguageLabel(translationLanguage),
        }),
      );
    } catch (error) {
      console.error("Failed to translate description:", error);
      showAlert("error", t("series.edit.alert.translate_failed"));
    } finally {
      setIsTranslatingDescription(false);
    }
  };

  const closeDescriptionViewMenu = () => {
    setIsDescriptionViewMenuOpen(false);
    requestAnimationFrame(() => {
      descriptionViewButtonRef.current?.focus();
    });
  };

  const handleDescriptionViewButtonKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowDown":
      case "Enter":
      case " ":
        event.preventDefault();
        setIsDescriptionViewMenuOpen(true);
        break;
      case "ArrowUp":
        event.preventDefault();
        setIsDescriptionViewMenuOpen(true);
        requestAnimationFrame(() => {
          descriptionViewOptionRefs.current[1]?.focus();
        });
        break;
      case "Escape":
        if (isDescriptionViewMenuOpen) {
          event.preventDefault();
          closeDescriptionViewMenu();
        }
        break;
    }
  };

  const handleDescriptionViewOptionKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        descriptionViewOptionRefs.current[index === 0 ? 1 : 0]?.focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        descriptionViewOptionRefs.current[index === 0 ? 1 : 0]?.focus();
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        setDescriptionView(index === 0 ? "translated" : "original");
        closeDescriptionViewMenu();
        break;
      case "Escape":
        event.preventDefault();
        closeDescriptionViewMenu();
        break;
    }
  };

  const handleResetSeriesMetadata = () => {
    showConfirm(
      t("series.edit.alert.reset_metadata_confirm"),
      async () => {
        setIsResettingMetadata(true);
        try {
          const result = await seriesAPI.resetMetadata(series.id);
          onUpdate(result.series);
          setTranslatedDescription(result.series.metadata?.description_translated || "");
          setDescriptionView(result.series.metadata?.description_translated?.trim() ? "translated" : "original");
          setCharactersReloadToken((prev) => prev + 1);
          const warningMessage = formatResetWarnings(result.warnings);
          showAlert("success", `${t("series.edit.alert.reset_metadata_success")}${warningMessage}`);
        } catch (error) {
          console.error("Failed to reset series metadata:", error);
          showAlert("error", t("series.edit.alert.reset_metadata_failed"));
        } finally {
          setIsResettingMetadata(false);
        }
      },
      t("series.edit.alert.reset_metadata_title"),
    );
  };

  const hasTranslatedDescription = Boolean(translatedDescription.trim());
  const isShowingTranslatedDescription = hasTranslatedDescription && descriptionView === "translated";
  const displayedDescription = isShowingTranslatedDescription ? translatedDescription : formData.description;

  if (!isOpen) return null;

  const handleMetadataApplied = (response: MetadataApplyResponse) => {
    onUpdate(response.series);

    const updatedFieldSet = new Set(response.updated_fields);
    if (updatedFieldSet.size === 0) {
      return;
    }

    setFormData((prev) => ({
      ...prev,
      title: updatedFieldSet.has("title") ? response.series.title || "" : prev.title,
      authors: updatedFieldSet.has("authors") ? response.series.metadata?.authors || "" : prev.authors,
      tags: updatedFieldSet.has("tags") ? response.series.metadata?.tags || "" : prev.tags,
      description: updatedFieldSet.has("description") ? response.series.description || "" : prev.description,
      publication_year: updatedFieldSet.has("publication_year") ? response.series.metadata?.publication_year || "" : prev.publication_year,
      original_title: updatedFieldSet.has("original_title") ? response.series.metadata?.original_title || "" : prev.original_title,
      publisher: updatedFieldSet.has("publisher") ? response.series.metadata?.publisher || "" : prev.publisher,
      published_at: updatedFieldSet.has("published_at") ? response.series.metadata?.published_at || "" : prev.published_at,
      isbn: updatedFieldSet.has("isbn") ? response.series.metadata?.isbn || "" : prev.isbn,
    }));
    setTranslatedDescription(response.series.metadata?.description_translated || "");
    setDescriptionView(response.series.metadata?.description_translated?.trim() ? "translated" : "original");
  };

  return (
    <>
      {createPortal(
        <div
          className={styles.modalOverlay}
          onClick={onClose}
        >
          <div
            className={`${styles.modalContent} ${(isMetadataOpen || isCharactersOpen) ? styles.modalContentExpanded : ""} ${isCharactersOpen && !isMetadataOpen ? styles.modalContentCharactersOnly : ""} ${isMetadataOpen && !isCharactersOpen ? styles.modalContentMetadataOnly : ""} ${isMetadataOpen && isCharactersOpen ? styles.modalContentDualPane : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2>{t("series.edit.title")}</h2>
              <div className={styles.headerActions}>
                <button
                  type="button"
                  className={styles.btnReset}
                  onClick={handleResetSeriesMetadata}
                  disabled={isSaving || isResettingMetadata}
                >
                  {isResettingMetadata ? (
                    t("series.edit.actions.resetting")
                  ) : (
                    <>
                      <RotateCcw size={16} /> {t("series.edit.actions.reset")}
                    </>
                  )}
                </button>
                <button
                  type="submit"
                  form="edit-series-form"
                  className={styles.btnPrimary}
                  disabled={isSaving || isResettingMetadata}
                >
                  {isSaving ? (
                    t("series.edit.actions.saving")
                  ) : (
                    <>
                      <Save size={18} /> {t("series.edit.actions.save")}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className={styles.btnIcon}
                  onClick={onClose}
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <form
              id="edit-series-form"
              onSubmit={handleSubmit}
              className={styles.editForm}
            >
              <div
                className={`${styles.toolbarRow} ${isCharactersOpen ? styles.toolbarWithCharacters : ""} ${isMetadataOpen ? styles.toolbarWithMetadata : ""}`}
              >
                <button
                  type="button"
                  className={`${styles.metadataButton} ${isCharactersOpen ? styles.metadataButtonActive : ""}`}
                  onClick={() => {
                    setIsCharactersOpen((prev) => {
                      const next = !prev;
                      if (next) {
                        setIsMetadataOpen(false);
                      }
                      return next;
                    });
                  }}
                >
                  <Users size={16} />
                  <span>{t("series.characters.title")}</span>
                </button>
                <button
                  type="button"
                  className={`${styles.metadataButton} ${styles.metadataButtonRight} ${isMetadataOpen ? styles.metadataButtonActive : ""}`}
                  onClick={() => {
                    setIsMetadataOpen((prev) => {
                      const next = !prev;
                      if (next) {
                        setIsCharactersOpen(false);
                      }
                      return next;
                    });
                  }}
                >
                  <Search size={16} />
                  <span>{t("series.metadata.title")}</span>
                </button>
              </div>

              <div
                className={`${styles.workspace} ${isCharactersOpen ? styles.workspaceWithCharacters : ""} ${isMetadataOpen ? styles.workspaceWithMetadata : ""}`}
              >
                {isCharactersOpen && (
                  <aside className={styles.charactersPane}>
                    <SeriesCharactersDrawer
                      series={series}
                      reloadToken={charactersReloadToken}
                    />
                  </aside>
                )}
                <div className={styles.formPane}>
                  <div className={styles.editFormGrid}>
                <div className={styles.editFormLeft}>
                  <div className={styles.formGroup}>
                    <label>{t("series.edit.thumbnail.label")}</label>
                    <div className={styles.thumbnailUploadTabs}>
                      <button
                        type="button"
                        className={`${styles.tabBtn} ${thumbnailMode === "file" ? styles.active : ""}`}
                        onClick={() => setThumbnailMode("file")}
                      >
                        <Upload size={14} /> {t("series.edit.thumbnail.tab_file")}
                      </button>
                      <button
                        type="button"
                        className={`${styles.tabBtn} ${thumbnailMode === "url" ? styles.active : ""}`}
                        onClick={() => setThumbnailMode("url")}
                      >
                        <Link size={14} /> {t("series.edit.thumbnail.tab_url")}
                      </button>
                      <button
                        type="button"
                        className={styles.tabBtn}
                        onClick={handleResetThumbnail}
                        title={t("series.edit.thumbnail.reset_tooltip")}
                        style={{ marginLeft: "auto" }}
                      >
                        <RotateCcw size={14} /> {t("series.edit.thumbnail.reset")}
                      </button>
                    </div>

                    {thumbnailMode === "file" ? (
                      <div
                        className={`${styles.thumbnailDropzone} ${isDragging ? styles.dragging : ""}`}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleThumbnailChange}
                          hidden
                          ref={fileInputRef}
                        />
                        <p>{t("series.edit.thumbnail.drag_drop")}</p>
                      </div>
                    ) : (
                      <div className={styles.urlInputGroup}>
                        <input
                          type="text"
                          placeholder={t("series.edit.thumbnail.url_placeholder")}
                          value={thumbnailUrl}
                          onChange={(e) => setThumbnailUrl(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={handleUrlUpload}
                        >
                          {t("series.edit.thumbnail.url_confirm")}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className={styles.formGroup}>
                    <label>{t("series.edit.form.title")}</label>
                    <input
                      type="text"
                      name="title"
                      value={formData.title}
                      onChange={handleChange}
                      required
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label>{t("series.edit.form.authors")}</label>
                    <input
                      type="text"
                      name="authors"
                      value={formData.authors}
                      onChange={handleChange}
                      placeholder={t("series.edit.form.authors_placeholder")}
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label>{t("series.edit.form.publication_year")}</label>
                    <input
                      type="text"
                      name="publication_year"
                      value={formData.publication_year}
                      onChange={handleChange}
                      placeholder={t("series.edit.form.publication_year_placeholder")}
                    />
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label>{t("series.edit.form.original_title")}</label>
                      <div
                        className={styles.inlineSelectField}
                        ref={originalTitleMenuRef}
                      >
                        <input
                          type="text"
                          name="original_title"
                          value={formData.original_title}
                          onChange={handleChange}
                          placeholder={t("series.edit.form.original_title_placeholder")}
                        />
                        {originalTitleOptions.length > 0 && (
                          <>
                            <button
                              type="button"
                              className={styles.inlineSelectButton}
                              onClick={() => setIsOriginalTitleMenuOpen((prev) => !prev)}
                              aria-label={t("series.edit.form.original_title")}
                              aria-expanded={isOriginalTitleMenuOpen}
                            >
                              <ChevronDown size={16} />
                            </button>
                            {isOriginalTitleMenuOpen && (
                              <div className={styles.inlineSelectMenu}>
                                {originalTitleOptions.map((option) => (
                                  <button
                                    key={option.key}
                                    type="button"
                                    className={styles.inlineSelectOption}
                                    onClick={() => applyOriginalTitleOption(option.value)}
                                  >
                                    <span className={styles.inlineSelectOptionLabel}>
                                      {originalTitleLanguageLabel(option.key)}
                                    </span>
                                    <span className={styles.inlineSelectOptionValue}>{option.value}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div className={styles.formGroup}>
                      <label>{t("series.edit.form.publisher")}</label>
                      <input
                        type="text"
                        name="publisher"
                        value={formData.publisher}
                        onChange={handleChange}
                        placeholder={t("series.edit.form.publisher_placeholder")}
                      />
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label>{t("series.edit.form.published_at")}</label>
                      <input
                        type="text"
                        name="published_at"
                        value={formData.published_at}
                        onChange={handleChange}
                        placeholder={t("series.edit.form.published_at_placeholder")}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label>{t("series.edit.form.isbn")}</label>
                      <input
                        type="text"
                        name="isbn"
                        value={formData.isbn}
                        onChange={handleChange}
                        placeholder={t("series.edit.form.isbn_placeholder")}
                      />
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <img src="https://anilist.co/img/icons/favicon-32x32.png" width={14} height={14} alt="AniList" style={{ borderRadius: "3px" }} />
                        AniList ID
                      </label>
                      <input
                        type="text"
                        name="anilist_id"
                        value={formData.anilist_id}
                        onChange={handleChange}
                        placeholder="ej. 87216"
                      />
                      <button
                        type="button"
                        onClick={() => handleSyncDirectID("anilist", formData.anilist_id)}
                        disabled={isSyncingID}
                        style={{
                          marginTop: "8px",
                          padding: "8px 12px",
                          backgroundColor: "rgba(59, 130, 246, 0.1)",
                          color: "#3b82f6",
                          border: "1px solid rgba(59, 130, 246, 0.3)",
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontSize: "12px",
                          fontWeight: "500",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                          width: "100%",
                          transition: "all 0.2s"
                        }}
                      >
                        <RefreshCw size={13} className={isSyncingID ? styles.spinning : ""} />
                        {isSyncingID ? "Importando..." : "Importar desde AniList"}
                      </button>
                    </div>
                    <div className={styles.formGroup}>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <img src="https://myanimelist.net/img/common/pwa/launcher-icon-0-75x.png" width={14} height={14} alt="MAL" style={{ borderRadius: "3px" }} />
                        MyAnimeList ID
                      </label>
                      <input
                        type="text"
                        name="mal_id"
                        value={formData.mal_id}
                        onChange={handleChange}
                        placeholder="ej. 113138"
                      />
                      <button
                        type="button"
                        onClick={() => handleSyncDirectID("mal", formData.mal_id)}
                        disabled={isSyncingID}
                        style={{
                          marginTop: "8px",
                          padding: "8px 12px",
                          backgroundColor: "rgba(59, 130, 246, 0.1)",
                          color: "#3b82f6",
                          border: "1px solid rgba(59, 130, 246, 0.3)",
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontSize: "12px",
                          fontWeight: "500",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                          width: "100%",
                          transition: "all 0.2s"
                        }}
                      >
                        <RefreshCw size={13} className={isSyncingID ? styles.spinning : ""} />
                        {isSyncingID ? "Importando..." : "Importar desde MyAnimeList"}
                      </button>
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label>{t("series.edit.form.status")}</label>
                      <select
                        name="status"
                        value={formData.status}
                        onChange={handleChange}
                      >
                        <option value="COMPLETED">{t("series.edit.form.status_options.completed")}</option>
                        <option value="ONGOING">{t("series.edit.form.status_options.ongoing")}</option>
                        <option value="HIATUS">{t("series.edit.form.status_options.hiatus")}</option>
                        <option value="CANCELLED">{t("series.edit.form.status_options.cancelled")}</option>
                      </select>
                    </div>
                    <div className={styles.formGroup}>
                      <label>{t("series.edit.form.tags")}</label>
                      <input
                        type="text"
                        name="tags"
                        value={formData.tags}
                        onChange={handleChange}
                        placeholder={t("series.edit.form.tags_placeholder")}
                      />
                    </div>
                  </div>

                  <div className={styles.formRow} style={{ alignItems: "center", justifyContent: "space-between" }}>
                    <div className={styles.formGroup} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "10px", padding: "10px 0" }}>
                      <input
                        type="checkbox"
                        id="generate_chapter_covers"
                        name="generate_chapter_covers"
                        checked={formData.generate_chapter_covers}
                        onChange={(e) => setFormData((prev) => ({ ...prev, generate_chapter_covers: e.target.checked }))}
                        style={{ width: "20px", height: "20px", cursor: "pointer" }}
                      />
                      <label htmlFor="generate_chapter_covers" style={{ cursor: "pointer", userSelect: "none", fontWeight: "500", display: "flex", alignItems: "center", gap: "6px" }}>
                        {t("series.edit.form.generate_chapter_covers")}
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={handleGenerateChapterCovers}
                      disabled={isGeneratingCovers}
                      style={{
                        padding: "6px 12px",
                        backgroundColor: "rgba(59, 130, 246, 0.1)",
                        color: "#3b82f6",
                        border: "1px solid rgba(59, 130, 246, 0.3)",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontWeight: "500",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        transition: "all 0.2s"
                      }}
                    >
                      <RefreshCw size={13} className={isGeneratingCovers ? styles.spinning : ""} />
                      {isGeneratingCovers ? t("series.edit.form.generate_chapter_covers_manual_loading") : t("series.edit.form.generate_chapter_covers_manual")}
                    </button>
                  </div>

                  <div className={`${styles.formGroup} ${styles.hFull}`}>
                    <div className={styles.fieldLabelRow}>
                      <div className={styles.descriptionLabelRow}>
                        <label>{t("series.edit.form.description")}</label>
                        {hasTranslatedDescription && (
                          <div
                            ref={descriptionViewMenuRef}
                            className={styles.descriptionViewMenu}
                          >
                            <button
                              type="button"
                              className={styles.descriptionViewButton}
                              ref={descriptionViewButtonRef}
                              aria-haspopup="menu"
                              aria-expanded={isDescriptionViewMenuOpen}
                              aria-label={t("series.edit.form.description_view")}
                              onKeyDown={handleDescriptionViewButtonKeyDown}
                              onClick={() => setIsDescriptionViewMenuOpen((prev) => !prev)}
                            >
                              <span>
                                {descriptionView === "translated"
                                  ? t("series.edit.form.description_view_translated")
                                  : t("series.edit.form.description_view_original")}
                              </span>
                              <ChevronDown size={11} />
                            </button>
                            {isDescriptionViewMenuOpen && (
                              <div
                                className={styles.descriptionViewMenuList}
                                role="menu"
                                aria-label={t("series.edit.form.description_view")}
                              >
                                <button
                                  type="button"
                                  ref={(node) => {
                                    descriptionViewOptionRefs.current[0] = node;
                                  }}
                                  role="menuitemradio"
                                  aria-checked={descriptionView === "translated"}
                                  tabIndex={isDescriptionViewMenuOpen && descriptionView === "translated" ? 0 : -1}
                                  className={`${styles.descriptionViewOption} ${descriptionView === "translated" ? styles.descriptionViewOptionActive : ""}`}
                                  onKeyDown={(event) => handleDescriptionViewOptionKeyDown(event, 0)}
                                  onClick={() => {
                                    setDescriptionView("translated");
                                    closeDescriptionViewMenu();
                                  }}
                                >
                                  {t("series.edit.form.description_view_translated")}
                                </button>
                                <button
                                  type="button"
                                  ref={(node) => {
                                    descriptionViewOptionRefs.current[1] = node;
                                  }}
                                  role="menuitemradio"
                                  aria-checked={descriptionView === "original"}
                                  tabIndex={isDescriptionViewMenuOpen && descriptionView === "original" ? 0 : -1}
                                  className={`${styles.descriptionViewOption} ${descriptionView === "original" ? styles.descriptionViewOptionActive : ""}`}
                                  onKeyDown={(event) => handleDescriptionViewOptionKeyDown(event, 1)}
                                  onClick={() => {
                                    setDescriptionView("original");
                                    closeDescriptionViewMenu();
                                  }}
                                >
                                  {t("series.edit.form.description_view_original")}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className={styles.descriptionTranslateRow}>
                        <span className={styles.translationLanguageBadge}>
                          {t("series.edit.form.translation_target", {
                            language: originalTitleLanguageLabel(translationLanguage),
                          })}
                        </span>
                        <button
                          type="button"
                          className={styles.translateButton}
                          onClick={handleTranslateDescription}
                          disabled={isSaving || isResettingMetadata || isTranslatingDescription}
                        >
                          {isTranslatingDescription
                            ? t("series.edit.actions.translating")
                            : t("series.edit.actions.translate")}
                        </button>
                      </div>
                    </div>
                    <textarea
                      name="description"
                      value={displayedDescription}
                      onChange={handleDescriptionChange}
                      className={styles.hFull}
                    />
                  </div>
                </div>
                  </div>
                </div>

                {isMetadataOpen && (
                  <aside className={styles.metadataPane}>
                    <SeriesMetadataPanel
                      series={series}
                      onApplied={handleMetadataApplied}
                      onCharactersImported={() => {
                        setCharactersReloadToken((prev) => prev + 1);
                      }}
                      compact
                    />
                  </aside>
                )}
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}

      <AlertModal
        isOpen={alertModal.isOpen}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        showCancel={alertModal.showCancel}
        onConfirm={alertModal.onConfirm}
        onCancel={alertModal.onCancel}
      />
    </>
  );
}
