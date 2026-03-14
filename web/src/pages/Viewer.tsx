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

  const showLoadingBase = loaderData.isLoading || !loaderData.chapter;

  if (!loaderData.chapter) {
    return showLoadingBase ? <LoadingSpinner fullScreen text={undefined} /> : null;
  }

  const chapterPath = loaderData.chapter.path?.toLowerCase() ?? "";
  const isPdf = chapterPath.endsWith(".pdf");
  const isEpub = chapterPath.endsWith(".epub");
  const isText = chapterPath.endsWith(".txt");
  const shouldUseImageRouteForPdf = isPdf && loaderData.chapter.render_mode === "image";
  const isImageRoute = !isEpub && !isText && (!isPdf || shouldUseImageRouteForPdf);
  const showLoading =
    showLoadingBase || (isImageRoute && loaderData.viewStatus !== undefined && loaderData.viewStatus !== "ready");

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
