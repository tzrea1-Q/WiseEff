import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = "ops/self-hosted/scripts/npm-ci-with-diagnostics.sh";

function writeFakeNpm(binDir: string, body: string) {
  const npmPath = join(binDir, "npm");
  writeFileSync(npmPath, `#!/bin/sh\n${body}\n`);
  chmodSync(npmPath, 0o755);
}

describe("npm-ci-with-diagnostics.sh", () => {
  it("exports sanitized npm debug logs and preserves the npm exit code", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-npm-diagnostics-"));
    const binDir = join(root, "bin");
    const cacheDir = join(root, "npm-cache");
    mkdirSync(binDir);
    writeFakeNpm(binDir, `
mkdir -p "$NPM_CONFIG_CACHE/_logs"
printf '%s\\n' \\
  'fetch https://operator:proxy-secret@registry.example.com/pkg' \\
  '_authToken=registry-secret' \\
  'password=account-secret' \\
  'NPM_TOKEN=environment-secret' \\
  '{"token":"json-secret"}' \\
  'Authorization: Bearer bearer-secret' \\
  'npm error code EAI_AGAIN' \\
  > "$NPM_CONFIG_CACHE/_logs/2026-08-22T00_00_00_000Z-debug-0.log"
exit 47
    `);

    const result = spawnSync("sh", [script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        NPM_CONFIG_CACHE: cacheDir
      }
    });

    expect(result.status).toBe(47);
    expect(result.stderr).toContain("WISEEFF_NPM_CI_DIAGNOSTICS_BEGIN");
    expect(result.stderr).toContain("npm error code EAI_AGAIN");
    expect(result.stderr).toContain("[REDACTED]");
    expect(result.stderr).not.toContain("proxy-secret");
    expect(result.stderr).not.toContain("registry-secret");
    expect(result.stderr).not.toContain("account-secret");
    expect(result.stderr).not.toContain("environment-secret");
    expect(result.stderr).not.toContain("json-secret");
    expect(result.stderr).not.toContain("bearer-secret");
    expect(result.stderr).toContain("WISEEFF_NPM_CI_DIAGNOSTICS_END");
  });

  it("reports a missing debug log without masking the npm failure", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-npm-no-log-"));
    const binDir = join(root, "bin");
    mkdirSync(binDir);
    writeFakeNpm(binDir, "exit 19");

    const result = spawnSync("sh", [script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        NPM_CONFIG_CACHE: join(root, "npm-cache")
      }
    });

    expect(result.status).toBe(19);
    expect(result.stderr).toContain("npm_debug_log=not-found");
  });

  it("stays silent when npm ci succeeds", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-npm-success-"));
    const binDir = join(root, "bin");
    mkdirSync(binDir);
    writeFakeNpm(binDir, "exit 0");

    const result = spawnSync("sh", [script], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` }
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("routes every locked tarball through the configured registry and suppresses deployment-only requests", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-npm-registry-"));
    const binDir = join(root, "bin");
    const trace = join(root, "npm-env");
    mkdirSync(binDir);
    writeFakeNpm(
      binDir,
      `printf '%s|%s|%s|%s|%s\n' "$npm_config_registry" "$npm_config_replace_registry_host" "$npm_config_audit" "$npm_config_fund" "$npm_config_update_notifier" > "$WISEEFF_TEST_TRACE"`
    );

    const result = spawnSync("sh", [script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        WISEEFF_TEST_TRACE: trace,
        WISEEFF_NPM_REGISTRY: "https://npm.example.com/repository/npm/"
      }
    });

    expect(result.status).toBe(0);
    expect(readFileSync(trace, "utf8")).toBe(
      "https://npm.example.com/repository/npm/|always|false|false|false\n"
    );
  });
});
