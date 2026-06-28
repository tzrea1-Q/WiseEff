import { resolveWiseEffApiBaseUrl } from "./runtimeMode";

function normalizeDownloadPath(downloadUrl: string) {
  if (downloadUrl.startsWith("/")) {
    return downloadUrl;
  }
  return `/${downloadUrl}`;
}

/** Resolve same-origin download paths to the API host when the SPA and API run on different origins (local dev). */
export function resolveDeviceBridgeDownloadUrl(downloadUrl: string) {
  if (!downloadUrl.trim()) {
    return downloadUrl;
  }
  if (/^https?:\/\//i.test(downloadUrl)) {
    return downloadUrl;
  }

  const path = normalizeDownloadPath(downloadUrl);
  const apiBase = resolveWiseEffApiBaseUrl().replace(/\/$/, "");

  if (typeof window === "undefined") {
    return `${apiBase}${path}`;
  }

  try {
    const pageOrigin = window.location.origin;
    const apiOrigin = new URL(apiBase).origin;
    if (apiOrigin !== pageOrigin) {
      return `${apiBase}${path}`;
    }
  } catch {
    return `${apiBase}${path}`;
  }

  return path;
}
