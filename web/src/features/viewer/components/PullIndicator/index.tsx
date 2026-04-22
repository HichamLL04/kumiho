// 세로 모드 당김 인디케이터 컴포넌트

import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { isFullscreen as isDocumentFullscreen } from "../../../../utils/fullscreen";
import { startChapterSwitching } from "../../../../stores/fullscreenSwitchStore";
import { buildViewerRouteState } from "../../../../utils/viewerRouteState";
import styles from "./PullIndicator.module.css";

interface PullIndicatorProps {
  type: "prev" | "next";
  pullOffset: number;
  pullThreshold: number;
  chapterId: string | null;
  chapterTitle: string | null;
  saveProgress: () => Promise<void>;
  onActivate?: (type: "prev" | "next") => Promise<void> | void;
  labelText?: string;
  hintText?: string;
  ariaActionLabel?: string;
}

export function PullIndicator({
  type,
  pullOffset,
  pullThreshold,
  chapterId,
  chapterTitle,
  saveProgress,
  onActivate,
  labelText,
  hintText,
  ariaActionLabel,
}: PullIndicatorProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const viewerFrom = typeof location.state?.from === "string" ? location.state.from : undefined;
  const routeIsIncognito = location.state?.isIncognito === true;

  // 라우팅 기반 챕터 이동은 chapterId가 필요하지만, 커스텀 활성화 콜백은 chapterId 없이도 동작한다.
  if (!chapterId && !onActivate) return null;

  // 오프셋이 있으면 visible 클래스 적용
  // 작은 오프셋이라도 감지되면 일단 보여주고(opacity 1), 0이 되면 CSS transition(1s)을 통해 사라짐
  const isVisible = (type === "prev" && pullOffset > 0) || (type === "next" && pullOffset < 0);

  const handleClick = async () => {
    // visible 상태일 때만 클릭 허용 (pointer-events로 제어하지만 안전장치)
    if (!isVisible) return;

    if (onActivate) {
      try {
        await onActivate(type);
      } catch (err) {
        console.warn("Failed to activate pull indicator", err);
      }
      return;
    }

    await saveProgress().catch((err) => console.warn("Failed to save progress", err));
    startChapterSwitching(isDocumentFullscreen());
    if (type === "prev") {
      navigate(`/viewer/${chapterId}?page=last`, {
        state: buildViewerRouteState({ from: viewerFrom, isIncognito: routeIsIncognito }),
      });
    } else {
      navigate(`/viewer/${chapterId}`, {
        state: buildViewerRouteState({ from: viewerFrom, isIncognito: routeIsIncognito }),
      });
    }
  };

  const progress = Math.min(100, Math.round((Math.abs(pullOffset) / pullThreshold) * 100));
  const defaultLabelText = type === "prev" ? t("viewer.guide.scroll_prev_label") : t("viewer.guide.scroll_next_label");
  const defaultHintText = type === "prev" ? t("viewer.guide.scroll_prev_hint") : t("viewer.guide.scroll_next_hint");
  const defaultAriaActionLabel =
    type === "prev" ? t("viewer.guide.aria_prev_chapter") : t("viewer.guide.aria_next_chapter");

  return (
    <button
      type="button"
      className={`${styles.pullIndicator} ${styles[type]} ${isVisible ? styles.visible : ""}`}
      style={{
        transform:
          type === "prev"
            ? `translateY(${Math.min(0, -15 + Math.abs(pullOffset) / 4)}px)`
            : `translateY(${Math.max(0, 15 - Math.abs(pullOffset) / 4)}px)`,
      }}
      onClick={handleClick}
      aria-label={`${ariaActionLabel ?? defaultAriaActionLabel}: ${chapterTitle || t("viewer.guide.no_title")}`}
    >
      <div className={styles.content}>
        <span className={styles.label}>
          {labelText ?? defaultLabelText} ({progress}%)
        </span>
        <span className={styles.title}>{chapterTitle || t("viewer.guide.no_title")}</span>
        <span className={styles.hint}>{hintText ?? defaultHintText}</span>
      </div>
    </button>
  );
}
