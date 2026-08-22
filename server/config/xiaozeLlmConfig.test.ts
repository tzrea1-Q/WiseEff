import { describe, expect, it } from "vitest";
import { resolveXiaozeLlmConfig } from "./xiaozeLlmConfig";

describe("resolveXiaozeLlmConfig", () => {
  it.each([
    {
      name: "uses the canonical group when all canonical keys are populated",
      env: {
        XIAOZE_LLM_API_BASE_URL: " https://canonical.example.com/v1 ",
        XIAOZE_LLM_MODEL: " canonical-model ",
        XIAOZE_LLM_API_KEY: " canonical-secret "
      },
      expected: {
        source: "canonical",
        config: {
          apiBaseUrl: "https://canonical.example.com/v1",
          model: "canonical-model",
          apiKey: "canonical-secret"
        }
      }
    },
    {
      name: "treats one blank canonical key as canonical mode without legacy fallback",
      env: {
        XIAOZE_LLM_API_KEY: "   ",
        AGENT_API_BASE_URL: "https://legacy.example.com/v1",
        AGENT_MODEL: "legacy-model",
        AGENT_API_KEY: "legacy-secret"
      },
      expected: {
        source: "canonical",
        config: {
          apiBaseUrl: undefined,
          model: "gpt-4o-mini",
          apiKey: undefined
        }
      }
    },
    {
      name: "defaults a blank canonical model without falling back to a legacy model",
      env: {
        XIAOZE_LLM_API_BASE_URL: "https://canonical.example.com/v1",
        XIAOZE_LLM_MODEL: " ",
        XIAOZE_LLM_API_KEY: "canonical-secret",
        XIAOZE_MODEL: "legacy-xiaoze-model",
        AGENT_MODEL: "legacy-agent-model"
      },
      expected: {
        source: "canonical",
        config: {
          apiBaseUrl: "https://canonical.example.com/v1",
          model: "gpt-4o-mini",
          apiKey: "canonical-secret"
        }
      }
    },
    {
      name: "uses legacy aliases only when the complete canonical group is absent",
      env: {
        AGENT_API_BASE_URL: " https://legacy.example.com/v1 ",
        XIAOZE_MODEL: " xiaoze-legacy-model ",
        AGENT_MODEL: "agent-legacy-model",
        AGENT_API_KEY: " legacy-secret "
      },
      expected: {
        source: "legacy",
        config: {
          apiBaseUrl: "https://legacy.example.com/v1",
          model: "xiaoze-legacy-model",
          apiKey: "legacy-secret"
        }
      }
    },
    {
      name: "falls back from a blank XIAOZE_MODEL to AGENT_MODEL in legacy mode",
      env: {
        XIAOZE_MODEL: " ",
        AGENT_MODEL: " agent-legacy-model "
      },
      expected: {
        source: "legacy",
        config: {
          apiBaseUrl: undefined,
          model: "agent-legacy-model",
          apiKey: undefined
        }
      }
    },
    {
      name: "uses a stable model default when neither group configures a model",
      env: {},
      expected: {
        source: "default",
        config: {
          apiBaseUrl: undefined,
          model: "gpt-4o-mini",
          apiKey: undefined
        }
      }
    }
  ])("$name", ({ env, expected }) => {
    const result = resolveXiaozeLlmConfig(env);

    expect(result.source).toBe(expected.source);
    expect(result.config).toEqual(expected.config);
  });

  it.each([
    {
      name: "warns for each legacy-only key that participates in the migration window",
      env: {
        AGENT_API_BASE_URL: "https://legacy.example.com/v1",
        XIAOZE_MODEL: "legacy-model",
        AGENT_API_KEY: "legacy-secret"
      },
      expected: [
        {
          code: "legacy-used",
          key: "AGENT_API_BASE_URL",
          canonicalKey: "XIAOZE_LLM_API_BASE_URL"
        },
        {
          code: "legacy-used",
          key: "XIAOZE_MODEL",
          canonicalKey: "XIAOZE_LLM_MODEL"
        },
        {
          code: "legacy-used",
          key: "AGENT_API_KEY",
          canonicalKey: "XIAOZE_LLM_API_KEY"
        }
      ]
    },
    {
      name: "marks equal legacy keys deprecated and ignored when canonical mode wins",
      env: {
        XIAOZE_LLM_API_BASE_URL: "https://same.example.com/v1",
        XIAOZE_LLM_MODEL: "same-model",
        XIAOZE_LLM_API_KEY: "same-secret",
        AGENT_API_BASE_URL: " https://same.example.com/v1 ",
        AGENT_MODEL: "same-model",
        AGENT_API_KEY: "same-secret"
      },
      expected: [
        {
          code: "legacy-deprecated-ignored",
          key: "AGENT_API_BASE_URL",
          canonicalKey: "XIAOZE_LLM_API_BASE_URL"
        },
        {
          code: "legacy-deprecated-ignored",
          key: "AGENT_MODEL",
          canonicalKey: "XIAOZE_LLM_MODEL"
        },
        {
          code: "legacy-deprecated-ignored",
          key: "AGENT_API_KEY",
          canonicalKey: "XIAOZE_LLM_API_KEY"
        }
      ]
    },
    {
      name: "marks different legacy keys conflicted and ignored without exposing their values",
      env: {
        XIAOZE_LLM_API_BASE_URL: "https://canonical.example.com/v1",
        XIAOZE_LLM_MODEL: "canonical-model",
        XIAOZE_LLM_API_KEY: "canonical-secret",
        AGENT_API_BASE_URL: "https://legacy.example.com/v1",
        XIAOZE_MODEL: "legacy-model",
        AGENT_API_KEY: "legacy-secret"
      },
      expected: [
        {
          code: "legacy-conflict-ignored",
          key: "AGENT_API_BASE_URL",
          canonicalKey: "XIAOZE_LLM_API_BASE_URL"
        },
        {
          code: "legacy-conflict-ignored",
          key: "XIAOZE_MODEL",
          canonicalKey: "XIAOZE_LLM_MODEL"
        },
        {
          code: "legacy-conflict-ignored",
          key: "AGENT_API_KEY",
          canonicalKey: "XIAOZE_LLM_API_KEY"
        }
      ]
    }
  ])("$name", ({ env, expected }) => {
    const diagnostics = resolveXiaozeLlmConfig(env).diagnostics;

    expect(diagnostics).toEqual(expected);
    const serialized = JSON.stringify(diagnostics);
    for (const value of Object.values(env)) {
      expect(serialized).not.toContain(value.trim());
    }
  });
});
