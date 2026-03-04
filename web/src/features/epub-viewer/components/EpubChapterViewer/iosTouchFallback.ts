import { isOldIOSSafari } from "../../../../utils/browserDetect";

export function applyOldIOSSafariPointerEventFallback(doc: Document): void {
  if (!isOldIOSSafari()) return;

  const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null;
  if (!iframe) return;

  iframe.style.pointerEvents = "none";
}
