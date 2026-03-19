import type { Series, Volume, ReadingProgress, SeriesProgressSummary } from "../types/series";

export interface ProgressDisplayData {
  percent: number;
  label: string;
}

/**
 * 초 단위 시간을 "H:MM:SS" 또는 "M:SS" 형태로 포맷합니다.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * 시리즈 또는 볼륨의 진행 상태를 기반으로 퍼센트와 라벨을 계산함
 */
export function calculateProgressDisplay(params: {
  type: "series" | "volume";
  series: Series;
  volume?: Volume;
  progress?: ReadingProgress;
  summary?: SeriesProgressSummary;
  preferPercentLabel?: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}): ProgressDisplayData {
  const { type, series, volume, progress, summary, preferPercentLabel = false, t } = params;
  const isVolumeType = type === "volume";
  const isAudiobook = series.library_type === "audiobook" || series.has_audio;

  // 오디오북 시리즈: 시간 기반 진행도
  if (!isVolumeType && isAudiobook && summary?.total_duration && summary.total_duration > 0) {
    const listened = Math.min(summary.listened_duration || 0, summary.total_duration);
    const total = summary.total_duration;
    const percent = Math.min(100, Math.max(0, (listened / total) * 100));
    const p = Math.floor(percent);
    const label = `${p}% (${formatDuration(listened)} / ${formatDuration(total)})`;
    return { percent, label };
  }

  // 오디오북 볼륨: current_time / duration 기반 진행도
  if (isVolumeType && isAudiobook && progress?.duration && progress.duration > 0) {
    const currentTime = progress.current_time || 0;
    const duration = progress.duration;
    const percent = Math.min(100, Math.max(0, (currentTime / duration) * 100));
    const p = Math.floor(percent);
    const label = `${p}% (${formatDuration(currentTime)} / ${formatDuration(duration)})`;
    return { percent, label };
  }

  // 1. 퍼센트 계산 로직
  let percent = 0;
  if (isVolumeType) {
    if (volume) {
      if (volume.is_completed) {
        percent = 100;
      } else if (typeof volume.progress_percent === "number") {
        // TXT/EPUB 등 가변 페이지 매체는 고정 총량과 별도로 실제 읽기 진행 퍼센트를 우선 사용
        percent = Math.min(100, Math.max(0, volume.progress_percent));
      } else if (volume.total_page_count && volume.total_page_count > 0) {
        // 일반 도서 (이미지/PDF): 전체 페이지 수 기반 계산
        percent = Math.min(100, ((volume.read_page_count || 0) / volume.total_page_count) * 100);
      } else if (progress) {
        // EPUB 도서: total_page_count가 0이므로 progress_percent(0~100) 직접 사용
        percent = Math.min(100, Math.max(0, progress.progress_percent));
      }
    }
  } else {
    if (summary?.total_pages && summary.total_pages > 0) {
      percent = Math.min(100, Math.max(0, ((summary.read_pages || 0) / summary.total_pages) * 100));
    } else if (series.total_page_count && series.total_page_count > 0) {
      // 일반 시리즈: 전체 페이지 수 기반 합산 계산
      percent = Math.min(100, Math.max(0, ((series.read_page_count || 0) / series.total_page_count) * 100));
    } else if (summary?.total_volumes && summary.current_volume_number >= 0) {
      // 볼륨 단위 진행도 (챕터 정보 부족 시 가이드용)
      percent = Math.min(100, (summary.current_volume_number / summary.total_volumes) * 100);
    } else if (progress) {
      // EPUB 시리즈: progress_percent 직접 사용
      percent = Math.min(100, Math.max(0, progress.progress_percent));
    }
  }

  // 2. 라벨 생성 로직
  let label = t("series.info.not_read");
  if (isVolumeType) {
    if (volume) {
      if (volume.is_completed) {
        label = t("series.info.completed");
      } else if (preferPercentLabel && percent > 0) {
        label = `${Math.floor(percent)}%`;
      } else if (preferPercentLabel && percent <= 0) {
        label = t("series.info.not_read");
      } else if (volume.total_page_count && volume.total_page_count > 0) {
        label = `${volume.read_page_count || 0} / ${volume.total_page_count} P`;
      } else if (progress) {
        label = `${progress.current_page} / ${progress.total_pages} P`;
      }
    }
  } else {
    if (summary?.total_pages && summary.total_pages > 0) {
      const p = Math.floor(((summary.read_pages || 0) / summary.total_pages) * 100);
      label = preferPercentLabel ? `${p}%` : `${p}% (${summary.read_pages || 0} / ${summary.total_pages} P)`;
    } else if (series.total_page_count && series.total_page_count > 0) {
      const p = Math.floor(percent);
      label = preferPercentLabel ? `${p}%` : `${p}% (${series.read_page_count || 0} / ${series.total_page_count} P)`;
    } else if (series.chapter_count && series.chapter_count > 0) {
      label = t("series.unit.chapter_count", { count: series.chapter_count });
    } else if (series.volume_count && series.volume_count > 0) {
      label = t("series.unit.volume", { count: series.volume_count });
    } else if (summary?.total_volumes) {
      label = `${summary.current_volume_number} / ${summary.total_volumes} ${t("series.unit.volume", { count: 1 }).replace(/\d+/, "").trim()}`;
    } else if (progress) {
      label = preferPercentLabel ? `${Math.floor(percent)}%` : `${progress.current_page} / ${progress.total_pages} P`;
    }
  }

  return { percent, label };
}
