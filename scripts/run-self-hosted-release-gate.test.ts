import { describe, expect, it } from "vitest";
import {
  buildConfiguredCommandResults,
  buildReleaseGateEvidence,
  evaluateReleaseGate,
  parseReleaseGateArgs,
  requiredReleaseGateCommands,
  type ReleaseGateInput
} from "./run-self-hosted-release-gate";

const baseInput: ReleaseGateInput = {
  metadata: {
    branch: "codex/m6-6-release-rollback-capacity-gate",
    commit: "abc1234",
    version: "m6.6-rc.1",
    dirty: false,
    targetEnvironment: "self-hosted-staging",
    artifactRef: "registry.local/wiseeff:abc1234",
    migrations: ["0010_m5_user_governance.sql"],
    envFingerprint: "sha256:1234",
    syntheticAcceptanceMode: "target-non-hdc",
    hdc: { status: "skipped_by_scope", evidencePath: null }
  },
  evidence: {
    backupEvidencePath: "docs/generated/backup-restore-drill.md",
    rollbackPlanPath: "docs/runbooks/release-rollback.md",
    rollbackRehearsalEvidencePath: "docs/generated/rollback-rehearsal.md",
    targetSyntheticEvidencePath: "docs/generated/acceptance-browser-evidence.md",
    capacityEvidencePath: "docs/generated/capacity-gate.md"
  },
  commands: requiredReleaseGateCommands.map((name) => ({ name, status: "passed", detail: "ok" })),
  dependencies: {
    selfHostedConfig: "passed",
    backupRestore: "passed",
    queueReadiness: "pending",
    observability: "pending"
  }
};

describe("self-hosted release gate", () => {
  it("passes a release candidate with complete metadata, command gates, and target evidence", () => {
    const result = evaluateReleaseGate({
      ...baseInput,
      dependencies: {
        selfHostedConfig: "passed",
        backupRestore: "passed",
        queueReadiness: "passed",
        observability: "passed"
      }
    });

    expect(result.status).toBe("passed");
    expect(result.blockers).toEqual([]);
    expect(result.pending).toEqual([]);
  });

  it("blocks missing release metadata and explicit HDC scope", () => {
    const result = evaluateReleaseGate({
      ...baseInput,
      metadata: {
        ...baseInput.metadata,
        version: "",
        targetEnvironment: "",
        artifactRef: "",
        migrations: [],
        hdc: { status: "enabled", evidencePath: null }
      }
    });

    expect(result.status).toBe("failed");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "Release version label is required.",
        "Target environment label is required.",
        "Release artifact reference is required.",
        "At least one migration entry or explicit no-op marker is required.",
        "HDC enabled releases require an HDC evidence path."
      ])
    );
  });

  it("blocks failed command gates and leaves unavailable M6 dependency evidence pending", () => {
    const result = evaluateReleaseGate({
      ...baseInput,
      commands: baseInput.commands.map((command) =>
        command.name === "build" ? { ...command, status: "failed" as const, detail: "vite build failed" } : command
      )
    });

    expect(result.status).toBe("failed");
    expect(result.blockers).toContain("Command gate failed: build.");
    expect(result.pending).toEqual(
      expect.arrayContaining([
        "Queue readiness evidence is pending.",
        "Observability evidence is pending."
      ])
    );
  });

  it("renders redacted machine-readable release evidence for operators", () => {
    const evidence = buildReleaseGateEvidence({
      date: "2026-06-03T00:00:00.000Z",
      input: {
        ...baseInput,
        metadata: {
          ...baseInput.metadata,
          envFingerprint: "sha256:abcdef",
          artifactRef: "registry.local/wiseeff:abc1234?token=secret"
        }
      },
      result: evaluateReleaseGate(baseInput)
    });

    expect(evidence).toContain("## M6.6 Self-Hosted Release Gate Evidence");
    expect(evidence).toContain("- Version: `m6.6-rc.1`");
    expect(evidence).toContain("- Artifact: `registry.local/wiseeff:abc1234?token=<redacted>`");
    expect(evidence).toContain("| docs:check | passed | ok |");
    expect(evidence).toContain("### Pending Evidence");
    expect(evidence).not.toContain("token=secret");
  });

  it("accepts npm-config flags and stripped positional PowerShell values", () => {
    expect(
      parseReleaseGateArgs(["docs/generated/m6-release-readiness.md", "docs/generated/capacity-gate.md"], {
        npm_config_output: "true",
        npm_config_capacity_evidence: "true",
        npm_config_target_environment: "stage-a",
        npm_config_artifact_ref: "registry.local/wiseeff:rc1",
        npm_config_synthetic_mode: "target-non-hdc"
      })
    ).toMatchObject({
      output: "docs/generated/m6-release-readiness.md",
      capacityEvidencePath: "docs/generated/capacity-gate.md",
      targetEnvironment: "stage-a",
      artifactRef: "registry.local/wiseeff:rc1",
      syntheticAcceptanceMode: "target-non-hdc"
    });
  });

  it("parses explicit target dependency evidence statuses", () => {
    expect(
      parseReleaseGateArgs([
        "--backup-restore",
        "passed",
        "--queue-readiness",
        "passed",
        "--observability",
        "failed"
      ])
    ).toMatchObject({
      backupRestoreStatus: "passed",
      queueReadinessStatus: "passed",
      observabilityStatus: "failed"
    });
  });

  it("marks configured command gates as pending until they are actually run", () => {
    const commands = buildConfiguredCommandResults({ scripts: { "docs:check": "tsx scripts/check-doc-governance.ts" } });

    expect(commands.find((command) => command.name === "docs:check")).toMatchObject({
      status: "pending",
      detail: "configured_not_run"
    });
    expect(commands.find((command) => command.name === "build")).toMatchObject({
      status: "failed",
      detail: "missing package script"
    });
  });
});
