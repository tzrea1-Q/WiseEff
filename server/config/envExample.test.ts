import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTokenVerifier } from "../modules/auth/tokenVerifier";
import { loadServerEnv } from "./env";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envExamplePath = path.join(projectRoot, ".env.example");
const gitignorePath = path.join(projectRoot, ".gitignore");
const allowedBlankKeys = new Set(["AGENT_API_BASE_URL", "AGENT_MODEL", "AGENT_API_KEY"]);

function parseEnvExample(contents: string) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator === -1) {
          throw new Error(`Invalid .env.example line: ${line}`);
        }

        return [line.slice(0, separator), line.slice(separator + 1)];
      })
  ) as Record<string, string>;
}

describe(".env.example", () => {
  it("prepares local dependencies and only leaves live LLM settings blank", async () => {
    const rawExample = await readFile(envExamplePath, "utf8");
    const parsed = parseEnvExample(rawExample);
    const blankKeys = Object.entries(parsed)
      .filter(([, value]) => value.trim() === "")
      .map(([key]) => key)
      .sort();

    expect(blankKeys).toEqual([...allowedBlankKeys].sort());
    expect(parsed).toMatchObject({
      NODE_ENV: "development",
      PORT: "8787",
      DATABASE_URL: "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff",
      AUTH_MODE: "production",
      AUTH_PROVIDER: "local",
      AUTH_TOKEN_ISSUER: "wiseeff-local",
      WISEEFF_API_BASE_URL: "http://127.0.0.1:8787",
      VITE_WISEEFF_RUNTIME_MODE: "api",
      VITE_WISEEFF_API_BASE_URL: "http://127.0.0.1:8787",
      OBJECT_STORE_MODE: "local",
      OBJECT_STORE_ROOT: ".wiseeff-object-store",
      WISEEFF_LOCAL_BACKUP_DIR: ".wiseeff-backups",
      WISEEFF_LOCAL_RESTORE_DIR: ".wiseeff-restore",
      DEBUG_DEVICE_GATEWAY_MODE: "simulator",
      DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: "true",
      AGENT_PROVIDER: "live",
      AGENT_API_FORMAT: "pi",
      AGENT_PI_PROVIDER: "minimax",
      AGENT_API_TIMEOUT_MS: "30000",
      AGENT_PROMPT_VERSION: "m7-pi-agent-v1",
      M5_CONTRACT_CHECK_PASSED: "true",
      M5_SMOKE_ALLOW_NO_API: "false"
    });
    expect(parsed.AUTH_TOKEN_HMAC_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(parsed.M5_SMOKE_AUTHORIZATION).toMatch(/^Bearer \S+\.\S+$/);
    expect(parsed.WISEEFF_SMOKE_AUTHORIZATION).toBe(parsed.M5_SMOKE_AUTHORIZATION);
    await expect(
      createTokenVerifier({
        issuer: parsed.AUTH_TOKEN_ISSUER,
        secret: parsed.AUTH_TOKEN_HMAC_SECRET
      }).verify(parsed.M5_SMOKE_AUTHORIZATION)
    ).resolves.toMatchObject({
      user: { id: "u-xu-yun", organizationId: "org-chargelab" },
      permissions: expect.arrayContaining(["admin:access"])
    });

    const filled = {
      ...parsed,
      AGENT_MODEL: "MiniMax-M2.7",
      AGENT_API_KEY: "local-pi-api-key"
    };
    const serverEnv = loadServerEnv(filled);

    expect(serverEnv.AUTH_MODE).toBe("production");
    expect(serverEnv.OBJECT_STORE_MODE).toBe("local");
    expect(serverEnv.DEBUG_DEVICE_GATEWAY_MODE).toBe("simulator");
    expect(serverEnv.DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION).toBe(true);
    expect(serverEnv.AGENT_PROVIDER).toBe("live");
  });

  it("keeps generated local storage and restore artifacts out of git", async () => {
    const gitignore = await readFile(gitignorePath, "utf8");

    expect(gitignore).toContain(".wiseeff-object-store/");
    expect(gitignore).toContain(".wiseeff-backups/");
    expect(gitignore).toContain(".wiseeff-restore/");
  });
});
