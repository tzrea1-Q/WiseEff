import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type {
  CutoverPlan,
  CutoverResult,
  CutoverRunSnapshot,
  ExecuteCutoverInput,
  PlanCutoverInput,
} from "../../../../server/modules/catalog-cutover/interface";
import {
  PRE_ACTIVATION_PHASES,
  UNAVAILABLE_PHASES,
} from "../../../../server/modules/catalog-cutover/interface";
import type {
  PrepareVerificationInput,
  ReleaseVerificationService,
  VerificationAttemptSnapshot,
  VerificationPlan,
} from "../../../../server/modules/release-verification/core";

import type { CutoverPorts, VerificationPorts } from "./actions";
import { asPrepareVerificationCutover } from "./actions";
import { openCatalogUpgradeController } from "./controller";
import { journalBytes } from "./journal";
import { THREAT_MATRIX } from "./threatMatrix";

const dir = path.dirname(fileURLToPath(import.meta.url));

const productionFiles = (): string[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".ts") && !name.includes(".test."))
    .map((name) => path.join(dir, name));

const cutoverPlan = (): CutoverPlan => ({
  planDigest: "sha256:plan-1",
  sourceSnapshotFingerprint: "sha256:source-1",
  targetArtifactSha: "a".repeat(40),
  targetCatalogReleaseDigest: "sha256:release-1",
  migrationContractVersion: "s7-orc-p0-p10-v1",
  phases: PRE_ACTIVATION_PHASES,
});

const planInput = (): PlanCutoverInput =>
  ({
    graph: { identities: [{ id: "legacy-1" }] },
    targetArtifactSha: "a".repeat(40),
    targetCatalogReleaseDigest: "sha256:release-1",
  }) as PlanCutoverInput;

const executeInput = (): ExecuteCutoverInput =>
  ({
    plan: cutoverPlan(),
  }) as ExecuteCutoverInput;

const completedSnapshot = (resumed = false): CutoverRunSnapshot => ({
  runId: "cutover_plan-1",
  planDigest: "sha256:plan-1",
  currentPhase: "P10",
  state: "completed",
  resumed,
  liveRun: false,
  checkpoints: PRE_ACTIVATION_PHASES.map((phase) => ({
    phase,
    checkpointDigest: `sha256:${phase.toLowerCase()}`,
    payload: {},
    committedAt: "2026-09-04T00:00:00.000Z",
  })),
  runBoundToken: "token-1",
  recoveryPointDump: "dump-1",
});

const ok = <T>(value: T): CutoverResult<T> => ({ ok: true, value });

const prepareInput = (): PrepareVerificationInput => ({
  subject: {
    targetId: "target-lab-1",
    deploymentClass: "self-hosted",
    environmentId: "env-isolated",
  },
  purpose: "pre-activation",
  mode: "populated",
  lineage: {
    phaseSnapshot: "P10",
    predecessorReportDigests: [],
    p12State: "not-started",
    p13State: "not-started",
    writerRetirementFingerprint: null,
    runtimePinGeneration: null,
    pointerRollbackStatus: "open",
    trafficIsolationState: "isolated",
  },
  pins: {
    artifact: {
      gitSha: "a".repeat(40),
      releaseTag: "v-s11-upg",
      packageManifestDigest: "sha256:pkg",
      apiImageDigest: "sha256:api",
      workerImageDigest: "sha256:worker",
      webImageDigest: "sha256:web",
    },
    catalog: {
      releaseId: "crel-s11",
      releaseDigest: "sha256:catalog",
      compiledModelDigest: "sha256:compiled",
      materializationFingerprint: "sha256:material",
    },
    database: {
      targetIdentity: "pg-s11",
      schemaVersion: "0139",
      migrationInventoryDigest: "sha256:migrations",
    },
    cutover: asPrepareVerificationCutover(cutoverPlan()),
    mappingArchive: {
      mappingEpoch: "epoch-1",
      mappingHeadDigest: "sha256:map",
      archiveManifestDigest: "sha256:archive",
    },
    recovery: {
      recoveryPointId: "rp-1",
      recoveryPointDigest: "sha256:rp",
    },
    acceptance: {
      openApiDigest: "sha256:openapi",
      browserBundleSha: "sha256:browser",
    },
    target: {
      deploymentId: "deploy-1",
      hostFingerprint: "sha256:host",
    },
    verification: {
      contractVersion: "s10-per",
      verifierRole: "catalog_verifier",
    },
  },
  evidenceRequirements: {
    recoveryPointDigest: "sha256:rp",
    mappingEpoch: "epoch-1",
    cutoverPlanDigest: "sha256:plan-1",
    acceptanceContractDigest: "sha256:accept",
  },
});

