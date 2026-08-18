import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initIpLabEnv } from "./init-ip-lab";
import { evaluateIpLabEnv, parseEnvText } from "./ip-lab-profile";

describe("initIpLabEnv", () => {
  it("prints an env that passes preflight without writing", async () => {
    const result = await initIpLabEnv([
      "--ip",
      "203.0.113.10",
      "--admin-password",
      "ReplaceWithAStrongPassword",
      "--print-env"
    ]);

    expect(result.wrote).toBe(false);
    const parsed = parseEnvText(result.envText);
    expect(parsed.WISEEFF_PUBLIC_URL).toBe("http://203.0.113.10");
    expect(evaluateIpLabEnv(parsed).status).toBe("passed");
  });

  it("writes a mode-600 env file and refuses overwrite", async () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-ip-lab-"));
    const envFile = join(directory, ".env");

    const first = await initIpLabEnv([
      "--ip",
      "192.168.1.50",
      "--admin-password",
      "ReplaceWithAStrongPassword",
      "--env-file",
      envFile
    ]);
    expect(first.wrote).toBe(true);
    expect(readFileSync(envFile, "utf8")).toContain("WISEEFF_DEPLOY_PROFILE=ip-lab");

    await expect(
      initIpLabEnv([
        "--ip",
        "192.168.1.50",
        "--admin-password",
        "ReplaceWithAStrongPassword",
        "--env-file",
        envFile
      ])
    ).rejects.toThrow("already exists");
  });
});
