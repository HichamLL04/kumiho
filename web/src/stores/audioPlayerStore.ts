import { create } from "zustand";
import { devtools, subscribeWithSelector } from "zustand/middleware";
import type { Series, Volume, Chapter, ReadingProgress } from "../types/series";

export type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "ended" | "error";
export type PlayerMode = "fullscreen" | "sidebar" | "mini" | "hidden";

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
  updateCurrentSeries: (series: Series) => void;
  playChapter: (chapter: Chapter, startTime?: number) => void;
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

      setChapters: (chapters) => set({ chapters }),
      setChapterProgressList: (progressList) => {
        const chapterProgressMap: Record<string, AudioChapterProgress> = {};
        for (const progress of progressList) {
          const chapterID = progress.chapter_id;
          if (chapterID) {
            chapterProgressMap[chapterID] = progress;
          }
        }
        set({ chapterProgressMap });
      },

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
          get().playChapter(chapters[currentIndex + 1]);
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
          get().playChapter(chapters[currentIndex - 1]);
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