type Harness = {
  readonly calls: string[];
  readonly cutover: CutoverPorts;
  readonly verification: VerificationPorts;
};

const createHarness = (options?: {
  execute?: CutoverPorts["execute"];
}): Harness => {
  const calls: string[] = [];
  const plan = cutoverPlan();
  const cutover: CutoverPorts = {
    plan: async () => {
      calls.push("plan");
      return ok(plan);
    },
    execute:
      options?.execute ??
      (async () => {
        calls.push("execute");
        return ok(completedSnapshot());
      }),
    inspect: async () => {
      calls.push("inspect");
      return ok(completedSnapshot(true));
    },
    recover: async () => {
      calls.push("recover");
      return ok({
        ...completedSnapshot(),
        currentPhase: "P3",
        state: "recovery-required",
      });
    },
  };
  const verification: VerificationPorts = {
    prepareVerification: (async () => {
      calls.push("prepareVerification");
      return {
        ok: true,
        value: { digest: "sha256:vplan" } as VerificationPlan,
      };
    }) as ReleaseVerificationService["prepareVerification"],
    runVerification: (async () => {
      calls.push("runVerification");
      return {
        ok: true,
        value: { digest: "sha256:vattempt" } as VerificationAttemptSnapshot,
      };
    }) as ReleaseVerificationService["runVerification"],
  };
  return { calls, cutover, verification };
};

const journalPathFor = (runId: string): string =>
  path.join(mkdtempSync(path.join(tmpdir(), `s11-upg-${runId}-`)), "journal.json");

describe("S11-UPG threat matrix", () => {
  it("freezes the seven R3 observations before production controller work", () => {
    expect(THREAT_MATRIX).toHaveLength(7);
    expect(Object.isFrozen(THREAT_MATRIX)).toBe(true);
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "legal-journal-transition-idempotent",
      "illegal-action-journal-unchanged",
      "crash-resume-same-journal",
      "cannot-select-verification-gates",
      "cannot-guess-or-migrate-via-api",
      "consume-s7-orc-and-s10-per-types",
      "no-catalog-releases-writer-dml",
    ]);
    for (const row of THREAT_MATRIX) {
      expect(row.attack.length).toBeGreaterThan(0);
      expect(row.expected.length).toBeGreaterThan(0);
      expect(row.evidenceOwner).toBe("L");
    }
  });
});

