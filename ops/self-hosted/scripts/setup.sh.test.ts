import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  it("documents the private build-network contract", () => {
    const result = runSetup(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--build-network-file");
  });

  it("loads the private build-network contract before setup preflight succeeds", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-setup-build-network-"));
    const envFile = join(directory, "runtime.env");
    const buildNetworkFile = join(directory, "build-network.env");
    writeFileSync(
      envFile,
      [
        "WISEEFF_SITE_HOST=203.0.113.10",
        "WISEEFF_PUBLIC_URL=http://203.0.113.10",
        "WISEEFF_CADDYFILE=Caddyfile.ip-lab",
        "POSTGRES_PASSWORD=probe",
        "DATABASE_URL=postgres://wiseeff:probe@postgres:5432/wiseeff",
        "AUTH_PROVIDER=local",
        ""
      ].join("\n"),
      { mode: 0o600 }
    );
    writeFileSync(buildNetworkFile, "HTTPS_PROXY=http://operator:secret@proxy.example.com:8080\n", {
      mode: 0o644
    });
    chmodSync(buildNetworkFile, 0o644);

    const result = runSetup(
      ["--non-interactive", "preflight", "--env-file", envFile, "--build-network-file", buildNetworkFile],
      {
        WISEEFF_SETUP_RENDER: "bash",
        WISEEFF_OPERATION_LOCK_DIR: join(directory, "lock"),
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        ALL_PROXY: "",
        NO_PROXY: "",
        http_proxy: "",
        https_proxy: "",
        all_proxy: "",
        no_proxy: ""
      }
    );

    expect(result.status).toBe(10);
    expect(result.stderr).toContain("mode 644");
    expect(result.stdout).not.toContain("Preflight passed");
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("operator:secret");
  });

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
