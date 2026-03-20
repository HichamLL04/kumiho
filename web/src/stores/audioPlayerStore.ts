import { create } from "zustand";
import { devtools, subscribeWithSelector } from "zustand/middleware";
import { seriesAPI, volumeAPI } from "../api/client";
import type { Series, Volume, Chapter, ReadingProgress } from "../types/series";

export type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "ended" | "error";
export type PlayerMode = "fullscreen" | "sidebar" | "mini" | "hidden";
export type AudioBootstrapSource = "series" | "volume" | "viewer";

export interface AudioPlayerSettings {
  playbackRate: number;
  skipBackwardSec: number;
  skipForwardSec: number;
  volume: number;
  isMuted: boolean;
  autoPlayNext: boolean;
  volumeBoost: boolean;
}

export type AudioChapterProgress = Partial<ReadingProgress> & {
  chapter_id?: string;
  current_page: number;
  total_pages: number;
};

export const isCompletedAudioChapter = (
  chapter: Chapter,
  progress?: AudioChapterProgress,
): boolean => {
  if (!progress) return chapter.is_read === true;

  const duration = chapter.duration ?? progress.duration ?? 0;
  const currentTime = progress.current_time ?? 0;

  return (
    chapter.is_read === true ||
    (progress.progress_percent ?? 0) >= 99.9 ||
    (duration > 0 && currentTime >= duration - 1)
  );
};

export interface AudioBootstrapOptions {
  source: AudioBootstrapSource;
  seriesId: string;
  volumeId?: string;
  preferredChapterId?: string;
  preferredStartTime?: number;
  series?: Series | null;
  volume?: Volume | null;
  chapter?: Chapter | null;
}

export interface AudioBootstrapResult {
  ok: boolean;
  reason?: "no_chapters" | "fetch_failed";
}

interface AudioPlayerState {
  // Content
  currentSeries: Series | null;
  currentVolume: Volume | null;
  currentVolumeId: string | null;
  currentChapter: Chapter | null;
  chapters: Chapter[];
  chapterProgressMap: Record<string, AudioChapterProgress>;

  // Playback
  status: PlaybackStatus;
  currentTime: number;
  duration: number;

  // Settings
  settings: AudioPlayerSettings;

  // UI
  playerMode: PlayerMode;
  isChapterListOpen: boolean;

  // Seek request (version counter for AudioProvider to detect seek)
  seekVersion: number;
  seekTarget: number;

  // Sleep timer
  sleepTimerMinutes: number | null;
  sleepTimerEndTime: number | null;

  // Actions - Content
  loadAndPlay: (
    series: Series,
    chapter: Chapter,
    chapters?: Chapter[],
    volume?: Volume | null,
    startTime?: number,
  ) => void;
  bootstrapAndPlay: (options: AudioBootstrapOptions) => Promise<AudioBootstrapResult>;
  updateCurrentSeries: (series: Series) => void;
  playChapter: (chapter: Chapter, startTime?: number) => void;
  playChapterFromProgress: (chapter: Chapter) => void;
  setChapters: (chapters: Chapter[]) => void;
  setChapterProgressList: (progressList: ReadingProgress[]) => void;

  // Actions - Playback
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setStatus: (status: PlaybackStatus) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  seekTo: (time: number) => void;
  skipForward: () => void;
  skipBackward: () => void;
  nextChapter: () => void;
  prevChapter: () => void;

  // Actions - Settings
  setPlaybackRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setSkipBackwardSec: (sec: number) => void;
  setSkipForwardSec: (sec: number) => void;
  toggleAutoPlayNext: () => void;
  toggleVolumeBoost: () => void;

  // Actions - UI
  setPlayerMode: (mode: PlayerMode) => void;
  toggleChapterList: () => void;

  // Actions - Sleep timer
  setSleepTimer: (minutes: number | null) => void;
  clearSleepTimer: () => void;

  // Actions - Lifecycle
  close: () => void;
  reset: () => void;
}

const DEFAULT_SETTINGS: AudioPlayerSettings = {
  playbackRate: 1.0,
  skipBackwardSec: 10,
  skipForwardSec: 30,
  volume: 1.0,
  isMuted: false,
  autoPlayNext: true,
  volumeBoost: false,
};

const getChapterProgressMap = (progressList: ReadingProgress[] | undefined): Record<string, AudioChapterProgress> => {
  const chapterProgressMap: Record<string, AudioChapterProgress> = {};
  if (!Array.isArray(progressList)) return chapterProgressMap;

  for (const progress of progressList) {
    const chapterID = progress.chapter_id;
    if (chapterID) {
      chapterProgressMap[chapterID] = progress;
    }
  }

  return chapterProgressMap;
};

