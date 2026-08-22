import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  caddyfileForTlsMode,
  detectDefaultHost,
  evaluateIpLabCaddyfile,
  evaluateIpLabEnv,
  formatHostForUrl,
  generateUrlSafeSecret,
  parseEnvText,
  parseIpLabCliArgs,
  publicUrlForLab,
  renderIpLabEnv
} from "./ip-lab-profile";

const validLabInput = {
  host: "203.0.113.10",
  tlsMode: "http" as const,
  adminUsername: "admin.ops",
  adminPassword: "ReplaceWithAStrongPassword",
  postgresPassword: "postgres_lab_secret",
  minioPassword: "minio_lab_secret"
};

describe("ip lab profile helpers", () => {
  it("generates URL-safe secrets and HTTP or internal public URLs", () => {
    expect(generateUrlSafeSecret()).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(publicUrlForLab("203.0.113.10", "http")).toBe("http://203.0.113.10");
    expect(publicUrlForLab("203.0.113.10", "internal")).toBe("https://203.0.113.10");
    expect(formatHostForUrl("2001:db8::1")).toBe("[2001:db8::1]");
    expect(caddyfileForTlsMode("http")).toBe("Caddyfile.ip-lab");
    expect(caddyfileForTlsMode("internal")).toBe("Caddyfile.ip-lab-tls");
  });

  it("prefers a non-private IPv4 when detecting the default host", () => {
    expect(
      detectDefaultHost({
        eth0: [
          { address: "192.168.1.20", family: "IPv4", internal: false } as never,
          { address: "203.0.113.10", family: "IPv4", internal: false } as never
        ]
      })
    ).toBe("203.0.113.10");
  });

  it("renders an expanded lab env that passes preflight", () => {
    const text = renderIpLabEnv(validLabInput);
    const env = parseEnvText(text);

    expect(env.WISEEFF_DEPLOY_PROFILE).toBe("ip-lab");
    expect(env.DATABASE_URL).toBe("postgres://wiseeff:postgres_lab_secret@postgres:5432/wiseeff");
    expect(env.OBJECT_STORAGE_SECRET_ACCESS_KEY).toBe("minio_lab_secret");
    expect(env.VITE_WISEEFF_API_BASE_URL).toBe("http://203.0.113.10");
    expect(env.XIAOZE_DETERMINISTIC).toBe("true");
    expect(env.LOG_ANALYSIS_DETERMINISTIC).toBe("true");
    expect(env).toHaveProperty("XIAOZE_LLM_API_BASE_URL", "");
    expect(env).toHaveProperty("XIAOZE_LLM_MODEL", "");
    expect(env).toHaveProperty("XIAOZE_LLM_API_KEY", "");
    expect(env).not.toHaveProperty("AGENT_API_KEY");
    const result = evaluateIpLabEnv(env);
    expect(result.status).toBe("passed");
    expect(result.issues.every((issue) => issue.level === "warning")).toBe(true);
  });

  it("rejects interpolated secrets, ACME-style TLS, and missing deterministic LLM flags", () => {
    const env = parseEnvText(renderIpLabEnv(validLabInput));
    env.DATABASE_URL = "postgres://wiseeff:${POSTGRES_PASSWORD}@postgres:5432/wiseeff";
    env.XIAOZE_DETERMINISTIC = "false";
    env.XIAOZE_LLM_API_BASE_URL = "";
    env.XIAOZE_LLM_API_KEY = "";
    env.WISEEFF_CADDYFILE = "Caddyfile.example";
    env.WISEEFF_TLS_MODE = "http";

    const result = evaluateIpLabEnv(env);
    expect(result.status).toBe("failed");
    expect(result.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "DATABASE_URL must embed the expanded POSTGRES_PASSWORD.",
        "Set XIAOZE_DETERMINISTIC=true or provide XIAOZE_LLM_API_BASE_URL and XIAOZE_LLM_API_KEY.",
        "WISEEFF_CADDYFILE must be Caddyfile.ip-lab when WISEEFF_TLS_MODE=http."
      ])
    );
  });

  it("requires tls internal in the internal Caddyfile and forbids ACME email TLS in HTTP mode", () => {
    const httpResult = evaluateIpLabCaddyfile(
      `:80 {\n  tls {$WISEEFF_TLS_EMAIL}\n  handle /api/* { reverse_proxy api:8787 }\n}`,
      "http"
    );
    expect(httpResult.status).toBe("failed");
    expect(httpResult.forbiddenTokens).toContain("tls {$WISEEFF_TLS_EMAIL}");

    const tlsResult = evaluateIpLabCaddyfile(
      `:80 {\n  handle /api/* { reverse_proxy api:8787 }\n  handle /health/* { reverse_proxy api:8787 }\n  handle /downloads/device-bridge/* { file_server }\n  reverse_proxy web:5173\n}\n`,
      "internal"
    );
    expect(tlsResult.status).toBe("failed");
    expect(tlsResult.missingTokens).toContain("tls internal");
  });

  it("parses init CLI arguments", () => {
    expect(
      parseIpLabCliArgs(["--ip", "203.0.113.10", "--tls-mode", "internal", "--force", "--print-env"])
    ).toMatchObject({
      host: "203.0.113.10",
      tlsMode: "internal",
      force: true,
      printEnv: true
    });
    expect(() => parseIpLabCliArgs(["--unknown"])).toThrow("Unknown or incomplete IP lab argument");
  });

  it("accepts the committed IP lab Caddyfiles", () => {
    expect(evaluateIpLabCaddyfile(readFileSync("ops/self-hosted/Caddyfile.ip-lab", "utf8"), "http").status).toBe(
      "passed"
    );
    expect(
      evaluateIpLabCaddyfile(readFileSync("ops/self-hosted/Caddyfile.ip-lab-tls", "utf8"), "internal").status
    ).toBe("passed");
  });
});
