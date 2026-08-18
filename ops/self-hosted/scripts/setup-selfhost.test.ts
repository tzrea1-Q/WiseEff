import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnvText } from "./ip-lab-profile";
import { setupSelfHostEnv } from "./setup-selfhost";

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
    expect(after.AGENT_API_KEY).toBe("sk-demo");
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
});
