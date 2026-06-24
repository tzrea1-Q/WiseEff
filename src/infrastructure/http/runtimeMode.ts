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
export const wiseEffApiBaseUrl = import.meta.env.VITE_WISEEFF_API_BASE_URL ?? "http://127.0.0.1:8787";
export const wiseEffApiAuthorization = parseStaticApiAuthorization(import.meta.env.VITE_WISEEFF_API_AUTHORIZATION, import.meta.env.MODE);

export function parseXiaozeEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export const xiaozeEnabled = parseXiaozeEnabled(import.meta.env.VITE_XIAOZE_ENABLED);
