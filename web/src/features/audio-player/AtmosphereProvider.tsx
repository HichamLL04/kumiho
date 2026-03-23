import { useEffect, useRef, useCallback } from "react";
import { useAtmosphereStore } from "../../stores/atmosphereStore";
import { AMBIENT_TRACKS } from "../../constants/ambientTracks";

export function AtmosphereProvider() {
  const { isEnabled, selectedTrackId, volume, suppressedBy, timerEndAt, setEnabled, setTimer } = useAtmosphereStore();
  const isSuppressed = Object.values(suppressedBy).some(Boolean);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackChangeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 현재 선택된 트랙 정보 (존재하지 않으면 첫 번째 트랙으로 폴백)
  const currentTrack = AMBIENT_TRACKS.find((t) => t.id === selectedTrackId) || AMBIENT_TRACKS[0];

  // 타이머 종료 감지 로직
  useEffect(() => {
    if (!isEnabled || timerEndAt === null) return;

    const checkTimer = () => {
      const now = Date.now();
      if (now >= timerEndAt) {
        setEnabled(false);
        setTimer(null);
      }
    };

    // 10초마다 체크 (성능과 정확도의 균형)
    const interval = setInterval(checkTimer, 10000);
    checkTimer(); // 즉시 한 번 체크

    return () => clearInterval(interval);
  }, [isEnabled, timerEndAt, setEnabled, setTimer]);

  // Web Audio Context 및 GainNode 초기화
  const initAudioContext = useCallback(() => {
    // 기능이 꺼져있거나 억제된 상태라면 초기화하지 않음
    if (!isEnabled || isSuppressed) {
      return null;
    }

    if (!audioContextRef.current) {
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContextRef.current = new AudioContextClass();
    }
    const ctx = audioContextRef.current;

    if (!audioRef.current) {
      const audio = new Audio();
      audio.loop = true;
      audio.crossOrigin = "anonymous";
      audioRef.current = audio;
    }

    if (!gainNodeRef.current) {
      const gain = ctx.createGain();
      gain.gain.value = 0; // 시작은 무음
      gain.connect(ctx.destination);
      gainNodeRef.current = gain;
    }

    if (!sourceNodeRef.current && audioRef.current && gainNodeRef.current) {
      try {
        const source = ctx.createMediaElementSource(audioRef.current);
        source.connect(gainNodeRef.current);
        sourceNodeRef.current = source;
      } catch (e) {
        console.error("Failed to create MediaElementSource:", e);
      }
    }

    return { ctx, gain: gainNodeRef.current!, audio: audioRef.current! };
  }, [isEnabled, isSuppressed]);

  // 페이드 인/아웃 처리
  const fadeVolume = useCallback((targetVolume: number, duration: number) => {
    const ctx = audioContextRef.current;
    const gainNode = gainNodeRef.current;
    if (!ctx || !gainNode) return;

    if (ctx.state === "suspended") void ctx.resume().catch(console.error);

    const gainParam = gainNode.gain;
    const currentTime = ctx.currentTime;

    gainParam.cancelScheduledValues(currentTime);

    if (duration > 0) {
      // 0.5s 등의 긴 페이드(온/오프용)에만 지수적 페이드 적용
      gainParam.setTargetAtTime(targetVolume, currentTime, duration / 4);
    } else {
      // 그 외(볼륨 조절 등)에는 지연 없이 즉시 변경
      gainParam.setValueAtTime(targetVolume, currentTime);
    }
  }, []);

  // 컴포넌트 언마운트 시 오디오 및 타이머 확실히 정리
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
      if (trackChangeTimeoutRef.current) clearTimeout(trackChangeTimeoutRef.current);
      if (audioContextRef.current) {
        if (audioContextRef.current.state !== "closed") {
          audioContextRef.current.close().catch(console.error);
        }
        audioContextRef.current = null;
      }
    };
  }, []);

  // 볼륨 ref (interaction 리스너에서 최신 값 참조용 - 의존성 배열에서 volume 제거)
  const volumeRef = useRef(volume);
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  // 첫 사용자 상호작용 시 오디오 컨텍스트 재개 (Autoplay 정책 대응)
  useEffect(() => {
    if (!isEnabled || isSuppressed) {
      return;
    }

    const handleInteraction = () => {
      const initialized = initAudioContext();
      if (!initialized) return;

      const { ctx, audio } = initialized;
      if (ctx.state === "suspended") void ctx.resume().catch(console.error);

      if (audio.paused) {
        if (!audio.src) {
          return;
        }

        audio
          .play()
          .then(() => {
            fadeVolume(volumeRef.current, 0.5);
            window.removeEventListener("click", handleInteraction);
            window.removeEventListener("keydown", handleInteraction);
            window.removeEventListener("touchstart", handleInteraction);
          })
          .catch((e: unknown) => console.warn("Interaction play failed:", e));
        return;
      }

      window.removeEventListener("click", handleInteraction);
      window.removeEventListener("keydown", handleInteraction);
      window.removeEventListener("touchstart", handleInteraction);
    };

    window.addEventListener("click", handleInteraction);
    window.addEventListener("keydown", handleInteraction);
    window.addEventListener("touchstart", handleInteraction);

    return () => {
      window.removeEventListener("click", handleInteraction);
      window.removeEventListener("keydown", handleInteraction);
      window.removeEventListener("touchstart", handleInteraction);
    };
  }, [isEnabled, isSuppressed, initAudioContext, fadeVolume]);

  // 재생/일시정지 및 트랙 전환 제어
  useEffect(() => {
    const shouldPlay = isEnabled && !isSuppressed;

    // 이전 트랙 변경 타이머 정리
    if (trackChangeTimeoutRef.current) clearTimeout(trackChangeTimeoutRef.current);

    if (shouldPlay) {
      const initialized = initAudioContext();
      if (initialized && currentTrack) {
        const { audio, ctx } = initialized;
        const trackUrl = `/assets/ambient/${currentTrack.file}.opus`;
        const fullTrackUrl = window.location.origin + trackUrl;

        // 다른 트랙으로 변경되는 경우 (전환 페이드 적용)
        if (audio.src !== fullTrackUrl && audio.src !== "" && !audio.paused) {
          // 1. 현재 트랙 페이드 아웃 (0.5s)
          fadeVolume(0, 0.5);
          trackChangeTimeoutRef.current = setTimeout(() => {
            // 2. 소스 교체 및 로드
            audio.src = trackUrl;
            audio.load();
            // 3. 새 트랙 재생 및 페이드 인 (0.5s)
            audio
              .play()
              .then(() => {
                fadeVolume(volume, 0.5);
              })
              .catch((e: unknown) => {
                console.warn("Track switch play failed (normal if not interacted):", e);
              });
          }, 600);
        } else {
          // 초기 시작, 정지 상태에서 트랙 변경, 또는 동일 트랙
          if (audio.src !== fullTrackUrl) {
            audio.src = trackUrl;
            audio.load();
          }

          if (ctx.state === "suspended") void ctx.resume().catch(console.error);
          if (audio.paused) {
            audio
              .play()
              .then(() => {
                // 처음 켜질 때 부드럽게 페이드 인 (0.5s)
                fadeVolume(volume, 0.5);
              })
              .catch((e: unknown) => {
                console.warn("Ambient initial play failed (normal if not interacted):", e);
              });
          } else {
            // 이미 재생 중일 때 볼륨 변화가 있으면 즉각 반영 (지연 없음)
            fadeVolume(volume, 0);
          }
        }
      }
    } else if (gainNodeRef.current) {
      // 꺼질 때 페이드 아웃 후 정지 (AudioContext가 초기화된 경우에만)
      fadeVolume(0, 0.5);
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
      fadeTimeoutRef.current = setTimeout(() => {
        // 페이드 중 다시 켜졌을 수 있으므로 최신 상태 확인
        const state = useAtmosphereStore.getState();
        const stillSuppressed = Object.values(state.suppressedBy).some(Boolean);
        if (!state.isEnabled || stillSuppressed) {
          audioRef.current?.pause();
        }
      }, 600);
    }

    return () => {
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
      if (trackChangeTimeoutRef.current) clearTimeout(trackChangeTimeoutRef.current);
    };
  }, [isEnabled, isSuppressed, selectedTrackId, initAudioContext, fadeVolume, currentTrack, volume]);

  return null; // 헤드리스 컴포넌트
}
