import { useState, useEffect, useCallback, useId, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Search, Sparkles, Loader2, Database, ChevronDown, Languages, Check } from "lucide-react";
import { libraryAPI, seriesAPI, pluginAPI, settingAPI } from "../../api/client";
import type { Library, Series } from "../../types/series";
import type { MetadataFetchResponse, MetadataSearchResult } from "../../types/plugin";
import { getAuthenticatedImageUrl } from "../../utils/image";
import { ProgressBar } from "../common/ProgressBar";
import { Toast } from "../common/Toast";
import { EditSeriesModal } from "../modals/EditSeriesModal";
import { AlertModal, type AlertType } from "../modals/AlertModal";
import { normalizeAppLanguage } from "../../utils/language";
import styles from "./MetadataTab.module.css";
import commonStyles from "./SettingsComponents.module.css";

interface SeriesMetadataInfo extends Series {
  scanStatus?: "idle" | "searching" | "matched" | "failed" | "applied" | "applied_with_warnings";
  matchResult?: MetadataFetchResponse;
}

interface LanguageOption {
  code: string;
  label: string;
  keywords: string[];
}

function extractApiErrorMessage(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "data" in error.response &&
    typeof error.response.data === "object" &&
    error.response.data !== null &&
    "error" in error.response.data &&
    typeof error.response.data.error === "string"
  ) {
    return error.response.data.error;
  }

  return fallback;
}

const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: "ar", label: "العربية", keywords: ["arabic", "ar", "العربية"] },
  { code: "ko", label: "한국어", keywords: ["korean", "hangul", "ko", "한국어"] },
  { code: "en", label: "English", keywords: ["english", "en"] },
  { code: "en-gb", label: "English (British)", keywords: ["english", "british", "en-gb", "uk english"] },
  { code: "en-us", label: "English (American)", keywords: ["english", "american", "en-us", "us english"] },
  { code: "ja", label: "日本語", keywords: ["japanese", "nihongo", "ja", "일본어", "日本語"] },
  { code: "bg", label: "Български", keywords: ["bulgarian", "bg", "български"] },
  { code: "cs", label: "Čeština", keywords: ["czech", "cs", "čeština"] },
  { code: "da", label: "Dansk", keywords: ["danish", "da", "dansk"] },
  { code: "de", label: "Deutsch", keywords: ["german", "de", "deutsch"] },
  { code: "el", label: "Ελληνικά", keywords: ["greek", "el", "ελληνικά"] },
  { code: "fr", label: "Français", keywords: ["french", "fr", "francais", "français"] },
  { code: "es", label: "Español", keywords: ["spanish", "es", "espanol", "español"] },
  { code: "es-419", label: "Español (Latinoamérica)", keywords: ["spanish latin american", "es-419", "latam spanish", "español latinoamérica"] },
  { code: "et", label: "Eesti", keywords: ["estonian", "et", "eesti"] },
  { code: "fi", label: "Suomi", keywords: ["finnish", "fi", "suomi"] },
  { code: "hu", label: "Magyar", keywords: ["hungarian", "hu", "magyar"] },
  { code: "id", label: "Bahasa Indonesia", keywords: ["indonesian", "id", "bahasa indonesia"] },
  { code: "it", label: "Italiano", keywords: ["italian", "it", "italiano"] },
  { code: "lt", label: "Lietuvių", keywords: ["lithuanian", "lt", "lietuvių"] },
  { code: "lv", label: "Latviešu", keywords: ["latvian", "lv", "latviešu"] },
  { code: "nb", label: "Norsk Bokmål", keywords: ["norwegian", "nb", "bokmal", "bokmål"] },
  { code: "nl", label: "Nederlands", keywords: ["dutch", "nl", "nederlands"] },
  { code: "pl", label: "Polski", keywords: ["polish", "pl", "polski"] },
  { code: "pt", label: "Português", keywords: ["portuguese", "pt", "português", "portugues"] },
  { code: "pt-br", label: "Português (Brasil)", keywords: ["portuguese brazil", "pt-br", "brazilian portuguese", "português brasil"] },
  { code: "pt-pt", label: "Português (Europeu)", keywords: ["portuguese european", "pt-pt", "european portuguese", "português europeu"] },
  { code: "ro", label: "Română", keywords: ["romanian", "ro", "română", "romana"] },
  { code: "ru", label: "Русский", keywords: ["russian", "ru", "русский"] },
  { code: "sk", label: "Slovenčina", keywords: ["slovak", "sk", "slovenčina"] },
  { code: "sl", label: "Slovenščina", keywords: ["slovenian", "sl", "slovenščina"] },
  { code: "sv", label: "Svenska", keywords: ["swedish", "sv", "svenska"] },
  { code: "tr", label: "Türkçe", keywords: ["turkish", "tr", "türkçe", "turkce"] },
  { code: "uk", label: "Українська", keywords: ["ukrainian", "uk", "українська"] },
  { code: "zh", label: "中文", keywords: ["chinese", "zh", "中文"] },
  { code: "zh-hans", label: "中文 (简体)", keywords: ["chinese simplified", "zh-hans", "简体中文", "simplified chinese"] },
  { code: "zh-hant", label: "中文 (繁體)", keywords: ["chinese traditional", "zh-hant", "繁體中文", "traditional chinese"] },
];

