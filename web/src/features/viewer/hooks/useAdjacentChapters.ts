// 인접 챕터 탐색 훅

import { useEffect, useState, useCallback } from "react";
import { seriesAPI } from "../../../api/client";
import type { Chapter, AdjacentChapterInfo } from "../types";

interface UseAdjacentChaptersParams {
  volumeId: string | null;
  chapterId: string | undefined;
  seriesId: string | null;
}

/**
 * 이전/다음 챕터 정보를 탐색하는 커스텀 훅
 * - 같은 볼륨 내 인접 챕터 확인
 * - 다른 볼륨으로 넘어가는 경우도 처리
 */
export function useAdjacentChapters({ volumeId, chapterId, seriesId }: UseAdjacentChaptersParams): AdjacentChapterInfo {
  const [nextChapterId, setNextChapterId] = useState<string | null>(null);
  const [prevChapterId, setPrevChapterId] = useState<string | null>(null);
  const [nextChapterTitle, setNextChapterTitle] = useState<string | null>(null);
  const [prevChapterTitle, setPrevChapterTitle] = useState<string | null>(null);
  const [isLastChapterOfVolume, setIsLastChapterOfVolume] = useState(false);
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const currentKey = volumeId && chapterId && seriesId ? `${volumeId}:${chapterId}:${seriesId}` : null;

  // 인접 챕터 로드
  const loadAdjacentChapters = useCallback(
    async (targetVolumeId: string, currentChapterId: string, targetSeriesId: string) => {
      try {
        const [volumesRes, chaptersRes] = await Promise.all([
          seriesAPI.getVolumes(targetSeriesId),
          seriesAPI.getChapters(targetSeriesId),
        ]);
        const volumes = (volumesRes.data.volumes || []).sort(
          (a: { volume_number: number }, b: { volume_number: number }) => a.volume_number - b.volume_number,
        );
        const allChapters = chaptersRes.data.chapters || [];
        const chaptersByVolume = new Map<string, Chapter[]>();

        for (const chapter of allChapters) {
          if (!chaptersByVolume.has(chapter.volume_id)) {
            chaptersByVolume.set(chapter.volume_id, []);
          }
          chaptersByVolume.get(chapter.volume_id)!.push(chapter);
        }
        for (const chapterList of chaptersByVolume.values()) {
          chapterList.sort((a, b) => a.chapter_number - b.chapter_number);
        }

        const chapters = chaptersByVolume.get(targetVolumeId) || [];
        const currentIndex = chapters.findIndex((c) => c.id === currentChapterId);
        const currentVolIndex = volumes.findIndex((v: { id: string }) => v.id === targetVolumeId);
        if (currentVolIndex < 0 || currentIndex < 0) {
          return false;
        }

        // 같은 볼륨 내 이전/다음 챕터 확인
        if (currentIndex > 0) {
          const prev = chapters[currentIndex - 1];
          setPrevChapterId(prev.id);
          setPrevChapterTitle(prev.title);
        } else {
          // 볼륨의 첫 챕터 -> 이전 볼륨의 마지막 챕터 확인
          setPrevChapterId(null);
          setPrevChapterTitle(null);
          for (let i = currentVolIndex - 1; i >= 0; i--) {
            const prevVol = volumes[i];
            const prevVolumeChapters = chaptersByVolume.get(prevVol.id) || [];
            if (prevVolumeChapters.length === 0) continue;
            const lastChapter = prevVolumeChapters[prevVolumeChapters.length - 1];
            setPrevChapterId(lastChapter.id);
            const title =
              prevVol.title !== lastChapter.title ? `${prevVol.title} - ${lastChapter.title}` : lastChapter.title;
            setPrevChapterTitle(title);
            break;
          }
        }

        if (currentIndex < chapters.length - 1) {
          const next = chapters[currentIndex + 1];
          setNextChapterId(next.id);
          setNextChapterTitle(next.title);
          setIsLastChapterOfVolume(false);
        } else {
          // 볼륨의 마지막 챕터 -> 다음 볼륨의 첫 챕터 확인
          setNextChapterId(null);
          setNextChapterTitle(null);
          setIsLastChapterOfVolume(true); // 마지막 챕터임을 표시
          for (let i = currentVolIndex + 1; i < volumes.length; i++) {
            const nextVol = volumes[i];
            const nextVolumeChapters = chaptersByVolume.get(nextVol.id) || [];
            if (nextVolumeChapters.length === 0) continue;
            const firstChapter = nextVolumeChapters[0];
            setNextChapterId(firstChapter.id);
            const title =
              nextVol.title !== firstChapter.title ? `${nextVol.title} - ${firstChapter.title}` : firstChapter.title;
            setNextChapterTitle(title);
            break;
          }
        }
        return true;
      } catch (err) {
        console.error("인접 챕터 로드 실패:", err);
        return false;
      }
    },
    [],
  );

  // volumeId, chapterId, seriesId가 변경되면 인접 챕터 로드
  useEffect(() => {
    let cancelled = false;
    const requestKey = currentKey;

    const load = async () => {
      if (!requestKey || !volumeId || !chapterId || !seriesId) {
        if (!cancelled) {
          setResolvedKey(null);
        }
        return;
      }

      const success = await loadAdjacentChapters(volumeId, chapterId, seriesId);
      if (cancelled) return;

      setResolvedKey(success ? requestKey : null);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [volumeId, chapterId, seriesId, loadAdjacentChapters, currentKey]);

  return {
    nextChapterId,
    prevChapterId,
    nextChapterTitle,
    prevChapterTitle,
    isLastChapterOfVolume,
    isAdjacentResolved: currentKey !== null && resolvedKey === currentKey,
  };
}
