import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateIpLabEnv, parseEnvText } from "./ip-lab-profile";
import { normalizeAnswers } from "./selfhost-answers";
import {
  caddyfileForSelfHost,
  evaluateSelfHostCaddyfile,
  evaluateSelfHostEnv,
  publicUrlForSelfHost,
  renderSelfHostEnv,
  resolveSecrets
} from "./selfhost-profile";

const secrets = { postgresPassword: "postgres_lab_secret", minioPassword: "minio_lab_secret" };

describe("self-host profile renderer", () => {
  it.each([
    ["bootstrap", "postgres://wiseeff:postgres_lab_secret@postgres:5432/wiseeff", "passed"],
    ["runtime login", "postgres://wiseeff_api:independent_secret@postgres:5432/wiseeff", "passed"],
    ["interpolation", "postgres://wiseeff:${POSTGRES_PASSWORD}@postgres:5432/wiseeff", "failed"],
    ["wrong bootstrap password", "postgres://wiseeff:wrong@postgres:5432/wiseeff?probe=postgres_lab_secret", "failed"]
  ])("checks ACME DATABASE_URL for %s", (_name, databaseUrl, status) => {
    const env = parseEnvText(renderSelfHostEnv(normalizeAnswers({
      profile: "acme",
      siteHost: "wiseeff.example.com",
      tlsEmail: "ops@example.com",
      adminPassword: "ReplaceWithAStrongPassword"
    }), secrets));
    env.DATABASE_URL = databaseUrl;
    expect(evaluateSelfHostEnv(env).status).toBe(status);
  });

  it.each([
    ["bootstrap query password override", "postgres://wiseeff:postgres_lab_secret@postgres/wiseeff?password=wrong", "failed"],
    ["runtime query user override", "postgres://wiseeff_api:independent_secret@postgres/wiseeff?user=other", "failed"],
    ["hostname substring", "postgres://wiseeff:wrong@postgres_lab_secret:5432/wiseeff", "failed"],
    ["password substring", "postgres://wiseeff:prefix_postgres_lab_secret_suffix@postgres/wiseeff", "failed"],
    ["malformed URL", "postgres_lab_secret", "failed"],
    ["wrong protocol", "https://wiseeff:postgres_lab_secret@postgres/wiseeff", "failed"],
    ["missing hostname", "postgres:///wiseeff?probe=postgres_lab_secret", "failed"],
    ["invalid port", "postgres://wiseeff:postgres_lab_secret@postgres:99999/wiseeff", "failed"],
    ["invalid encoding", "postgres://wiseeff_api:bad%XX@postgres/wiseeff", "failed"],
    ["unrecognized role", "postgres://other:postgres_lab_secret@postgres/wiseeff", "failed"],
    ["worker role", "postgres://wiseeff_worker:postgres_lab_secret@postgres/wiseeff", "failed"],
    ["empty runtime password", "postgres://wiseeff_api@postgres/wiseeff?probe=postgres_lab_secret", "failed"],
    ["same password bytes for runtime role", "postgres://wiseeff_api:postgres_lab_secret@postgres/wiseeff", "passed"],
    ["interpolated query", "postgres://wiseeff:postgres_lab_secret@postgres/wiseeff?probe=${VALUE}", "failed"],
    ["encoded interpolation", "postgres://wiseeff_api:%24%7BPASSWORD%7D@postgres/wiseeff", "failed"],
    ["decoded bootstrap credential", "postgresql://wiseeff:%70ostgres_lab_secret@postgres/wiseeff", "passed"],
    ["encoded runtime credential and IPv6", "postgresql://%77iseeff_api:runtime%3A%40%2F%25@[::1]:5432/wiseeff", "passed"]
  ])("checks %s in both profiles", (_name, databaseUrl, status) => {
    for (const profile of ["acme", "ip-lab"] as const) {
      const env = parseEnvText(renderSelfHostEnv(normalizeAnswers({
        profile,
        siteHost: "wiseeff.example.com",
        tlsEmail: "ops@example.com",
        adminPassword: "ReplaceWithAStrongPassword"
      }), secrets));
      env.DATABASE_URL = databaseUrl;
      expect(evaluateSelfHostEnv(env).status).toBe(status);
    }
  });

  it("renders IP lab Quick answers that pass the existing lab preflight", () => {
    const text = renderSelfHostEnv(
      normalizeAnswers({
        profile: "ip-lab",
        siteHost: "203.0.113.10",
        adminPassword: "ReplaceWithAStrongPassword",
        seed: "chargelab",
        llm: "skip"
      }),
      secrets
    );
    const env = parseEnvText(text);
    expect(env.WISEEFF_DEPLOY_PROFILE).toBe("ip-lab");
    expect(env.WISEEFF_LAB_SEED).toBe("chargelab");
    expect(env.DATABASE_URL).toBe("postgres://wiseeff:postgres_lab_secret@postgres:5432/wiseeff");
    expect(env.XIAOZE_DETERMINISTIC).toBe("true");
    expect(evaluateIpLabEnv(env).status).toBe("passed");
    expect(evaluateSelfHostEnv(env).status).toBe("passed");
  });

  it("renders ACME answers with expanded secrets and https URLs", () => {
    const text = renderSelfHostEnv(
      normalizeAnswers({
        profile: "acme",
        siteHost: "wiseeff.example.com",
        tlsEmail: "ops@example.com",
        adminPassword: "ReplaceWithAStrongPassword",
        llm: "skip"
      }),
      secrets
    );
    const env = parseEnvText(text);
    expect(env.WISEEFF_DEPLOY_PROFILE).toBe("acme");
    expect(env.WISEEFF_CADDYFILE).toBe("Caddyfile.example");
    expect(env.WISEEFF_PUBLIC_URL).toBe("https://wiseeff.example.com");
    expect(env.DATABASE_URL).toContain("postgres_lab_secret");
    expect(env.DATABASE_URL).not.toContain("${");
    expect(evaluateSelfHostEnv(env).status).toBe("passed");
    expect(publicUrlForSelfHost("wiseeff.example.com", "acme")).toBe("https://wiseeff.example.com");
    expect(caddyfileForSelfHost("acme")).toBe("Caddyfile.example");
  });

  it("turns off deterministic flags when live Xiaoze and log-analysis keys are present", () => {
    const env = parseEnvText(
      renderSelfHostEnv(
        normalizeAnswers({
          profile: "ip-lab",
          siteHost: "203.0.113.10",
          adminPassword: "ReplaceWithAStrongPassword",
          llm: "xiaoze+logs",
          agentApiBaseUrl: "https://llm.example.com/v1",
          agentModel: "demo-model",
          agentApiKey: "sk-xiaoze",
          logAnalysisApiBaseUrl: "https://llm.example.com/v1",
          logAnalysisModel: "demo-logs",
          logAnalysisApiKey: "sk-logs"
        }),
        secrets
      )
    );
    expect(env.XIAOZE_DETERMINISTIC).toBe("false");
    expect(env.LOG_ANALYSIS_DETERMINISTIC).toBe("false");
    expect(env.XIAOZE_LLM_API_BASE_URL).toBe("https://llm.example.com/v1");
    expect(env.XIAOZE_LLM_MODEL).toBe("demo-model");
    expect(env.XIAOZE_LLM_API_KEY).toBe("sk-xiaoze");
    expect(env).not.toHaveProperty("AGENT_API_KEY");
    expect(evaluateSelfHostEnv(env).status).toBe("passed");
  });

  it("rejects interpolated ACME DATABASE_URL values", () => {
    const env = parseEnvText(
      renderSelfHostEnv(
        normalizeAnswers({
          profile: "acme",
          siteHost: "wiseeff.example.com",
          tlsEmail: "ops@example.com",
          adminPassword: "ReplaceWithAStrongPassword"
        }),
        secrets
      )
    );
    env.DATABASE_URL = "postgres://wiseeff:${POSTGRES_PASSWORD}@postgres:5432/wiseeff";
    expect(evaluateSelfHostEnv(env).status).toBe("failed");
    expect(evaluateSelfHostEnv(env).issues.map((issue) => issue.message)).toContain(
      "DATABASE_URL must be a valid PostgreSQL URL with expanded credentials: wiseeff requires the exact POSTGRES_PASSWORD; wiseeff_api requires a nonempty password."
    );
  });

  it("reuses existing secrets unless force is set", () => {
    expect(
      resolveSecrets({ POSTGRES_PASSWORD: "keep_pg", MINIO_ROOT_PASSWORD: "keep_minio" }, false, () => "generated")
    ).toEqual({ postgresPassword: "keep_pg", minioPassword: "keep_minio" });
    expect(
      resolveSecrets({ POSTGRES_PASSWORD: "keep_pg", MINIO_ROOT_PASSWORD: "keep_minio" }, true, () => "generated")
    ).toEqual({ postgresPassword: "generated", minioPassword: "generated" });
  });

  it("accepts the committed ACME Caddyfile", () => {
    expect(
      evaluateSelfHostCaddyfile(readFileSync("ops/self-hosted/Caddyfile.example", "utf8"), "acme").status
    ).toBe("passed");
  });
});
