import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type {
  EpubFlow,
  EpubFontFamily,
  EpubRenderMode,
  EpubViewerSettings,
  EpubTheme,
} from "../../../../stores/epubViewerStore";
import { EPUB_LINE_HEIGHT_SCALE_DEFAULT, EPUB_LINE_HEIGHT_SCALE_MAX, EPUB_LINE_HEIGHT_SCALE_MIN } from "../../../../stores/epubViewerStore";
import styles from "./EpubSettingsPanel.module.css";

interface EpubSettingsPanelProps {
  settings: EpubViewerSettings;
  onFontSizeChange: (size: number) => void;
  onFontFamilyChange: (family: EpubFontFamily) => void;
  onLineHeightChange: (height: number) => void;
  onThemeChange: (theme: EpubTheme) => void;
  onRenderModeChange: (mode: EpubRenderMode) => void;
  onFlowChange: (flow: EpubFlow) => void;
  onSpreadChange: (spread: "auto" | "none") => void;
  onWheelDirectionChange: (direction: "down" | "up") => void;
  onKeyboardDirectionChange: (direction: "right" | "left") => void;
  onClickDirectionChange: (direction: "right" | "left") => void;
  onClose: () => void;
  isTypographyControlLimited?: boolean;
}

export function EpubSettingsPanel({
  settings,
  onFontSizeChange,
  onFontFamilyChange,
  onLineHeightChange,
  onThemeChange,
  onRenderModeChange,
  onFlowChange,
  onSpreadChange,
  onWheelDirectionChange,
  onKeyboardDirectionChange,
  onClickDirectionChange,
  onClose,
  isTypographyControlLimited = false,
}: EpubSettingsPanelProps) {
  const { t } = useTranslation();
  const isOriginalFontSize = settings.fontSize === 100;
  const isOriginalLineHeight = Math.abs(settings.lineHeight - EPUB_LINE_HEIGHT_SCALE_DEFAULT) < 0.001;
  const fontSizeValueLabel = isOriginalFontSize ? t("epub_viewer.settings.font_size.original", { defaultValue: "원본" }) : `${settings.fontSize}%`;
  const lineHeightValueLabel = isOriginalLineHeight
    ? t("epub_viewer.settings.line_height.original", { defaultValue: "원본" })
    : `${settings.lineHeight.toFixed(2)}x`;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>{t("epub_viewer.settings.title")}</h3>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label={t("common.close", { defaultValue: "닫기" })}
          title={t("common.close", { defaultValue: "닫기" })}
        >
          <X
            size={16}
            aria-hidden="true"
          />
        </button>
      </div>

      <div className={styles.content}>
        {/* 보기 모드 */}
        <div className={styles.section}>
          <label
            className={styles.label}
            htmlFor="render-mode-select"
          >
            {t("epub_viewer.settings.render_mode.label")}
          </label>
          <select
            id="render-mode-select"
            className={styles.select}
            value={settings.renderMode}
            onChange={(e) => onRenderModeChange(e.target.value as EpubRenderMode)}
          >
            <option value="auto">{t("epub_viewer.settings.render_mode.auto")}</option>
            <option value="book">{t("epub_viewer.settings.render_mode.book")}</option>
            <option value="comic">{t("epub_viewer.settings.render_mode.comic")}</option>
          </select>
        </div>

        {/* 레이아웃 */}
        <div className={styles.section}>
          <label
            className={styles.label}
            id="flow-label"
          >
            {t("epub_viewer.settings.flow.label", { defaultValue: "레이아웃" })}
          </label>
          <div
            className={styles.buttonGroup}
            aria-labelledby="flow-label"
          >
            <button
              type="button"
              aria-pressed={settings.flow === "paginated"}
              className={`${styles.optionBtn} ${settings.flow === "paginated" ? styles.active : ""}`}
              onClick={() => onFlowChange("paginated")}
              title={t("epub_viewer.settings.flow.paginated", { defaultValue: "페이지" })}
              aria-label={t("epub_viewer.settings.flow.paginated", { defaultValue: "페이지" })}
            >
              {t("epub_viewer.settings.flow.paginated", { defaultValue: "페이지" })}
            </button>
            <button
              type="button"
              aria-pressed={settings.flow === "scrolled"}
              className={`${styles.optionBtn} ${settings.flow === "scrolled" ? styles.active : ""}`}
              onClick={() => onFlowChange("scrolled")}
              title={t("epub_viewer.settings.flow.scrolled", { defaultValue: "세로 스크롤" })}
              aria-label={t("epub_viewer.settings.flow.scrolled", { defaultValue: "세로 스크롤" })}
            >
              {t("epub_viewer.settings.flow.scrolled", { defaultValue: "세로 스크롤" })}
            </button>
          </div>
        </div>

        {/* 페이지 모드 */}
        <div className={styles.section}>
          <label
            className={styles.label}
            id="spread-label"
          >
            {t("epub_viewer.settings.spread.label", { defaultValue: "페이지 모드" })}
          </label>
          <div
            className={styles.buttonGroup}
            aria-labelledby="spread-label"
          >
            <button
              type="button"
              aria-pressed={settings.spread === "none"}
              className={`${styles.optionBtn} ${settings.spread === "none" ? styles.active : ""}`}
              onClick={() => onSpreadChange("none")}
              disabled={settings.flow === "scrolled" || isTypographyControlLimited || settings.renderMode === "comic"}
              title={t("epub_viewer.footer.pages_1", { defaultValue: "1페이지" })}
              aria-label={t("epub_viewer.footer.pages_1", { defaultValue: "1페이지" })}
            >
              {t("epub_viewer.footer.pages_1", { defaultValue: "1페이지" })}
            </button>
            <button
              type="button"
              aria-pressed={settings.spread === "auto"}
              className={`${styles.optionBtn} ${settings.spread === "auto" ? styles.active : ""}`}
              onClick={() => onSpreadChange("auto")}
              disabled={settings.flow === "scrolled" || isTypographyControlLimited || settings.renderMode === "comic"}
              title={t("epub_viewer.footer.pages_2", { defaultValue: "2페이지" })}
              aria-label={t("epub_viewer.footer.pages_2", { defaultValue: "2페이지" })}
            >
              {t("epub_viewer.footer.pages_2", { defaultValue: "2페이지" })}
            </button>
          </div>
          {settings.flow === "scrolled" && (
            <p className={styles.helperText}>
              {t("epub_viewer.settings.flow.spread_disabled", { defaultValue: "세로 스크롤에서는 페이지 수를 나누지 않습니다." })}
            </p>
          )}
          {settings.flow !== "scrolled" && (isTypographyControlLimited || settings.renderMode === "comic") && (
            <p className={styles.helperText}>{t("epub_viewer.settings.render_mode.typography_limited")}</p>
          )}
        </div>

        {/* 글꼴 (최상단, 드롭다운) */}
        <div className={styles.section}>
          <label
            className={styles.label}
            htmlFor="font-family-select"
          >
            {t("epub_viewer.settings.font_family.label")}
          </label>
          <select
            id="font-family-select"
            className={styles.select}
            value={settings.fontFamily}
            onChange={(e) => onFontFamilyChange(e.target.value as EpubFontFamily)}
          >
            <option value="original">{t("epub_viewer.settings.font_family.original")}</option>
            <option value="serif">{t("epub_viewer.settings.font_family.serif")}</option>
            <option value="sans-serif">{t("epub_viewer.settings.font_family.sans_serif")}</option>
          </select>
        </div>

        {/* 글자 크기 */}
        <div className={styles.section}>
          <label
            className={styles.label}
            htmlFor="font-size-slider"
          >
            {t("epub_viewer.settings.font_size.label")} ({fontSizeValueLabel})
          </label>
          <input
            id="font-size-slider"
            type="range"
            min={50}
            max={150}
            step={5}
            value={settings.fontSize}
            onChange={(e) => onFontSizeChange(Number(e.target.value))}
            className={styles.slider}
            disabled={isTypographyControlLimited}
          />
          <div className={styles.sliderLabels}>
            <span>50%</span>
            <span>150%</span>
          </div>
        </div>

        {/* 줄 간격 */}
        <div className={styles.section}>
          <label
            className={styles.label}
            htmlFor="line-height-slider"
          >
            {t("epub_viewer.settings.line_height.label")} ({lineHeightValueLabel})
          </label>
          <input
            id="line-height-slider"
            type="range"
            min={EPUB_LINE_HEIGHT_SCALE_MIN}
            max={EPUB_LINE_HEIGHT_SCALE_MAX}
            step={0.05}
            value={settings.lineHeight}
            onChange={(e) => onLineHeightChange(Number(e.target.value))}
            className={styles.slider}
            disabled={isTypographyControlLimited}
          />
          <div className={styles.sliderLabels}>
            <span>{EPUB_LINE_HEIGHT_SCALE_MIN.toFixed(2)}x</span>
            <span>{EPUB_LINE_HEIGHT_SCALE_MAX.toFixed(2)}x</span>
          </div>
          {isTypographyControlLimited && (
            <p className={styles.helperText}>{t("epub_viewer.settings.render_mode.typography_limited")}</p>
          )}
        </div>

        {/* 테마 */}
        <div className={styles.section}>
          <label className={styles.label}>{t("epub_viewer.settings.theme.label")}</label>
          <div className={styles.themeGroup}>
            {(["light", "dark", "sepia"] as EpubTheme[]).map((theme) => (
              <button
                key={theme}
                type="button"
                className={`${styles.themeBtn} ${styles[`theme_${theme}`]} ${settings.theme === theme ? styles.activeTheme : ""}`}
                onClick={() => onThemeChange(theme)}
                title={t(`epub_viewer.settings.theme.${theme}`)}
                aria-label={t(`epub_viewer.settings.theme.${theme}`)}
              >
                {t(`epub_viewer.settings.theme.${theme}`)}
              </button>
            ))}
          </div>
        </div>

        {/* 입력 */}
        <div className={styles.section}>
          <label className={styles.label}>{t("epub_viewer.settings.input_controls.wheel_label")}</label>
          <div className={styles.buttonGroup}>
            <button
              type="button"
              className={`${styles.optionBtn} ${settings.wheelDirection === "down" ? styles.active : ""}`}
              onClick={() => onWheelDirectionChange("down")}
            >
              {t("epub_viewer.settings.input_controls.wheel_down")}
            </button>
            <button
              type="button"
              className={`${styles.optionBtn} ${settings.wheelDirection === "up" ? styles.active : ""}`}
              onClick={() => onWheelDirectionChange("up")}
            >
              {t("epub_viewer.settings.input_controls.wheel_up")}
            </button>
          </div>
        </div>

        {/* 입력 - 키보드 */}
        <div className={styles.section}>
          <label className={styles.label}>{t("epub_viewer.settings.input_controls.keyboard_label")}</label>
          <div className={styles.buttonGroup}>
            <button
              type="button"
              className={`${styles.optionBtn} ${settings.keyboardDirection === "right" ? styles.active : ""}`}
              onClick={() => onKeyboardDirectionChange("right")}
            >
              {t("epub_viewer.settings.input_controls.keyboard_right")}
            </button>
            <button
              type="button"
              className={`${styles.optionBtn} ${settings.keyboardDirection === "left" ? styles.active : ""}`}
              onClick={() => onKeyboardDirectionChange("left")}
            >
              {t("epub_viewer.settings.input_controls.keyboard_left")}
            </button>
          </div>
        </div>

        {/* 입력 - 클릭 */}
        <div className={styles.section}>
          <label className={styles.label}>{t("epub_viewer.settings.input_controls.click_label")}</label>
          <div className={styles.buttonGroup}>
            <button
              type="button"
              className={`${styles.optionBtn} ${settings.clickDirection === "right" ? styles.active : ""}`}
              onClick={() => onClickDirectionChange("right")}
            >
              {t("epub_viewer.settings.input_controls.click_right")}
            </button>
            <button
              type="button"
              className={`${styles.optionBtn} ${settings.clickDirection === "left" ? styles.active : ""}`}
              onClick={() => onClickDirectionChange("left")}
            >
              {t("epub_viewer.settings.input_controls.click_left")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
