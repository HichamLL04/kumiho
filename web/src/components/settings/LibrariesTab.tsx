import { useState, useEffect, useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Trash2,
  Plus,
  RefreshCw,
  FolderOpen,
  Search,
  Settings,
  GripVertical,
  Eye,
  EyeOff,
  Clock,
  Folder,
  Square,
  Headphones,
  Book as BookIcon,
  BookOpen,
  Image,
  X,
  ChevronRight,
  ArrowUp,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { libraryAPI, filesystemAPI } from "../../api/client";
import { useLibraryStore, type Library } from "../../stores/libraryStore";
import type { LibraryType } from "../../types/series";
import { useScanStore } from "../../stores/scanStore";
import { Toast } from "../common/Toast";
import { AlertModal } from "../modals/AlertModal";
import commonStyles from "./SettingsComponents.module.css";
import styles from "./LibrariesTab.module.css";
import { settingAPI } from "../../api/client";
import { useAuthStore } from "../../stores/authStore";
import { getLibraryDeleteErrorMessage } from "./libraryDeleteErrors";

interface SortableItemProps {
  lib: Library;
  onEdit: (lib: Library) => void;
  onScan: (id: string) => void;
  onDelete: (lib: Library) => void;
  onToggleVisibility: (lib: Library) => void;
  editingLibrary: Library | null;
  setEditingLibrary: (lib: Library | null) => void;
  handleUpdateLibrary: (id: string, data: Partial<Library>) => void;
  openBrowse: (target: { type: "create" | "edit"; index: number }, initialPath?: string) => void;
}

function SortableLibraryItem({
  lib,
  onEdit,
  onScan,
  onDelete,
  onToggleVisibility,
  editingLibrary,
  setEditingLibrary,
  handleUpdateLibrary,
  openBrowse,
}: SortableItemProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lib.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
    opacity: isDragging || lib.is_visible === false ? 0.5 : 1,
  };

  const isSystem = lib.type === "SYSTEM";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={styles.libraryItemContainer}
    >
      <div className={`${commonStyles.settingsItem} ${styles.libraryItem}`}>
        <div className={styles.libraryInfoGroup}>
          <div
            className={styles.dragHandle}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={20} />
          </div>
          <div className={commonStyles.itemInfo}>
            <div className={styles.flexAlignCenter}>
              <label className={styles.libraryName}>
                {isSystem && lib.name === "좋아요한 시리즈" ? t("sidebar.system.liked") : lib.name}
              </label>
              {isSystem && <span className={styles.systemBadge}>{t("settings.libraries.item.system_badge")}</span>}
              {!isSystem && (
                <span className={styles.typeBadge}>
                  {lib.library_type === "audiobook" ? (
                    <>
                      <Headphones size={12} /> {t("settings.libraries.type_audiobook")}
                    </>
                  ) : lib.library_type === "comic" ? (
                    <>
                      <Image size={12} /> {t("settings.libraries.type_comic")}
                    </>
                  ) : lib.library_type === "novel" ? (
                    <>
                      <BookOpen size={12} /> {t("settings.libraries.type_novel")}
                    </>
                  ) : (
                    <>
                      <BookIcon size={12} /> {t("settings.libraries.type_book")}
                    </>
                  )}
                </span>
              )}
            </div>
            <p className={styles.libraryPath}>{(lib.paths || []).join(", ")}</p>
            <div className={styles.libraryMeta}>
              {!isSystem && (
                <>
                  <span>
                    {lib.default_view_mode === "single"
                      ? t("settings.viewer.mode.single")
                      : lib.default_view_mode === "double"
                        ? t("settings.viewer.mode.double")
                        : t("settings.viewer.mode.vertical")}
                  </span>
                  <span>•</span>
                  <span>
                    {lib.default_read_direction === "ltr"
                      ? t("settings.viewer.direction.ltr")
                      : lib.default_read_direction === "rtl"
                        ? t("settings.viewer.direction.rtl")
                        : t("settings.viewer.direction.ltr")}
                  </span>
                  <span>•</span>
                  <span>
                    {lib.default_page_transition === "slide"
                      ? t("viewer.settings.page_transition.slide")
                      : lib.default_page_transition === "fade"
                        ? t("viewer.settings.page_transition.fade")
                        : t("viewer.settings.page_transition.none")}
                  </span>
                </>
              )}
              {isSystem && <span>{t("settings.libraries.item.system_notice")}</span>}
            </div>
          </div>
        </div>
        <div className={`${commonStyles.itemControl} ${styles.actionButtons}`}>
          {isSystem ? (
            <button
              onClick={() => onToggleVisibility(lib)}
              className={`${commonStyles.settingsSelect} ${styles.iconButton} ${lib.is_visible !== false ? styles.btnBlue : styles.btnGray}`}
              title={lib.is_visible !== false ? t("common.hide") : t("common.show")}
            >
              {lib.is_visible !== false ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          ) : (
            <>
              <button
                onClick={() => onEdit(lib)}
                className={`${commonStyles.settingsSelect} ${styles.iconButton} ${styles.btnBlue}`}
                title="설정 수정"
              >
                <Settings size={16} />
              </button>

              <button
                onClick={() => onScan(lib.id)}
                className={`${commonStyles.settingsSelect} ${styles.iconButton} ${lib.scan_status === "SCANNING" ? styles.btnRed : styles.btnGreen}`}
                title={lib.scan_status === "SCANNING" ? t("sidebar.scan_cancel_tooltip") : t("sidebar.scan_tooltip")}
              >
                {lib.scan_status === "SCANNING" ? (
                  <Square
                    size={16}
                    fill="currentColor"
                  />
                ) : (
                  <RefreshCw size={16} />
                )}
              </button>

              <button
                onClick={() => onDelete(lib)}
                className={`${commonStyles.settingsSelect} ${styles.iconButton} ${styles.btnRed}`}
                title="삭제"
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {editingLibrary?.id === lib.id && (
        <div className={styles.editForm}>
          <div className={styles.editGrid}>
            <div className={styles.flexOne}>
              <label className={styles.fieldLabel}>{t("settings.libraries.item.edit.name_label")}</label>
              <input
                type="text"
                value={editingLibrary.name}
                onChange={(e) => setEditingLibrary({ ...editingLibrary, name: e.target.value })}
                className={commonStyles.settingsInput}
                disabled={isSystem} // 시스템 라이브러리 이름 수정 불가
              />
            </div>
            {!isSystem && (
              <>
                <div className={styles.flexFull}>
                  <label className={styles.fieldLabel}>{t("settings.libraries.paths_label")}</label>
                  <div className={styles.pathToolbar}>
                    <button
                      type="button"
                      onClick={() => openBrowse({ type: "edit", index: (editingLibrary.paths || []).length }, "/")}
                      className={`${commonStyles.settingsSelect} ${styles.btnAuto} ${styles.btnTransparent}`}
                    >
                      <Plus size={14} /> {t("settings.libraries.add_path")}
                    </button>
                  </div>
                  {(editingLibrary.paths || []).map((p, i) => (
                    <div
                      key={i}
                      className={styles.pathRow}
                    >
                      <button
                        type="button"
                        onClick={() => openBrowse({ type: "edit", index: i }, p || "/")}
                        className={styles.pathValueButton}
                        title={p || t("settings.libraries.browse")}
                      >
                        <Folder size={16} />
                        <span>{p || t("settings.libraries.path_empty")}</span>
                      </button>
                      {(editingLibrary.paths || []).length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const newPaths = (editingLibrary.paths || []).filter((_, idx) => idx !== i);
                            setEditingLibrary({ ...editingLibrary, paths: newPaths });
                          }}
                          className={`${commonStyles.settingsSelect} ${styles.btnAuto} ${styles.btnTransparent} ${styles.btnDanger}`}
                          title={t("settings.libraries.remove_path")}
                          aria-label={t("settings.libraries.remove_path")}
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className={styles.flexOne}>
                  <label className={styles.fieldLabel}>{t("settings.libraries.item.edit.type_label")}</label>
                  <select
                    value={editingLibrary.library_type || "book"}
                    onChange={(e) =>
                      setEditingLibrary({ ...editingLibrary, library_type: e.target.value as LibraryType })
                    }
                    className={commonStyles.settingsSelect}
                  >
                    <option value="comic">{t("settings.libraries.type_comic")}</option>
                    <option value="novel">{t("settings.libraries.type_novel")}</option>
                    <option value="book">{t("settings.libraries.type_book")}</option>
                    <option value="audiobook">{t("settings.libraries.type_audiobook")}</option>
                  </select>
                </div>
                {editingLibrary.library_type !== "audiobook" && (
                  <>
                    <div className={styles.flexOne}>
                      <label className={styles.fieldLabel}>{t("settings.libraries.item.edit.view_mode_label")}</label>
                      <select
                        value={editingLibrary.default_view_mode}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditingLibrary({
                            ...editingLibrary,
                            default_view_mode: val,
                            default_epub_spread: val === "double" ? "auto" : "none",
                          });
                        }}
                        className={commonStyles.settingsSelect}
                      >
                        <option value="single">{t("settings.viewer.mode.single")}</option>
                        <option value="double">{t("settings.viewer.mode.double")}</option>
                        <option value="vertical">{t("settings.viewer.mode.vertical")}</option>
                      </select>
                    </div>
                    <div className={styles.flexOne}>
                      <label className={styles.fieldLabel}>
                        {t("settings.libraries.item.edit.read_direction_label")}
                      </label>
                      <select
                        value={editingLibrary.default_read_direction}
                        onChange={(e) =>
                          setEditingLibrary({ ...editingLibrary, default_read_direction: e.target.value })
                        }
                        className={commonStyles.settingsSelect}
                      >
                        <option value="ltr">{t("settings.viewer.direction.ltr")}</option>
                        <option value="rtl">{t("settings.viewer.direction.rtl")}</option>
                      </select>
                    </div>
                    <div className={styles.flexOne}>
                      <label className={styles.fieldLabel}>{t("viewer.settings.page_transition.label")}</label>
                      <select
                        value={editingLibrary.default_page_transition}
                        onChange={(e) =>
                          setEditingLibrary({ ...editingLibrary, default_page_transition: e.target.value })
                        }
                        className={commonStyles.settingsSelect}
                      >
                        <option value="slide">{t("viewer.settings.page_transition.slide")}</option>
                        <option value="fade">{t("viewer.settings.page_transition.fade")}</option>
                        <option value="none">{t("viewer.settings.page_transition.none")}</option>
                      </select>
                    </div>
                  </>
                )}
                <div className={styles.flexOne}>
                  <label className={styles.fieldLabel}>{t("settings.libraries.item.edit.excludes_label")}</label>
                  <input
                    type="text"
                    value={editingLibrary.scan_excludes || ""}
                    onChange={(e) => setEditingLibrary({ ...editingLibrary, scan_excludes: e.target.value })}
                    className={commonStyles.settingsInput}
                    placeholder={t("settings.libraries.item.edit.excludes_placeholder")}
                  />
                </div>
              </>
            )}
            {isSystem && (
              <div className={styles.flexOne}>
                <p className={`${styles.fieldLabel} ${styles.dangerText}`}>
                  {t("settings.libraries.item.edit.system_warning")}
                </p>
              </div>
            )}

            {isSystem ? (
              <div className={styles.editActions}>
                <button
                  onClick={() => setEditingLibrary(null)}
                  className={`${commonStyles.settingsSelect} ${styles.btnAuto} ${styles.btnTransparent}`}
                >
                  {t("common.confirm")}
                </button>
              </div>
            ) : (
              <div className={styles.editActions}>
                <button
                  onClick={() => handleUpdateLibrary(lib.id, editingLibrary)}
                  className={`${commonStyles.settingsSelect} ${styles.btnAuto} ${styles.btnPrimary}`}
                >
                  {t("common.save")}
                </button>
                <button
                  onClick={() => setEditingLibrary(null)}
                  className={`${commonStyles.settingsSelect} ${styles.btnAuto} ${styles.btnTransparent}`}
                >
                  {t("common.cancel")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function LibrariesTab() {
  const { t } = useTranslation();
  const { libraries, isLoading, fetchLibraries: storeFetchLibraries, setLibraries } = useLibraryStore();
  const [isCreating, setIsCreating] = useState(false);
  const [editingLibrary, setEditingLibrary] = useState<Library | null>(null);
  const [status, setStatus] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [libraryToDelete, setLibraryToDelete] = useState<Library | null>(null);
  const [createStep, setCreateStep] = useState<1 | 2>(1);
  const [createStepDirection, setCreateStepDirection] = useState<"forward" | "backward">("forward");

  const user = useAuthStore((state) => state.user);
  const { startPolling, stopPolling } = useScanStore();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const [newLibrary, setNewLibrary] = useState<{
    name: string;
    paths: string[];
    default_view_mode: string;
    default_read_direction: string;
    default_page_transition: string;
    default_epub_spread: string;
    library_type: LibraryType;
    scan_excludes: string;
  }>({
    name: "",
    paths: [],
    default_view_mode: "single",
    default_read_direction: "ltr",
    default_page_transition: "slide",
    default_epub_spread: "none",
    library_type: "comic",
    scan_excludes: "",
  });

  // 디렉토리 브라우저 모달 상태
  const [isBrowseOpen, setIsBrowseOpen] = useState(false);
  const [browseTarget, setBrowseTarget] = useState<{ type: "create" | "edit"; index: number }>({
    type: "create",
    index: 0,
  });
  const [browsePath, setBrowsePath] = useState("/");
  const [browseParent, setBrowseParent] = useState<string | null>(null);
  const [browseQuickPaths, setBrowseQuickPaths] = useState<{ name: string; path: string }[]>([]);
  const [browseDirs, setBrowseDirs] = useState<{ name: string; path: string }[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseInput, setBrowseInput] = useState("/");
  const browseCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const browseTriggerRef = useRef<HTMLElement | null>(null);
  const browseRequestIdRef = useRef(0);

  // Global Settings state
  const [scanInterval, setScanInterval] = useState("0");
  const [scanWatch, setScanWatch] = useState(false);
  const [scanPerformanceLevel, setScanPerformanceLevel] = useState("2");
  const [updatedSeriesPeriod, setUpdatedSeriesPeriod] = useState("7");
  const validNewLibraryPaths = newLibrary.paths.filter((p) => p.trim() !== "");
  const canProceedCreateStepOne =
    newLibrary.name.trim() !== "" && validNewLibraryPaths.length > 0 && !!newLibrary.library_type;

  // Load global settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await settingAPI.list();
        setScanInterval(settings.scan_interval || "0");
        setScanWatch(settings.scan_watch === "true");
        setScanPerformanceLevel(settings.scan_performance_level || "2");
        setUpdatedSeriesPeriod(settings.updated_series_period || "7");
      } catch (error) {
        console.error("Failed to load settings:", error);
      }
    };
    loadSettings();
  }, []);

  const handleScanIntervalChange = async (value: string) => {
    try {
      if (value === "realtime") {
        setScanWatch(true);
        setScanInterval("0");
        await Promise.all([
          settingAPI.update("scan_watch", { value: "true" }),
          settingAPI.update("scan_interval", { value: "0" }),
        ]);
      } else {
        setScanWatch(false);
        setScanInterval(value);
        await Promise.all([
          settingAPI.update("scan_watch", { value: "false" }),
          settingAPI.update("scan_interval", { value: value }),
        ]);
      }
      setStatus({ type: "success", message: t("settings.libraries.toast.saved") });
    } catch (error) {
      console.error("Failed to update scan settings:", error);
      setStatus({ type: "error", message: t("settings.libraries.toast.save_failed") });
    }
  };

  const handleUpdatedSeriesPeriodChange = async (value: string) => {
    try {
      setUpdatedSeriesPeriod(value);
      await settingAPI.update("updated_series_period", { value });
      setStatus({ type: "success", message: t("settings.libraries.toast.saved") });
    } catch (error) {
      console.error("Failed to update updated series period:", error);
      setStatus({ type: "error", message: t("settings.libraries.toast.save_failed") });
    }
  };

  const handleScanPerformanceLevelChange = async (value: string) => {
    try {
      setScanPerformanceLevel(value);
      await settingAPI.update("scan_performance_level", { value });
      setStatus({ type: "success", message: t("settings.libraries.toast.saved") });
    } catch (error) {
      console.error("Failed to update scan performance level:", error);
      setStatus({ type: "error", message: t("settings.libraries.toast.save_failed") });
    }
  };

  const fetchLibraries = useCallback(
    async (showLoading = true) => {
      await storeFetchLibraries(showLoading);
    },
    [storeFetchLibraries],
  );

  useEffect(() => {
    fetchLibraries();
  }, [fetchLibraries]);

  const hasScanningLibrary = libraries.some((l) => l.scan_status === "SCANNING");

  useEffect(() => {
    if (!hasScanningLibrary) return;

    let timeoutId: number;
    let isMounted = true;

    const poll = async () => {
      if (!isMounted) return;
      await fetchLibraries(false);
      if (isMounted) {
        timeoutId = window.setTimeout(poll, 3000);
      }
    };

    timeoutId = window.setTimeout(poll, 3000);

    return () => {
      isMounted = false;
      window.clearTimeout(timeoutId);
    };
  }, [hasScanningLibrary, fetchLibraries]);

  const handleCreateLibrary = async () => {
    if (!newLibrary.name || validNewLibraryPaths.length === 0) {
      setStatus({ type: "error", message: t("settings.libraries.toast.empty_fields") });
      return;
    }

    try {
      await libraryAPI.create({ ...newLibrary, paths: validNewLibraryPaths });
      startPolling();
      setStatus({ type: "success", message: t("settings.libraries.toast.created") });
      setIsCreating(false);
      setCreateStep(1);
      setNewLibrary({
        name: "",
        paths: [],
        default_view_mode: "single",
        default_read_direction: "ltr",
        default_page_transition: "slide",
        default_epub_spread: "none",
        library_type: "comic",
        scan_excludes: "",
      });
      fetchLibraries();
    } catch (error: unknown) {
      console.error("Failed to create library:", error);
      const err = error as { response?: { data?: { error?: string } } };
      setStatus({ type: "error", message: err.response?.data?.error || t("settings.libraries.toast.create_failed") });
    }
  };

  const loadBrowsePath = useCallback(async (path: string) => {
    const requestId = ++browseRequestIdRef.current;
    setBrowseLoading(true);
    try {
      const res = await filesystemAPI.browse(path);
      if (requestId !== browseRequestIdRef.current) return;
      setBrowsePath(res.data.current);
      setBrowseInput(res.data.current);
      setBrowseParent(res.data.parent);
      setBrowseQuickPaths(res.data.quick_paths || []);
      setBrowseDirs(res.data.directories || []);
    } catch {
      if (requestId !== browseRequestIdRef.current) return;
      setBrowsePath(path);
      setBrowseInput(path);
      setBrowseParent(null);
      setBrowseQuickPaths([]);
      setBrowseDirs([]);
    } finally {
      if (requestId === browseRequestIdRef.current) {
        setBrowseLoading(false);
      }
    }
  }, []);

  const openBrowse = async (target: { type: "create" | "edit"; index: number }, initialPath?: string) => {
    const fallbackPath = initialPath || "/";
    if (document.activeElement instanceof HTMLElement) {
      browseTriggerRef.current = document.activeElement;
    }
    setBrowseTarget(target);
    setIsBrowseOpen(true);
    await loadBrowsePath(fallbackPath);
  };

  const closeBrowse = useCallback(() => {
    setIsBrowseOpen(false);
  }, []);

  const handleBrowseDialogKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;

    const focusableSelectors = [
      "a[href]",
      "area[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "button:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(", ");

    const focusableElements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(focusableSelectors)).filter(
      (element) => {
        if (element.getAttribute("aria-hidden") === "true") return false;
        if (element.tabIndex < 0) return false;
        return !element.hasAttribute("disabled");
      },
    );

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement as HTMLElement | null;

    if (!event.shiftKey && activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
      return;
    }

    if (event.shiftKey && activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    }
  }, []);

  useEffect(() => {
    if (!isBrowseOpen) {
      browseTriggerRef.current?.focus();
      return;
    }

    browseCloseButtonRef.current?.focus();

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeBrowse();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [closeBrowse, isBrowseOpen]);

  const navigateBrowse = async (path: string) => {
    await loadBrowsePath(path);
  };

  const selectBrowsePath = () => {
    if (browseTarget.type === "create") {
      const newPaths = [...newLibrary.paths];
      newPaths[browseTarget.index] = browsePath;
      setNewLibrary({ ...newLibrary, paths: newPaths });
    } else if (browseTarget.type === "edit" && editingLibrary) {
      const newPaths = [...(editingLibrary.paths || [])];
      newPaths[browseTarget.index] = browsePath;
      setEditingLibrary({ ...editingLibrary, paths: newPaths });
    }
    setIsBrowseOpen(false);
  };

  const handleBrowseSubmit = async () => {
    const nextPath = browseInput.trim();
    if (!nextPath) return;
    await navigateBrowse(nextPath);
  };

  const handleUpdateLibrary = async (id: string, data: Partial<Library>) => {
    try {
      await libraryAPI.update(id, data);
      setStatus({ type: "success", message: t("settings.libraries.toast.updated") });
      setEditingLibrary(null);
      fetchLibraries();
    } catch (error: unknown) {
      console.error("Failed to update library:", error);
      const err = error as { response?: { data?: { error?: string } } };
      setStatus({ type: "error", message: err.response?.data?.error || t("settings.libraries.toast.update_failed") });
    }
  };

  const handleDeleteLibrary = (lib: Library) => {
    setLibraryToDelete(lib);
    setIsDeleteModalOpen(true);
  };

  const executeDelete = async () => {
    if (!libraryToDelete) return;

    try {
      await libraryAPI.delete(libraryToDelete.id);
      setStatus({ type: "success", message: t("settings.libraries.toast.deleted") });
      setIsDeleteModalOpen(false);
      setLibraryToDelete(null);
      fetchLibraries();
    } catch (error: unknown) {
      console.error("Failed to delete library:", error);
      setStatus({ type: "error", message: getLibraryDeleteErrorMessage(error, t) });
      setIsDeleteModalOpen(false);
    }
  };

  const handleScanLibrary = async (id: string) => {
    const library = libraries.find((l) => l.id === id);
    const isCurrentlyScanning = library?.scan_status === "SCANNING";

    try {
      if (isCurrentlyScanning) {
        await libraryAPI.cancelScan(id);
        stopPolling();
        setStatus({ type: "info", message: t("settings.libraries.toast.scan_canceled") });
        fetchLibraries();
        return;
      }

      setStatus({ type: "info", message: t("settings.libraries.toast.scan_started") });
      startPolling();
      await libraryAPI.scan(id);
      setStatus({ type: "success", message: t("settings.libraries.toast.scan_completed") });
      fetchLibraries();
    } catch (error: unknown) {
      console.error("Failed to scan library:", error);
      const err = error as { response?: { status?: number } };
      if (err.response?.status === 409) {
        setStatus({ type: "info", message: t("settings.libraries.toast.scan_running") });
      } else {
        setStatus({ type: "error", message: t("settings.libraries.toast.scan_failed") });
      }
    }
  };

  const handleScanAll = async () => {
    try {
      setStatus({ type: "info", message: t("settings.libraries.toast.scan_started") });
      startPolling();
      await libraryAPI.scanAll();
      fetchLibraries();
    } catch (error: unknown) {
      console.error("Failed to scan all libraries:", error);
      setStatus({ type: "error", message: t("settings.libraries.toast.scan_failed") });
    }
  };

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id) {
        const oldIndex = libraries.findIndex((lib) => lib.id === active.id);
        const newIndex = libraries.findIndex((lib) => lib.id === over.id);

        const newLibraries = arrayMove(libraries, oldIndex, newIndex);
        setLibraries(newLibraries);

        try {
          await libraryAPI.updateOrder(newLibraries.map((l) => l.id));
        } catch (error) {
          console.error("Failed to update library order:", error);
          setStatus({ type: "error", message: t("settings.libraries.toast.order_failed") });
          fetchLibraries(); // Rollback
        }
      }
    },
    [libraries, setLibraries, fetchLibraries, t],
  );

  const handleToggleVisibility = async (lib: Library) => {
    try {
      const newIsVisible = lib.is_visible === false ? true : false;
      const updatedLibraries = libraries.map((l) => (l.id === lib.id ? { ...l, is_visible: newIsVisible } : l));
      setLibraries(updatedLibraries);

      await libraryAPI.update(lib.id, { is_visible: newIsVisible });
    } catch (error: unknown) {
      console.error("Failed to toggle visibility:", error);
      setStatus({ type: "error", message: t("settings.libraries.toast.visibility_failed") });
      fetchLibraries(); // Rollback
    }
  };

  return (
    <div className={`${commonStyles.tabContent} ${styles.relative}`}>
      {status && (
        <Toast
          type={status.type}
          message={status.message}
          onClose={() => setStatus(null)}
        />
      )}

      <div className={styles.tabHeaderFlex}>
        <div className={styles.flexOne}>
          <h2>{t("settings.libraries.title")}</h2>
          <p className={commonStyles.tabDescription}>{t("settings.libraries.desc")}</p>
        </div>
        {!isCreating && (
          <button
            onClick={() => {
              setCreateStep(1);
              setIsCreating(true);
            }}
            className={`${commonStyles.settingsSelect} ${styles.addLibraryButton}`}
          >
            <Plus size={14} />
            {t("settings.libraries.add_button")}
          </button>
        )}
      </div>

      {isCreating && (
        <div className={`${commonStyles.settingsSection} ${styles.createForm}`}>
          <div className={commonStyles.sectionTitle}>
            <FolderOpen size={18} />
            <h3>{t("settings.libraries.add_title")}</h3>
          </div>
          <div className={commonStyles.sectionContent}>
            <div
              key={createStep}
              className={`${styles.createStepPanel} ${createStepDirection === "forward" ? styles.createStepForward : styles.createStepBackward}`}
            >
              {createStep === 1 ? (
                <>
                  <div className={commonStyles.settingsItem}>
                    <div className={commonStyles.itemInfo}>
                      <label>{t("settings.libraries.name_label")}</label>
                    </div>
                    <div className={commonStyles.itemControl}>
                      <input
                        type="text"
                        placeholder={t("settings.libraries.name_placeholder")}
                        value={newLibrary.name}
                        onChange={(e) => setNewLibrary({ ...newLibrary, name: e.target.value })}
                        className={commonStyles.settingsInput}
                      />
                    </div>
                  </div>
                  <div className={commonStyles.settingsItem}>
                    <div className={commonStyles.itemInfo}>
                      <label>{t("settings.libraries.paths_label")}</label>
                      <p>{t("settings.libraries.paths_desc")}</p>
                    </div>
                    <div className={commonStyles.itemControl}>
                      <div className={styles.pathToolbar}>
                        <button
                          type="button"
                          onClick={() => openBrowse({ type: "create", index: newLibrary.paths.length }, "/")}
                          className={`${commonStyles.settingsSelect} ${styles.btnAuto} ${styles.btnTransparent}`}
                        >
                          <Plus size={14} /> {t("settings.libraries.add_path")}
                        </button>
                      </div>
                      {newLibrary.paths.map((p, i) => (
                        <div
                          key={i}
                          className={styles.pathRow}
                        >
                          <button
                            type="button"
                            onClick={() => openBrowse({ type: "create", index: i }, p || "/")}
                            className={styles.pathValueButton}
                            title={p || t("settings.libraries.browse")}
                          >
                            <Folder size={16} />
                            <span>{p || t("settings.libraries.path_empty")}</span>
                          </button>
                          {newLibrary.paths.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const newPaths = newLibrary.paths.filter((_, idx) => idx !== i);
                                setNewLibrary({ ...newLibrary, paths: newPaths });
                              }}
                              className={`${commonStyles.settingsSelect} ${styles.btnAuto} ${styles.btnTransparent} ${styles.btnDanger}`}
                              title={t("settings.libraries.remove_path")}
                              aria-label={t("settings.libraries.remove_path")}
                            >
                              <X size={16} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className={commonStyles.settingsItem}>
                    <div className={commonStyles.itemInfo}>
                      <label>{t("settings.libraries.type_label")}</label>
                      <p>{t("settings.libraries.type_desc")}</p>
                    </div>
                    <div className={commonStyles.itemControl}>
                      <select
                        value={newLibrary.library_type}
                        onChange={(e) => setNewLibrary({ ...newLibrary, library_type: e.target.value as LibraryType })}
                        className={commonStyles.settingsSelect}
                      >
                        <option value="comic">{t("settings.libraries.type_comic")}</option>
                        <option value="novel">{t("settings.libraries.type_novel")}</option>
                        <option value="book">{t("settings.libraries.type_book")}</option>
                        <option value="audiobook">{t("settings.libraries.type_audiobook")}</option>
                      </select>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {newLibrary.library_type !== "audiobook" && (
                    <div className={commonStyles.settingsItem}>
                      <div className={commonStyles.itemInfo}>
                        <label>{t("settings.libraries.view_mode_label")}</label>
                        <p>{t("settings.libraries.view_mode_desc")}</p>
                      </div>
                      <div className={`${commonStyles.itemControl} ${styles.selectGroup}`}>
                        <select
                          value={newLibrary.default_view_mode}
                          onChange={(e) => {
                            const val = e.target.value;
                            setNewLibrary({
                              ...newLibrary,
                              default_view_mode: val,
                              default_epub_spread: val === "double" ? "auto" : "none",
                            });
                          }}
                          className={`${commonStyles.settingsSelect} ${styles.flexOne}`}
                        >
                          <option value="single">{t("settings.viewer.mode.single")}</option>
                          <option value="double">{t("settings.viewer.mode.double")}</option>
                          <option value="vertical">{t("settings.viewer.mode.vertical")}</option>
                        </select>
                        <select
                          value={newLibrary.default_read_direction}
                          onChange={(e) => setNewLibrary({ ...newLibrary, default_read_direction: e.target.value })}
                          className={`${commonStyles.settingsSelect} ${styles.flexOne}`}
                        >
                          <option value="ltr">{t("settings.viewer.direction.ltr")}</option>
                          <option value="rtl">{t("settings.viewer.direction.rtl")}</option>
                        </select>
                        <select
                          value={newLibrary.default_page_transition}
                          onChange={(e) => setNewLibrary({ ...newLibrary, default_page_transition: e.target.value })}
                          className={`${commonStyles.settingsSelect} ${styles.flexOne}`}
                        >
                          <option value="slide">{t("viewer.settings.page_transition.slide")}</option>
                          <option value="fade">{t("viewer.settings.page_transition.fade")}</option>
                          <option value="none">{t("viewer.settings.page_transition.none")}</option>
                        </select>
                      </div>
                    </div>
                  )}
                  <div className={commonStyles.settingsItem}>
                    <div className={commonStyles.itemInfo}>
                      <label>{t("settings.libraries.excludes_label")}</label>
                      <p className={styles.multilineHelp}>{t("settings.libraries.excludes_desc")}</p>
                    </div>
                    <div className={commonStyles.itemControl}>
                      <input
                        type="text"
                        placeholder={t("settings.libraries.excludes_placeholder")}
                        value={newLibrary.scan_excludes}
                        onChange={(e) => setNewLibrary({ ...newLibrary, scan_excludes: e.target.value })}
                        className={commonStyles.settingsInput}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className={styles.createFooter}>
              <div className={styles.stepIndicator}>
                <div className={styles.stepIndicatorInner}>
                  <div
                    className={`${styles.stepConnectorProgress} ${createStep === 2 ? styles.stepConnectorProgressActive : ""}`}
                  />
                  <div
                    className={`${styles.stepMarker} ${createStep === 2 ? styles.stepMarkerStepTwo : styles.stepMarkerStepOne}`}
                  />
                  <div className={styles.stepItem}>
                    <div
                      className={`${styles.stepNumber} ${createStep === 1 ? styles.stepNumberActive : styles.stepNumberInactive}`}
                    >
                      1
                    </div>
                  </div>
                  <div className={styles.stepConnector} />
                  <div className={styles.stepItem}>
                    <div
                      className={`${styles.stepNumber} ${createStep === 2 ? styles.stepNumberActive : styles.stepNumberInactive}`}
                    >
                      2
                    </div>
                  </div>
                </div>
              </div>
              <div className={styles.formActions}>
                <button
                  onClick={() => {
                    if (createStep === 2) {
                      setCreateStepDirection("backward");
                      setCreateStep(1);
                      return;
                    }
                    setIsCreating(false);
                    setCreateStepDirection("forward");
                    setCreateStep(1);
                  }}
                  className={`${commonStyles.settingsSelect} ${styles.btnAuto} ${styles.btnTransparent}`}
                >
                  {createStep === 1 ? t("common.cancel") : t("common.prev")}
                </button>
                {createStep === 1 ? (
                  <button
                    onClick={() => {
                      setCreateStepDirection("forward");
                      setCreateStep(2);
                    }}
                    disabled={!canProceedCreateStepOne}
                    className={`${commonStyles.settingsSelect} ${styles.btnAuto} ${styles.btnPrimary}`}
                  >
                    {t("common.next")}
                  </button>
                ) : (
                  <button
                    onClick={handleCreateLibrary}
                    className={`${commonStyles.settingsSelect} ${styles.btnAuto} ${styles.btnPrimary}`}
                  >
                    {t("common.create")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={styles.settingsGrid}>
        <div className={`${commonStyles.settingsSection} ${styles.globalSettings}`}>
          <div className={commonStyles.sectionTitle}>
            <RefreshCw size={18} />
            <h3>{t("settings.libraries.scan.title")}</h3>
          </div>
          <div className={commonStyles.sectionContent}>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label>{t("settings.libraries.scan.performance_label")}</label>
                <p>{t("settings.libraries.scan.performance_desc")}</p>
              </div>
              <div className={commonStyles.itemControl}>
                <select
                  value={scanPerformanceLevel}
                  onChange={(e) => handleScanPerformanceLevelChange(e.target.value)}
                  className={commonStyles.settingsSelect}
                >
                  <option value="1">{t("settings.libraries.scan.level_1")}</option>
                  <option value="2">{t("settings.libraries.scan.level_2")}</option>
                  <option value="4">{t("settings.libraries.scan.level_4")}</option>
                </select>
              </div>
            </div>

            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label>{t("settings.libraries.scan.interval_label")}</label>
                <p>{t("settings.libraries.scan.interval_desc")}</p>
              </div>
              <div className={commonStyles.itemControl}>
                <select
                  value={scanWatch ? "realtime" : scanInterval}
                  onChange={(e) => handleScanIntervalChange(e.target.value)}
                  className={commonStyles.settingsSelect}
                >
                  <option value="0">{t("settings.libraries.scan.manual")}</option>
                  <option value="realtime">{t("settings.libraries.scan.realtime")}</option>
                  <option value="30">{t("settings.libraries.scan.30min")}</option>
                  <option value="60">{t("settings.libraries.scan.1hr")}</option>
                  <option value="360">{t("settings.libraries.scan.6hr")}</option>
                  <option value="720">{t("settings.libraries.scan.12hr")}</option>
                  <option value="1440">{t("settings.libraries.scan.24hr")}</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className={`${commonStyles.settingsSection} ${styles.globalSettings}`}>
          <div className={commonStyles.sectionTitle}>
            <Clock size={18} />
            <h3>{t("settings.libraries.updated.title")}</h3>
          </div>
          <div className={commonStyles.sectionContent}>
            <div className={commonStyles.settingsItem}>
              <div className={commonStyles.itemInfo}>
                <label>{t("settings.libraries.updated.period_label")}</label>
                <p>{t("settings.libraries.updated.period_desc")}</p>
              </div>
              <div className={commonStyles.itemControl}>
                <select
                  value={updatedSeriesPeriod}
                  onChange={(e) => handleUpdatedSeriesPeriodChange(e.target.value)}
                  className={commonStyles.settingsSelect}
                  disabled={user?.role !== "MASTER"}
                >
                  <option value="1">{t("settings.libraries.updated.1day")}</option>
                  <option value="3">{t("settings.libraries.updated.3days")}</option>
                  <option value="7">{t("settings.libraries.updated.7days")}</option>
                  <option value="14">{t("settings.libraries.updated.14days")}</option>
                  <option value="30">{t("settings.libraries.updated.30days")}</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={commonStyles.settingsSection}>
        <div className={styles.listHeader}>
          <div className={styles.listHeaderTitle}>
            <Folder size={18} />
            <h3>{t("settings.libraries.list_title")}</h3>
          </div>
          <button
            onClick={handleScanAll}
            className={`${commonStyles.settingsSelect} ${styles.scanAllButton}`}
          >
            <RefreshCw size={14} />
            {t("settings.libraries.scan_all_button")}
          </button>
        </div>
        {isLoading ? (
          <div className={commonStyles.placeholderContent}>Loading...</div>
        ) : (
          <div className={styles.libraryList}>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={libraries.map((l) => l.id)}
                strategy={verticalListSortingStrategy}
              >
                {libraries.map((lib: Library) => (
                  <SortableLibraryItem
                    key={lib.id}
                    lib={lib}
                    editingLibrary={editingLibrary}
                    setEditingLibrary={setEditingLibrary}
                    handleUpdateLibrary={handleUpdateLibrary}
                    onEdit={(l) => setEditingLibrary(editingLibrary?.id === l.id ? null : l)}
                    onScan={handleScanLibrary}
                    onDelete={handleDeleteLibrary}
                    onToggleVisibility={handleToggleVisibility}
                    openBrowse={openBrowse}
                  />
                ))}
              </SortableContext>
            </DndContext>
            {libraries.length === 0 && (
              <div className={commonStyles.placeholderContent}>{t("settings.libraries.empty")}</div>
            )}
          </div>
        )}
      </div>
      <AlertModal
        isOpen={isDeleteModalOpen}
        type="warning"
        title={t("settings.libraries.delete_modal.title")}
        message={t("settings.libraries.delete_modal.message", { name: libraryToDelete?.name })}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        showCancel={true}
        onConfirm={executeDelete}
        onCancel={() => {
          setIsDeleteModalOpen(false);
          setLibraryToDelete(null);
        }}
      />

      {/* 디렉토리 브라우저 모달 */}
      {isBrowseOpen && (
        <div
          className={styles.browseOverlay}
          onClick={closeBrowse}
        >
          <div
            className={styles.browseModal}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleBrowseDialogKeyDown}
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-browse-title"
          >
            <div className={styles.browseHeader}>
              <h3 id="library-browse-title">{t("settings.libraries.browse_title")}</h3>
              <button
                ref={browseCloseButtonRef}
                onClick={closeBrowse}
                className={styles.browseClose}
                type="button"
                aria-label={t("common.close")}
              >
                <X size={18} />
              </button>
            </div>
            <div className={styles.browseInputRow}>
              <input
                type="text"
                value={browseInput}
                onChange={(e) => setBrowseInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleBrowseSubmit();
                  }
                }}
                className={`${commonStyles.settingsInput} ${styles.browseInput}`}
                placeholder={t("settings.libraries.browse_input_placeholder")}
              />
              <button
                type="button"
                onClick={() => void handleBrowseSubmit()}
                className={`${commonStyles.settingsSelect} ${styles.btnAuto} ${styles.btnTransparent}`}
                title={t("settings.libraries.browse_go")}
                aria-label={t("settings.libraries.browse_go")}
              >
                <Search size={16} />
              </button>
            </div>
            {browseQuickPaths.length > 0 && (
              <div className={styles.browseQuickSection}>
                <div className={styles.browseQuickHeader}>{t("settings.libraries.browse_quick_paths")}</div>
                <div className={styles.browseQuickList}>
                  {browseQuickPaths.map((quickPath) => (
                    <button
                      key={quickPath.path}
                      type="button"
                      className={styles.browseQuickItem}
                      onClick={() => navigateBrowse(quickPath.path)}
                    >
                      <Folder size={14} />
                      <span>{quickPath.path}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className={styles.browseCurrent}>
              <Folder size={16} />
              <span>{browsePath}</span>
              {browseParent && (
                <button
                  onClick={() => navigateBrowse(browseParent)}
                  className={styles.browseUp}
                  title={t("settings.libraries.browse_up")}
                  aria-label={t("settings.libraries.browse_up")}
                  type="button"
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
            <div className={styles.browseList}>
              {browseLoading ? (
                <div className={styles.browseLoading}>{t("settings.libraries.browse_loading")}</div>
              ) : browseDirs.length === 0 ? (
                <div className={styles.browseEmpty}>{t("settings.libraries.browse_empty")}</div>
              ) : (
                browseDirs.map((dir) => (
                  <button
                    key={dir.path}
                    className={styles.browseItem}
                    onClick={() => navigateBrowse(dir.path)}
                  >
                    <Folder size={16} />
                    <span>{dir.name}</span>
                    <ChevronRight size={14} />
                  </button>
                ))
              )}
            </div>
            <div className={styles.browseActions}>
              <button
                onClick={closeBrowse}
                className={`${commonStyles.settingsSelect} ${styles.btnAuto} ${styles.btnTransparent}`}
                type="button"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={selectBrowsePath}
                className={`${commonStyles.settingsSelect} ${styles.btnAuto} ${styles.btnPrimary}`}
                type="button"
              >
                {t("settings.libraries.browse_select")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
