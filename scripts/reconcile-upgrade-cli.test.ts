import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const fixture = readFileSync("scripts/fixtures/upgrade-82344044-catalog-gate.sh", "utf8");
const cli = (args: string[]) => spawnSync(process.execPath,
  ["--import", "tsx", "scripts/reconcile-parameter-definitions.ts", ...args],
  { encoding: "utf8", env: { PATH: process.env.PATH, DATABASE_URL: "", DOTENV_CONFIG_PATH: "/dev/null" } });

describe("UPG-01 actual process boundary", () => {
  it.each([
    ["--verify"], ["--verify", "--catalog-only"],
    ["--verify", "--report-id", "absent"],
    ["--verify", "--report-id", "unapproved"],
    ["--verify", "--report-id", "pre-activation"],
  ])("rejects unbound release input %j before connecting", (...args) => {
    const result = cli(args);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ code: "PCAT-UPG-RELEASE-CONTEXT-UNAVAILABLE" });
  });
  it.each([
    ["--unknown"], ["--verify", "--diagnostic"],
    ["--verify", "--diagnostic", "--report-id"],
    ["--verify", "--diagnostic", "--catalog-only"],
    ["--verify", "--verify"],
  ])("rejects malformed or ambiguous input %j", (...args) => {
    expect(cli(args).status).not.toBe(0);
  });
  it("executes the exact old gate against the new npm command and never advances", () => {
    // The transport adapter replaces only Docker exec; npm and the target CLI
    // are real child processes. This is not a real Compose deployment test.
    const result = spawnSync("bash", ["-c", `${fixture}
      wiseeff_upgrade_compose() { shift 3; "$@"; }
      wiseeff_upgrade_state_read() { printf 'validating-app'; }
      wiseeff_upgrade_record_failure() { printf 'OLD-GATE-REFUSED\\n'; }
      if wiseeff_upgrade_verify_parameter_catalog; then
        printf 'QUEUE-OR-PROXY-RESUMED\\n'; exit 0
      else exit 70; fi
    `], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "", DOTENV_CONFIG_PATH: "/dev/null" } });
    expect(result.status).toBe(70);
    expect(result.stdout).toContain("PCAT-UPG-RELEASE-CONTEXT-UNAVAILABLE");
    expect(result.stdout).toContain("OLD-GATE-REFUSED");
    expect(result.stdout).not.toContain("QUEUE-OR-PROXY-RESUMED");
  });
  it("preserves the independently extracted 82344044 source gate bytes", () => {
    // Independently checked against git show 82344044...:ops/self-hosted/scripts/upgrade-lib.sh.
    // Commit the excerpt so shallow CI does not silently skip source provenance.
    expect(createHash("sha256").update(fixture).digest("hex")).toBe(
      "29c28f2b5951bf4650984ec1be07ac121b8bb61c07e29388f70b7848e8952232",
    );
  });
});
