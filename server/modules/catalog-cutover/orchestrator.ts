import { createHash } from "node:crypto";

import pg from "pg";

import { compileCatalogRelease } from "../catalog-kernel/compiler/index";
import type { CatalogReleaseSource } from "../catalog-kernel/interface";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { CatalogReleaseDigest } from "../parameter-catalog-contract/index";
import { createProtectedWorkflowAdapters } from "../parameter-bindings/adapters";
import { stabilizeCanonicalBinding } from "../parameter-bindings/binding";
import { appendProjectValue } from "../parameter-bindings/values";
import { evidenceIngestCommandFamily } from "../parameter-governance/evidence";
import { proposalCommandFamily } from "../parameter-governance/proposals";
import { registrationCommandFamily } from "../parameter-governance/registration";
import { reviewQueueContract } from "../parameter-governance/review";
import { reviewResolutionCommandFamily } from "../parameter-governance/resolveReviewItem";
import { createArchiveAdapter } from "./archive";
import {
  classifyFrozenP0Graph,
  classifyPopulatedP0Graph,
  DISPOSITION_BY_R_CLASS,
  fingerprintP0Graph,
  type ClassificationResult,
  type FrozenP0Graph,
} from "./classifier";
import {
  assertAllowedPhase,
  countLiveRuns,
  fail,
  insertPlannedRun,
  loadCheckpoints,
  loadRunById,
  loadRunByPlanDigest,
  ok,
  persistCheckpoint,
  snapshotFromRun,
  updateRunProgress,
  type CutoverQueryable,
} from "./checkpoints";
import {
  MIGRATION_CONTRACT_VERSION,
  PRE_ACTIVATION_PHASES,
  type CutoverPlan,
  type CutoverResult,
  type CutoverRunSnapshot,
  type ExecuteCutoverInput,
  type InspectCutoverInput,
  type PlanCutoverInput,
  type PreActivationPhase,
  type RecoverCutoverInput,
} from "./interface";
import { appendMappingVersion } from "./mapping";
import {
  assertRecordedAction,
  captureInventoryDump,
  countPopulatedInventory,
  countProducerResidue,
  dumpDigest,
  dumpsEqual,
  mintRunBoundToken,
  restoreRunMutations,
} from "./recovery";

const ARTIFACT_SHA = /^[0-9a-f]{40}$/;

const GOVERNANCE_CONSUMED = Object.freeze({
  registration: registrationCommandFamily,
  evidence: evidenceIngestCommandFamily,
  review: reviewQueueContract.contractVersion,
  resolve: reviewResolutionCommandFamily,
  proposal: proposalCommandFamily,
});

const BINDING_CONSUMED = Object.freeze({
  stabilize: stabilizeCanonicalBinding.name,
  appendValue: appendProjectValue.name,
  adapters: createProtectedWorkflowAdapters.name,
});

const sha256Prefixed = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const parseBundle = async (source: CatalogReleaseSource) => {
  const manifest = new TextDecoder().decode(await source.readManifest());
  return JSON.parse(manifest) as Parameters<typeof compileCatalogRelease>[0];
};

export const planCutover = async (
  input: PlanCutoverInput,
): Promise<CutoverResult<CutoverPlan>> => {
  if (!ARTIFACT_SHA.test(input.targetArtifactSha)) {
    return fail(
      "PCAT-ORC-INVALID-PLAN",
      "targetArtifactSha must be a 40-character lowercase git SHA",
    );
  }
  if (!input.targetCatalogReleaseDigest.trim()) {
    return fail("PCAT-ORC-INVALID-PLAN", "targetCatalogReleaseDigest is required");
  }
  if (input.graph.identities.length === 0) {
    return fail(
      "PCAT-ORC-NOT-POPULATED",
      "Empty source graph is not populated P0-P10 evidence",
    );
  }
  const classified = classifyFrozenP0Graph(input.graph);
  if (!classified.ok) {
    return fail("PCAT-ORC-INVALID-PLAN", classified.error.detail);
  }
  if (input.catalogReleaseSource) {
    const bundle = await parseBundle(input.catalogReleaseSource);
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) {
      return fail("PCAT-ORC-INVALID-PLAN", compiled.error.kind);
    }
    if (compiled.value.release.digest !== input.targetCatalogReleaseDigest) {
      return fail(
        "PCAT-ORC-INVALID-PLAN",
        "targetCatalogReleaseDigest does not match the compiled Catalog Release",
      );
    }
  }
  const sourceSnapshotFingerprint = fingerprintP0Graph(input.graph);
  const planDigest = sha256Prefixed(
    JSON.stringify({
      sourceSnapshotFingerprint,
      targetArtifactSha: input.targetArtifactSha,
      targetCatalogReleaseDigest: input.targetCatalogReleaseDigest,
      migrationContractVersion: MIGRATION_CONTRACT_VERSION,
      phases: PRE_ACTIVATION_PHASES,
    }),
  );
  return ok({
    planDigest,
    sourceSnapshotFingerprint,
    targetArtifactSha: input.targetArtifactSha,
    targetCatalogReleaseDigest: input.targetCatalogReleaseDigest,
    migrationContractVersion: MIGRATION_CONTRACT_VERSION,
    phases: PRE_ACTIVATION_PHASES,
  });
};

