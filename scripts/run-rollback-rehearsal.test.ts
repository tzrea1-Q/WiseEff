import { describe, expect, it } from "vitest";
import {
  buildRollbackRehearsalEvidence,
  evaluateRollbackRehearsal,
  parseRollbackRehearsalArgs,
  type RollbackRehearsalInput
} from "./run-rollback-rehearsal";

const baseInput: RollbackRehearsalInput = {
  metadata: {
    environment: "self-hosted-staging",
    releaseVersion: "m6.6-rc.1",
    candidateArtifact: "registry.local/wiseeff:candidate",
    previousArtifact: "registry.local/wiseeff:stable",
    approvalOwner: "ops-admin",
    maintenanceWindow: "2026-06-03T10:00:00Z/2026-06-03T11:00:00Z"
  },
  steps: {
    stopWrites: "passed",
    queueDrain: "passed",
    artifactRollback: "passed",
    databaseRestore: "skipped_by_scope",
    objectStoreRestore: "skipped_by_scope",
    postRollbackSmoke: "passed"
  },
  artifacts: {
    backupEvidencePath: "docs/generated/m6-backup-restore-evidence.md",
    smokeEvidencePath: "docs/generated/selfhost-smoke.md",
    queueEvidencePath: "docs/generated/m6-queue-readiness-evidence.md",
    notesPath: "docs/generated/rollback-notes.md"
  }
};

describe("rollback rehearsal evidence", () => {
  it("passes when rollback rehearsal metadata, steps, and artifacts are complete", () => {
    const result = evaluateRollbackRehearsal(baseInput);

    expect(result).toEqual({
      status: "passed",
      blockers: [],
      pending: []
    });
  });

  it("blocks missing metadata and failed rollback steps", () => {
    const result = evaluateRollbackRehearsal({
      ...baseInput,
      metadata: {
        ...baseInput.metadata,
        releaseVersion: "",
        previousArtifact: ""
      },
      steps: {
        ...baseInput.steps,
        artifactRollback: "failed",
        postRollbackSmoke: "pending"
      }
    });

    expect(result.status).toBe("failed");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "Release version is required.",
        "Previous artifact reference is required.",
        "Rollback step failed: artifact rollback."
      ])
    );
    expect(result.pending).toContain("Rollback step pending: post-rollback smoke.");
  });

  it("does not accept local-only environments as target rollback evidence", () => {
    const result = evaluateRollbackRehearsal({
      ...baseInput,
      metadata: {
        ...baseInput.metadata,
        environment: "local-self-hosted"
      }
    });

    expect(result.status).toBe("failed");
    expect(result.blockers).toContain(
      "Rollback environment must identify a configured target, staging, pilot, or self-hosted environment."
    );
  });

  it("requires restore evidence when database or object-store restore is in scope", () => {
    const result = evaluateRollbackRehearsal({
      ...baseInput,
      steps: {
        ...baseInput.steps,
        databaseRestore: "passed",
        objectStoreRestore: "passed"
      },
      artifacts: {
        ...baseInput.artifacts,
        backupEvidencePath: ""
      }
    });

    expect(result.blockers).toContain("Backup/restore evidence path is required when data restore is in scope.");
  });

  it("parses CLI statuses and default evidence output", () => {
    expect(
      parseRollbackRehearsalArgs([
        "--environment",
        "stage-a",
        "--release-version",
        "m6.6-rc.2",
        "--candidate-artifact",
        "candidate",
        "--previous-artifact",
        "stable",
        "--approval-owner",
        "operator",
        "--maintenance-window",
        "window",
        "--stop-writes",
        "passed",
        "--queue-drain",
        "pending",
        "--artifact-rollback",
        "passed",
        "--post-rollback-smoke",
        "passed"
      ])
    ).toMatchObject({
      output: "docs/generated/m6-rollback-rehearsal-evidence.md",
      input: {
        metadata: {
          environment: "stage-a",
          releaseVersion: "m6.6-rc.2",
          candidateArtifact: "candidate",
          previousArtifact: "stable",
          approvalOwner: "operator",
          maintenanceWindow: "window"
        },
        steps: {
          stopWrites: "passed",
          queueDrain: "pending",
          artifactRollback: "passed",
          databaseRestore: "skipped_by_scope",
          objectStoreRestore: "skipped_by_scope",
          postRollbackSmoke: "passed"
        }
      }
    });
  });

  it("builds redacted rollback rehearsal evidence", () => {
    const evidence = buildRollbackRehearsalEvidence({
      date: "2026-06-03T00:00:00.000Z",
      input: {
        ...baseInput,
        metadata: {
          ...baseInput.metadata,
          candidateArtifact: "registry.local/wiseeff:candidate?token=secret"
        }
      },
      result: evaluateRollbackRehearsal(baseInput)
    });

    expect(evidence).toContain("## M6.6 Rollback Rehearsal Evidence");
    expect(evidence).toContain("- Status: `passed`");
    expect(evidence).toContain("- Candidate artifact: `registry.local/wiseeff:candidate?token=<redacted>`");
    expect(evidence).toContain("| artifact rollback | passed |");
    expect(evidence).not.toContain("token=secret");
  });
});
