export type WiseEffRuntimeMode = "mock" | "api";

export function parseRuntimeMode(value: string | undefined, environment: string): WiseEffRuntimeMode {
  const mode = value === "api" ? "api" : "mock";

  if (environment === "production" && mode === "mock") {
    throw new Error("Mock runtime cannot be used in production builds");
  }

  return mode;
}

export const wiseEffRuntimeMode = parseRuntimeMode(import.meta.env.VITE_WISEEFF_RUNTIME_MODE, import.meta.env.MODE);
export const wiseEffApiBaseUrl = import.meta.env.VITE_WISEEFF_API_BASE_URL ?? "http://127.0.0.1:8787";
export const wiseEffApiAuthorization = import.meta.env.VITE_WISEEFF_API_AUTHORIZATION;