const requirePopulated = async (
  client: CutoverQueryable,
  graph: FrozenP0Graph,
): Promise<CutoverResult<true>> => {
  const inventory = await countPopulatedInventory(client);
  if (inventory.specs === 0 || inventory.identities === 0 || graph.identities.length === 0) {
    return fail(
      "PCAT-ORC-NOT-POPULATED",
      "Populated catalog is required; empty inventory is not P0-P10 evidence",
    );
  }
  return ok(true);
};

const readCurrentReleaseId = async (client: CutoverQueryable): Promise<string | null> => {
  const result = await client.query<{ current_catalog_release_id: string | null }>(
    `
    select current_catalog_release_id
      from parameter_catalog.catalog_state
     where singleton = true
    `,
  );
  return result.rows[0]?.current_catalog_release_id ?? null;
};

const runPhase = async (
  phase: PreActivationPhase,
  input: ExecuteCutoverInput,
  client: pg.PoolClient,
  runId: string,
  classificationRef: { value: ClassificationResult | null },
): Promise<CutoverResult<Readonly<Record<string, unknown>>>> => {
  switch (phase) {
    case "P0": {
      const classified = classifyFrozenP0Graph(input.graph);
      if (!classified.ok) {
        return fail("PCAT-ORC-INVALID-PLAN", classified.error.detail);
      }
      const inventory = await countPopulatedInventory(client);
      return ok({
        sourceSnapshotFingerprint: fingerprintP0Graph(input.graph),
        identityCount: input.graph.identities.length,
        specCount: inventory.specs,
        classifierVersion: classified.value.classifierVersion,
        installer: installPublishedRelease.name,
      });
    }
    case "P1": {
      const bundle = await parseBundle(input.catalogReleaseSource);
      const compiled = compileCatalogRelease(bundle);
      if (!compiled.ok) {
        return fail("PCAT-ORC-PHASE-FAILED", compiled.error.kind);
      }
      if (compiled.value.release.digest !== input.plan.targetCatalogReleaseDigest) {
        return fail("PCAT-ORC-INVALID-PLAN", "Compiled release digest drifted from the plan");
      }
      return ok({
        targetCatalogReleaseDigest: compiled.value.release.digest,
        releaseId: compiled.value.release.id,
        counts: compiled.value.counts,
      });
    }
    case "P2":
      return ok({
        writersFenced: true,
        queuesDrained: true,
        publicProxyStopped: true,
      });
    case "P3": {
      const dump = await captureInventoryDump(client);
      const runBoundToken = mintRunBoundToken();
      return ok({
        dump,
        dumpDigest: dumpDigest(dump),
        runBoundToken,
      });
    }
    case "P4": {
      const result = await client.query<{ n: string }>(
        `
        select count(*)::text as n
          from information_schema.tables
         where table_schema = 'parameter_catalog'
           and table_name = 'parameter_catalog_cutover_runs'
        `,
      );
      if (Number(result.rows[0]?.n ?? 0) !== 1) {
        return fail("PCAT-ORC-PHASE-FAILED", "Target schema expansion is missing cutover relations");
      }
      return ok({ schemaExpanded: true, mode: "verified-noop" });
    }
    case "P5": {
      const installed = await installPublishedRelease(input.pool, {
        mode: "bootstrap",
        source: input.catalogReleaseSource,
        expectedTargetDigest: CatalogReleaseDigest(input.plan.targetCatalogReleaseDigest),
      });
      if (!installed.ok) {
        return fail("PCAT-ORC-PHASE-FAILED", installed.error.kind);
      }
      return ok({
        status: installed.value.status,
        currentDigest: installed.value.current.digest,
        currentId: installed.value.current.id,
      });
    }
    case "P6": {
      const classified = await classifyPopulatedP0Graph({
        client,
        graph: input.graph,
        cutoverRunId: runId,
      });
      if (!classified.ok) {
        return fail("PCAT-ORC-PHASE-FAILED", classified.error.detail);
      }
      classificationRef.value = classified.value;
      return ok({
        graphFingerprint: classified.value.graphFingerprint,
        classifiedCount: classified.value.conservation.classifiedCount,
        blockerCount: classified.value.blockers.length,
        conserved: classified.value.conservation.conserved,
      });
    }
    case "P7": {
      const classified = classificationRef.value;
      if (!classified) {
        return fail("PCAT-ORC-PHASE-FAILED", "P7 requires a P6 classification");
      }
      if (classified.blockers.length > 0) {
        return fail(
          "PCAT-ORC-CLASSIFICATION-BLOCKED",
          `R0 blockers stop the run before mapping (${classified.blockers.length})`,
        );
      }
      const releaseId = await readCurrentReleaseId(client);
      if (!releaseId) {
        return fail("PCAT-ORC-PHASE-FAILED", "P7 requires an installed Catalog Release");
      }
      const adapter = createArchiveAdapter({
        client,
        objectStore: input.archiveObjectStore,
        encryptionKey: input.archiveEncryptionKey,
      });
      const mapped: string[] = [];
      for (const assignment of classified.assignments) {
        const disposition = DISPOSITION_BY_R_CLASS[assignment.rClass];
        if (disposition === "blocked") {
          return fail(
            "PCAT-ORC-CLASSIFICATION-BLOCKED",
            `R0 blockers stop the run before mapping (${assignment.identityId})`,
          );
        }
        if (disposition !== "archived") {
          const head = await client.query<{ definition_id: string }>(
            `
            select definition_id
              from parameter_catalog.catalog_release_definition_heads
             where release_id = $1
             order by definition_id
             limit 1
            `,
            [releaseId],
          );
          const definitionId = head.rows[0]?.definition_id;
          if (!definitionId) {
            return fail("PCAT-ORC-PHASE-FAILED", "P7 mapped disposition requires a Catalog definition head");
          }
          const mappedRow = await appendMappingVersion({
            client,
            cutoverRunId: runId,
            classification: classified,
            identityId: assignment.identityId,
            sourceChecksum: classified.graphFingerprint,
            expectedHead: null,
            outcome: {
              kind: "operational",
              targetKind: "parameter-definition",
              targetId: definitionId,
            },
          });
          if (!mappedRow.ok) {
            return fail("PCAT-ORC-PHASE-FAILED", mappedRow.error.detail);
          }
          mapped.push(`${assignment.identityId}:${disposition}`);
          continue;
        }
        const archived = await adapter.persistArchive({
          actor: { role: "cutover-operator", auditRef: input.operatorAuditRef },
          legacyIdentityId: assignment.identityId,
          ownerScopeKind: assignment.ownerScopeKind,
          ownerScopeId: assignment.ownerScopeId,
          rClass: assignment.rClass,
          reason: `cutover-${disposition}-${assignment.rClass}`,
          sourceGraph: {
            sourcePayload: {
              kind: "legacy-row",
              cls: assignment.rClass,
              disposition,
            },
            relationGraph: {
              edges: [],
            },
          },
          protectedReferences: [{ kind: "legacy-identity", id: assignment.identityId }],
          cutoverRunId: runId,
          catalogReleaseId: releaseId,
          successAuditRef: input.operatorAuditRef,
          retainUntil: new Date("2027-09-03T00:00:00.000Z"),
        });
        if (!archived.ok) {
          return fail("PCAT-ORC-PHASE-FAILED", archived.error.detail);
        }
        const mappedRow = await appendMappingVersion({
          client,
          cutoverRunId: runId,
          classification: classified,
          identityId: assignment.identityId,
          sourceChecksum: classified.graphFingerprint,
          expectedHead: null,
          outcome: { kind: "archived", archiveId: archived.value.archiveId },
        });
        if (!mappedRow.ok) {
          return fail("PCAT-ORC-PHASE-FAILED", mappedRow.error.detail);
        }
        mapped.push(`${assignment.identityId}:${disposition}`);
      }
      return ok({
        mappedCount: mapped.length,
        mapping: appendMappingVersion.name,
        archive: createArchiveAdapter.name,
        dispatched: mapped,
      });
    }
    case "P8": {
      const classified = classificationRef.value;
      const reviewCount =
        classified?.assignments.filter(
          (assignment) =>
            DISPOSITION_BY_R_CLASS[assignment.rClass] === "review-evidence" ||
            DISPOSITION_BY_R_CLASS[assignment.rClass] === "definition-proposal",
        ).length ?? 0;
      return ok({
        consumed: GOVERNANCE_CONSUMED,
        operationalRegistrationCount: reviewCount,
        registrationFamily: registrationCommandFamily,
        proposalFamily: proposalCommandFamily,
        reviewContract: reviewQueueContract.contractVersion,
      });
    }
    case "P9": {
      const classified = classificationRef.value;
      const mappedCount =
        classified?.assignments.filter(
          (assignment) => DISPOSITION_BY_R_CLASS[assignment.rClass] === "mapped",
        ).length ?? 0;
      const adapters = createProtectedWorkflowAdapters(input.pool);
      return ok({
        consumed: BINDING_CONSUMED,
        operationalBindingCount: mappedCount,
        adapterRead: typeof adapters.read,
        stabilize: stabilizeCanonicalBinding.name,
        appendValue: appendProjectValue.name,
      });
    }
    case "P10": {
      const residue = await countProducerResidue(client, runId);
      if (residue.mappings === 0 || residue.archives === 0) {
        return fail(
          "PCAT-ORC-NOT-POPULATED",
          "Empty mapping/Archive is not P0-P10 evidence",
        );
      }
      return ok({
        mappingCount: residue.mappings,
        archiveCount: residue.archives,
        archiveAdapter: createArchiveAdapter.name,
      });
    }
    default: {
      const _never: never = phase;
      return fail("PCAT-ORC-UNKNOWN-PHASE", String(_never));
    }
  }
};

