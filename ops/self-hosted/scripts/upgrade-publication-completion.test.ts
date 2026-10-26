import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function complete(owned: string, observed: string, action = "resume", skipped = "") {
  const directory = mkdtempSync(join(tmpdir(), "wiseeff-freeze-completion-"));
  writeFileSync(join(directory, "publication_freeze_owned"), owned);
  writeFileSync(join(directory, "publication_freeze_skipped"), skipped);
  try {
    const result = spawnSync("bash", ["-c", `
      source "$WISEEFF_TEST_UPGRADE_LIB"
      upgrade_run_dir="$WISEEFF_TEST_RUN_DIR"
      upgrade_run_id=freeze-completion
      upgrade_action="$WISEEFF_TEST_ACTION"
      upgrade_target_sha=target
      upgrade_json=true
      wiseeff_upgrade_wait_public_probe() { return 0; }
      wiseeff_upgrade_verify_final_state() { return 0; }
      wiseeff_upgrade_record_build_transport_completion() { return 0; }
      wiseeff_upgrade_publication_freeze() { printf '%s' "$1" >> "$upgrade_run_dir/clears"; }
      wiseeff_upgrade_publication_ops() {
        printf '%s' "$1" >> "$upgrade_run_dir/probes"
        [ "$WISEEFF_TEST_OBSERVED" != unavailable ] || return 1
        printf '%s' "$WISEEFF_TEST_OBSERVED"
      }
      wiseeff_upgrade_complete_candidate
    `], {
      encoding: "utf8",
      env: { ...process.env, WISEEFF_TEST_UPGRADE_LIB: resolve("ops/self-hosted/scripts/upgrade-lib.sh"),
        WISEEFF_TEST_RUN_DIR: directory, WISEEFF_TEST_ACTION: action, WISEEFF_TEST_OBSERVED: observed },
    });
    const read = (name: string) => {
      try { return readFileSync(join(directory, name), "utf8").trim(); } catch { return ""; }
    };
    return { result, completion: read("publication_freeze_completion"), next: read("next_action"),
      clears: read("clears"), probes: read("probes"), status: read("status") };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("upgrade completion publication freeze guidance", () => {
  it.each(["resume", "recover-candidate"])("reports a retained freeze on %s without clearing it", action => {
    const output = complete("false", '{"frozen":true}', action);
    expect(output.result.status, output.result.stderr).toBe(0);
    expect(output.completion).toBe("retained");
    expect(output.clears).toBe("");
    expect(output.probes).toBe("status");
    expect(output.next).toContain("collect-catalog-publication-status.sh");
    expect(output.result.stderr).toContain("publication freeze remains set");
    expect(JSON.parse(output.result.stdout)).toMatchObject({ status: "completed", publicationFreezeCompletion: "retained",
      nextAction: output.next });
    expect(output.status).toContain("publication_freeze_completion=retained");
  });

  it("clears only its own freeze and records the result", () => {
    const output = complete("true", "unavailable");
    expect(output.result.status, output.result.stderr).toBe(0);
    expect(output.clears).toBe("false");
    expect(output.probes).toBe("");
    expect(output.completion).toBe("cleared");
    expect(output.next).toBe("none");
  });

  it("does not invent a retained freeze when an operator has already cleared it", () => {
    const output = complete("false", '{"frozen":false}');
    expect(output.result.status, output.result.stderr).toBe(0);
    expect(output.completion).toBe("not-frozen");
    expect(output.next).toBe("none");
    expect(output.clears).toBe("");
  });

  it.each(["unavailable", "null", '{"frozen":"false"}'])("retains uncertainty when the status is %s", observed => {
    const output = complete("false", observed);
    expect(output.result.status, output.result.stderr).toBe(0);
    expect(output.completion).toBe("unknown");
    expect(output.next).not.toBe("none");
    expect(output.clears).toBe("");
  });

  it("does not require a manager LOGIN during first introduction", () => {
    const output = complete("false", "unavailable", "resume", "first-intro-unconfigured");
    expect(output.result.status, output.result.stderr).toBe(0);
    expect(output.completion).toBe("not-managed");
    expect(output.probes).toBe("");
    expect(output.next).toBe("none");
  });

  it.each(["retained", "unknown"])("exposes %s and the next action through persisted JSON status", completion => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-freeze-status-"));
    const directory = join(root, "run-1");
    mkdirSync(directory);
    try {
      for (const [key, value] of Object.entries({ status: "run_id=run-1", phase: "completed", outcome: "completed",
        publication_freeze_owned: "false", publication_freeze_completion: completion, next_action: "Inspect publication freeze" })) {
        writeFileSync(join(directory, key), value);
      }
      const result = spawnSync("bash", ["ops/self-hosted/scripts/upgrade.sh", "status", "--json",
        "--state-dir", root, "--run-id", "run-1"], { encoding: "utf8", env: process.env });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ phase: "completed", publicationFreezeOwned: "false",
        publicationFreezeCompletion: completion, nextAction: "Inspect publication freeze" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