describe("S11-UPG controller", () => {
  it("T1 legal plan then execute is idempotent and does not rewrite the journal", async () => {
    const harness = createHarness();
    const journalPath = journalPathFor("legal");
    const opened = openCatalogUpgradeController({
      journalPath,
      runId: "run-legal",
      cutover: harness.cutover,
      verification: harness.verification,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const controller = opened.value;

    const planned = await controller.dispatch({ action: "plan", input: planInput() });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.state).toBe("planned");
    expect(planned.value.nextAction).toBe("execute");
    expect(planned.value.replayed).toBe(false);

    const executed = await controller.dispatch({ action: "execute", input: executeInput() });
    expect(executed.ok).toBe(true);
    if (!executed.ok) return;
    expect(executed.value.state).toBe("cutover-completed");
    expect(executed.value.nextAction).toBe("prepareVerification");
    const committed = journalBytes(journalPath);

    const replayPlan = await controller.dispatch({ action: "plan", input: planInput() });
    expect(replayPlan.ok).toBe(true);
    if (!replayPlan.ok) return;
    expect(replayPlan.value.replayed).toBe(true);
    expect(replayPlan.value.state).toBe("cutover-completed");

    const replayExecute = await controller.dispatch({
      action: "execute",
      input: executeInput(),
    });
    expect(replayExecute.ok).toBe(true);
    if (!replayExecute.ok) return;
    expect(replayExecute.value.replayed).toBe(true);
    expect(journalBytes(journalPath).equals(committed)).toBe(true);
    expect(harness.calls.filter((name) => name === "plan")).toHaveLength(1);
    expect(harness.calls.filter((name) => name === "execute")).toHaveLength(1);
  });

  it("T2 refuses an illegal action and leaves journal bytes unchanged", async () => {
    const harness = createHarness();
    const journalPath = journalPathFor("illegal");
    const opened = openCatalogUpgradeController({
      journalPath,
      runId: "run-illegal",
      cutover: harness.cutover,
      verification: harness.verification,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const before = journalBytes(journalPath);
    const refused = await opened.value.dispatch({
      action: "prepareVerification",
      input: prepareInput(),
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("PCAT-UPG-ILLEGAL-ACTION");
    expect(journalBytes(journalPath).equals(before)).toBe(true);
    expect(harness.calls).toEqual([]);
  });

  it("T3 crash/resume continues the same journal run", async () => {
    let executeCalls = 0;
    const crashingExecute: CutoverPorts["execute"] = async () => {
      executeCalls += 1;
      if (executeCalls === 1) {
        return {
          ok: false,
          error: { code: "PCAT-ORC-CRASH", detail: "injected crash before P4" },
        };
      }
      return ok(completedSnapshot(true));
    };
    const journalPath = journalPathFor("crash");
    const firstHarness = createHarness({ execute: crashingExecute });
    const firstOpen = openCatalogUpgradeController({
      journalPath,
      runId: "run-crash",
      cutover: firstHarness.cutover,
      verification: firstHarness.verification,
    });
    expect(firstOpen.ok).toBe(true);
    if (!firstOpen.ok) return;
    const planned = await firstOpen.value.dispatch({ action: "plan", input: planInput() });
    expect(planned.ok).toBe(true);
    const crashed = await firstOpen.value.dispatch({
      action: "execute",
      input: executeInput(),
    });
    expect(crashed.ok).toBe(true);
    if (!crashed.ok) return;
    expect(crashed.value.state).toBe("executing");
    expect(crashed.value.nextAction).toBe("inspect");
    expect(crashed.value.runId).toBe("run-crash");

    const secondHarness = createHarness({ execute: crashingExecute });
    const resumedOpen = openCatalogUpgradeController({
      journalPath,
      runId: "run-crash",
      cutover: secondHarness.cutover,
      verification: secondHarness.verification,
    });
    expect(resumedOpen.ok).toBe(true);
    if (!resumedOpen.ok) return;
    const inspected = await resumedOpen.value.dispatch({ action: "inspect" });
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.value.runId).toBe("run-crash");
    expect(inspected.value.state).toBe("executing");

    const resumed = await resumedOpen.value.dispatch({
      action: "resume",
      input: executeInput(),
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value.runId).toBe("run-crash");
    expect(resumed.value.state).toBe("cutover-completed");
    expect(resumed.value.replayed).toBe(false);
    expect(executeCalls).toBe(2);
    expect(resumed.value.entryCount).toBeGreaterThanOrEqual(3);
  });

  it("T4 cannot select verification gates", async () => {
    const harness = createHarness();
    const journalPath = journalPathFor("gates");
    const opened = openCatalogUpgradeController({
      journalPath,
      runId: "run-gates",
      cutover: harness.cutover,
      verification: harness.verification,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const controller = opened.value;
    expect((await controller.dispatch({ action: "plan", input: planInput() })).ok).toBe(true);
    expect(
      (await controller.dispatch({ action: "execute", input: executeInput() })).ok,
    ).toBe(true);
    const before = journalBytes(journalPath);
    const prepareCalls = harness.calls.filter((name) => name === "prepareVerification").length;

    const gated = await controller.dispatch({
      action: "prepareVerification",
      input: { ...prepareInput(), gates: ["V01"] },
    });
    expect(gated.ok).toBe(false);
    if (gated.ok) return;
    expect(gated.error.code).toBe("PCAT-UPG-GATE-SELECTION-FORBIDDEN");
    expect(harness.calls.filter((name) => name === "prepareVerification")).toHaveLength(
      prepareCalls,
    );
    expect(journalBytes(journalPath).equals(before)).toBe(true);

    const selected = await controller.dispatch({
      action: "selectGates",
      input: { gateIds: ["PCAT-API-01"] },
    });
    expect(selected.ok).toBe(false);
    if (selected.ok) return;
    expect(selected.error.code).toBe("PCAT-UPG-GATE-SELECTION-FORBIDDEN");
    expect(journalBytes(journalPath).equals(before)).toBe(true);
  });

  it("T5 cannot guess unknown commits or migrate through API startup", async () => {
    const harness = createHarness();
    const journalPath = journalPathFor("guess");
    const opened = openCatalogUpgradeController({
      journalPath,
      runId: "run-guess",
      cutover: harness.cutover,
      verification: harness.verification,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const before = journalBytes(journalPath);

    const migrate = await opened.value.dispatch({
      action: "migrateViaApi",
      input: { startupMigration: true },
    });
    expect(migrate.ok).toBe(false);
    if (migrate.ok) return;
    expect(migrate.error.code).toBe("PCAT-UPG-API-MIGRATE-FORBIDDEN");

    const guess = await opened.value.dispatch({
      action: "guessUnknownCommit",
      input: { guessedCommit: "deadbeef" },
    });
    expect(guess.ok).toBe(false);
    if (guess.ok) return;
    expect(guess.error.code).toBe("PCAT-UPG-UNKNOWN-OUTCOME");

    for (const phase of UNAVAILABLE_PHASES) {
      const activation = await opened.value.dispatch({ action: phase });
      expect(activation.ok).toBe(false);
      if (activation.ok) return;
      expect(activation.error.code).toBe("PCAT-UPG-ILLEGAL-ACTION");
    }
    expect(journalBytes(journalPath).equals(before)).toBe(true);
    expect(harness.calls).toEqual([]);
  });

  it("T5 refuses execute after recovery-required instead of guessing commit outcome", async () => {
    const harness = createHarness();
    const journalPath = journalPathFor("recovery");
    const opened = openCatalogUpgradeController({
      journalPath,
      runId: "run-recovery",
      cutover: harness.cutover,
      verification: harness.verification,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const controller = opened.value;
    expect((await controller.dispatch({ action: "plan", input: planInput() })).ok).toBe(true);
    const executing = await controller.dispatch({
      action: "execute",
      input: executeInput(),
    });
    expect(executing.ok).toBe(true);
    const recovered = await controller.dispatch({
      action: "recover",
      input: {
        runId: "cutover_plan-1",
        recordedAction: "whole-state-restore",
        runBoundToken: "token-1",
      },
    });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.value.state).toBe("recovery-required");
    const before = journalBytes(journalPath);
    const guessed = await controller.dispatch({
      action: "execute",
      input: executeInput(),
    });
    expect(guessed.ok).toBe(false);
    if (guessed.ok) return;
    expect(guessed.error.code).toBe("PCAT-UPG-UNKNOWN-OUTCOME");
    expect(journalBytes(journalPath).equals(before)).toBe(true);
  });

  it("T6 consumes S7-ORC plan/execute/inspect/recover and S10-PER prepare/run types without reimplementing them", () => {
    const files = productionFiles();
    expect(files.length).toBeGreaterThan(1);
    const combined = files.map((filePath) => readFileSync(filePath, "utf8")).join("\n");
    expect(combined).toContain("PlanCutoverInput");
    expect(combined).toContain("ExecuteCutoverInput");
    expect(combined).toContain("InspectCutoverInput");
    expect(combined).toContain("RecoverCutoverInput");
    expect(combined).toContain("PrepareVerificationInput");
    expect(combined).toContain("ReleaseVerificationService");
    expect(combined).not.toMatch(/function\s+planCutover\b/);
    expect(combined).not.toMatch(/function\s+executeCutover\b/);
    expect(combined).not.toMatch(/function\s+inspectCutover\b/);
    expect(combined).not.toMatch(/function\s+recoverCutover\b/);
    expect(combined).not.toMatch(/function\s+prepareVerification\b/);
    expect(combined).not.toMatch(/function\s+runVerification\b/);
    expect(combined).not.toMatch(/function\s+assembleReport\b/);
    expect(combined).not.toMatch(/function\s+approveReport\b/);
    expect(combined).not.toMatch(/function\s+readReport\b/);
    expect(combined).not.toContain("createReleaseVerificationService");
  });

  it("T7 has no catalog_releases writer DML or banned relation literals", () => {
    const files = productionFiles();
    const bannedDefinitions = ["parameter", "definitions"].join("_");
    const bannedValues = ["project_parameter", "values"].join("_");
    for (const filePath of files) {
      const text = readFileSync(filePath, "utf8");
      expect(text, filePath).not.toContain(bannedDefinitions);
      expect(text, filePath).not.toContain(bannedValues);
      expect(text, filePath).not.toMatch(
        /\b(?:insert|update|delete)\s+(?:into|from)?\s*parameter_catalog\.catalog_releases\b/i,
      );
    }
  });

  it("prepareVerification then runVerification follow the frozen Cutover/Verification seam", async () => {
    const harness = createHarness();
    const journalPath = journalPathFor("verify");
    const opened = openCatalogUpgradeController({
      journalPath,
      runId: "run-verify",
      cutover: harness.cutover,
      verification: harness.verification,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const controller = opened.value;
    expect((await controller.dispatch({ action: "plan", input: planInput() })).ok).toBe(true);
    expect(
      (await controller.dispatch({ action: "execute", input: executeInput() })).ok,
    ).toBe(true);
    const prepared = await controller.dispatch({
      action: "prepareVerification",
      input: prepareInput(),
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.value.state).toBe("verification-prepared");
    expect(prepared.value.nextAction).toBe("runVerification");
    const ran = await controller.dispatch({
      action: "runVerification",
      input: { planDigest: "sha256:vplan" },
    });
    expect(ran.ok).toBe(true);
    if (!ran.ok) return;
    expect(ran.value.state).toBe("verification-ran");
    expect(ran.value.nextAction).toBe("none");
    expect(harness.calls).toEqual([
      "plan",
      "execute",
      "prepareVerification",
      "runVerification",
    ]);
  });
});
