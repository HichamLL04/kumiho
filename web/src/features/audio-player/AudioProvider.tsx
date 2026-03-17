import { useEffect, useRef, useCallback } from "react";
import { useAudioPlayerStore } from "../../stores/audioPlayerStore";
import { chapterAPI } from "../../api/client";
import { seriesAPI } from "../../api/client";

const PROGRESS_SAVE_INTERVAL = 10_000; // 10초마다 진행률 저장

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
  const saveProgress = useCallback((isFinished: boolean = false) => {
    const { currentChapter, currentTime, duration, currentSeries } = store.getState();
    if (!currentChapter || !currentSeries || currentTime <= 0) return;
    // 마지막 저장 시점과 동일하면 스킵 (단, 완료 시점은 무조건 저장)
    if (!isFinished && Math.abs(currentTime - lastSavedTimeRef.current) < 1) return;

    lastSavedTimeRef.current = currentTime;

    const progressValue = isFinished ? 100 : duration > 0 ? (currentTime / duration) * 100 : 0;
    const timeValue = isFinished && duration > 0 ? duration : currentTime;

    seriesAPI
      .updateProgress(currentSeries.id, {
        chapter_id: currentChapter.id,
        current_page: 0,
        total_pages: 0,
        current_time: timeValue,
        duration: duration,
        progress_percent: Math.min(100, progressValue),
      })
      .catch((err) => {
        console.warn("Failed to save audio progress:", err);
      });
  }, []);

  // 챕터 변경 감지 → 오디오 소스 교체
  useEffect(() => {
    const unsub = store.subscribe((state, prevState) => {
      const audio = audioRef.current;
      if (!audio) return;

      const isSameChapter = state.currentChapter?.id === prevState.currentChapter?.id;
      const chapterChanged = state.currentChapter?.id !== prevState.currentChapter?.id;

      // 챕터가 실제로 변경되었거나, 동일 챕터인데 status가 loading으로 명시적으로 바뀐 경우 (이어보기 등)
      if (
        state.currentChapter &&
        (chapterChanged || (isSameChapter && state.status === "loading" && prevState.status !== "loading"))
      ) {
        // 이전 챕터 진행률 저장
        if (prevState.currentChapter && prevState.status === "playing") {
          saveProgress();
        }

        const audioUrl = chapterAPI.getAudioUrl(state.currentChapter.id);
        const token = localStorage.getItem("access_token");
        const fullSrc = token ? `${audioUrl}?token=${token}` : audioUrl;

        // 소스가 다른 경우에만 새로 로드하여 불필요한 중단 방지
        if (audio.src !== fullSrc || audio.error) {
          audio.pause();
          audio.src = fullSrc;
          audio.load();

          // 신규 로드 시, 전달받은 startTime이 있다면 미리 lastSavedTimeRef에 반영하여 저장 시점 보호
          if (state.currentTime > 0) {
            lastSavedTimeRef.current = state.currentTime;

            const seekToStart = () => {
              audio.currentTime = state.currentTime;
              audio.removeEventListener("canplay", seekToStart);
              audio.removeEventListener("loadedmetadata", seekToStart);
            };
            audio.addEventListener("loadedmetadata", seekToStart);
            audio.addEventListener("canplay", seekToStart);
          }
        } else if (state.status === "loading") {
          // 이미 소스가 같다면 (동일 챕터 이어보기), readyState를 확인하여 즉시 재생 상태로 넘김
          if (audio.readyState >= 3) {
            // HAVE_FUTURE_DATA 이상
            if (state.currentTime > 0 && Math.abs(audio.currentTime - state.currentTime) > 1.5) {
              lastSavedTimeRef.current = state.currentTime;
              audio.currentTime = state.currentTime;
            }
            store.getState().setStatus("playing");
          }
        }

        // 서버의 최신 진행률로 다시 한번 복원 시도 (지연 실행하여 로드 시점과 맞춤)
        setTimeout(() => {
          void restoreProgress(state.currentChapter!.id, state.currentSeries?.id);
        }, 100);
      }
    });
    return unsub;
  }, [saveProgress]);

  // 이전 진행률 복원
  const restoreProgress = async (chapterId: string, seriesId?: string | null) => {
    if (!seriesId) return;
    try {
      const res = await seriesAPI.getProgress(seriesId);
      const prog = res.data?.progress;
      if (prog && prog.chapter_id === chapterId) {
        const seekTime = prog.current_time ?? prog.current_page;
        if (seekTime > 0) {
          const audio = audioRef.current;
          if (audio) {
            // 복원될 시간을 미리 저장 시점에 반영하여, 0초가 서버로 나가는 것을 방지
            lastSavedTimeRef.current = seekTime;

            const applySeek = () => {
              // 중복 리스너 방지를 위해 제거
              audio.removeEventListener("canplay", applySeek);
              audio.removeEventListener("loadedmetadata", applySeek);

              if (Math.abs(audio.currentTime - seekTime) > 1.5) {
                audio.currentTime = seekTime;
              }
            };

            if (audio.readyState >= 1) {
              applySeek();
            } else {
              audio.addEventListener("loadedmetadata", applySeek);
              audio.addEventListener("canplay", applySeek);
            }
          }
        }
      }
    } catch (err) {
      console.warn("Failed to restore audio progress:", err);
    }
  };

  // 재생/일시정지 상태 동기화
  useEffect(() => {
    const unsub = store.subscribe((state, prevState) => {
      const audio = audioRef.current;
      if (!audio) return;

      if (state.status !== prevState.status) {
        if (state.status === "playing") {
          // play()는 이미 소스가 로드된 상태여야 함 (onCanPlay 등에서 처리되지만 안전장치)
          if (audio.paused) {
            audio.play().catch((err) => {
              console.warn("Audio play failed:", err);
              // user interaction이 필요한 경우 error 상태로 대기
              if (err.name !== "AbortError") {
                store.getState().setStatus("error");
              }
            });
          }
        } else if (state.status === "paused") {
          if (!audio.paused) {
            audio.pause();
          }
        }
      }
    });
    return unsub;
  }, []);

  // Seek 요청 감지 (seekVersion 변경)
  useEffect(() => {
    const unsub = store.subscribe((state) => {
      const audio = audioRef.current;
      if (!audio) return;

      if (state.seekVersion > lastSeekVersionRef.current) {
        lastSeekVersionRef.current = state.seekVersion;
        if (audio.readyState >= 1) {
          audio.currentTime = state.seekTarget;
        }
      }
    });
    return unsub;
  }, []);

  // 설정 동기화 (playbackRate, volume, mute)
  useEffect(() => {
    const unsub = store.subscribe((state, prevState) => {
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
    });
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
      const { status, settings, currentTime } = store.getState();
      // 설정 적용
      audio.playbackRate = settings.playbackRate;
      audio.volume = settings.volume;
      audio.muted = settings.isMuted;

      // 로딩 중이었다면, 스토어에 보관된 서버 진행도를 실제 오디오에 주입 (정밀 복원)
      if (status === "loading") {
        if (currentTime > 0 && Math.abs(audio.currentTime - currentTime) > 1) {
          audio.currentTime = currentTime;
        }

        audio
          .play()
          .then(() => {
            store.getState().setStatus("playing");
          })
          .catch(() => {
            store.getState().setStatus("error");
          });
      }
    };

    const onTimeUpdate = () => {
      const { status } = store.getState();
      // 로딩 중일 때는 브라우저가 보고하는 초기값(0초 등)이 스토어(서버 데이터)를 덮어쓰지 않도록 차단
      if (status !== "loading") {
        store.getState().setCurrentTime(audio.currentTime);
      }
    };

    const onEnded = () => {
      store.getState().setStatus("ended");
      saveProgress(true);

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
    const unsub = store.subscribe((state, prevState) => {
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
    });
    return () => {
      unsub();
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
      }
    };
  }, [saveProgress]);

  // 수면 타이머
  useEffect(() => {
    const unsub = store.subscribe((state, prevState) => {
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
    });
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

    const unsub = store.subscribe((state, prevState) => {
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
    });

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