export const useAudioPlayerStore = create<AudioPlayerState>()(
  devtools(
    subscribeWithSelector((set, get) => ({
      // Initial state
      currentSeries: null,
      currentVolume: null,
      currentVolumeId: null,
      currentChapter: null,
      chapters: [],
      chapterProgressMap: {},
      status: "idle",
      currentTime: 0,
      duration: 0,
      settings: { ...DEFAULT_SETTINGS },
      playerMode: "hidden",
      isChapterListOpen: false,
      seekVersion: 0,
      seekTarget: 0,
      sleepTimerMinutes: null,
      sleepTimerEndTime: null,

      // Content actions
      loadAndPlay: (series, chapter, chapters, volume, startTime = 0) => {
        set({
          currentSeries: series,
          currentVolume: volume ?? null,
          currentVolumeId: chapter.volume_id ?? volume?.id ?? null,
          currentChapter: chapter,
          chapters: chapters ?? [],
          chapterProgressMap: {},
          status: "loading",
          currentTime: startTime,
          duration: 0,
          playerMode: "fullscreen",
        });
      },

      bootstrapAndPlay: async ({
        source,
        seriesId,
        volumeId,
        preferredChapterId,
        preferredStartTime,
        series: initialSeries,
        volume: initialVolume,
        chapter: initialChapter,
      }) => {
        try {
          const [seriesRes, chaptersRes, progressListRes, progressRes, volumeRes] = await Promise.all([
            initialSeries ? Promise.resolve({ data: initialSeries }) : seriesAPI.get(seriesId),
            seriesAPI.getChapters(seriesId),
            seriesAPI.getProgressList(seriesId).catch(() => null),
            source === "series"
              ? seriesAPI.getProgress(seriesId).catch(() => null)
              : source === "volume" && volumeId
                ? volumeAPI.getProgress(volumeId).catch(() => null)
                : Promise.resolve(null),
            volumeId
              ? initialVolume
                ? Promise.resolve({ data: initialVolume })
                : volumeAPI.get(volumeId).catch(() => null)
              : Promise.resolve(null),
          ]);

          const series = seriesRes.data;
          const chapters: Chapter[] = chaptersRes.data.chapters || [];
          if (chapters.length === 0) {
            return { ok: false, reason: "no_chapters" };
          }

          const progressList = progressListRes?.data?.progress_list;
          const chapterProgressMap = getChapterProgressMap(progressList);
          let startChapter: Chapter | null = null;
          let startTime = preferredStartTime ?? 0;

          if (source === "series") {
            const progress = progressRes?.data?.progress as ReadingProgress | undefined;
            startChapter = progress?.chapter_id
              ? chapters.find((item) => item.id === progress.chapter_id) || chapters[0]
              : chapters[0];
            startTime = progress?.chapter_id === startChapter.id ? (progress.current_time ?? 0) : 0;
          } else if (source === "volume") {
            const progressListData = Array.isArray(progressRes?.data)
              ? (progressRes.data as ReadingProgress[])
              : ((progressRes?.data?.progress_list as ReadingProgress[] | undefined) ?? []);
            const lastProgress = progressListData[0];
            startChapter = lastProgress?.chapter_id
              ? chapters.find((item) => item.id === lastProgress.chapter_id) ||
                (volumeId ? chapters.find((item) => item.volume_id === volumeId) : undefined) ||
                chapters[0]
              : (volumeId ? chapters.find((item) => item.volume_id === volumeId) : undefined) || chapters[0];
            startTime = lastProgress?.chapter_id === startChapter.id ? (lastProgress.current_time ?? 0) : 0;
          } else {
            startChapter =
              (preferredChapterId ? chapters.find((item) => item.id === preferredChapterId) : undefined) ||
              initialChapter ||
              null;
            if (!startChapter) {
              return { ok: false, reason: "fetch_failed" };
            }
            startTime = chapterProgressMap[startChapter.id]?.current_time ?? preferredStartTime ?? 0;
          }

          if (!startChapter) {
            return { ok: false, reason: "no_chapters" };
          }

          get().loadAndPlay(series, startChapter, chapters, volumeRes?.data ?? null, startTime);
          set({ chapterProgressMap });
          return { ok: true };
        } catch (error) {
          console.error("Failed to bootstrap audio playback:", error);
          return { ok: false, reason: "fetch_failed" };
        }
      },

      updateCurrentSeries: (series) => {
        const { currentSeries } = get();
        if (currentSeries && currentSeries.id === series.id) {
          set({ currentSeries: series });
        }
      },

      playChapter: (chapter, startTime = 0) => {
        const { currentVolume } = get();
        const nextVolumeId = chapter.volume_id ?? null;
        set({
          currentVolume: currentVolume?.id === nextVolumeId ? currentVolume : null,
          currentVolumeId: nextVolumeId,
          currentChapter: chapter,
          status: "loading",
          currentTime: startTime,
          duration: 0,
        });
      },

      playChapterFromProgress: (chapter) => {
        const progress = get().chapterProgressMap[chapter.id];
        const resumeTime = isCompletedAudioChapter(chapter, progress) ? 0 : (progress?.current_time ?? 0);
        get().playChapter(chapter, resumeTime);
      },

      setChapters: (chapters) => set({ chapters }),
      setChapterProgressList: (progressList) => set({ chapterProgressMap: getChapterProgressMap(progressList) }),

      // Playback actions
      play: () => set({ status: "playing" }),
      pause: () => set({ status: "paused" }),
      togglePlay: () => {
        const { status } = get();
        if (status === "playing") set({ status: "paused" });
        else if (status === "paused" || status === "ended") set({ status: "playing" });
      },
      setStatus: (status) => set({ status }),
      setCurrentTime: (currentTime) => set({ currentTime }),
      setDuration: (duration) => set({ duration }),

      seekTo: (time) => {
        const { seekVersion } = get();
        set({ currentTime: time, seekTarget: time, seekVersion: seekVersion + 1 });
      },

      skipForward: () => {
        const { currentTime, duration, settings } = get();
        const newTime = Math.min(currentTime + settings.skipForwardSec, duration);
        get().seekTo(newTime);
      },

      skipBackward: () => {
        const { currentTime, settings } = get();
        const newTime = Math.max(currentTime - settings.skipBackwardSec, 0);
        get().seekTo(newTime);
      },

      nextChapter: () => {
        const { chapters, currentChapter } = get();
        if (!currentChapter || chapters.length === 0) return;
        const currentIndex = chapters.findIndex((c) => c.id === currentChapter.id);
        if (currentIndex >= 0 && currentIndex < chapters.length - 1) {
          get().playChapterFromProgress(chapters[currentIndex + 1]);
        }
      },

      prevChapter: () => {
        const { chapters, currentChapter, currentTime } = get();
        if (!currentChapter || chapters.length === 0) return;
        // If more than 3 seconds in, restart current chapter
        if (currentTime > 3) {
          get().seekTo(0);
          return;
        }
        const currentIndex = chapters.findIndex((c) => c.id === currentChapter.id);
        if (currentIndex > 0) {
          get().playChapterFromProgress(chapters[currentIndex - 1]);
        }
      },

      // Settings actions
      setPlaybackRate: (playbackRate) => set((state) => ({ settings: { ...state.settings, playbackRate } })),
      setVolume: (volume) => set((state) => ({ settings: { ...state.settings, volume, isMuted: false } })),
      toggleMute: () => set((state) => ({ settings: { ...state.settings, isMuted: !state.settings.isMuted } })),
      setSkipBackwardSec: (skipBackwardSec) => set((state) => ({ settings: { ...state.settings, skipBackwardSec } })),
      setSkipForwardSec: (skipForwardSec) => set((state) => ({ settings: { ...state.settings, skipForwardSec } })),
      toggleAutoPlayNext: () =>
        set((state) => ({ settings: { ...state.settings, autoPlayNext: !state.settings.autoPlayNext } })),
      toggleVolumeBoost: () =>
        set((state) => ({ settings: { ...state.settings, volumeBoost: !state.settings.volumeBoost } })),

      // UI actions
      setPlayerMode: (playerMode) => set({ playerMode }),
      toggleChapterList: () => set((state) => ({ isChapterListOpen: !state.isChapterListOpen })),

      // Sleep timer actions
      setSleepTimer: (minutes) => {
        if (minutes === null) {
          set({ sleepTimerMinutes: null, sleepTimerEndTime: null });
        } else {
          set({
            sleepTimerMinutes: minutes,
            sleepTimerEndTime: Date.now() + minutes * 60 * 1000,
          });
        }
      },
      clearSleepTimer: () => set({ sleepTimerMinutes: null, sleepTimerEndTime: null }),

      // Lifecycle actions
      close: () => set({ playerMode: "hidden", status: "paused" }),
      reset: () =>
        set({
          currentSeries: null,
          currentVolume: null,
          currentVolumeId: null,
          currentChapter: null,
          chapters: [],
          chapterProgressMap: {},
          status: "idle",
          currentTime: 0,
          duration: 0,
          playerMode: "hidden",
          isChapterListOpen: false,
          seekVersion: 0,
          seekTarget: 0,
          sleepTimerMinutes: null,
          sleepTimerEndTime: null,
        }),
    })),
    { name: "kumiho-audio-player" },
  ),
);
