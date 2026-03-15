import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useChapterLoader } from "../features/viewer";
import { ImageViewerRoute } from "./ImageViewerRoute";
import { PdfViewerRoute } from "./PdfViewerRoute";
import { EpubViewerRoute } from "./EpubViewerRoute";
import { TextViewerRoute } from "./TextViewerRoute";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import styles from "./Viewer.module.css";

export function ViewerPage() {
  const { chapterId } = useParams<{ chapterId: string }>();
  const { t } = useTranslation();

  // Fetch minimal data to route
  const loaderData = useChapterLoader({ chapterId });

  if (loaderData.error) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", color: "white" }}>
        <div>{t("viewer.error.load_failed", { error: loaderData.error })}</div>
      </div>
    );
  }

  // 메인 로딩 스피너: viewStatus가 "ready"가 될 때까지 오버레이 유지
  // 이미지가 실제 로드 완료된 후에만 오버레이를 제거하여 검은 화면 깜빡임 방지
  const showLoading =
    loaderData.isLoading ||
    !loaderData.chapter ||
    (loaderData.viewStatus !== undefined && loaderData.viewStatus !== "ready");

  if (!loaderData.chapter) {
    return showLoading ? <LoadingSpinner fullScreen text={undefined} /> : null;
  }

  const chapterPath = loaderData.chapter.path?.toLowerCase() ?? "";
  const isPdf = chapterPath.endsWith(".pdf");
  const isEpub = chapterPath.endsWith(".epub");
  const isText = chapterPath.endsWith(".txt");
  const shouldUseImageRouteForPdf = isPdf && loaderData.chapter.render_mode === "image";

  const route = isEpub ? (
    <EpubViewerRoute loaderData={loaderData} />
  ) : isPdf && !shouldUseImageRouteForPdf ? (
    <PdfViewerRoute loaderData={loaderData} />
  ) : isText ? (
    <TextViewerRoute loaderData={loaderData} />
  ) : (
    <ImageViewerRoute loaderData={loaderData} />
  );

  return (
    <>
      {showLoading && <LoadingSpinner fullScreen text={undefined} className={styles.viewerLoadingOverlay} />}
      {route}
    </>
  );
}
