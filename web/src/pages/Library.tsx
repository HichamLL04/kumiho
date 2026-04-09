import { Fragment, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useParams, Link } from "react-router-dom";
import { Folder, RefreshCw } from "lucide-react";
import { useLibraryStore } from "../stores/libraryStore";
import type { Library } from "../stores/libraryStore";
import { useAuthStore } from "../stores/authStore";
import { libraryAPI } from "../api/client";
import { Header } from "../components/headers/Header";
import { SubHeader } from "../components/headers/SubHeader";
import { Sidebar } from "../components/Sidebar";
import { SeriesCard } from "../components/SeriesCard";
import { Toast } from "../components/common/Toast";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import type { Series } from "../types/series";
import { compareSeriesByDisplayName, getSeriesDisplayContext, getSeriesDisplayName, getSeriesGroupKey } from "../utils/librarySeries";
import styles from "./Library.module.css";

const POLL_INTERVAL_MS = 3000;

export function LibraryPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();

  const { fetchLibraries, triggerRefresh, refreshKey } = useLibraryStore();
  const currentLibraryScanStatus = useLibraryStore(
    (state) => state.libraries.find((l) => l.id === id)?.scan_status,
  );

  // 데이터 상태
  const [library, setLibrary] = useState<Library | null>(null);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const loadSequenceRef = useRef(0);
  const lastFetchedIdRef = useRef<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const user = useAuthStore((state) => state.user);

  // 사이드바 상태
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const sortedSeriesList = useMemo(() => {
    return [...seriesList].sort(compareSeriesByDisplayName);
  }, [seriesList]);

  const groupedSeriesList = useMemo(() => {
    const groups: { key: string; items: Series[] }[] = [];
    for (const series of sortedSeriesList) {
      const groupKey = getSeriesGroupKey(getSeriesDisplayName(series));
      const lastGroup = groups[groups.length - 1];
      if (!lastGroup || lastGroup.key !== groupKey) {
        groups.push({ key: groupKey, items: [series] });
        continue;
      }
      lastGroup.items.push(series);
    }
    return groups;
  }, [sortedSeriesList]);

  const loadData = useCallback(
    async (isInitial = false) => {
      if (!id) return;
      const currentLoad = ++loadSequenceRef.current;
      if (isInitial) {
        setIsLoading(true);
      }

      try {
        const response = await libraryAPI.get(id);
        if (currentLoad !== loadSequenceRef.current) return;
        setLibrary(response.data);

        const seriesResponse = await libraryAPI.getSeries(id);
        const loadedSeries: Series[] = seriesResponse.data.series || [];
        if (currentLoad !== loadSequenceRef.current) return;
        setSeriesList(loadedSeries);
      } catch (error) {
        console.error("Failed to load library data:", error);
      } finally {
        if (currentLoad === loadSequenceRef.current) {
          // 초기 진입과 새로고침 모두 최신 요청이 끝나면 로딩을 해제해야 화면이 갱신된다.
          setIsLoading(false);
        }
      }
    },
    [id],
  );

  useEffect(() => {
    if (id) {
      const isInitial = lastFetchedIdRef.current !== id;
      lastFetchedIdRef.current = id;

      const timer = window.setTimeout(() => {
        void loadData(isInitial);
      }, 0);
      fetchLibraries(isInitial);
      // ID가 바뀌면 사이드바 닫기 (선택적)
      setSidebarOpen(false);
      return () => {
        window.clearTimeout(timer);
        loadSequenceRef.current += 1;
      };
    }
  }, [id, refreshKey, loadData, fetchLibraries]);

  // 스캔 중일 때 시리즈 목록 실시간 폴링
  // - isScanning: 이 페이지에서 직접 스캔 버튼을 눌렀을 때 (libraryAPI.scan은 동기 블로킹이므로 스토어 갱신 없음)
  // - currentLibraryScanStatus: 외부(다른 탭/스케줄러 등)에서 스캔이 시작된 경우
  useEffect(() => {
    if (!isScanning && currentLibraryScanStatus !== "SCANNING") return;

    let timeoutId: number;
    let isMounted = true;

    const poll = async () => {
      if (!isMounted) return;
      await Promise.all([loadData(false), fetchLibraries(false)]);
      if (isMounted) {
        timeoutId = window.setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    void poll();

    return () => {
      isMounted = false;
      window.clearTimeout(timeoutId);
    };
  }, [isScanning, currentLibraryScanStatus, loadData, fetchLibraries]);

  const handleScan = async () => {
    if (!id) return;
    setIsScanning(true);
    setStatus(null); // 이전 메시지 제거
    setTimeout(() => {
      setStatus({ type: "info", message: t("settings.libraries.toast.scan_started") });
    }, 0);
    try {
      await libraryAPI.scan(id);
      await loadData();
      triggerRefresh();
      setStatus(null); // 이전 메시지 제거
      setTimeout(() => {
        setStatus({ type: "success", message: t("settings.libraries.toast.scan_completed") });
      }, 0);
    } catch (error: unknown) {
      console.error("Scan failed:", error);
      const err = error as { response?: { status?: number } };
      if (err.response?.status === 409) {
        setStatus({ type: "info", message: t("settings.libraries.toast.scan_running") });
        // 스토어 scan_status를 SCANNING으로 갱신해야 폴링 effect가 유지됨
        await fetchLibraries(false);
      } else {
        setStatus({ type: "error", message: t("settings.libraries.toast.scan_failed") });
        await loadData(false);  // 실패 후 최신 상태로 복원
      }
    } finally {
      setIsScanning(false);
    }
  };

  const scrollToGroup = (groupKey: string) => {
    const target = sectionRefs.current[groupKey];
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  if (isLoading) {
    return (
      <div className={styles.libraryContainer}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <LoadingSpinner fullScreen />
      </div>
    );
  }

  // 라이브러리를 찾을 수 없는 경우
  if (!library) {
    return (
      <div className={styles.libraryContainer}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <div className={styles.errorContainer}>
          <p>{t("home.library.not_found")}</p>
          <Link
            to="/"
            className={styles.backLink}
          >
            {t("common.go_home")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.libraryContainer} page-with-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      {status && (
        <Toast
          type={status.type}
          message={status.message}
          onClose={() => setStatus(null)}
        />
      )}
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* 메인 콘텐츠 */}
      <div className={styles.libraryContentWrapper}>
        <SubHeader
          showBackButton={false}
          title={
            <>
              <Folder size={24} /> {library.name}
            </>
          }
          rightContent={
            library.type !== "SYSTEM" &&
            user?.role === "MASTER" && (
              <button
                onClick={handleScan}
                disabled={isScanning}
                className={styles.scanBtn}
              >
                {isScanning ? (
                  <>
                    <RefreshCw
                      size={16}
                      className={styles.spin}
                    />{" "}
                    {t("home.library.scan_in_progress")}
                  </>
                ) : (
                  <>
                    <RefreshCw size={16} /> {t("home.library.scan")}
                  </>
                )}
              </button>
            )
          }
        />

        {/* 시리즈 그리드 */}
        <main className={styles.libraryMain}>
          <div className={styles.seriesCount}>
            <Trans
              i18nKey="home.library.total_series"
              count={sortedSeriesList.length}
              components={{ strong: <strong /> }}
            />
          </div>

          {sortedSeriesList.length === 0 ? (
            <div className={styles.emptyState}>
              <p>{t("home.library.empty_series")}</p>
              {library.type !== "SYSTEM" && user?.role === "MASTER" && (
                <button
                  onClick={handleScan}
                  className={`${styles.scanBtn} ${styles.primary}`}
                >
                  <RefreshCw size={16} /> {t("home.library.scan_now")}
                </button>
              )}
            </div>
          ) : (
            <div className={styles.seriesLayout}>
              <nav
                className={styles.seriesIndex}
                aria-label={t("home.library.total_series", { count: sortedSeriesList.length })}
              >
                {groupedSeriesList.map((group) => (
                  <button
                    key={group.key}
                    type="button"
                    className={styles.seriesIndexButton}
                    onClick={() => scrollToGroup(group.key)}
                    aria-label={`${group.key} 섹션으로 이동`}
                  >
                    {group.key}
                  </button>
                ))}
              </nav>

              <div className={styles.seriesGrid}>
                {groupedSeriesList.map((group) => (
                  <Fragment key={group.key}>
                    {group.items.map((series, index) => {
                      const displayContext = getSeriesDisplayContext(series.path, library.paths);
                      return (
                        <div
                          key={series.id}
                          ref={(node) => {
                            if (index === 0) {
                              sectionRefs.current[group.key] = node;
                            }
                          }}
                          className={styles.seriesCardAnchor}
                        >
                          <SeriesCard
                            item={series}
                            type="series"
                            customSubtitle={displayContext || undefined}
                            progressStyle="overlay"
                            showExtensionBadge
                            onStatusChange={loadData}
                          />
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
