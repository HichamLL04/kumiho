import { useEffect, useRef, useCallback } from "react";
import { useAtmosphereStore } from "../../stores/atmosphereStore";
import { AMBIENT_TRACKS } from "../../constants/ambientTracks";

export function AtmosphereProvider() {
  const { isEnabled, selectedTrackId, volume, isSuppressed } = useAtmosphereStore();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackChangeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 현재 선택된 트랙 정보 (존재하지 않으면 첫 번째 트랙으로 폴백)
  const currentTrack = AMBIENT_TRACKS.find((t) => t.id === selectedTrackId) || AMBIENT_TRACKS[0];

  // Web Audio Context 및 GainNode 초기화
  const initAudioContext = useCallback(() => {
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
  }, []);

  // 페이드 인/아웃 처리
  const fadeVolume = useCallback((targetVolume: number, duration: number) => {
    const ctx = audioContextRef.current;
    const gainNode = gainNodeRef.current;
    if (!ctx || !gainNode) return;

    if (ctx.state === "suspended") ctx.resume();

    const gainParam = gainNode.gain;
    const currentTime = ctx.currentTime;

    gainParam.cancelScheduledValues(currentTime);

    if (duration > 0) {
      // 0.5s 등의 긴 페이드(온/오프용)에만 지수적 페이드 적용
      gainParam.setTargetAtTime(targetVolume, currentTime, duration / 4);
    } else {
      // 그 외(볼륨 조절 등)에는 지연 없이 즉시 변경 (사용자 요청에 따라 팝 방지 제거)
      gainParam.setValueAtTime(targetVolume, currentTime);
    }
  }, []);

  // 컴포넌트 언마운트 시 오디오 및 타이머 확실히 정리
  useEffect(() => {
    const audio = audioRef.current;
    const ctx = audioContextRef.current;
    const fTimeout = fadeTimeoutRef.current;
    const tTimeout = trackChangeTimeoutRef.current;

    return () => {
      if (audio) {
        audio.pause();
        audio.src = "";
      }
      if (fTimeout) clearTimeout(fTimeout);
      if (tTimeout) clearTimeout(tTimeout);
      if (ctx) {
        ctx.close().catch(console.error);
      }
    };
  }, []);

  // 재생/일시정지 및 트랙 전환 제어
  useEffect(() => {
    const shouldPlay = isEnabled && !isSuppressed;
    const { audio, ctx } = initAudioContext();
    const fTimeout = fadeTimeoutRef.current;
    const tTimeout = trackChangeTimeoutRef.current;

    if (shouldPlay) {
      if (currentTrack) {
        const trackUrl = `/assets/ambient/${currentTrack.file}.opus`;
        const fullTrackUrl = window.location.origin + trackUrl;

        // 다른 트랙으로 변경되면 즉시 교체 (사용자 요청에 따라 롤백: 지연/페이드 없이 바로 교체)
        if (audio.src !== fullTrackUrl) {
          audio.src = trackUrl;
          audio.load();
        }

        if (ctx.state === "suspended") ctx.resume();
        if (audio.paused) {
          audio
            .play()
            .then(() => {
              // 켜질 때는 부드럽게 페이드 인 (0.5s)
              fadeVolume(volume, 0.5);
            })
            .catch((e) => console.warn("Ambient play failed:", e));
        } else {
          // 이미 재생 중일 때 볼륨 변화가 있으면 즉각 반영
          fadeVolume(volume, 0);
        }
      }
    } else {
      // 꺼질 때 페이드 아웃 후 정지 (0.5s)
      fadeVolume(0, 0.5);
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
      fadeTimeoutRef.current = setTimeout(() => {
        if (!isEnabled || isSuppressed) {
          audio.pause();
        }
      }, 500);
    }

    return () => {
      if (fTimeout) clearTimeout(fTimeout);
      if (tTimeout) clearTimeout(tTimeout);
    };
  }, [isEnabled, isSuppressed, selectedTrackId, initAudioContext, fadeVolume, currentTrack, volume]);

  return null; // 헤드리스 컴포넌트
}
