import { wiseEffApiBaseUrl } from "./runtimeMode";

function readApiBaseUrl() {
  return (import.meta.env.VITE_WISEEFF_API_BASE_URL ?? wiseEffApiBaseUrl).replace(/\/$/, "");
}

export function resolveBridgeServerUrl(pageOrigin?: string) {
  const origin = pageOrigin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const apiBase = readApiBaseUrl();

  try {
    const apiOrigin = new URL(apiBase).origin;
    if (!origin) {
      return apiOrigin;
    }
    return apiOrigin === origin ? origin : apiOrigin;
  } catch {
    return origin || apiBase;
  }
}
