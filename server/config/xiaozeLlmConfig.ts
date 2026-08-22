export const DEFAULT_XIAOZE_LLM_MODEL = "gpt-4o-mini";

export type XiaozeLlmConfigSource = "canonical" | "legacy" | "default";

export interface XiaozeLlmConfig {
  apiBaseUrl?: string;
  model: string;
  apiKey?: string;
}

export type XiaozeLlmConfigDiagnosticCode =
  | "legacy-used"
  | "legacy-deprecated-ignored"
  | "legacy-conflict-ignored";

export interface XiaozeLlmConfigDiagnostic {
  code: XiaozeLlmConfigDiagnosticCode;
  key: "AGENT_API_BASE_URL" | "XIAOZE_MODEL" | "AGENT_MODEL" | "AGENT_API_KEY";
  canonicalKey: "XIAOZE_LLM_API_BASE_URL" | "XIAOZE_LLM_MODEL" | "XIAOZE_LLM_API_KEY";
}

export interface ResolvedXiaozeLlmConfig {
  config: XiaozeLlmConfig;
  source: XiaozeLlmConfigSource;
  diagnostics: XiaozeLlmConfigDiagnostic[];
}

type EnvLike = Record<string, string | undefined>;

export const XIAOZE_LLM_CANONICAL_KEYS = [
  "XIAOZE_LLM_API_BASE_URL",
  "XIAOZE_LLM_MODEL",
  "XIAOZE_LLM_API_KEY"
] as const;

export const XIAOZE_LLM_LEGACY_KEYS = [
  "AGENT_API_BASE_URL",
  "XIAOZE_MODEL",
  "AGENT_MODEL",
  "AGENT_API_KEY"
] as const;

const legacyMappings = [
  { key: "AGENT_API_BASE_URL", canonicalKey: "XIAOZE_LLM_API_BASE_URL", field: "apiBaseUrl" },
  { key: "XIAOZE_MODEL", canonicalKey: "XIAOZE_LLM_MODEL", field: "model" },
  { key: "AGENT_MODEL", canonicalKey: "XIAOZE_LLM_MODEL", field: "model" },
  { key: "AGENT_API_KEY", canonicalKey: "XIAOZE_LLM_API_KEY", field: "apiKey" }
] as const;

function hasRawKey(env: EnvLike, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(env, key);
}

function normalizedValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function createDiagnostics(
  env: EnvLike,
  source: XiaozeLlmConfigSource,
  config: XiaozeLlmConfig
): XiaozeLlmConfigDiagnostic[] {
  if (source === "default") {
    return [];
  }

  const diagnostics: XiaozeLlmConfigDiagnostic[] = [];
  for (const { key, canonicalKey, field } of legacyMappings) {
    if (!hasRawKey(env, key)) {
      continue;
    }
    if (source === "legacy") {
      diagnostics.push({ code: "legacy-used", key, canonicalKey });
      continue;
    }

    diagnostics.push({
      code:
        normalizedValue(env[key]) === config[field]
          ? "legacy-deprecated-ignored"
          : "legacy-conflict-ignored",
      key,
      canonicalKey
    });
  }
  return diagnostics;
}

export function resolveXiaozeLlmConfig(env: EnvLike): ResolvedXiaozeLlmConfig {
  if (XIAOZE_LLM_CANONICAL_KEYS.some((key) => hasRawKey(env, key))) {
    const config = {
      apiBaseUrl: normalizedValue(env.XIAOZE_LLM_API_BASE_URL),
      model: normalizedValue(env.XIAOZE_LLM_MODEL) ?? DEFAULT_XIAOZE_LLM_MODEL,
      apiKey: normalizedValue(env.XIAOZE_LLM_API_KEY)
    };
    return {
      source: "canonical",
      config,
      diagnostics: createDiagnostics(env, "canonical", config)
    };
  }

  const hasLegacyKey = XIAOZE_LLM_LEGACY_KEYS.some((key) => hasRawKey(env, key));
  const source = hasLegacyKey ? "legacy" : "default";
  const config = {
    apiBaseUrl: normalizedValue(env.AGENT_API_BASE_URL),
    model:
      normalizedValue(env.XIAOZE_MODEL) ??
      normalizedValue(env.AGENT_MODEL) ??
      DEFAULT_XIAOZE_LLM_MODEL,
    apiKey: normalizedValue(env.AGENT_API_KEY)
  };
  return {
    source,
    config,
    diagnostics: createDiagnostics(env, source, config)
  };
}
