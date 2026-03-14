import styles from "./SmartImageViewer.module.css";
import { useSmartImage } from "../hooks/useSmartImage";

interface SmartImageViewerProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  nextSrc?: string;
  className?: string;
  /** 이미지가 로드되어 화면에 그려질 준비가 되었을 때 호출되는 콜백 */
  onVisualReady?: () => void;
}

export function SmartImageViewer({ src, nextSrc, className, onVisualReady, ...props }: SmartImageViewerProps) {
  const { displaySrc, isLoading, LOADING_OPACITY, TRANSITION_STYLE } = useSmartImage(src, nextSrc);

  return (
    <div className={`${styles.container} ${className || ""}`}>
      <img
        {...props}
        src={displaySrc}
        className={className}
        onLoad={() => onVisualReady?.()}
        onError={() => onVisualReady?.()}
        style={{
          ...props.style,
          opacity: isLoading ? LOADING_OPACITY : 1,
          transition: TRANSITION_STYLE,
        }}
      />
    </div>
  );
}
