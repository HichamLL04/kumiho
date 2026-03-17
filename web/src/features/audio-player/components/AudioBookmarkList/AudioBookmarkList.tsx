import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { useAudioPlayerStore } from "../../../../stores/audioPlayerStore";
import { bookmarkAPI } from "../../../../api/client";
import styles from "./AudioBookmarkList.module.css";

interface Bookmark {
  id: string;
  title: string;
  current_time?: number;
  chapter_id?: string;
  created_at: string;
}

interface AudioBookmarkListProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatTime(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioBookmarkList({ isOpen, onClose }: AudioBookmarkListProps) {
  const { t } = useTranslation();
  const currentSeries = useAudioPlayerStore((s) => s.currentSeries);
  const currentChapter = useAudioPlayerStore((s) => s.currentChapter);
  const currentTime = useAudioPlayerStore((s) => s.currentTime);
  const seekTo = useAudioPlayerStore((s) => s.seekTo);
  const playChapter = useAudioPlayerStore((s) => s.playChapter);
  const chapters = useAudioPlayerStore((s) => s.chapters);

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  const loadBookmarks = useCallback(async () => {
    if (!currentSeries) return;
    try {
      const res = await bookmarkAPI.getAll(currentSeries.id);
      const list = res.data.bookmarks || res.data || [];
      setBookmarks(Array.isArray(list) ? list : []);
    } catch {
      setBookmarks([]);
    }
  }, [currentSeries]);

  useEffect(() => {
    if (isOpen) {
      loadBookmarks();
    }
  }, [isOpen, loadBookmarks]);

  if (!isOpen) return null;

  const handleAdd = async () => {
    if (!currentSeries || !currentChapter) return;

    const chapterTitle = currentChapter.title || `Chapter ${currentChapter.chapter_number}`;
    const timeStr = formatTime(currentTime);

    try {
      await bookmarkAPI.create({
        series_id: currentSeries.id,
        chapter_id: currentChapter.id,
        title: `${chapterTitle} - ${timeStr}`,
        current_time: currentTime,
      });
      await loadBookmarks();
    } catch (err) {
      console.error("Failed to create bookmark:", err);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await bookmarkAPI.delete(id);
      setBookmarks((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      console.error("Failed to delete bookmark:", err);
    }
  };

  const handleSeek = (bookmark: Bookmark) => {
    // 같은 챕터라면 seek, 다른 챕터라면 챕터 전환
    if (bookmark.chapter_id && bookmark.chapter_id !== currentChapter?.id) {
      const chapter = chapters.find((c) => c.id === bookmark.chapter_id);
      if (chapter) {
        playChapter(chapter);
        // 챕터 로드 후 seek은 AudioProvider에서 처리
      }
    } else if (bookmark.current_time != null) {
      seekTo(bookmark.current_time);
    }
    onClose();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>
            {t("audio_player.bookmarks", "Bookmarks")}
          </span>
          <button className={styles.addBtn} onClick={handleAdd}>
            <Plus size={16} />
            {t("audio_player.bookmark_add", "Add")}
          </button>
        </div>

        <div className={styles.list}>
          {bookmarks.length === 0 ? (
            <div className={styles.empty}>
              {t("audio_player.bookmark_empty", "No bookmarks yet")}
            </div>
          ) : (
            bookmarks.map((bookmark) => (
              <div
                key={bookmark.id}
                className={styles.item}
                onClick={() => handleSeek(bookmark)}
              >
                <span className={styles.itemTime}>
                  {formatTime(bookmark.current_time)}
                </span>
                <div className={styles.itemInfo}>
                  <div className={styles.itemTitle}>{bookmark.title}</div>
                </div>
                <button
                  className={styles.deleteBtn}
                  onClick={(e) => handleDelete(e, bookmark.id)}
                  aria-label="Delete bookmark"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>

        <button className={styles.closeBtn} onClick={onClose}>
          {t("common.cancel", "Close")}
        </button>
      </div>
    </div>
  );
}