export function MetadataTab() {
  const { t } = useTranslation();
  const progressLabelId = useId();
  const librarySelectorLabelId = useId();
  const translateLanguageLabelId = useId();
  const translateLanguageListboxId = useId();
  const cancelScanRequestedRef = useRef(false);
  const isMountedRef = useRef(true);
  const loadSeriesRequestIdRef = useRef(0);
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const languageButtonRef = useRef<HTMLButtonElement>(null);
  const languageOptionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>("");
  const [seriesList, setSeriesList] = useState<SeriesMetadataInfo[]>([]);
  const [deselectedApplyIds, setDeselectedApplyIds] = useState<string[]>([]);
  const [editingSeries, setEditingSeries] = useState<SeriesMetadataInfo | null>(null);
  const [expandedResultId, setExpandedResultId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [appLanguage, setAppLanguage] = useState("ko");
  const [selectedTargetLanguage, setSelectedTargetLanguage] = useState("ko");
  const [languageSearch, setLanguageSearch] = useState("");
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const [highlightedLanguageIndex, setHighlightedLanguageIndex] = useState(-1);
  const [languageDropdownStyle, setLanguageDropdownStyle] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const [updatingLibraryIds, setUpdatingLibraryIds] = useState<Set<string>>(new Set());
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [isResettingMetadata, setIsResettingMetadata] = useState(false);
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
  const deselectedApplySet = useMemo(() => new Set(deselectedApplyIds), [deselectedApplyIds]);
  const selectedLibrary = useMemo(
    () => libraries.find((library) => library.id === selectedLibraryId) ?? null,
    [libraries, selectedLibraryId],
  );
  const selectedMatchedCount = useMemo(
    () =>
      seriesList.filter(
        (series) =>
          (series.scanStatus === "matched" || series.scanStatus === "applied_with_warnings") &&
          !deselectedApplySet.has(series.id),
      ).length,
    [deselectedApplySet, seriesList],
  );
  const scanPercent = scanProgress.total > 0 ? Math.round((scanProgress.current / scanProgress.total) * 100) : 0;
  const selectedLanguageOption = useMemo(
    () => LANGUAGE_OPTIONS.find((option) => option.code === selectedTargetLanguage) ?? LANGUAGE_OPTIONS[0],
    [selectedTargetLanguage],
  );
  const filteredLanguageOptions = useMemo(() => {
    const query = languageSearch.trim().toLowerCase();
    if (!query) return LANGUAGE_OPTIONS;
    const normalizedQuery = query.replace(/\s+/g, "");
    return LANGUAGE_OPTIONS.filter((option) => {
      const normalizedCode = option.code.toLowerCase();
      const normalizedLabel = option.label.toLowerCase();
      const normalizedKeywords = option.keywords.map((keyword) => keyword.toLowerCase().replace(/\s+/g, ""));

      return (
        normalizedCode === normalizedQuery ||
        normalizedCode.startsWith(normalizedQuery) ||
        normalizedLabel.includes(query) ||
        normalizedKeywords.some((keyword) => keyword === normalizedQuery || keyword.startsWith(normalizedQuery))
      );
    });
  }, [languageSearch]);

  const closeLanguageDropdown = useCallback((restoreFocus = false) => {
    setIsLanguageDropdownOpen(false);
    setLanguageSearch("");
    setHighlightedLanguageIndex(-1);
    if (restoreFocus) {
      requestAnimationFrame(() => {
        languageButtonRef.current?.focus();
      });
    }
  }, []);

  const focusLanguageOption = useCallback((index: number) => {
    requestAnimationFrame(() => {
      languageOptionRefs.current[index]?.focus();
    });
  }, []);

  const moveHighlightedLanguage = useCallback(
    (direction: 1 | -1) => {
      if (filteredLanguageOptions.length === 0) return;

      const currentIndex =
        highlightedLanguageIndex >= 0 && highlightedLanguageIndex < filteredLanguageOptions.length
          ? highlightedLanguageIndex
          : filteredLanguageOptions.findIndex((option) => option.code === selectedTargetLanguage);
      const baseIndex = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
      const nextIndex = (baseIndex + direction + filteredLanguageOptions.length) % filteredLanguageOptions.length;

      setHighlightedLanguageIndex(nextIndex);
      focusLanguageOption(nextIndex);
    },
    [filteredLanguageOptions, focusLanguageOption, highlightedLanguageIndex, selectedTargetLanguage],
  );

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      cancelScanRequestedRef.current = true;
    };
  }, []);

  useEffect(() => {
    settingAPI
      .list()
      .then((settings) => {
        if (!isMountedRef.current) return;
        const appLanguage = normalizeAppLanguage(settings.app_language);
        setAppLanguage(appLanguage);
        setSelectedTargetLanguage(appLanguage);
      })
      .catch((error) => {
        console.error("Failed to load translation language setting:", error);
      });
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
  }, []);

  // Load series when selected library changes
  const loadSeries = useCallback(
    async (libraryId: string) => {
      if (!libraryId) return;
      const requestId = ++loadSeriesRequestIdRef.current;
      if (isMountedRef.current) {
        setDeselectedApplyIds([]);
        setExpandedResultId(null);
        setSeriesList([]);
        setIsLoading(true);
      }
      try {
        const res = await libraryAPI.getSeries(libraryId);
        if (!isMountedRef.current || loadSeriesRequestIdRef.current !== requestId) return;
        setSeriesList(res.data.series || []);
      } catch (err) {
        console.error("Failed to load series:", err);
        if (!isMountedRef.current || loadSeriesRequestIdRef.current !== requestId) return;
        setSeriesList([]);
        setToast({ type: "error", message: t("settings.metadata.error_load_series") });
      } finally {
        if (isMountedRef.current && loadSeriesRequestIdRef.current === requestId) {
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

    if (typeof touchPreviewQuery.addEventListener === "function") {
      touchPreviewQuery.addEventListener("change", syncExpandedResultState);
    } else {
      touchPreviewQuery.addListener(syncExpandedResultState);
    }

    return () => {
      if (typeof touchPreviewQuery.removeEventListener === "function") {
        touchPreviewQuery.removeEventListener("change", syncExpandedResultState);
      } else {
        touchPreviewQuery.removeListener(syncExpandedResultState);
      }
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

  useEffect(() => {
    if (!isLanguageDropdownOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (languageDropdownRef.current?.contains(target) || languageButtonRef.current?.contains(target)) {
        return;
      }
      closeLanguageDropdown(true);
    };

    const updateDropdownPosition = () => {
      const rect = languageButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setLanguageDropdownStyle({
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
      });
    };

    updateDropdownPosition();

    const handleWindowChange = () => {
      updateDropdownPosition();
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [closeLanguageDropdown, isLanguageDropdownOpen]);

  useEffect(() => {
    if (!isLanguageDropdownOpen) {
      setLanguageDropdownStyle(null);
    }
  }, [isLanguageDropdownOpen]);

  useEffect(() => {
    if (!isLanguageDropdownOpen) return;

    const selectedIndex = filteredLanguageOptions.findIndex((option) => option.code === selectedTargetLanguage);
    setHighlightedLanguageIndex(selectedIndex >= 0 ? selectedIndex : filteredLanguageOptions.length > 0 ? 0 : -1);
    languageOptionRefs.current = [];
  }, [filteredLanguageOptions, isLanguageDropdownOpen, selectedTargetLanguage]);

  const handleLanguageInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveHighlightedLanguage(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveHighlightedLanguage(-1);
        break;
      case "Enter":
        if (highlightedLanguageIndex >= 0 && filteredLanguageOptions[highlightedLanguageIndex]) {
          event.preventDefault();
          handleSelectTargetLanguage(filteredLanguageOptions[highlightedLanguageIndex].code);
        }
        break;
      case "Escape":
        event.preventDefault();
        closeLanguageDropdown(true);
        break;
    }
  };

  const handleLanguageOptionKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, index: number) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveHighlightedLanguage(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveHighlightedLanguage(-1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        handleSelectTargetLanguage(filteredLanguageOptions[index].code);
        break;
      case "Escape":
        event.preventDefault();
        closeLanguageDropdown(true);
        break;
    }
  };

  const handleLanguageButtonKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowDown":
      case "Enter":
      case " ":
        event.preventDefault();
        setIsLanguageDropdownOpen(true);
        break;
      case "ArrowUp":
        event.preventDefault();
        setIsLanguageDropdownOpen(true);
        requestAnimationFrame(() => {
          if (filteredLanguageOptions.length > 0) {
            const nextIndex = filteredLanguageOptions.length - 1;
            setHighlightedLanguageIndex(nextIndex);
            focusLanguageOption(nextIndex);
          }
        });
        break;
      case "Escape":
        if (isLanguageDropdownOpen) {
          event.preventDefault();
          closeLanguageDropdown(true);
        }
        break;
    }
  };

  const languageDropdown =
    isLanguageDropdownOpen && languageDropdownStyle
      ? createPortal(
          <div
            ref={languageDropdownRef}
            className={styles.translationLanguageDropdown}
            style={{
              position: "fixed",
              top: languageDropdownStyle.top,
              left: languageDropdownStyle.left,
              width: languageDropdownStyle.width,
            }}
          >
            <div className={styles.translationLanguageSearchWrap}>
              <Search size={14} />
              <input
                value={languageSearch}
                onChange={(e) => setLanguageSearch(e.target.value)}
                onKeyDown={handleLanguageInputKeyDown}
                placeholder={t("settings.metadata.batch_translate.language_search_placeholder")}
                aria-label={t("settings.metadata.batch_translate.language_search_placeholder")}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={isLanguageDropdownOpen}
                aria-controls={translateLanguageListboxId}
                aria-activedescendant={
                  highlightedLanguageIndex >= 0 ? `translation-language-option-${filteredLanguageOptions[highlightedLanguageIndex]?.code}` : undefined
                }
                className={styles.translationLanguageSearchInput}
                autoFocus
              />
            </div>
            <div
              id={translateLanguageListboxId}
              className={styles.translationLanguageOptions}
              role="listbox"
              aria-labelledby={translateLanguageLabelId}
            >
              {filteredLanguageOptions.length > 0 ? (
                filteredLanguageOptions.map((option, index) => (
                  <div
                    id={`translation-language-option-${option.code}`}
                    key={option.code}
                    ref={(node) => {
                      languageOptionRefs.current[index] = node;
                    }}
                    className={styles.translationLanguageOption}
                    role="option"
                    aria-selected={option.code === selectedTargetLanguage}
                    tabIndex={highlightedLanguageIndex === index ? 0 : -1}
                    onClick={() => handleSelectTargetLanguage(option.code)}
                    onFocus={() => setHighlightedLanguageIndex(index)}
                    onKeyDown={(event) => handleLanguageOptionKeyDown(event, index)}
                  >
                    <span className={styles.translationLanguageOptionLabel}>
                      {option.label}
                      <span className={styles.translationLanguageCode}>{option.code.toUpperCase()}</span>
                    </span>
                    {option.code === selectedTargetLanguage ? <Check size={14} /> : null}
                  </div>
                ))
              ) : (
                <div className={styles.translationLanguageEmpty}>{t("settings.metadata.batch_translate.language_search_empty")}</div>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  const isApplySelected = (series: SeriesMetadataInfo) =>
    (series.scanStatus === "matched" || series.scanStatus === "applied_with_warnings") &&
    !deselectedApplySet.has(series.id);

  const toggleApplySelection = (seriesId: string) => {
    setDeselectedApplyIds((prev) =>
      prev.includes(seriesId) ? prev.filter((id) => id !== seriesId) : [...prev, seriesId],
    );
  };

  const toggleResultPreview = (seriesId: string) => {
    setExpandedResultId((prev) => (prev === seriesId ? null : seriesId));
  };

  const getSeriesThumbnailSrc = (series: SeriesMetadataInfo) => {
    if (!series.thumbnail_url) return "";

    const versionSource = series.updated_at || series.created_at;
    const parsedTime = Date.parse(versionSource);
    const cacheBuster = Number.isFinite(parsedTime) ? parsedTime : 0;
    const separator = series.thumbnail_url.includes("?") ? "&" : "?";
    return getAuthenticatedImageUrl(`${series.thumbnail_url}${separator}_cb=${cacheBuster}`);
  };

  const handleLibraryOverrideToggle = async (library: Library, enabled: boolean) => {
    if (!library.id) return;
    try {
      setUpdatingLibraryIds((prev) => {
        const next = new Set(prev);
        next.add(library.id);
        return next;
      });
      const updatedLibrary = await libraryAPI
        .update(library.id, { original_title_override: enabled })
        .then((res) => res.data as Library);
      if (!isMountedRef.current) return;
      setLibraries((prev) =>
        prev.map((library) => (library.id === updatedLibrary.id ? { ...library, ...updatedLibrary } : library)),
      );
      if (selectedLibraryId === library.id) {
        await loadSeries(library.id);
      }
      setToast({ type: "success", message: t("settings.viewer.toast.saved") });
    } catch (error) {
      console.error("라이브러리 original_title_override 업데이트 실패:", error);
      if (isMountedRef.current) {
        setToast({ type: "error", message: t("settings.viewer.toast.save_failed") });
      }
    } finally {
      if (isMountedRef.current) {
        setUpdatingLibraryIds((prev) => {
          const next = new Set(prev);
          next.delete(library.id);
          return next;
        });
      }
    }
  };

  const handleScan = async () => {
    if (isScanning || seriesList.length === 0) return;
    const scanTargets = seriesList
      .map((series, index) => ({ series, index }))
      .filter(
        ({ series }) =>
          series.scanStatus !== "matched" &&
          series.scanStatus !== "applied" &&
          series.scanStatus !== "applied_with_warnings",
      );
    if (scanTargets.length === 0) return;

    setEditingSeries(null);
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

        if (cancelScanRequestedRef.current) {
          updatedList[index] = { ...series, scanStatus: series.scanStatus || "idle" };
          break;
        }

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
    const matchedItems = seriesList.filter(
      (s) => (s.scanStatus === "matched" || s.scanStatus === "applied_with_warnings") && !deselectedApplySet.has(s.id),
    );
    if (matchedItems.length === 0 || !isMountedRef.current) return;

    setIsLoading(true);
    let successCount = 0;
    let warningCount = 0;

    for (const series of matchedItems) {
      if (!isMountedRef.current) break;
      if (!series.matchResult) continue;

      try {
        await seriesAPI.metadataApply(series.id, series.matchResult.result);
        if (!isMountedRef.current) break;
        let characterImportFailed = false;
        if (series.matchResult.plugin_id) {
          try {
            await seriesAPI.importCharacters(
              series.id,
              series.matchResult.result.characters || [],
              series.matchResult.plugin_id,
            );
            if (!isMountedRef.current) break;
          } catch (err) {
            console.error(`Failed to import characters for ${series.title}:`, err);
            characterImportFailed = true;
          }
        }
        if (!isMountedRef.current) break;
        setSeriesList((prev) =>
          prev.map((s) =>
            s.id === series.id ? { ...s, scanStatus: characterImportFailed ? "applied_with_warnings" : "applied" } : s,
          ),
        );
        successCount++;
        if (characterImportFailed) {
          warningCount++;
        }
      } catch (err) {
        console.error(`Failed to apply metadata for ${series.title}:`, err);
        if (!isMountedRef.current) break;
      }
    }

    if (!isMountedRef.current) return;
    setIsLoading(false);
    setToast({
      type: warningCount > 0 ? "info" : "success",
      message:
        warningCount > 0
          ? t("settings.metadata.apply_complete_with_warnings", { count: successCount, warnings: warningCount })
          : t("settings.metadata.apply_complete", { count: successCount }),
    });
  };

  const handleBatchTranslate = async () => {
    if (isTranslating || !isMountedRef.current) return;
    setIsTranslating(true);
    setToast({ type: "info", message: t("settings.metadata.batch_translate.starting") });

    try {
      const res = await pluginAPI.batchTranslate(selectedTargetLanguage);
      if (!isMountedRef.current) return;

      if (res.cancelled) {
        setToast({
          type: "info",
          message: t("settings.metadata.batch_translate.cancelled", {
            total: res.total_processed,
            success: res.total_success,
          }),
        });
      } else if (res.total_failed > 0) {
        setToast({
          type: res.total_success > 0 ? "info" : "error",
          message: t("settings.metadata.batch_translate.failed", {
            total: res.total_processed,
            failed: res.total_failed,
          }),
        });
      } else {
        setToast({
          type: "success",
          message: t("settings.metadata.batch_translate.complete", {
            total: res.total_processed,
            success: res.total_success,
          }),
        });
      }
      if (res.total_success > 0 && selectedLibraryId) {
        loadSeries(selectedLibraryId); // Refresh the list when any item was translated
      }
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      console.error("Batch translate failed:", err);
      const errMsg = extractApiErrorMessage(err, t("settings.metadata.batch_translate.request_failed"));
      setToast({ type: "error", message: errMsg });
    } finally {
      if (isMountedRef.current) {
        setIsTranslating(false);
      }
    }
  };

  const handleSelectTargetLanguage = (languageCode: string) => {
    setSelectedTargetLanguage(languageCode);
    closeLanguageDropdown(true);
  };

  const handleResetLibraryMetadata = () => {
    if (!selectedLibraryId || !selectedLibrary) return;

    setAlertModal({
      isOpen: true,
      type: "warning",
      title: t("settings.metadata.reset_title"),
      message: t("settings.metadata.reset_confirm", { library: selectedLibrary.name }),
      showCancel: true,
      onConfirm: async () => {
        setIsResettingMetadata(true);
        try {
          const result = await libraryAPI.resetMetadata(selectedLibraryId);
          setToast({
            type: "success",
            message: t("settings.metadata.reset_complete", {
              library: result.library_name,
              count: result.reset_count,
            }),
          });
          await loadSeries(selectedLibraryId);
        } catch (error) {
          console.error("Failed to reset library metadata:", error);
          setToast({ type: "error", message: t("settings.metadata.reset_failed") });
        } finally {
          setIsResettingMetadata(false);
          setAlertModal((prev) => ({ ...prev, isOpen: false }));
        }
      },
      onCancel: () => setAlertModal((prev) => ({ ...prev, isOpen: false })),
    });
  };

  return (
    <div className={styles.metadataTab}>
      {editingSeries && (
        <EditSeriesModal
          isOpen={Boolean(editingSeries)}
          onClose={() => setEditingSeries(null)}
          series={editingSeries}
          onUpdate={(updatedSeries) => {
            setSeriesList((prev) =>
              prev.map((series) => (series.id === updatedSeries.id ? { ...series, ...updatedSeries } : series)),
            );
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

      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h2>{t("settings.metadata.title")}</h2>
          <p>{t("settings.metadata.description")}</p>
        </div>
      </div>

      <div className={styles.header}>
        <section className={styles.libraryOverrideSection}>
          <div className={styles.metadataSettingsHeader}>
            <h3>{t("settings.viewer.epub.title_override_label")}</h3>
            <p>{t("settings.metadata.settings_description")}</p>
          </div>
          <div className={styles.libraryOverrideGrid}>
            {libraries.map((library) => {
              const enabled = Boolean(library.original_title_override);
              const isUpdating = updatingLibraryIds.has(library.id);
              const isDisabled = isScanning || isUpdating;
              return (
                <article
                  key={library.id}
                  className={`${styles.libraryOverrideCard} ${isDisabled ? styles.libraryOverrideCardDisabled : ""}`}
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`${library.name} ${t("settings.viewer.epub.title_override_label")}`}
                  aria-disabled={isDisabled}
                  tabIndex={isDisabled ? -1 : 0}
                  onClick={() => {
                    if (isDisabled) return;
                    void handleLibraryOverrideToggle(library, !enabled);
                  }}
                  onKeyDown={(event) => {
                    if (isDisabled) return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    void handleLibraryOverrideToggle(library, !enabled);
                  }}
                >
                  <div className={styles.libraryOverrideInfo}>
                    <div className={styles.libraryOverrideNameRow}>
                      <Database size={16} />
                      <h4>{library.name}</h4>
                    </div>
                    <p>
                      {enabled ? t("common.on", { defaultValue: "켜기" }) : t("common.off", { defaultValue: "끄기" })}
                    </p>
                  </div>
                  <label
                    className={`${commonStyles.pluginToggle} ${isScanning || isUpdating ? commonStyles.pluginToggleDisabled : ""}`}
                  >
                    <button
                      type="button"
                      className={`${commonStyles.pluginToggleTrack} ${enabled ? commonStyles.pluginToggleTrackOn : ""}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleLibraryOverrideToggle(library, !enabled);
                      }}
                      disabled={isDisabled}
                      aria-hidden="true"
                      tabIndex={-1}
                    >
                      <span
                        className={`${commonStyles.pluginToggleThumb} ${enabled ? commonStyles.pluginToggleThumbOn : ""}`}
                      >
                        {isUpdating ? (
                          <Loader2
                            className={styles.spinning}
                            size={11}
                          />
                        ) : null}
                      </span>
                    </button>
                  </label>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      <div className={styles.header}>
        <section className={styles.libraryOverrideSection}>
          <div className={styles.metadataSettingsHeader}>
            <h3>{t("settings.metadata.batch_translate.title")}</h3>
            <p>{t("settings.metadata.batch_translate.description")}</p>
          </div>
          <div className={styles.libraryOverrideGrid}>
            <article
              className={styles.libraryOverrideCard}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
            >
              <div className={styles.translateCardContent}>
                <div className={styles.libraryOverrideInfo}>
                  <div className={styles.libraryOverrideNameRow}>
                    <Sparkles size={16} />
                    <h4>{t("settings.metadata.batch_translate.card_title")}</h4>
                  </div>
                  <p>{t("settings.metadata.batch_translate.card_description")}</p>
                </div>
                <div className={styles.translationLanguageControl}>
                  <div
                    id={translateLanguageLabelId}
                    className={styles.selectorLabel}
                  >
                    <Languages size={14} />
                    <span>{t("settings.metadata.batch_translate.target_label")}</span>
                  </div>
                  <div className={styles.translationLanguageHint}>
                    {t("settings.metadata.batch_translate.server_language_hint", {
                      language: LANGUAGE_OPTIONS.find((option) => option.code === appLanguage)?.label ?? appLanguage,
                    })}
                  </div>
                  <button
                    type="button"
                    className={styles.translationLanguageButton}
                    ref={languageButtonRef}
                    aria-haspopup="listbox"
                    aria-controls={translateLanguageListboxId}
                    aria-expanded={isLanguageDropdownOpen}
                    aria-label={`${t("settings.metadata.batch_translate.target_label")}: ${selectedLanguageOption.label}${selectedTargetLanguage === appLanguage ? ` (${t("settings.metadata.batch_translate.server_language_badge")})` : ""}`}
                    onKeyDown={handleLanguageButtonKeyDown}
                    onClick={() => setIsLanguageDropdownOpen((prev) => !prev)}
                  >
                    <span className={styles.translationLanguageValue}>
                      {selectedLanguageOption.label}
                      {selectedTargetLanguage === appLanguage && (
                        <span className={styles.translationLanguageBadge}>{t("settings.metadata.batch_translate.server_language_badge")}</span>
                      )}
                    </span>
                    <ChevronDown
                      size={16}
                      className={isLanguageDropdownOpen ? styles.translationLanguageChevronOpen : undefined}
                    />
                  </button>
                </div>
              </div>
              <button
                className={`${commonStyles.settingsButton} ${styles.primaryAction}`}
                onClick={handleBatchTranslate}
                disabled={isTranslating}
                style={{ height: "fit-content", padding: "0.5rem 1rem" }}
              >
                {isTranslating ? (
                  <Loader2
                    className={styles.spinning}
                    size={16}
                  />
                ) : (
                  <Sparkles size={16} />
                )}
                {isTranslating ? t("settings.metadata.batch_translate.translating") : t("settings.metadata.batch_translate.action")}
              </button>
            </article>
          </div>
        </section>
      </div>
      {languageDropdown}

      <div className={styles.header}>
        <section className={styles.libraryOverrideSection}>
          <div className={styles.metadataSettingsHeader}>
            <h3>{t("settings.metadata.search_title", { defaultValue: "메타데이터 검색" })}</h3>
            <p>
              {t("settings.metadata.search_description", {
                defaultValue: "선택한 라이브러리의 시리즈를 검색하고 매칭된 메타데이터를 일괄 적용합니다.",
              })}
            </p>
          </div>
          <div className={styles.metadataSearchCard}>
            <div className={styles.libraryActionPanel}>
              <div className={styles.librarySelector}>
                <div
                  id={librarySelectorLabelId}
                  className={styles.selectorLabel}
                >
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
              <div className={styles.actions}>
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
          </div>
        </section>
      </div>

      {isScanning && (
        <div
          className={styles.progressArea}
          role="status"
          aria-live="polite"
        >
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
                      <span className={styles.seriesCount}>
                        {t("settings.metadata.total_series_count", { count: seriesList.length })}
                      </span>
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
                                  src={getSeriesThumbnailSrc(series)}
                                  alt={series.title}
                                  loading="lazy"
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
                            <button
                              type="button"
                              className={`${styles.matchPreview} ${index >= Math.max(seriesList.length - 2, 0) ? styles.matchPreviewUp : ""} ${expandedResultId === series.id ? styles.matchPreviewExpanded : ""}`}
                              data-match-preview="true"
                              aria-expanded={expandedResultId === series.id}
                              aria-label={t("settings.metadata.preview_result_for", {
                                title: series.matchResult.result.title,
                              })}
                              onClick={() => toggleResultPreview(series.id)}
                              disabled={isScanning}
                            >
                              <span className={styles.matchThumbnail}>
                                {series.matchResult.result.cover?.url ? (
                                  <img
                                    src={series.matchResult.result.cover.url}
                                    alt={series.matchResult.result.title}
                                    loading="lazy"
                                  />
                                ) : (
                                  <span className={styles.matchThumbnailFallback}>
                                    <Database size={16} />
                                  </span>
                                )}
                              </span>
                              <span className={styles.matchContent}>
                                <span className={styles.matchTitle}>{series.matchResult.result.title}</span>
                                <span className={styles.matchDescription}>
                                  {series.matchResult.result.description || "-"}
                                </span>
                              </span>
                              <span className={styles.matchPopover}>
                                <span className={styles.matchPopoverMedia}>
                                  <span className={styles.matchPopoverThumbnail}>
                                    {series.matchResult.result.cover?.url ? (
                                      <img
                                        src={series.matchResult.result.cover.url}
                                        alt={series.matchResult.result.title}
                                        loading="lazy"
                                      />
                                    ) : (
                                      <span className={styles.matchThumbnailFallback}>
                                        <Database size={18} />
                                      </span>
                                    )}
                                  </span>
                                  <span className={styles.matchPopoverContent}>
                                    <strong>{series.matchResult.result.title}</strong>
                                    {series.matchResult.result.authors &&
                                      series.matchResult.result.authors.length > 0 && (
                                        <span className={styles.matchPopoverAuthors}>
                                          {series.matchResult.result.authors.join(", ")}
                                        </span>
                                      )}
                                    <span>{series.matchResult.result.description || "-"}</span>
                                  </span>
                                </span>
                              </span>
                            </button>
                          )}
                          {(series.scanStatus === "matched" || series.scanStatus === "applied_with_warnings") &&
                            series.matchResult && (
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
                                  disabled={isScanning}
                                />
                              </label>
                            )}
                          {series.scanStatus === "failed" && (
                            <button
                              type="button"
                              className={`${styles.btnIcon} ${styles.failedActionButton}`}
                              onClick={() => setEditingSeries(series)}
                              title={t("settings.metadata.manual_search")}
                              disabled={isScanning}
                            >
                              <Search size={14} />
                              <span>{t("settings.metadata.manual_search")}</span>
                            </button>
                          )}
                          {!series.matchResult && series.scanStatus !== "failed" && (
                            <span className={styles.emptyResult}>-</span>
                          )}
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

      <div className={styles.header}>
        <section className={styles.libraryOverrideSection}>
          <div className={styles.metadataSettingsHeader}>
            <h3>{t("settings.metadata.reset_title")}</h3>
            <p>{t("settings.metadata.reset_description")}</p>
          </div>
          <div className={styles.metadataSearchCard}>
            <article className={styles.resetMetadataCard}>
              <div className={styles.resetMetadataContent}>
                <div className={styles.librarySelector}>
                  <div
                    id={`${librarySelectorLabelId}-reset`}
                    className={styles.selectorLabel}
                  >
                    <Database size={14} />
                    <span>{t("settings.tabs.libraries")}</span>
                  </div>
                  <div className={styles.selectWrap}>
                    <select
                      className={styles.librarySelect}
                      value={selectedLibraryId}
                      onChange={(e) => setSelectedLibraryId(e.target.value)}
                      disabled={isResettingMetadata || isScanning || isLoading}
                      aria-labelledby={`${librarySelectorLabelId}-reset`}
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
                <p>{t("settings.metadata.reset_card_description")}</p>
              </div>
              <button
                className={`${commonStyles.settingsButton} ${styles.resetButton}`}
                onClick={handleResetLibraryMetadata}
                disabled={!selectedLibraryId || isResettingMetadata || isScanning || isLoading}
              >
                {isResettingMetadata ? (
                  <Loader2
                    className={styles.spinning}
                    size={16}
                  />
                ) : (
                  <Database size={16} />
                )}
                {t("settings.metadata.reset_action")}
              </button>
            </article>
          </div>
        </section>
      </div>

      <AlertModal
        isOpen={alertModal.isOpen}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        showCancel={alertModal.showCancel}
        onConfirm={alertModal.onConfirm}
        onCancel={alertModal.onCancel}
      />
    </div>
  );
}
