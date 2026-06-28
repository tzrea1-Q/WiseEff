import { resolveWiseEffApiBaseUrl } from "./runtimeMode";

function readApiBaseUrl() {
  return resolveWiseEffApiBaseUrl().replace(/\/$/, "");
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

export function resolveBridgeWebOrigin(pageOrigin?: string) {
  const origin = pageOrigin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return origin.replace(/\/$/, "");
}
