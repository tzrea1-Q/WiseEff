export type WiseEffRuntimeMode = "mock" | "api";

export function parseRuntimeMode(value: string | undefined, environment: string): WiseEffRuntimeMode {
  const trimmed = value?.trim();
  if (trimmed === "mock") {
    if (environment === "production") {
      throw new Error("Mock runtime cannot be used in production builds");
    }
    return "mock";
  }

  return "api";
}

export function parseStaticApiAuthorization(value: string | undefined, environment: string) {
  if (environment === "production" && value?.trim()) {
    throw new Error("Static API authorization cannot be used in production builds");
  }

  return value;
}

export const wiseEffRuntimeMode = parseRuntimeMode(import.meta.env.VITE_WISEEFF_RUNTIME_MODE, import.meta.env.MODE);

const defaultWiseEffApiBaseUrl = "http://127.0.0.1:8787";

function readConfiguredWiseEffApiBaseUrl() {
  return import.meta.env.VITE_WISEEFF_API_BASE_URL ?? defaultWiseEffApiBaseUrl;
}

/** Baked build-time API URL (tests and non-browser contexts). */
export const wiseEffApiBaseUrl = readConfiguredWiseEffApiBaseUrl();

/** Prefer the page origin in production when Caddy serves SPA and API on the same host (e.g. IP access before DNS). */
export function resolveWiseEffApiBaseUrl() {
  const configuredWiseEffApiBaseUrl = readConfiguredWiseEffApiBaseUrl();

  if (typeof window === "undefined" || import.meta.env.MODE !== "production") {
    return configuredWiseEffApiBaseUrl;
  }

  try {
    const configuredOrigin = new URL(configuredWiseEffApiBaseUrl).origin;
    if (configuredOrigin !== window.location.origin) {
      return window.location.origin;
    }
  } catch {
    // Keep configured URL when it is not a valid absolute URL.
  }

  return configuredWiseEffApiBaseUrl;
}

export const wiseEffApiAuthorization = parseStaticApiAuthorization(import.meta.env.VITE_WISEEFF_API_AUTHORIZATION, import.meta.env.MODE);

export function parseXiaozeProactiveEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function parseXiaozeReasoningDevExpanded(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function parseXiaozePromptDebugEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export const xiaozeProactiveEnabled = parseXiaozeProactiveEnabled(import.meta.env.VITE_XIAOZE_PROACTIVE_ENABLED);
export const xiaozeReasoningDevExpanded =
  import.meta.env.MODE !== "production" && parseXiaozeReasoningDevExpanded(import.meta.env.VITE_XIAOZE_REASONING_DEV_EXPANDED);
export const xiaozePromptDebugEnabled =
  import.meta.env.MODE !== "production" && parseXiaozePromptDebugEnabled(import.meta.env.VITE_XIAOZE_PROMPT_DEBUG);