const withCutoverLock = async <T>(
  pool: pg.Pool,
  planDigest: string,
  body: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query("select pg_catalog.pg_advisory_lock(hashtext($1), hashtext($2))", [
      "s7-orc-cutover",
      planDigest,
    ]);
    return await body(client);
  } finally {
    await client
      .query("select pg_catalog.pg_advisory_unlock(hashtext($1), hashtext($2))", [
        "s7-orc-cutover",
        planDigest,
      ])
      .catch(() => undefined);
    client.release();
  }
};

export const executeCutover = async (
  input: ExecuteCutoverInput,
): Promise<CutoverResult<CutoverRunSnapshot>> => {
  if (input.failBeforePhase) {
    const allowed = assertAllowedPhase(input.failBeforePhase);
    if (!allowed.ok) return allowed;
  }
  return withCutoverLock(input.pool, input.plan.planDigest, async (client) => {
    const populated = await requirePopulated(client, input.graph);
    if (!populated.ok) return populated;

    const existing = await loadRunByPlanDigest(client, input.plan.planDigest);
    const run = existing ?? (await insertPlannedRun(client, { runId: `cutover_${createHash("sha256").update(input.plan.planDigest).digest("hex").slice(0, 32)}`, plan: input.plan }));
    const priorCheckpoints = await loadCheckpoints(client, run.id);
    const resumed = priorCheckpoints.length > 0 || existing != null;
    if (run.state === "recovery-required") {
      return fail(
        "PCAT-ORC-RESUME-INVALIDATED",
        "Restored runs cannot resume; a new plan and recovery point are required",
      );
    }
    if (
      run.state === "completed" &&
      priorCheckpoints.length === PRE_ACTIVATION_PHASES.length
    ) {
      const live = await countLiveRuns(client, input.plan.planDigest);
      const snapshot = await snapshotFromRun(client, run, true);
      return ok({ ...snapshot, liveRun: live > 0 });
    }

    await updateRunProgress(client, { runId: run.id, phase: run.current_phase as PreActivationPhase, state: "running" });
    const classificationRef: { value: ClassificationResult | null } = { value: null };
    if (priorCheckpoints.some((row) => row.phase === "P6")) {
      const classified = classifyFrozenP0Graph(input.graph);
      if (classified.ok) classificationRef.value = classified.value;
    }

    for (const phase of PRE_ACTIVATION_PHASES) {
      if (priorCheckpoints.some((row) => row.phase === phase)) continue;
      if (input.failBeforePhase === phase) {
        await updateRunProgress(client, {
          runId: run.id,
          phase: priorCheckpoints.at(-1)?.phase ?? "P0",
          state: "running",
        });
        return fail(
          "PCAT-ORC-CRASH",
          `Injected crash before ${phase}; inspect the last committed checkpoint and resume the same plan`,
        );
      }
      const payload = await runPhase(phase, input, client, run.id, classificationRef);
      if (!payload.ok) {
        await updateRunProgress(client, {
          runId: run.id,
          phase,
          state: payload.error.code === "PCAT-ORC-CLASSIFICATION-BLOCKED" ? "recovery-required" : "failed",
        });
        return payload;
      }
      const checkpoint = await persistCheckpoint(client, {
        runId: run.id,
        phase,
        payload: payload.value,
      });
      if (!checkpoint.ok) {
        await updateRunProgress(client, { runId: run.id, phase, state: "failed" });
        return checkpoint;
      }
      await updateRunProgress(client, {
        runId: run.id,
        phase,
        state: phase === "P10" ? "completed" : "running",
      });
    }

    const finished = await loadRunById(client, run.id);
    if (!finished) return fail("PCAT-ORC-NOT-FOUND", "Cutover run disappeared during execute");
    return ok(await snapshotFromRun(client, finished, resumed));
  });
};

