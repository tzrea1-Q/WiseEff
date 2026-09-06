import { afterEach, describe, expect, it, vi } from "vitest";
import * as reportModule from "../server/modules/release-verification/report/index";
import { validPrepare } from "../server/modules/release-verification/report/fixtures";
import type { Database } from "../server/shared/database/client";
import type { ReleaseVerificationReport } from "../server/modules/release-verification/core";
import {
  buildConfiguredCommandResults,
  buildReleaseGateEvidence,
  evaluateReleaseGate,
  parseReleaseGateArgs,
  requiredReleaseGateCommands,
  runCatalogReleaseAction,
  type CatalogReleaseBoundary,
  type CatalogReleaseTarget,
  type ReleaseGateInput
} from "./run-self-hosted-release-gate";

describe("Catalog release invocation adapter (not complete gate execution evidence)", () => {
  afterEach(() => vi.restoreAllMocks());
  const boundary = (): CatalogReleaseBoundary => {
    const prepare = validPrepare();
    return { ...prepare.lineage, p12State: "not-started", pins: prepare.pins, subject: prepare.subject };
  };
  const fixture = () => {
    const current = boundary();
    const db: Database = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })), transaction: async (body) => body(db) };
    const target: CatalogReleaseTarget = {
      withExclusiveBoundary: vi.fn(async (body) => body()), observeBoundary: vi.fn(async () => current),
      activateP12: vi.fn(), startCandidate: vi.fn(), releasePublic: vi.fn(),
    };
    return { db, target, current, action: "activate-p12", reportDigest: "sha256:unit-approved-report" };
  };
  it("real Report service returns absent without invoking activation", async () => {
    const options = fixture();
    expect(await runCatalogReleaseAction(options)).toEqual({ ok: false, reason: "absent" });
    expect(options.db.query).toHaveBeenCalled();
    expect(options.target.activateP12).not.toHaveBeenCalled();
  });
  it("real Report service preserves unapproved instead of trusting a stored passed decision", async () => {
    const options = fixture();
    vi.mocked(options.db.query).mockResolvedValueOnce({ rows: [{ purpose: "pre-activation", decision: "passed", digest: options.reportDigest }], rowCount: 1 });
    expect(await runCatalogReleaseAction(options)).toEqual({ ok: false, reason: "unapproved" });
    expect(options.target.activateP12).not.toHaveBeenCalled();
  });
  it.each(["", "resume", "retire-p13", "apply", "--diagnostic"])("rejects unknown action %s before querying or locking", async (action) => {
    const options = fixture();
    expect(await runCatalogReleaseAction({ ...options, action })).toEqual({ ok: false, reason: "unknown-action" });
    expect(options.target.withExclusiveBoundary).not.toHaveBeenCalled();
    expect(options.db.query).not.toHaveBeenCalled();
  });
  it("rejects missing report before acquiring target resources", async () => {
    const options = fixture();
    expect(await runCatalogReleaseAction({ ...options, reportDigest: " " })).toEqual({ ok: false, reason: "missing-report" });
    expect(options.target.withExclusiveBoundary).not.toHaveBeenCalled();
  });
  it("real runtime reader refuses pre-pin rather than using a pre-activation report", async () => {
    const options = fixture();
    expect(await runCatalogReleaseAction({ ...options, action: "start-candidate" })).toEqual({ ok: false, reason: "pre-pin" });
    expect(options.target.startCandidate).not.toHaveBeenCalled();
  });
  const reportStub = (options: ReturnType<typeof fixture>, changes: Partial<ReleaseVerificationReport> = {}) => {
    // This is adapter dispatch coverage only. It never prepares gates, inserts a report,
    // or represents a synthetic all-gates-passed report as release evidence.
    const report = {
      digest: options.reportDigest, purpose: "pre-activation", decision: "passed",
      pins: options.current.pins, phaseSnapshot: options.current.phaseSnapshot,
      predecessorReportDigests: [], pointerRollbackStatus: "open",
      evidenceRefs: [{ subject: options.current.subject }], ...changes,
    } as ReleaseVerificationReport;
    vi.spyOn(reportModule, "createVerificationReportService").mockReturnValue({
      readReport: vi.fn(async () => ({ kind: "present", report })),
      readApprovedRuntimePin: vi.fn(async () => ({ kind: "present", report })),
    } as unknown as reportModule.VerificationReportService);
  };
  it("invokes only the purpose effect under its target lock after two equal observations", async () => {
    const options = fixture(); reportStub(options);
    expect(await runCatalogReleaseAction(options)).toEqual({ ok: true, action: "activate-p12", reportDigest: options.reportDigest });
    expect(options.target.observeBoundary).toHaveBeenCalledTimes(2);
    expect(options.target.activateP12).toHaveBeenCalledOnce();
    expect(options.target.startCandidate).not.toHaveBeenCalled();
    expect(options.target.releasePublic).not.toHaveBeenCalled();
  });
  it.each([
    ["purpose", { purpose: "public-release" }, "wrong-purpose"],
    ["decision", { decision: "blocked" }, "wrong-purpose"],
    ["phase", { phaseSnapshot: "other-phase" }, "boundary-mismatch"],
    ["report", { digest: "other-digest" }, "boundary-mismatch"],
    ["lineage", { predecessorReportDigests: ["another-run"] }, "boundary-mismatch"],
    ["rollback", { pointerRollbackStatus: "closed" }, "boundary-mismatch"],
    ["empty subject evidence", { evidenceRefs: [] }, "boundary-mismatch"],
  ] as const)("rejects wrong %s before effects", async (_name, changes, reason) => {
    const options = fixture(); reportStub(options, changes as Partial<ReleaseVerificationReport>);
    expect(await runCatalogReleaseAction(options)).toEqual({ ok: false, reason });
    expect(options.target.activateP12).not.toHaveBeenCalled();
  });
  it("rejects live target drift after report read", async () => {
    const options = fixture(); reportStub(options);
    vi.mocked(options.target.observeBoundary).mockResolvedValueOnce(options.current).mockResolvedValueOnce({ ...options.current, phaseSnapshot: "changed" });
    expect(await runCatalogReleaseAction(options)).toEqual({ ok: false, reason: "boundary-mismatch" });
    expect(options.target.activateP12).not.toHaveBeenCalled();
  });
  it.each(["artifact", "database", "catalog", "mappingArchive", "cutover", "target", "recovery"] as const)("rejects another %s pin before effect", async (family) => {
    const options = fixture();
    reportStub(options, { pins: { ...options.current.pins, [family]: { ...options.current.pins[family], unexpected: "another-run" } } });
    expect(await runCatalogReleaseAction(options)).toEqual({ ok: false, reason: "boundary-mismatch" });
    expect(options.target.activateP12).not.toHaveBeenCalled();
  });
  it("rejects report evidence from another deployment subject", async () => {
    const options = fixture();
    reportStub(options, { evidenceRefs: [{ subject: { ...options.current.subject, targetId: "another-target" } }] as ReleaseVerificationReport["evidenceRefs"] });
    expect(await runCatalogReleaseAction(options)).toEqual({ ok: false, reason: "boundary-mismatch" });
    expect(options.target.activateP12).not.toHaveBeenCalled();
  });
  it("preserves unknown outcome after an effect loses its commit acknowledgement", async () => {
    const options = fixture(); reportStub(options);
    vi.mocked(options.target.activateP12).mockRejectedValue(new Error("private credentials never leave this exception"));
    expect(await runCatalogReleaseAction(options)).toEqual({ ok: false, reason: "unknown-outcome" });
    expect(options.target.activateP12).toHaveBeenCalledOnce();
    expect(options.target.releasePublic).not.toHaveBeenCalled();
  });
});

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
    identityEvidencePath: "docs/generated/m6-identity-evidence.md",
    rollbackPlanPath: "docs/runbooks/release-rollback.md",
    rollbackRehearsalEvidencePath: "docs/generated/rollback-rehearsal.md",
    targetSyntheticEvidencePath: "docs/generated/acceptance-browser-evidence.md",
    capacityEvidencePath: "docs/generated/capacity-gate.md",
    queueEvidencePath: "docs/generated/m6-queue-readiness-evidence.md",
    observabilityEvidencePath: "docs/generated/m6-observability-evidence.md"
  },
  commands: requiredReleaseGateCommands.map((name) => ({ name, status: "passed", detail: "ok" })),
  dependencies: {
    selfHostedConfig: "passed",
    backupRestore: "passed",
    identityReadiness: "pending",
    rollbackReadiness: "pending",
    capacityReadiness: "pending",
    targetSyntheticReadiness: "pending",
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
        identityReadiness: "passed",
        rollbackReadiness: "passed",
        capacityReadiness: "passed",
        targetSyntheticReadiness: "passed",
        queueReadiness: "passed",
        observability: "passed"
      }
    } as ReleaseGateInput);

    expect(result.status).toBe("passed");
    expect(result.blockers).toEqual([]);
    expect(result.pending).toEqual([]);
  });

  it("keeps rollback, capacity, and target synthetic evidence pending without explicit dependency statuses", () => {
    const result = evaluateReleaseGate({
      ...baseInput,
      dependencies: {
        selfHostedConfig: "passed",
        backupRestore: "passed",
        identityReadiness: "passed",
        rollbackReadiness: "pending",
        capacityReadiness: "pending",
        targetSyntheticReadiness: "pending",
        queueReadiness: "passed",
        observability: "passed"
      }
    } as ReleaseGateInput);

    expect(result.status).toBe("failed");
    expect(result.pending).toEqual(
      expect.arrayContaining([
        "Rollback readiness evidence is pending.",
        "Capacity readiness evidence is pending.",
        "Target synthetic readiness evidence is pending."
      ])
    );
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

  it("does not accept local-only environments as target release evidence", () => {
    const result = evaluateReleaseGate({
      ...baseInput,
      metadata: {
        ...baseInput.metadata,
        targetEnvironment: "local-self-hosted"
      },
      dependencies: {
        selfHostedConfig: "passed",
        backupRestore: "passed",
        identityReadiness: "passed",
        rollbackReadiness: "passed",
        capacityReadiness: "passed",
        targetSyntheticReadiness: "passed",
        queueReadiness: "passed",
        observability: "passed"
      }
    });

    expect(result.status).toBe("failed");
    expect(result.blockers).toContain(
      "Target environment must identify a configured target, staging, pilot, or self-hosted environment."
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
        "Identity readiness evidence is pending.",
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
    expect(evidence).toContain("- Command gate scope: `local prerelease commands; not target evidence`");
    expect(evidence).toContain("- Target evidence scope: `dependency readiness requires real self-hosted target evidence`");
    expect(evidence).toContain("- Version: `m6.6-rc.1`");
    expect(evidence).toContain("- Artifact: `registry.local/wiseeff:abc1234?token=<redacted>`");
    expect(evidence).toContain("- Identity evidence: `docs/generated/m6-identity-evidence.md`");
    expect(evidence).toContain("- Queue evidence: `docs/generated/m6-queue-readiness-evidence.md`");
    expect(evidence).toContain("- Observability evidence: `docs/generated/m6-observability-evidence.md`");
    expect(evidence).toContain("| docs:check | passed | ok |");
    expect(evidence).toContain("| identity readiness | pending |");
    expect(evidence).toContain("| rollback readiness | pending |");
    expect(evidence).toContain("| capacity readiness | pending |");
    expect(evidence).toContain("| target synthetic readiness | pending |");
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
        "--identity-evidence",
        "docs/generated/target-identity-evidence.md",
        "--identity-readiness",
        "passed",
        "--rollback-readiness",
        "passed",
        "--capacity-readiness",
        "pending",
        "--target-synthetic-readiness",
        "passed",
        "--queue-readiness",
        "passed",
        "--queue-evidence",
        "docs/generated/target-queue-evidence.md",
        "--observability",
        "failed",
        "--observability-evidence",
        "docs/generated/target-observability-evidence.md"
      ])
    ).toMatchObject({
      backupRestoreStatus: "passed",
      identityEvidencePath: "docs/generated/target-identity-evidence.md",
      identityReadinessStatus: "passed",
      rollbackReadinessStatus: "passed",
      capacityReadinessStatus: "pending",
      targetSyntheticReadinessStatus: "passed",
      queueReadinessStatus: "passed",
      queueEvidencePath: "docs/generated/target-queue-evidence.md",
      observabilityStatus: "failed",
      observabilityEvidencePath: "docs/generated/target-observability-evidence.md"
    });
  });

  it("parses equals-form target dependency evidence statuses", () => {
    expect(
      parseReleaseGateArgs([
        "--backup-restore=passed",
        "--identity-evidence=docs/generated/target-identity-evidence.md",
        "--identity-readiness=pending",
        "--rollback-readiness=failed",
        "--capacity-readiness=passed",
        "--target-synthetic-readiness=pending",
        "--queue-readiness=pending",
        "--queue-evidence=docs/generated/target-queue-evidence.md",
        "--observability=passed",
        "--observability-evidence=docs/generated/target-observability-evidence.md"
      ])
    ).toMatchObject({
      backupRestoreStatus: "passed",
      identityEvidencePath: "docs/generated/target-identity-evidence.md",
      identityReadinessStatus: "pending",
      rollbackReadinessStatus: "failed",
      capacityReadinessStatus: "passed",
      targetSyntheticReadinessStatus: "pending",
      queueReadinessStatus: "pending",
      queueEvidencePath: "docs/generated/target-queue-evidence.md",
      observabilityStatus: "passed",
      observabilityEvidencePath: "docs/generated/target-observability-evidence.md"
    });
  });

  it("blocks passed queue and observability dependencies without evidence paths", () => {
    const result = evaluateReleaseGate({
      ...baseInput,
      evidence: {
        ...baseInput.evidence,
        queueEvidencePath: "",
        observabilityEvidencePath: ""
      },
      dependencies: {
        ...baseInput.dependencies,
        queueReadiness: "passed",
        observability: "passed"
      }
    });

    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "Queue evidence path is required when queue readiness is passed.",
        "Observability evidence path is required when observability is passed."
      ])
    );
  });

  it("blocks passed rollback, capacity, and target synthetic dependencies without evidence paths", () => {
    const result = evaluateReleaseGate({
      ...baseInput,
      evidence: {
        ...baseInput.evidence,
        rollbackRehearsalEvidencePath: "",
        capacityEvidencePath: "",
        targetSyntheticEvidencePath: ""
      },
      dependencies: {
        ...baseInput.dependencies,
        rollbackReadiness: "passed",
        capacityReadiness: "passed",
        targetSyntheticReadiness: "passed"
      }
    });

    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "Rollback evidence path is required when rollback readiness is passed.",
        "Capacity evidence path is required when capacity readiness is passed.",
        "Target synthetic evidence path is required when target synthetic readiness is passed."
      ])
    );
  });

  it("accepts npm-config identity readiness status", () => {
    expect(
      parseReleaseGateArgs([], {
        npm_config_identity_readiness: "passed",
        npm_config_rollback_readiness: "failed",
        npm_config_capacity_readiness: "passed",
        npm_config_target_synthetic_readiness: "pending"
      })
    ).toMatchObject({
      identityReadinessStatus: "passed",
      rollbackReadinessStatus: "failed",
      capacityReadinessStatus: "passed",
      targetSyntheticReadinessStatus: "pending"
    });
  });

  it("defaults to the M6 backup restore evidence artifact", () => {
    expect(parseReleaseGateArgs([])).toMatchObject({
      backupEvidencePath: "docs/generated/m6-backup-restore-evidence.md",
      identityEvidencePath: "docs/generated/m6-identity-evidence.md",
      rollbackRehearsalEvidencePath: "docs/generated/m6-rollback-rehearsal-evidence.md",
      queueEvidencePath: "docs/generated/m6-queue-readiness-evidence.md",
      observabilityEvidencePath: "docs/generated/m6-observability-evidence.md"
    });
  });

  it("marks configured command gates as pending until they are actually run", () => {
    const commands = buildConfiguredCommandResults({
      scripts: {
        "docs:check": "tsx scripts/check-doc-governance.ts",
        "identity:check": "tsx scripts/check-identity-evidence.ts"
      }
    });

    expect(commands.find((command) => command.name === "docs:check")).toMatchObject({
      status: "pending",
      detail: "local_prerelease_command_configured_not_run_in_this_evidence"
    });
    expect(commands.find((command) => command.name === "identity:check")).toMatchObject({
      status: "pending",
      detail: "local_prerelease_command_configured_not_run_in_this_evidence"
    });
    expect(commands.find((command) => command.name === "build")).toMatchObject({
      status: "failed",
      detail: "missing package script"
    });
  });
});
