import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnvText } from "./ip-lab-profile";
import { setupSelfHostEnv } from "./setup-selfhost";
import { resolveXiaozeLlmConfig } from "../../../server/config/xiaozeLlmConfig";

describe("setup-selfhost writer", () => {
  it("prints an IP lab env without writing when --print-env is set", async () => {
    const result = await setupSelfHostEnv([
      "--print-env",
      "--profile",
      "ip-lab",
      "--ip",
      "203.0.113.10",
      "--admin-password",
      "ReplaceWithAStrongPassword",
      "--env-file",
      join(tmpdir(), "wiseeff-missing.env")
    ]);
    expect(result.wrote).toBe(false);
    expect(parseEnvText(result.envText).WISEEFF_PUBLIC_URL).toBe("http://203.0.113.10");
  });

  it("updates the LLM section without rotating database secrets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wiseeff-setup-"));
    const envFile = join(dir, ".env");
    const initial = await setupSelfHostEnv([
      "--profile",
      "ip-lab",
      "--ip",
      "203.0.113.10",
      "--admin-password",
      "ReplaceWithAStrongPassword",
      "--env-file",
      envFile
    ]);
    const before = parseEnvText(initial.envText);

    const updated = await setupSelfHostEnv([
      "llm",
      "--llm",
      "xiaoze",
      "--agent-api-base-url",
      "https://llm.example.com/v1",
      "--agent-model",
      "demo-model",
      "--agent-api-key",
      "sk-demo",
      "--env-file",
      envFile
    ]);
    const after = parseEnvText(readFileSync(envFile, "utf8"));
    expect(updated.wrote).toBe(true);
    expect(after.POSTGRES_PASSWORD).toBe(before.POSTGRES_PASSWORD);
    expect(after.MINIO_ROOT_PASSWORD).toBe(before.MINIO_ROOT_PASSWORD);
    expect(after.XIAOZE_LLM_API_KEY).toBe("sk-demo");
    expect(after).not.toHaveProperty("AGENT_API_KEY");
    expect(after.XIAOZE_DETERMINISTIC).toBe("false");
    expect(after.LOG_ANALYSIS_DETERMINISTIC).toBe("true");
    expect(after.WISEEFF_SITE_HOST).toBe("203.0.113.10");
  });

  it("refuses to overwrite an existing file without --force", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wiseeff-setup-"));
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "WISEEFF_DEPLOY_PROFILE=ip-lab\n");
    await expect(
      setupSelfHostEnv(["--profile", "ip-lab", "--ip", "203.0.113.10", "--env-file", envFile])
    ).rejects.toThrow("already exists");
  });

  it("migrates a legacy-only env through the Bash fallback and preserves non-Xiaoze settings", () => {
    const dir = mkdtempSync(join(tmpdir(), "wiseeff-setup-bash-"));
    const envFile = join(dir, ".env");
    const legacyInput = {
      AGENT_API_BASE_URL: "https://legacy.example.com/v1",
      XIAOZE_MODEL: "legacy-xiaoze-model",
      AGENT_MODEL: "legacy-agent-model",
      AGENT_API_KEY: "legacy-secret"
    };
    writeFileSync(
      envFile,
      `${baseExistingEnv()}\n${envLines(legacyInput)}`
    );

    const result = runBashMigration(dir, envFile);

    expect(result.status, result.stderr).toBe(0);
    const migrated = parseEnvText(readFileSync(envFile, "utf8"));
    expect(migrated.XIAOZE_LLM_API_BASE_URL).toBe("https://legacy.example.com/v1");
    expect(migrated.XIAOZE_LLM_MODEL).toBe("legacy-xiaoze-model");
    expect(migrated.XIAOZE_LLM_API_KEY).toBe("legacy-secret");
    expect(migrated.POSTGRES_PASSWORD).toBe("keep-postgres");
    expect(migrated.WISEEFF_SITE_HOST).toBe("203.0.113.10");
    expect(migrated).not.toHaveProperty("AGENT_API_BASE_URL");
    expect(migrated).not.toHaveProperty("AGENT_MODEL");
    expect(migrated).not.toHaveProperty("AGENT_API_KEY");
    expect(resolveXiaozeLlmConfig(migrated).config).toEqual(resolveXiaozeLlmConfig(legacyInput).config);
    expect(result.stderr).toContain(
      "[xiaoze-llm-config] legacy-used: XIAOZE_MODEL -> XIAOZE_LLM_MODEL"
    );
    expect(result.stderr).not.toContain("legacy-secret");
  });

  it("keeps a present blank canonical group authoritative in the Bash fallback", () => {
    const dir = mkdtempSync(join(tmpdir(), "wiseeff-setup-bash-"));
    const envFile = join(dir, ".env");
    const mixedInput = {
      XIAOZE_LLM_API_KEY: "   ",
      AGENT_API_BASE_URL: "https://legacy.example.com/v1",
      AGENT_MODEL: "legacy-model",
      AGENT_API_KEY: "legacy-secret"
    };
    writeFileSync(
      envFile,
      `${baseExistingEnv()}\n${envLines(mixedInput)}`
    );

    const result = runBashMigration(dir, envFile);

    expect(result.status, result.stderr).toBe(0);
    const migrated = parseEnvText(readFileSync(envFile, "utf8"));
    expect(migrated.XIAOZE_LLM_API_BASE_URL).toBe("");
    expect(migrated.XIAOZE_LLM_MODEL).toBe("");
    expect(migrated.XIAOZE_LLM_API_KEY).toBe("");
    expect(migrated.XIAOZE_DETERMINISTIC).toBe("true");
    expect(resolveXiaozeLlmConfig(migrated).config).toEqual(resolveXiaozeLlmConfig(mixedInput).config);
    expect(result.stderr).toContain(
      "[xiaoze-llm-config] legacy-conflict-ignored: AGENT_API_KEY -> XIAOZE_LLM_API_KEY"
    );
    expect(result.stderr).not.toContain("legacy-secret");
  });

  it("reports same-value legacy aliases as deprecated and ignored in the Bash fallback", () => {
    const dir = mkdtempSync(join(tmpdir(), "wiseeff-setup-bash-"));
    const envFile = join(dir, ".env");
    const mixedInput = {
      XIAOZE_LLM_API_BASE_URL: "https://same.example.com/v1",
      XIAOZE_LLM_MODEL: "same-model",
      XIAOZE_LLM_API_KEY: "same-secret",
      AGENT_API_BASE_URL: "https://same.example.com/v1",
      AGENT_MODEL: "same-model",
      AGENT_API_KEY: "same-secret"
    };
    writeFileSync(envFile, `${baseExistingEnv()}\n${envLines(mixedInput)}`);

    const result = runBashMigration(dir, envFile);

    expect(result.status, result.stderr).toBe(0);
    const migrated = parseEnvText(readFileSync(envFile, "utf8"));
    expect(resolveXiaozeLlmConfig(migrated).config).toEqual(resolveXiaozeLlmConfig(mixedInput).config);
    expect(result.stderr).toContain(
      "[xiaoze-llm-config] legacy-deprecated-ignored: AGENT_API_KEY -> XIAOZE_LLM_API_KEY"
    );
    expect(result.stderr).not.toContain("same-secret");
  });
});

function baseExistingEnv() {
  return [
    "WISEEFF_DEPLOY_PROFILE=ip-lab",
    "WISEEFF_TLS_MODE=http",
    "WISEEFF_SITE_HOST=203.0.113.10",
    "WISEEFF_TLS_EMAIL=unused-ip-lab@localhost",
    "WISEEFF_LAB_ADMIN_USERNAME=admin.ops",
    "WISEEFF_LAB_ADMIN_PASSWORD=KeepThisPassword",
    "WISEEFF_LAB_ADMIN_NAME=Platform Admin",
    "WISEEFF_LAB_SEED=chargelab",
    "POSTGRES_PASSWORD=keep-postgres",
    "MINIO_ROOT_PASSWORD=keep-minio"
  ].join("\n");
}

function runBashMigration(dir: string, envFile: string) {
  return spawnSync(
    "bash",
    ["ops/self-hosted/scripts/setup.sh", "--non-interactive", "--env-file", envFile, "llm"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        WISEEFF_SETUP_RENDER: "bash",
        WISEEFF_OPERATION_LOCK_DIR: join(dir, "operation-lock")
      }
    }
  );
}

function envLines(env: Record<string, string>) {
  return `${Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}
