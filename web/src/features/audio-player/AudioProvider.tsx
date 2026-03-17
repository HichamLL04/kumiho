import { useEffect, useRef, useCallback } from "react";
import { useAudioPlayerStore } from "../../stores/audioPlayerStore";
import { chapterAPI } from "../../api/client";
import { seriesAPI } from "../../api/client";

const PROGRESS_SAVE_INTERVAL = 30_000; // 30초마다 진행률 저장

export function AudioProvider() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSeekVersionRef = useRef(0);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSavedTimeRef = useRef(0);
  const sleepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const store = useAudioPlayerStore;

  // Audio element 초기화 (최초 1회)
  useEffect(() => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = "metadata";
      audioRef.current = audio;
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
      }
      if (sleepTimerRef.current) {
        clearInterval(sleepTimerRef.current);
      }
      if (fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
      }
    };
  }, []);

  // 진행률 저장
  const saveProgress = useCallback(() => {
    const { currentChapter, currentTime, duration, currentSeries } = store.getState();
    if (!currentChapter || !currentSeries || currentTime <= 0) return;
    // 마지막 저장 시점과 동일하면 스킵
    if (Math.abs(currentTime - lastSavedTimeRef.current) < 1) return;

    lastSavedTimeRef.current = currentTime;

    const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

    seriesAPI.updateProgress(currentSeries.id, {
      chapter_id: currentChapter.id,
      current_page: 0,
      total_pages: 0,
      current_time: currentTime,
      duration: duration,
      progress_percent: Math.min(100, progressPercent),
    }).catch((err) => {
      console.warn("Failed to save audio progress:", err);
    });
  }, []);

  // 챕터 변경 감지 → 오디오 소스 교체
  useEffect(() => {
    const unsub = store.subscribe(
      (state, prevState) => {
        const audio = audioRef.current;
        if (!audio) return;

        // 챕터 변경 감지
        if (state.currentChapter?.id !== prevState.currentChapter?.id && state.currentChapter) {
          // 이전 챕터 진행률 저장
          if (prevState.currentChapter && prevState.status === "playing") {
            saveProgress();
          }

          const audioUrl = chapterAPI.getAudioUrl(state.currentChapter.id);
          const token = localStorage.getItem("access_token");

          // 이전 소스 정리
          audio.pause();
          audio.src = token ? `${audioUrl}?token=${token}` : audioUrl;
          audio.load();

          // 이전 진행률 복원 시도
          void restoreProgress(state.currentChapter.id, state.currentSeries?.id);
        }
      },
    );
    return unsub;
  }, [saveProgress]);

  // 이전 진행률 복원
  const restoreProgress = async (chapterId: string, seriesId?: string | null) => {
    if (!seriesId) return;
    try {
      const res = await seriesAPI.getProgress(seriesId);
      const prog = res.data?.progress;
      if (prog && prog.chapter_id === chapterId) {
        // current_time(float 초)을 우선 사용, 없으면 current_page(정수 초) 폴백
        const seekTime = prog.current_time ?? prog.current_page;
        if (seekTime > 0) {
          const audio = audioRef.current;
          if (audio) {
            const seekToSaved = () => {
              audio.currentTime = seekTime;
              audio.removeEventListener("loadedmetadata", seekToSaved);
            };
            if (audio.readyState >= 1) {
              audio.currentTime = seekTime;
            } else {
              audio.addEventListener("loadedmetadata", seekToSaved);
            }
          }
        }
      }
    } catch {
      // 진행률 없으면 처음부터 재생
    }
  };

  // 재생/일시정지 상태 동기화
  useEffect(() => {
    const unsub = store.subscribe(
      (state, prevState) => {
        const audio = audioRef.current;
        if (!audio) return;

        if (state.status !== prevState.status) {
          if (state.status === "playing") {
            audio.play().catch(() => {
              store.getState().setStatus("error");
            });
          } else if (state.status === "paused") {
            audio.pause();
          }
        }
      },
    );
    return unsub;
  }, []);

  // Seek 요청 감지 (seekVersion 변경)
  useEffect(() => {
    const unsub = store.subscribe(
      (state) => {
        const audio = audioRef.current;
        if (!audio) return;

        if (state.seekVersion > lastSeekVersionRef.current) {
          lastSeekVersionRef.current = state.seekVersion;
          if (audio.readyState >= 1) {
            audio.currentTime = state.seekTarget;
          }
        }
      },
    );
    return unsub;
  }, []);

  // 설정 동기화 (playbackRate, volume, mute)
  useEffect(() => {
    const unsub = store.subscribe(
      (state, prevState) => {
        const audio = audioRef.current;
        if (!audio) return;

        if (state.settings.playbackRate !== prevState.settings.playbackRate) {
          audio.playbackRate = state.settings.playbackRate;
        }
        if (state.settings.volume !== prevState.settings.volume) {
          audio.volume = state.settings.volume;
        }
        if (state.settings.isMuted !== prevState.settings.isMuted) {
          audio.muted = state.settings.isMuted;
        }
      },
    );
    return unsub;
  }, []);

  // Audio element 이벤트 핸들러
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoadedMetadata = () => {
      store.getState().setDuration(audio.duration);
    };

    const onCanPlay = () => {
      const { status, settings } = store.getState();
      // 설정 적용
      audio.playbackRate = settings.playbackRate;
      audio.volume = settings.volume;
      audio.muted = settings.isMuted;

      if (status === "loading") {
        audio.play().then(() => {
          store.getState().setStatus("playing");
        }).catch(() => {
          store.getState().setStatus("error");
        });
      }
    };

    const onTimeUpdate = () => {
      store.getState().setCurrentTime(audio.currentTime);
    };

    const onEnded = () => {
      store.getState().setStatus("ended");
      saveProgress();

      // 다음 챕터 자동 재생
      const { chapters, currentChapter } = store.getState();
      if (!currentChapter || chapters.length === 0) return;
      const currentIndex = chapters.findIndex((c) => c.id === currentChapter.id);
      if (currentIndex >= 0 && currentIndex < chapters.length - 1) {
        store.getState().playChapter(chapters[currentIndex + 1]);
      }
    };

    const onError = () => {
      store.getState().setStatus("error");
    };

    const onPlay = () => {
      const { status } = store.getState();
      if (status !== "playing") {
        store.getState().setStatus("playing");
      }
    };

    const onPause = () => {
      const { status } = store.getState();
      if (status === "playing") {
        store.getState().setStatus("paused");
      }
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [saveProgress]);

  // 30초 간격 자동 저장
  useEffect(() => {
    const unsub = store.subscribe(
      (state, prevState) => {
        if (state.status === "playing" && prevState.status !== "playing") {
          // 재생 시작 → 타이머 시작
          if (progressTimerRef.current) clearInterval(progressTimerRef.current);
          progressTimerRef.current = setInterval(saveProgress, PROGRESS_SAVE_INTERVAL);
        } else if (state.status !== "playing" && prevState.status === "playing") {
          // 재생 중단 → 타이머 정리 + 즉시 저장
          if (progressTimerRef.current) {
            clearInterval(progressTimerRef.current);
            progressTimerRef.current = null;
          }
          saveProgress();
        }

        // 플레이어 닫힘 (hidden) → 즉시 저장
        if (state.playerMode === "hidden" && prevState.playerMode !== "hidden") {
          saveProgress();
        }
      },
    );
    return () => {
      unsub();
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
      }
    };
  }, [saveProgress]);

  // 수면 타이머
  useEffect(() => {
    const unsub = store.subscribe(
      (state, prevState) => {
        const endTimeChanged = state.sleepTimerEndTime !== prevState.sleepTimerEndTime;
        if (!endTimeChanged) return;

        // 기존 타이머 정리
        if (sleepTimerRef.current) {
          clearInterval(sleepTimerRef.current);
          sleepTimerRef.current = null;
        }

        if (state.sleepTimerEndTime) {
          sleepTimerRef.current = setInterval(() => {
            const { sleepTimerEndTime, status } = store.getState();
            if (!sleepTimerEndTime) {
              if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
              return;
            }

            if (Date.now() >= sleepTimerEndTime && status === "playing") {
              // 페이드아웃 후 정지
              fadeOutAndPause();
              store.getState().clearSleepTimer();
              if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
            }
          }, 1000);
        }
      },
    );
    return () => {
      unsub();
      if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
    };
  }, []);

  // 페이드아웃 (2초간 볼륨 점점 줄임)
  const fadeOutAndPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const originalVolume = audio.volume;
    const steps = 20;
    const stepDuration = 2000 / steps;
    let currentStep = 0;

    if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current);

    fadeIntervalRef.current = setInterval(() => {
      currentStep++;
      audio.volume = Math.max(0, originalVolume * (1 - currentStep / steps));

      if (currentStep >= steps) {
        if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current);
        store.getState().pause();
        // 볼륨 복원
        audio.volume = originalVolume;
      }
    }, stepDuration);
  }, []);

  // beforeunload 시 즉시 저장
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveProgress();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [saveProgress]);

  // MediaSession API (잠금화면/노티피케이션 컨트롤)
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    const unsub = store.subscribe(
      (state, prevState) => {
        const chapterChanged = state.currentChapter?.id !== prevState.currentChapter?.id;
        const seriesChanged = state.currentSeries?.id !== prevState.currentSeries?.id;

        if (chapterChanged || seriesChanged) {
          const { currentSeries, currentChapter } = state;
          if (!currentSeries || !currentChapter) return;

          navigator.mediaSession.metadata = new MediaMetadata({
            title: currentChapter.title || `Chapter ${currentChapter.chapter_number}`,
            artist: currentSeries.author || currentSeries.title,
            album: currentSeries.title,
            artwork: currentSeries.thumbnail_url
              ? [{ src: currentSeries.thumbnail_url, sizes: "512x512", type: "image/jpeg" }]
              : [],
          });
        }
      },
    );

    navigator.mediaSession.setActionHandler("play", () => store.getState().play());
    navigator.mediaSession.setActionHandler("pause", () => store.getState().pause());
    navigator.mediaSession.setActionHandler("previoustrack", () => store.getState().prevChapter());
    navigator.mediaSession.setActionHandler("nexttrack", () => store.getState().nextChapter());
    navigator.mediaSession.setActionHandler("seekbackward", () => store.getState().skipBackward());
    navigator.mediaSession.setActionHandler("seekforward", () => store.getState().skipForward());

    return unsub;
  }, []);

  // 렌더링 없음 (headless component)
  return null;
}
