import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseEnvText } from "./ip-lab-profile";

const script = "ops/self-hosted/scripts/setup.sh";

function runSetup(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

describe("setup.sh", () => {
  it("prints a Quick IP lab env from flags", () => {
    const result = runSetup([
      "--non-interactive",
      "--print-env",
      "--profile",
      "ip-lab",
      "--ip",
      "203.0.113.10",
      "--admin-password",
      "ReplaceWithAStrongPassword"
    ]);
    expect(result.status).toBe(0);
    const env = parseEnvText(result.stdout);
    expect(env.WISEEFF_DEPLOY_PROFILE).toBe("ip-lab");
    expect(env.WISEEFF_PUBLIC_URL).toBe("http://203.0.113.10");
    expect(env.DATABASE_URL).toContain(env.POSTGRES_PASSWORD);
    expect(env.XIAOZE_DETERMINISTIC).toBe("true");
    expect(env.WISEEFF_LAB_SEED).toBe("chargelab");
  });

  it("prints an ACME env from the bash renderer", () => {
    const result = runSetup(
      [
        "--non-interactive",
        "--print-env",
        "--profile",
        "acme",
        "--host",
        "wiseeff.example.com",
        "--tls-email",
        "ops@example.com",
        "--admin-password",
        "ReplaceWithAStrongPassword"
      ],
      { WISEEFF_SETUP_RENDER: "bash" }
    );
    expect(result.status).toBe(0);
    const env = parseEnvText(result.stdout);
    expect(env.WISEEFF_DEPLOY_PROFILE).toBe("acme");
    expect(env.WISEEFF_CADDYFILE).toBe("Caddyfile.example");
    expect(env.WISEEFF_PUBLIC_URL).toBe("https://wiseeff.example.com");
    expect(env.DATABASE_URL).not.toContain("${");
  });

  it("exits 2 when non-interactive setup has no host and no env", () => {
    const result = runSetup(["--non-interactive", "init", "--env-file", "/tmp/wiseeff-does-not-exist.env"]);
    expect(result.status).toBe(2);
  });
});
