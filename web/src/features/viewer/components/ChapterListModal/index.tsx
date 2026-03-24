import { useEffect, useState, useCallback, useRef, type CSSProperties, type JSX } from "react";
import { X, ChevronRight, ChevronDown, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import { seriesAPI } from "../../../../api/client";
import type { Volume, Chapter } from "../../../../types/series";
import { LoadingSpinner } from "../../../../components/common/LoadingSpinner";
import styles from "./ChapterListModal.module.css";

interface ChapterListModalProps {
  seriesId: string;
  currentChapterId?: string;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (chapterId: string) => void;
}

interface VolumeTreeNode {
  volume: Volume;
  chapters: Chapter[];
  children: VolumeTreeNode[];
}

export function ChapterListModal({ seriesId, currentChapterId, isOpen, onClose, onNavigate }: ChapterListModalProps) {
  const { t } = useTranslation();
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [allChapters, setAllChapters] = useState<Chapter[]>([]);
  const [expandedVolumeIds, setExpandedVolumeIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    if (!seriesId) {
      setVolumes([]);
      setAllChapters([]);
      setExpandedVolumeIds(new Set());
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [volRes, chapRes] = await Promise.all([seriesAPI.getVolumes(seriesId), seriesAPI.getChapters(seriesId)]);
      const loadedVolumes: Volume[] = volRes.data.volumes || [];
      const loadedChapters: Chapter[] = chapRes.data.chapters || [];

      setVolumes(loadedVolumes);
      setAllChapters(loadedChapters);

      // 현재 챕터가 속한 볼륨과 상위 볼륨 체인을 자동으로 확장
      if (currentChapterId) {
        const currentChapter = loadedChapters.find((c) => c.id === currentChapterId);
        if (currentChapter?.volume_id) {
          const expandedIds = new Set<string>();
          const volumeById = new Map<string, Volume>(loadedVolumes.map((volume) => [volume.id, volume]));
          let volumeId: string | undefined = currentChapter.volume_id;

          while (volumeId) {
            expandedIds.add(volumeId);
            volumeId = volumeById.get(volumeId)?.parent_id;
          }

          setExpandedVolumeIds(expandedIds);
        } else {
          setExpandedVolumeIds(new Set());
        }
      } else {
        setExpandedVolumeIds(new Set());
      }
    } catch (error) {
      console.error("Failed to load chapter list:", error);
    } finally {
      setIsLoading(false);
    }
  }, [seriesId, currentChapterId]);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  // ESC 키로 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // 활성 챕터로 스크롤
  useEffect(() => {
    if (isOpen && !isLoading && currentChapterId && containerRef.current) {
      // 약간의 지연을 주어 대화상자 애니메이션과 겹치지 않게 함
      const timer = setTimeout(() => {
        const activeItem = containerRef.current?.querySelector(`.${styles.activeChapter}`);
        if (activeItem) {
          activeItem.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen, isLoading, currentChapterId]);

  // 바깥 클릭으로 닫기
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleChapterClick = (chapterId: string) => {
    onNavigate(chapterId);
    onClose();
  };

  const toggleVolume = (volumeId: string) => {
    setExpandedVolumeIds((prev) => {
      const next = new Set(prev);
      if (next.has(volumeId)) {
        next.delete(volumeId);
      } else {
        next.add(volumeId);
      }
      return next;
    });
  };

  const chapterByVolumeId = new Map<string, Chapter[]>();
  const rootChapters: Chapter[] = [];

  allChapters.forEach((chapter) => {
    if (!chapter.volume_id) {
      rootChapters.push(chapter);
      return;
    }

    const volumeChapters = chapterByVolumeId.get(chapter.volume_id) ?? [];
    volumeChapters.push(chapter);
    chapterByVolumeId.set(chapter.volume_id, volumeChapters);
  });

  const childVolumeByParentId = new Map<string, Volume[]>();
  const rootVolumes: Volume[] = [];

  volumes.forEach((volume) => {
    if (!volume.parent_id) {
      rootVolumes.push(volume);
      return;
    }

    const childVolumes = childVolumeByParentId.get(volume.parent_id) ?? [];
    childVolumes.push(volume);
    childVolumeByParentId.set(volume.parent_id, childVolumes);
  });

  const buildVolumeTree = (volume: Volume): VolumeTreeNode => ({
    volume,
    chapters: chapterByVolumeId.get(volume.id) ?? [],
    children: (childVolumeByParentId.get(volume.id) ?? []).map(buildVolumeTree),
  });

  const volumeTree = rootVolumes.map(buildVolumeTree);

  const renderChapterButton = (chapter: Chapter) => (
    <button
      key={chapter.id}
      className={`${styles.chapterBtn} ${chapter.id === currentChapterId ? styles.activeChapter : ""}`}
      onClick={() => handleChapterClick(chapter.id)}
    >
      <span className={styles.chapterTitle}>{chapter.title}</span>
      <ChevronRight size={16} />
    </button>
  );

  const renderVolumeNode = (node: VolumeTreeNode, depth = 0): JSX.Element => {
    const { volume, chapters, children } = node;
    const isExpanded = expandedVolumeIds.has(volume.id);
    const isCurrentVolume =
      chapters.some((chapter) => chapter.id === currentChapterId) ||
      children.some((child) => expandedVolumeIds.has(child.volume.id));

    return (
      <div
        key={volume.id}
        className={`${styles.volumeItem} ${isCurrentVolume ? styles.activeVolume : ""} ${isExpanded ? styles.isExpanded : ""}`}
        style={{ "--volume-depth": depth } as CSSProperties}
      >
        <button
          className={styles.volumeHeader}
          onClick={() => toggleVolume(volume.id)}
          aria-expanded={isExpanded}
        >
          <Folder
            size={18}
            className={styles.volumeIcon}
          />
          <span className={styles.volumeTitle}>{volume.title}</span>
          {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        {isExpanded && (
          <div className={styles.volumeContent}>
            {chapters.length > 0 && <div className={styles.chapterList}>{chapters.map(renderChapterButton)}</div>}
            {children.length > 0 && <div className={styles.nestedVolumeList}>{children.map((child) => renderVolumeNode(child, depth + 1))}</div>}
          </div>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div
      className={styles.modalOverlay}
      onClick={handleOverlayClick}
    >
      <div
        className={styles.modalContent}
        ref={containerRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.modalHeader}>
          <h2>{t("viewer.chapter_list.title", { defaultValue: "시리즈 목록" })}</h2>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <X size={24} />
          </button>
        </header>

        <div className={styles.modalBody}>
          {isLoading ? (
            <div className={styles.loaderWrap}>
              <LoadingSpinner />
            </div>
          ) : (
            <div className={styles.volumeList}>
              {rootChapters.length > 0 && <div className={styles.chapterList}>{rootChapters.map(renderChapterButton)}</div>}
              {volumeTree.map((node) => renderVolumeNode(node))}
              {rootChapters.length === 0 && volumeTree.length === 0 && (
                <div className={styles.emptyState}>
                  <p>{t("viewer.chapter_list.empty", { defaultValue: "목록이 비어 있습니다." })}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