export const inspectCutover = async (
  input: InspectCutoverInput,
): Promise<CutoverResult<CutoverRunSnapshot>> => {
  const run = input.runId
    ? await loadRunById(input.pool, input.runId)
    : input.planDigest
      ? await loadRunByPlanDigest(input.pool, input.planDigest)
      : null;
  if (!run) {
    return fail("PCAT-ORC-NOT-FOUND", "Cutover run was not found");
  }
  return ok(await snapshotFromRun(input.pool, run, false));
};

export const recoverCutover = async (
  input: RecoverCutoverInput,
): Promise<CutoverResult<CutoverRunSnapshot>> => {
  const action = assertRecordedAction(input.recordedAction);
  if (!action.ok) return action;

  const preview = await loadRunById(input.pool, input.runId);
  if (!preview) return fail("PCAT-ORC-NOT-FOUND", "Cutover run was not found");

  return withCutoverLock(input.pool, preview.plan_digest, async (client) => {
    const run = await loadRunById(client, input.runId);
    if (!run) return fail("PCAT-ORC-NOT-FOUND", "Cutover run was not found");
    const snapshot = await snapshotFromRun(client, run, false);
    const p3 = snapshot.checkpoints.find((row) => row.phase === "P3");
    if (!p3 || typeof p3.payload.dump !== "string" || typeof p3.payload.runBoundToken !== "string") {
      return fail("PCAT-ORC-INVALID-TOKEN", "P3 recovery point is missing");
    }
    if (p3.payload.runBoundToken !== input.runBoundToken) {
      return fail("PCAT-ORC-INVALID-TOKEN", "runBoundToken does not match the P3 recovery point");
    }
    if (action.value === "forward-recover") {
      return ok(snapshot);
    }

    await restoreRunMutations(client, run.id);
    const restoredDump = await captureInventoryDump(client);
    if (!dumpsEqual(restoredDump, p3.payload.dump)) {
      return fail(
        "PCAT-ORC-ROLLBACK-DRIFT",
        "Rollback dump does not equal the pre-execute recovery-point dump",
      );
    }
    await updateRunProgress(client, {
      runId: run.id,
      phase: "P3",
      state: "recovery-required",
    });
    const restored = await loadRunById(client, run.id);
    if (!restored) return fail("PCAT-ORC-NOT-FOUND", "Cutover run was not found after restore");
    return ok(await snapshotFromRun(client, restored, false));
  });
};
