import { useEffect, useRef, useCallback } from "react";
import { useAtmosphereStore } from "../../stores/atmosphereStore";
import { AMBIENT_TRACKS } from "../../constants/ambientTracks";

const AMBIENT_FADE_SECONDS = 0.5;
const AMBIENT_FADE_MS = AMBIENT_FADE_SECONDS * 1000;

type AudioContextWithWebkit = typeof AudioContext & {
  webkitAudioContext?: typeof AudioContext;
};

export function AtmosphereProvider() {
  const { isEnabled, selectedTrackId, volume, suppressedBy, timerEndAt, setEnabled, setTimer } = useAtmosphereStore();
  const isSuppressed = Object.values(suppressedBy).some(Boolean);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const currentTrackIdRef = useRef<string | null>(null);
  const decodedBufferCacheRef = useRef<Map<string, Promise<AudioBuffer> | AudioBuffer>>(new Map());
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInteractedRef = useRef(false);
  const operationTokenRef = useRef(0);

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

  const ensureAudioGraph = useCallback(() => {
    if (!audioContextRef.current) {
      const AudioContextClass = (window.AudioContext ||
        (window as unknown as AudioContextWithWebkit).webkitAudioContext) as typeof AudioContext | undefined;
      if (!AudioContextClass) {
        console.error("AudioContext is not available in this browser.");
        return null;
      }
      audioContextRef.current = new AudioContextClass();
    }
    const ctx = audioContextRef.current;
    if (!ctx) return null;

    if (!gainNodeRef.current) {
      const gain = ctx.createGain();
      gain.gain.value = 0; // 시작은 무음
      gain.connect(ctx.destination);
      gainNodeRef.current = gain;
    }

    return { ctx, gain: gainNodeRef.current };
  }, []);

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

  const stopCurrentSource = useCallback(() => {
    const source = currentSourceRef.current;
    if (!source) return;

    source.onended = null;
    try {
      source.stop();
    } catch {
      // 이미 정지된 source는 무시
    }
    source.disconnect();
    currentSourceRef.current = null;
  }, []);

  const stopAmbient = useCallback(
    ({ fadeOut, token, clearTrack }: { fadeOut: boolean; token: number; clearTrack: boolean }) => {
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current);
        fadeTimeoutRef.current = null;
      }

      if (!currentSourceRef.current) {
        if (clearTrack) currentTrackIdRef.current = null;
        return Promise.resolve();
      }

      if (!fadeOut) {
        stopCurrentSource();
        if (clearTrack) currentTrackIdRef.current = null;
        return Promise.resolve();
      }

      fadeVolume(0, AMBIENT_FADE_SECONDS);

      return new Promise<void>((resolve) => {
        fadeTimeoutRef.current = setTimeout(() => {
          fadeTimeoutRef.current = null;
          if (token !== operationTokenRef.current) {
            resolve();
            return;
          }
          stopCurrentSource();
          if (clearTrack) currentTrackIdRef.current = null;
          resolve();
        }, AMBIENT_FADE_MS);
      });
    },
    [fadeVolume, stopCurrentSource],
  );

  const loadTrackBuffer = useCallback(async (trackId: string) => {
    const cached = decodedBufferCacheRef.current.get(trackId);
    if (cached instanceof AudioBuffer) {
      return cached;
    }
    if (cached) {
      return cached;
    }

    const track = AMBIENT_TRACKS.find((item) => item.id === trackId) || AMBIENT_TRACKS[0];
    const loadingPromise = (async () => {
      const graph = ensureAudioGraph();
      if (!graph) {
        throw new Error("Audio graph is not available");
      }

      const response = await fetch(`/assets/ambient/${track.file}.m4a`);
      if (!response.ok) {
        throw new Error(`Failed to fetch ambient track: ${track.file}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const decodedBuffer = await graph.ctx.decodeAudioData(arrayBuffer);
      decodedBufferCacheRef.current.set(trackId, decodedBuffer);
      return decodedBuffer;
    })().catch((error: unknown) => {
      decodedBufferCacheRef.current.delete(trackId);
      throw error;
    });

    decodedBufferCacheRef.current.set(trackId, loadingPromise);
    return loadingPromise;
  }, [ensureAudioGraph]);

  const createLoopingSource = useCallback((buffer: AudioBuffer) => {
    const graph = ensureAudioGraph();
    if (!graph) return null;

    const source = graph.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(graph.gain);
    return source;
  }, [ensureAudioGraph]);

  // 컴포넌트 언마운트 시 오디오 및 타이머 확실히 정리
  useEffect(() => {
    return () => {
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
      stopCurrentSource();
      gainNodeRef.current?.disconnect();
      gainNodeRef.current = null;
      if (audioContextRef.current) {
        if (audioContextRef.current.state !== "closed") {
          audioContextRef.current.close().catch(console.error);
        }
        audioContextRef.current = null;
      }
    };
  }, [stopCurrentSource]);

  // 볼륨 ref (interaction 리스너에서 최신 값 참조용 - 의존성 배열에서 volume 제거)
  const volumeRef = useRef(volume);
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  // 첫 사용자 상호작용 시 오디오 컨텍스트 재개 (Autoplay 정책 대응)
  useEffect(() => {
    if (!isEnabled || isSuppressed || hasInteractedRef.current) {
      return;
    }

    const removeInteractionListeners = () => {
      window.removeEventListener("click", handleInteraction);
      window.removeEventListener("keydown", handleInteraction);
      window.removeEventListener("touchstart", handleInteraction);
    };

    const handleInteraction = () => {
      hasInteractedRef.current = true;
      removeInteractionListeners();

      const token = ++operationTokenRef.current;
      const startOnInteraction = async () => {
        const state = useAtmosphereStore.getState();
        const stillSuppressed = Object.values(state.suppressedBy).some(Boolean);
        if (!state.isEnabled || stillSuppressed) return;

        const graph = ensureAudioGraph();
        if (!graph) return;

        if (graph.ctx.state === "suspended") {
          try {
            await graph.ctx.resume();
          } catch (error) {
            console.warn("Failed to resume ambient audio context:", error);
            return;
          }
        }

        try {
          const nextTrackId =
            AMBIENT_TRACKS.find((track) => track.id === state.selectedTrackId)?.id ?? AMBIENT_TRACKS[0].id;
          const buffer = await loadTrackBuffer(nextTrackId);
          if (token !== operationTokenRef.current) return;

          stopCurrentSource();
          const source = createLoopingSource(buffer);
          if (!source) return;

          currentSourceRef.current = source;
          currentTrackIdRef.current = nextTrackId;
          source.start();
          fadeVolume(volumeRef.current, AMBIENT_FADE_SECONDS);
        } catch (error) {
          console.warn("Ambient interaction play failed:", error);
        }
      };

      void startOnInteraction();
    };

    window.addEventListener("click", handleInteraction);
    window.addEventListener("keydown", handleInteraction);
    window.addEventListener("touchstart", handleInteraction);

    return () => {
      removeInteractionListeners();
    };
  }, [isEnabled, isSuppressed, ensureAudioGraph, loadTrackBuffer, createLoopingSource, stopCurrentSource, fadeVolume]);

  // 재생/일시정지 및 트랙 전환 제어
  useEffect(() => {
    const shouldPlay = isEnabled && !isSuppressed;
    const token = ++operationTokenRef.current;

    const syncAmbientPlayback = async () => {
      if (!shouldPlay) {
        await stopAmbient({ fadeOut: true, token, clearTrack: true });
        return;
      }

      if (!hasInteractedRef.current) {
        return;
      }

      const graph = ensureAudioGraph();
      if (!graph) {
        return;
      }

      if (graph.ctx.state === "suspended") {
        try {
          await graph.ctx.resume();
        } catch (error) {
          console.warn("Failed to resume ambient audio context:", error);
          return;
        }
      }

      const isSameTrackPlaying = currentTrackIdRef.current === currentTrack.id && currentSourceRef.current;
      if (isSameTrackPlaying) {
        fadeVolume(volume, 0);
        return;
      }

      try {
        const buffer = await loadTrackBuffer(currentTrack.id);
        if (token !== operationTokenRef.current) {
          return;
        }

        // 이전 소스가 있으면 페이드아웃 후 교체
        if (currentSourceRef.current) {
          fadeVolume(0, AMBIENT_FADE_SECONDS);
          await new Promise((resolve) => {
            setTimeout(resolve, AMBIENT_FADE_MS);
          });
          if (token !== operationTokenRef.current) return;
        }

        stopCurrentSource();
        const source = createLoopingSource(buffer);
        if (!source) return;

        currentSourceRef.current = source;
        currentTrackIdRef.current = currentTrack.id;
        source.start();
        fadeVolume(volume, AMBIENT_FADE_SECONDS);
      } catch (error) {
        if (token !== operationTokenRef.current) return;
        console.warn("Failed to start ambient track:", error);
      }
    };

    void syncAmbientPlayback();

    return () => {
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    };
  }, [isEnabled, isSuppressed, currentTrack, volume, ensureAudioGraph, loadTrackBuffer, createLoopingSource, stopCurrentSource, stopAmbient, fadeVolume]);

  // 재생 중 볼륨은 즉시 반영
  useEffect(() => {
    if (!currentSourceRef.current || !isEnabled || isSuppressed) {
      return;
    }

    fadeVolume(volume, 0);
  }, [volume, isEnabled, isSuppressed, fadeVolume]);

  // 억제/비활성화 중에 남아 있는 트랙 ID 정리
  useEffect(() => {
    if (!isEnabled || isSuppressed) {
      if (!currentSourceRef.current) {
        currentTrackIdRef.current = null;
      }
    }
  }, [isEnabled, isSuppressed]);

  return null; // 헤드리스 컴포넌트
}
