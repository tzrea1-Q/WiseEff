import { describe, expect, it } from "vitest";
import {
  CATALOG_PUBLIC_RELEASE_PHASES,
  CATALOG_RELEASE_CHAIN_THREAT_MATRIX,
  buildConfiguredCommandResults,
  buildReleaseGateEvidence,
  evaluateCatalogReleaseChain,
  evaluateReleaseGate,
  parseReleaseGateArgs,
  requiredReleaseGateCommands,
  type CatalogReleaseChainInput,
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
    expect(evidence).toContain("### Catalog public-release chain (RI-01)");
    expect(evidence).toContain("- Catalog chain status: `failed`");
    expect(evidence).toContain(
      "- Local and Hosted command gates are not target, release, or production evidence."
    );
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

const digest = (seed: number): string => `sha256:${seed.toString(16).padStart(64, "0")}`;

const legalCatalogChain = (): CatalogReleaseChainInput => ({
  producersComplete: true,
  preActivationReportDigest: digest(1),
  postRetirementRuntimePinDigest: digest(2),
  isolatedAcceptanceReportDigest: digest(3),
  publicReleaseReportDigest: digest(4),
  p13NewAttemptDigest: digest(5),
  browserEvidenceAfterRuntimePin: true,
  trafficReleased: true,
  isolationHeldUntilApprovals: true,
  operatorApproval: "operator@wiseeff",
  platformOwnerApproval: "platform-owner@wiseeff",
  claimedEvidenceLevel: "T",
  localOrHostedLabeledAsTarget: false,
  executedPhases: [...CATALOG_PUBLIC_RELEASE_PHASES]
});

describe("RI-01 catalog public-release chain", () => {
  it("freezes the seven R3 observations before production chain work", () => {
    expect(CATALOG_RELEASE_CHAIN_THREAT_MATRIX).toHaveLength(7);
    expect(Object.isFrozen(CATALOG_RELEASE_CHAIN_THREAT_MATRIX)).toBe(true);
    expect(CATALOG_RELEASE_CHAIN_THREAT_MATRIX.map((row) => row.name)).toEqual([
      "missing-producer",
      "missing-pre-pin",
      "p13-delta-reuse",
      "pre-runtime-browser",
      "early-traffic",
      "local-hosted-as-target",
      "out-of-order-phases"
    ]);
  });

  it("T1 refuses a missing producer set", () => {
    const result = evaluateCatalogReleaseChain({
      ...legalCatalogChain(),
      producersComplete: false
    });
    expect(result.status).toBe("failed");
    expect(result.blockers).toContain("Catalog public-release chain is missing required producer evidence.");
  });

  it("T2 refuses P12 without a pre-activation pin", () => {
    const result = evaluateCatalogReleaseChain({
      ...legalCatalogChain(),
      preActivationReportDigest: null
    });
    expect(result.status).toBe("failed");
    expect(result.blockers).toContain("P12 requires an approved pre-activation report digest.");
  });

  it("T3 refuses P13 without a new post-retirement attempt", () => {
    const result = evaluateCatalogReleaseChain({
      ...legalCatalogChain(),
      p13NewAttemptDigest: null
    });
    expect(result.status).toBe("failed");
    expect(result.blockers).toContain("P13 delta requires a new post-retirement verification attempt digest.");
  });

  it("T4 refuses browser evidence before the runtime pin", () => {
    const result = evaluateCatalogReleaseChain({
      ...legalCatalogChain(),
      postRetirementRuntimePinDigest: null,
      browserEvidenceAfterRuntimePin: true
    });
    expect(result.status).toBe("failed");
    expect(result.blockers).toContain("Browser evidence before the approved runtime pin is forbidden.");
  });

  it("T5 refuses early public traffic", () => {
    const result = evaluateCatalogReleaseChain({
      ...legalCatalogChain(),
      executedPhases: ["P12", "P13"],
      trafficReleased: true,
      operatorApproval: null,
      platformOwnerApproval: null
    });
    expect(result.status).toBe("failed");
    expect(result.blockers).toContain(
      "Public traffic before distinct Operator and Platform-owner approvals is forbidden."
    );
  });

  it("T6 refuses local or Hosted labels as target evidence", () => {
    const result = evaluateCatalogReleaseChain({
      ...legalCatalogChain(),
      localOrHostedLabeledAsTarget: true,
      claimedEvidenceLevel: "H"
    });
    expect(result.status).toBe("failed");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "Local or Hosted output cannot be labeled target, release, or production evidence.",
        "Catalog public-release chain requires target-host evidence; local and Hosted output do not substitute."
      ])
    );
  });

  it("T7 refuses out-of-order phases", () => {
    const result = evaluateCatalogReleaseChain({
      ...legalCatalogChain(),
      executedPhases: ["P13", "P12"]
    });
    expect(result.status).toBe("failed");
    expect(result.blockers).toContain(
      "Catalog public-release phases must execute in order P12, P13, P11b, P14a, P14b, P14c, P15."
    );
  });

  it("keeps M6.6 command-gate pass distinct from catalog public-release pass", () => {
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
    });
    expect(result.status).toBe("passed");
    expect(result.catalogRelease?.status).toBe("failed");
    expect(result.catalogRelease?.blockers).toContain(
      "Catalog public-release chain is missing: P12, P13, P11b, P14a, P14b, P14c, P15."
    );
  });

  it("accepts only the exact ordered chain with distinct approvals as evaluator L, not real T/R", () => {
    const result = evaluateCatalogReleaseChain(legalCatalogChain());
    expect(result.status).toBe("passed");
    expect(result.blockers).toEqual([]);
  });
});
