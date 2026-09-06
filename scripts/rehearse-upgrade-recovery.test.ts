import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ownsRecoveryContainer } from "./rehearse-upgrade-recovery";

it("requires exact created container identity and private run label for cleanup", () => {
  const inspect = { Id: "created", Config: { Labels: { "wiseeff.synthetic-recovery-run": "this-run" } } };
  expect(ownsRecoveryContainer(inspect, "created", "this-run")).toBe(true);
  expect(ownsRecoveryContainer(inspect, "other", "this-run")).toBe(false);
  expect(ownsRecoveryContainer(inspect, "created", "another-run")).toBe(false);
  expect(ownsRecoveryContainer({ Id: "created" }, "created", "this-run")).toBe(false);
});

it("refuses external target and missing explicit synthetic mode before starting Docker", () => {
  for (const args of [[], ["--synthetic-only", "--target", "forbidden-target"]]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", path.resolve("scripts/rehearse-upgrade-recovery.ts"), ...args], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).status).toBe("blocked");
  }
});

describe.skipIf(process.env.UPG_RECOVERY_DOCKER_TEST !== "1")("actual isolated three-store restore", () => {
  it("backs up and restores separate PostgreSQL, MinIO and persisted Redis targets", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", path.resolve("scripts/rehearse-upgrade-recovery.ts"), "--synthetic-only"], {
      encoding: "utf8", timeout: 90000,
    });
    const evidence = JSON.parse(result.stdout);
    expect(evidence).toMatchObject({ status: "passed", evidence: "synthetic sentinel only", releaseReady: false,
      fullBusinessVerification: false, backupExists: true, checksumVerified: true, restoreExecuted: true,
      businessVerified: true, ownerAclVerified: true, cleanupVerified: true, objectCount: 1 });
    expect(result.status).toBe(0);
    expect(evidence.manifestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.stdout).not.toContain("postgres://");
  }, 100000);
});
