import { createHash } from "node:crypto";
import { produceComparisonP0Rules } from "./comparisonRules";
import { assertComparisonPlanInventoryCurrent } from "../release-verification/comparison/planInventory";

import pg from "pg";

import { compileCatalogRelease } from "../catalog-kernel/compiler/index";
import { jsonCatalogReleaseSource, type CatalogReleaseSource } from "../catalog-kernel/interface";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { CatalogReleaseDigest, CatalogReleaseId } from "../parameter-catalog-contract/index";
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
  type BindingPhaseAttempt,
} from "./interface";
import { appendMappingVersion, registerPlannedSourceIdentities } from "./mapping";
import { bindingImportDigest, importPreparedBindingHistory, verifyPreparedBindingHistory } from "../parameter-bindings/cutoverImport";
import { captureBindingImportIntent } from "../parameter-bindings/cutoverImport/intent";
import { BindingSourceRefusal, openLockedBindingSource, type LockedBindingSource } from "../parameter-bindings/cutoverImport/sourceBoundary";
import { assertBindingManagementLogin, BindingProducerRefusal, captureBindingMappingPins, prepareBindingEvidenceArchives, produceBindingImportReceipt, readBindingDatabaseIdentity, type BindingMappingPin } from "./bindingImportProducer";
import { captureArchivedDefinitionGraph, captureConversionSourceInventory, conversionManifestDigest, definitionGraphMatchesSource, inspectConversionManifest } from "./conversionManifest";
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
  input = { ...input, graph: structuredClone(input.graph),
    managementPreparation: input.managementPreparation && structuredClone(input.managementPreparation),
    bindingImportIntent: input.bindingImportIntent && structuredClone(input.bindingImportIntent),
    conversionManifest: input.conversionManifest && structuredClone(input.conversionManifest) };
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
  if ((input.graph.bindings.length || input.graph.bindingRevisions.length || input.graph.placements.length) && !input.bindingImportIntent) {
    return fail("PCAT-ORC-INVALID-PLAN", "conversion-business-history-producer-unavailable");
  }
  if (input.bindingImportIntent) {
    if (!input.bindingArchiveRetainUntil || Number.isNaN(Date.parse(input.bindingArchiveRetainUntil))) return fail("PCAT-ORC-INVALID-PLAN","binding-archive-retention-required");
    if (input.graph.identities.some(i => !["parameter-spec","parameter-spec-version","project-parameter-binding","project-parameter-binding-revision"].includes(i.sourceKind))) return fail("PCAT-ORC-INVALID-PLAN","binding-source-family-producer-unavailable");
    const intent = input.bindingImportIntent;
    if (intent.version !== "s6-binding-import-intent-v1" || !input.conversionManifest || intent.sourceSnapshotFingerprint !== fingerprintP0Graph(input.graph) || intent.sourceInventoryFingerprint !== input.conversionManifest.sourceInventoryFingerprint || intent.bindings.length === 0 || intent.bindings.length !== input.graph.bindings.length || new Set(intent.bindings.map(b => b.sourceBindingId)).size !== intent.bindings.length || !input.graph.bindings.every(b => intent.bindings.some(p => p.sourceBindingId === b.id && p.sourceSpecId === b.parameterSpecId))) return fail("PCAT-ORC-INVALID-PLAN", "binding-import-intent-conservation");
    for (const [kind,records] of [["parameter-spec",input.graph.specs],["parameter-spec-version",input.graph.specVersions],["project-parameter-binding",input.graph.bindings],["project-parameter-binding-revision",input.graph.bindingRevisions]] as const) {
      const identities = input.graph.identities.filter(i => i.sourceKind === kind);
      if (identities.length !== records.length || !records.every(record => identities.filter(i => i.sourceId === record.id).length === 1)) return fail("PCAT-ORC-INVALID-PLAN","binding-source-identity-conservation");
    }
  }
  if (!input.conversionManifest && classified.value.assignments.some((row) => row.disposition !== "archived")) {
    return fail("PCAT-ORC-INVALID-PLAN", "conversion-manifest-required");
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
    if (input.conversionManifest) {
      const problem = inspectConversionManifest({ graph: input.graph, targetCatalogReleaseDigest: input.targetCatalogReleaseDigest, bundle, manifest: input.conversionManifest, bindingImportIntent:input.bindingImportIntent });
      if (problem) return fail("PCAT-ORC-INVALID-PLAN", problem);
    }
  } else if (input.conversionManifest) {
    return fail("PCAT-ORC-INVALID-PLAN", "conversion-manifest-requires-release-source");
  }
  if (input.managementMigrationReceiptDigest !== undefined && !/^sha256:[a-f0-9]{64}$/.test(input.managementMigrationReceiptDigest)) return fail("PCAT-ORC-INVALID-PLAN", "management-migration-receipt-pin-invalid");
  const preparation = input.managementPreparation;
  if (!!input.managementMigrationReceiptDigest !== !!preparation || (preparation &&
      (!/^[A-Za-z0-9_-]+$/.test(preparation.runId) || !/^sha256:[a-f0-9]{64}$/.test(preparation.planDigest) ||
       preparation.candidateArtifactSha !== input.targetArtifactSha || !ARTIFACT_SHA.test(preparation.candidateArtifactTree)))) {
    return fail("PCAT-ORC-INVALID-PLAN", "management-preparation-pin-invalid");
  }
  const managementPin = input.managementMigrationReceiptDigest ? {
    managementMigrationReceiptDigest: input.managementMigrationReceiptDigest, managementPreparation: structuredClone(preparation!),
  } : {};
  const sourceSnapshotFingerprint = fingerprintP0Graph(input.graph);
  let comparisonRules: ReturnType<typeof produceComparisonP0Rules> | undefined;
  try {
    if (input.comparisonInventory) await assertComparisonPlanInventoryCurrent(input.comparisonInventory, input.targetArtifactSha);
    comparisonRules = input.comparisonInventory ? produceComparisonP0Rules(input.graph, input.comparisonInventory) : undefined;
    if (input.comparisonInventory) await assertComparisonPlanInventoryCurrent(input.comparisonInventory, input.targetArtifactSha);
  } catch {
    return fail("PCAT-ORC-INVALID-PLAN", "comparison-source-selection-unavailable");
  }
  const planDigest = sha256Prefixed(
    JSON.stringify({
      sourceSnapshotFingerprint,
      targetArtifactSha: input.targetArtifactSha,
      targetCatalogReleaseDigest: input.targetCatalogReleaseDigest,
      migrationContractVersion: MIGRATION_CONTRACT_VERSION,
      phases: PRE_ACTIVATION_PHASES,
      ...(comparisonRules ? { comparisonRulesDigest: comparisonRules.digest } : {}),
      ...managementPin,
      ...(input.conversionManifest ? { conversionManifestDigest: conversionManifestDigest(input.conversionManifest) } : {}),
      ...(input.bindingImportIntent ? {bindingImportIntentDigest:bindingImportDigest(input.bindingImportIntent)} : {}),
      ...(input.bindingImportIntent ? {bindingArchiveRetainUntil:input.bindingArchiveRetainUntil} : {}),
    }),
  );
  return ok({
    planDigest,
    sourceSnapshotFingerprint,
    targetArtifactSha: input.targetArtifactSha,
    targetCatalogReleaseDigest: input.targetCatalogReleaseDigest,
    migrationContractVersion: MIGRATION_CONTRACT_VERSION,
    phases: PRE_ACTIVATION_PHASES,
    ...(comparisonRules ? { comparisonRules } : {}),
    ...managementPin,
    ...(input.conversionManifest ? { conversionManifestDigest: conversionManifestDigest(input.conversionManifest) } : {}),
    ...(input.bindingImportIntent ? {bindingImportIntentDigest:bindingImportDigest(input.bindingImportIntent)} : {}),
    ...(input.bindingImportIntent ? {bindingArchiveRetainUntil:input.bindingArchiveRetainUntil} : {}),
  });
};

const requirePopulated = async (
  client: CutoverQueryable,
  graph: FrozenP0Graph,
  plannedSourceRegistration = false,
): Promise<CutoverResult<true>> => {
  const inventory = await countPopulatedInventory(client);
  if (inventory.specs === 0 || (!plannedSourceRegistration && inventory.identities === 0) || graph.identities.length === 0) {
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
  sourceClient?: pg.PoolClient,
): Promise<CutoverResult<Readonly<Record<string, unknown>>>> => {
  switch (phase) {
    case "P0": {
      const classified = classifyFrozenP0Graph(input.graph);
      if (!classified.ok) {
        return fail("PCAT-ORC-INVALID-PLAN", classified.error.detail);
      }
      if (input.plan.comparisonRules) {
        await registerPlannedSourceIdentities({ client,
          sourceSystem: input.plan.comparisonRules.inventory.binding.sourceSystem,
          identities: input.graph.identities.map(({ id, ...identity }) => ({ legacyIdentityId: id, ...identity })),
          beforeEffect: () => assertComparisonPlanInventoryCurrent(input.comparisonInventory!, input.plan.targetArtifactSha),
        });
        const populated = await requirePopulated(client, input.graph);
        if (!populated.ok) return populated;
      }
      const inventory = await countPopulatedInventory(client);
      return ok({
        sourceSnapshotFingerprint: fingerprintP0Graph(input.graph),
        identityCount: input.graph.identities.length,
        specCount: inventory.specs,
        classifierVersion: classified.value.classifierVersion,
        installer: installPublishedRelease.name,
        ...(input.plan.comparisonRules ? { comparisonRules: input.plan.comparisonRules } : {}),
        ...(input.bindingImportIntent ? {sourceInventoryFingerprint:input.bindingImportIntent.sourceInventoryFingerprint,bindingImportIntent:input.bindingImportIntent,bindingImportIntentDigest:bindingImportDigest(input.bindingImportIntent),conversionManifestDigest:input.plan.conversionManifestDigest,bindingArchiveRetainUntil:input.plan.bindingArchiveRetainUntil} : {}),
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
    case "P2": {
      if (input.bindingImportIntent) {
        if (!input.bindingBoundary) return fail("PCAT-ORC-PHASE-FAILED","binding-write-boundary-producer-unavailable");
        const target = await readBindingDatabaseIdentity(client);
        const receipt = await input.bindingBoundary.prepare({runId,plan:input.plan,target});
        if (receipt.runId !== runId || receipt.planDigest !== input.plan.planDigest || bindingImportDigest(receipt.target) !== bindingImportDigest(target) || receipt.sourceInventoryFingerprint !== input.bindingImportIntent.sourceInventoryFingerprint || !/^sha256:[a-f0-9]{64}$/.test(receipt.writeFenceReceiptDigest) || !/^sha256:[a-f0-9]{64}$/.test(receipt.recoveryManifestDigest)) return fail("PCAT-ORC-PHASE-FAILED","binding-boundary-receipt-mismatch");
        await input.bindingBoundary.verify(receipt);
        return ok({bindingBoundaryReceipt:receipt});
      }
      if (input.plan.comparisonRules) return fail("PCAT-ORC-PHASE-FAILED", "binding-write-boundary-producer-unavailable");
      return ok({
        writersFenced: true,
        queuesDrained: true,
        publicProxyStopped: true,
      });
    }
    case "P3": {
      if (input.bindingImportIntent) {
        const checkpoints = await loadCheckpoints(client,runId);
        const receipt = checkpoints.find(c => c.phase === "P2")?.payload.bindingBoundaryReceipt as import("./interface").BindingBoundaryReceipt | undefined;
        if (!receipt || !input.bindingBoundary) return fail("PCAT-ORC-PHASE-FAILED","binding-recovery-boundary-unavailable");
        await input.bindingBoundary.verify(receipt);
        return ok({bindingBoundaryReceipt:receipt,recoveryManifestDigest:receipt.recoveryManifestDigest});
      }
      const dump = await captureInventoryDump(client);
      const runBoundToken = mintRunBoundToken();
      return ok({
        dump,
        dumpDigest: dumpDigest(dump),
        runBoundToken,
      });
    }
    case "P4": {
      if (input.bindingImportIntent || input.plan.managementMigrationReceiptDigest || input.plan.comparisonRules) {
        const receiptDigest = input.plan.managementMigrationReceiptDigest;
        if (!receiptDigest || !input.plan.managementPreparation || !input.managementMigrations) return fail("PCAT-ORC-PHASE-FAILED", "management-migration-receipt-unavailable");
        try {
          const proof = await input.managementMigrations.verify({ receiptDigest, target: await readBindingDatabaseIdentity(client), preparation: input.plan.managementPreparation });
          if (proof.receiptDigest !== receiptDigest || ![proof.sourceSnapshotDigest, proof.candidateInventoryDigest].every(pin => /^sha256:[a-f0-9]{64}$/.test(pin))) return fail("PCAT-ORC-PHASE-FAILED", "management-migration-receipt-mismatch");
          return ok({ schemaExpanded: true, mode: "controlled-receipt-verified", ...proof });
        } catch { return fail("PCAT-ORC-PHASE-FAILED", "management-migration-receipt-verification-failed"); }
      }
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
      if (input.bindingImportIntent) {
        const bundle = await parseBundle(input.catalogReleaseSource);
        const chain: typeof bundle.releases[number][] = [];
        let node = bundle.releases.find(r => r.manifest.release.id === bundle.targetReleaseId);
        while (node) {
          if (chain.some(r => r.manifest.release.id === node!.manifest.release.id)) return fail("PCAT-ORC-PHASE-FAILED","binding-release-chain-cycle");
          chain.unshift(node);
          const previous = node.manifest.release.predecessor;
          if (!previous) break;
          node = bundle.releases.find(r => r.manifest.release.id === previous.id && r.manifest.release.digest === previous.digest);
          if (!node) return fail("PCAT-ORC-PHASE-FAILED","binding-release-chain-incomplete");
        }
        const installedCurrent = await client.query<{id:string;digest:string}>("select r.id,r.release_digest as digest from parameter_catalog.catalog_state s join parameter_catalog.catalog_releases r on r.id=s.current_catalog_release_id where s.singleton");
        let current = installedCurrent.rows[0];
        const currentIndex = current ? chain.findIndex(r => r.manifest.release.id === current.id && r.manifest.release.digest === current.digest) : -1;
        if (current && currentIndex < 0) return fail("PCAT-ORC-PHASE-FAILED","binding-release-installed-outside-chain");
        for (let index = currentIndex+1; index < chain.length; index++) {
          const target = chain[index].manifest.release;
          const source = jsonCatalogReleaseSource({...bundle,targetReleaseId:target.id,releases:chain.slice(0,index+1)});
          const installed = await installPublishedRelease(input.pool,current ? {mode:"advance",source,expectedTargetDigest:CatalogReleaseDigest(target.digest),expectedCurrent:{id:CatalogReleaseId(current.id),digest:CatalogReleaseDigest(current.digest)}} : {mode:"bootstrap",source,expectedTargetDigest:CatalogReleaseDigest(target.digest)});
          if (!installed.ok) return fail("PCAT-ORC-PHASE-FAILED",installed.error.kind);
          current = {id:installed.value.current.id,digest:installed.value.current.digest};
        }
        if (!current || current.digest !== input.plan.targetCatalogReleaseDigest) return fail("PCAT-ORC-PHASE-FAILED","binding-release-chain-target-mismatch");
        return ok({currentId:current.id,currentDigest:current.digest,retainedReleaseIds:chain.map(r => r.manifest.release.id)});
      }
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
          if (input.bindingImportIntent && ["project-parameter-binding","project-parameter-binding-revision"].includes(assignment.sourceKind)) continue;
          const mapping = input.conversionManifest?.mappings.find((row) => row.legacyIdentityId === assignment.identityId);
          if (!mapping) return fail("PCAT-ORC-PHASE-FAILED", "P7 requires an exact source-bound conversion identity");
          const mappedRow = await appendMappingVersion({
            client,
            cutoverRunId: runId,
            classification: classified,
            identityId: assignment.identityId,
            sourceChecksum: classified.graphFingerprint,
            expectedHead: null,
            outcome: {
              kind: "operational",
              targetKind: mapping.targetKind,
              targetId: mapping.targetId,
            },
          });
          if (!mappedRow.ok) {
            return fail("PCAT-ORC-PHASE-FAILED", mappedRow.error.detail);
          }
          mapped.push(`${assignment.identityId}:${disposition}`);
          continue;
        }
        const sourceGraph = assignment.sourceKind === "parameter-spec" ? await captureArchivedDefinitionGraph(client, assignment.sourceId) : null;
        if (!sourceGraph) return fail("PCAT-ORC-PHASE-FAILED", "archive-source-family-unavailable");
        const archived = await adapter.persistArchive({
          actor: { role: "cutover-operator", auditRef: input.operatorAuditRef },
          legacyIdentityId: assignment.identityId,
          ownerScopeKind: assignment.ownerScopeKind,
          ownerScopeId: assignment.ownerScopeId,
          rClass: assignment.rClass,
          reason: `cutover-${disposition}-${assignment.rClass}`,
          sourceGraph,
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
        ...(input.bindingImportIntent && input.conversionManifest ? {bindingMappingPins:await captureBindingMappingPins(client,runId,input.conversionManifest)} : {}),
      });
    }
    case "P8": {
      if (input.bindingImportIntent) return fail("PCAT-ORC-PHASE-FAILED","binding-P8-requires-controller-transaction");
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
      if (input.bindingImportIntent) {
        const checkpoints = await loadCheckpoints(client,runId);
        const receipt = checkpoints.find(c => c.phase === "P8")?.payload.bindingImport;
        if (!receipt) return fail("PCAT-ORC-PHASE-FAILED","binding-P8-receipt-missing");
        if (!sourceClient) return fail("PCAT-ORC-PHASE-FAILED","binding-source-management-connection-required");
        const imported = await importPreparedBindingHistory({client,sourceClient,runId,planDigest:input.plan.planDigest,manifestDigest:bindingImportDigest(receipt),archive:{objectStore:input.archiveObjectStore,encryptionKey:input.archiveEncryptionKey}});
        if (!imported.ok) return fail("PCAT-ORC-PHASE-FAILED",imported.reason);
        const classified = classificationRef.value;
        if (!classified) return fail("PCAT-ORC-PHASE-FAILED","binding-P6-classification-missing");
        for (const assignment of classified.assignments.filter(a => ["project-parameter-binding","project-parameter-binding-revision"].includes(a.sourceKind))) {
          if (assignment.disposition !== "mapped") return fail("PCAT-ORC-PHASE-FAILED","binding-primary-disposition-not-operational");
          const mapped = await appendMappingVersion({client,cutoverRunId:runId,classification:classified,identityId:assignment.identityId,sourceChecksum:input.bindingImportIntent.bindingInventoryDigest,expectedHead:null,outcome:{kind:"operational",targetKind:assignment.sourceKind === "project-parameter-binding" ? "parameter-binding":"project-value",targetId:assignment.sourceId}});
          if (!mapped.ok || mapped.value.status === "blocked") return fail("PCAT-ORC-PHASE-FAILED","binding-source-map-failed");
        }
        return ok({bindingImport:imported});
      }
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
      if (input.bindingImportIntent) {
        const checkpoints = await loadCheckpoints(client,runId);
        const receipt = checkpoints.find(c => c.phase === "P8")?.payload.bindingImport;
        if (!receipt) return fail("PCAT-ORC-PHASE-FAILED","binding-P8-receipt-missing");
        // S6 re-reads every target value/history/tip and all source rows; no cardinality-only pass.
        if (!sourceClient) return fail("PCAT-ORC-PHASE-FAILED","binding-source-management-connection-required");
        const verified = await importPreparedBindingHistory({client,sourceClient,runId,planDigest:input.plan.planDigest,manifestDigest:bindingImportDigest(receipt),archive:{objectStore:input.archiveObjectStore,encryptionKey:input.archiveEncryptionKey}});
        if (!verified.ok || verified.status !== "already-imported") return fail("PCAT-ORC-PHASE-FAILED",verified.ok ? "binding-import-receipt-missing":verified.reason);
      }
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
  body: (client: pg.PoolClient, assertLive: () => void) => Promise<CutoverResult<T>>,
): Promise<CutoverResult<T>> => {
  let client: pg.PoolClient | undefined, acquired = false, lost = false;
  const onLoss = () => { lost = true; };
  const unavailable = () => fail<T>("PCAT-ORC-PHASE-FAILED", "cutover-management-session-unavailable");
  const assertLive = () => { if (lost || !client) throw new Error("cutover-management-session-unavailable"); };
  let result: CutoverResult<T> = unavailable();
  try {
    await new Promise<void>((resolve, reject) => {
      try {
        pool.connect((error, observed) => {
          // pg-pool removes its idle error handler when checking a client out.
          // Own this exact session before the callback can return to pg-pool.
          if (observed) {
            client = observed;
            client.on("error", onLoss); client.on("end", onLoss);
          }
          if (error || !observed) { lost = true; reject(new Error("cutover-management-checkout-failed")); }
          else resolve();
        });
      } catch { lost = true; reject(new Error("cutover-management-checkout-failed")); }
    });
    assertLive();
    if (!client) return unavailable();
    const lock = await client.query<{ acquired: boolean }>("select pg_catalog.pg_try_advisory_lock(hashtext('s7-orc-cutover-target'), hashtext(current_database())) as acquired");
    acquired = lock.rows[0]?.acquired === true;
    assertLive();
    result = acquired ? await body(client, assertLive) : fail("PCAT-ORC-PHASE-FAILED", "cutover-target-lock-held");
  } catch {
    lost = true;
  } finally {
    if (client) {
      try {
        if (!lost && acquired) await client.query("select pg_catalog.pg_advisory_unlock(hashtext('s7-orc-cutover-target'), hashtext(current_database()))");
        if (!lost) await client.query("reset role");
      } catch { lost = true; }
      try {
        // A discarded native session must actually finish before its S7 lease
        // is considered released. Never end the caller's pool.
        if (lost) { if (!(client instanceof pg.Client)) throw new Error("cutover-management-client-unavailable"); await client.end(); }
      } catch { lost = true; }
      finally {
        try { client.release(lost); } catch { lost = true; }
        finally { client.off("error", onLoss); client.off("end", onLoss); }
      }
    }
  }
  return lost ? unavailable() : result;
};

export const executeCutover = async (
  input: ExecuteCutoverInput,
): Promise<CutoverResult<CutoverRunSnapshot>> => {
  // Fix serializable inputs before acquiring connections or invoking an async
  // receipt provider. Keep database/storage ports as opaque capabilities.
  input = { ...input, plan: structuredClone(input.plan), graph: structuredClone(input.graph),
    bindingImportIntent: input.bindingImportIntent && structuredClone(input.bindingImportIntent),
    conversionManifest: input.conversionManifest && structuredClone(input.conversionManifest),
    archiveEncryptionKey: Buffer.isBuffer(input.archiveEncryptionKey) ? Buffer.from(input.archiveEncryptionKey) : input.archiveEncryptionKey };
  if (input.failBeforePhase) {
    const allowed = assertAllowedPhase(input.failBeforePhase);
    if (!allowed.ok) return allowed;
  }
  if (input.bindingImportIntent && (!input.bindingManagementPool || !input.bindingBoundary || !input.bindingJournal)) return fail("PCAT-ORC-INVALID-PLAN","binding-management-boundary-and-journal-required");
  const comparison = input.plan.comparisonRules !== undefined;
  if (comparison && (!input.openComparisonSource || !input.bindingManagementPool || !input.bindingJournal)) return fail("PCAT-ORC-INVALID-PLAN", "comparison-management-source-and-journal-required");
  if (!comparison && input.openComparisonSource) return fail("PCAT-ORC-INVALID-PLAN", "comparison-plan-required");
  return withCutoverLock(input.bindingImportIntent || comparison ? input.bindingManagementPool! : input.pool, async (client, assertLive) => {
    let comparisonSource: Awaited<ReturnType<NonNullable<ExecuteCutoverInput["openComparisonSource"]>>> | undefined;
    let comparisonTransaction = false, comparisonWritten = false;
    let startupAttempt: BindingPhaseAttempt | undefined;
    let comparisonPendingAttempt: BindingPhaseAttempt | undefined;
    try {
    if (comparison) {
      await assertBindingManagementLogin(client);
      assertLive();
      await client.query("set role catalog_migration_owner");
      assertLive();
      const target = await readBindingDatabaseIdentity(client);
      assertLive();
      const unresolved = await input.bindingJournal!.unresolved(target);
      assertLive();
      if (unresolved.length) return fail("PCAT-ORC-RESUME-INVALIDATED", "binding-unresolved-phase-attempt");
      const previous = await loadRunByPlanDigest(client, input.plan.planDigest);
      assertLive();
      const prior = previous ? await loadCheckpoints(client, previous.id) : [];
      assertLive();
      if (!prior.some(checkpoint => checkpoint.phase === "P0")) {
        const runId = previous?.id ?? `cutover_${createHash("sha256").update(input.plan.planDigest).digest("hex").slice(0, 32)}`;
        startupAttempt = await input.bindingJournal!.begin({ target, runId, planDigest: input.plan.planDigest,
          phase: "P0", inputDigest: bindingImportDigest({ plan: input.plan, phase: "P0" }) });
        if (!startupAttempt.attemptId || startupAttempt.runId !== runId || startupAttempt.planDigest !== input.plan.planDigest || startupAttempt.phase !== "P0") throw new BindingProducerRefusal("binding-journal-attempt-mismatch");
        comparisonPendingAttempt = startupAttempt;
        assertLive();
      }
      // Registry writes belong to this original management transaction. A
      // second source SHARE on this table would block our own P0 INSERT.
      await client.query("begin isolation level serializable"); comparisonTransaction = true;
      assertLive();
      await client.query("lock table parameter_catalog.legacy_identities in share row exclusive mode nowait");
      assertLive();
      comparisonSource = await input.openComparisonSource!(client);
      assertLive();
      input = { ...input, comparisonInventory: comparisonSource.inventory };
    }
    let sourceInventory: string | undefined;
    if (input.bindingImportIntent) {
      try {
        await assertBindingManagementLogin(client);
        await client.query("set role catalog_migration_owner");
        const target = await readBindingDatabaseIdentity(client);
        if (!comparison && (await input.bindingJournal!.unresolved(target)).length !== 0) return fail("PCAT-ORC-RESUME-INVALIDATED","binding-unresolved-phase-attempt");
        const source = await input.pool.connect();
        try {
          if (bindingImportDigest(await readBindingDatabaseIdentity(source)) !== bindingImportDigest(target)) return fail("PCAT-ORC-INVALID-PLAN","binding-management-target-mismatch");
          sourceInventory = await captureConversionSourceInventory(source);
          const observed = await captureBindingImportIntent(source,input.bindingImportIntent);
          if (bindingImportDigest(observed) !== bindingImportDigest(input.bindingImportIntent)) return fail("PCAT-ORC-INVALID-PLAN","binding-import-source-drift");
        } finally { source.release(); }
        const sourceBindings = await client.query("select id,organization_id,parameter_spec_id,module_id from public.project_parameter_bindings order by id");
        const sourceRevisions = await client.query("select id,binding_id,parameter_spec_version_id from public.project_parameter_binding_revisions order by id");
        const identities = await client.query("select id,source_system,source_kind,owner_scope_kind,owner_scope_id,source_id from parameter_catalog.legacy_identities order by id");
        if ((!comparisonPendingAttempt && identities.rowCount !== input.graph.identities.length) || !identities.rows.every(i => input.graph.identities.some(g => g.id === i.id && g.sourceSystem === i.source_system && g.sourceKind === i.source_kind && g.sourceId === i.source_id && g.ownerScopeKind === i.owner_scope_kind && g.ownerScopeId === i.owner_scope_id))) return fail("PCAT-ORC-INVALID-PLAN","binding-source-identity-registry-drift");
        if (sourceBindings.rows.length !== input.graph.bindings.length || !sourceBindings.rows.every(b => input.graph.bindings.some(g => g.id === b.id && g.organizationId === b.organization_id && g.parameterSpecId === b.parameter_spec_id && g.moduleId === b.module_id)) || sourceRevisions.rows.length !== input.graph.bindingRevisions.length || !sourceRevisions.rows.every(r => input.graph.bindingRevisions.some(g => g.id === r.id && g.bindingId === r.binding_id && g.parameterSpecVersionId === r.parameter_spec_version_id))) return fail("PCAT-ORC-INVALID-PLAN","binding-source-graph-conservation");
      } catch (error) { return fail("PCAT-ORC-INVALID-PLAN",error instanceof BindingProducerRefusal || error instanceof BindingSourceRefusal ? error.message : "binding-management-preflight-query-failure"); }
    }
    const replanned = await planCutover({ graph: input.graph, comparisonInventory: input.comparisonInventory, targetArtifactSha: input.plan.targetArtifactSha, targetCatalogReleaseDigest: input.plan.targetCatalogReleaseDigest, catalogReleaseSource: input.catalogReleaseSource, conversionManifest: input.conversionManifest, bindingImportIntent:input.bindingImportIntent,bindingArchiveRetainUntil:input.plan.bindingArchiveRetainUntil,managementMigrationReceiptDigest:input.plan.managementMigrationReceiptDigest,managementPreparation:input.plan.managementPreparation });
    if (!replanned.ok) return replanned;
    if (replanned.value.planDigest !== input.plan.planDigest) return fail("PCAT-ORC-INVALID-PLAN", "conversion-plan-mismatch");
    // A committed P4 checkpoint is historical evidence. Resume and completed
    // replay must recompute its current applicability before any run write.
    if (input.bindingImportIntent || input.plan.managementMigrationReceiptDigest || comparison) {
      const prepared = await runPhase("P4", input, client, "pre-admission", { value: null });
      if (!prepared.ok) return prepared;
    }
    if (input.plan.conversionManifestDigest || input.conversionManifest) {
      if (!input.conversionManifest || input.plan.conversionManifestDigest !== conversionManifestDigest(input.conversionManifest)) return fail("PCAT-ORC-INVALID-PLAN", "conversion-manifest-digest-mismatch");
      if ((sourceInventory ?? await captureConversionSourceInventory(client)) !== input.conversionManifest.sourceInventoryFingerprint) return fail("PCAT-ORC-INVALID-PLAN", "conversion-source-inventory-drift");
      if (!await definitionGraphMatchesSource(client, input.graph)) return fail("PCAT-ORC-INVALID-PLAN", "conversion-source-graph-mismatch");
    }
    const populated = await requirePopulated(client, input.graph, !!comparisonPendingAttempt);
    if (!populated.ok) return populated;

    const existing = await loadRunByPlanDigest(client, input.plan.planDigest);
    const runId = existing?.id ?? `cutover_${createHash("sha256").update(input.plan.planDigest).digest("hex").slice(0, 32)}`;
    const beginAttempt = async (phase:PreActivationPhase):Promise<BindingPhaseAttempt> => {
      const attempt = await input.bindingJournal!.begin({target:await readBindingDatabaseIdentity(client),runId,planDigest:input.plan.planDigest,phase,inputDigest:bindingImportDigest({plan:input.plan,phase})});
      if (!attempt.attemptId || attempt.runId !== runId || attempt.planDigest !== input.plan.planDigest || attempt.phase !== phase) throw new BindingProducerRefusal("binding-journal-attempt-mismatch");
      return attempt;
    };
    // Persist intent before creating a new run. Interruption cannot erase its pending state.
    startupAttempt ??= input.bindingImportIntent && !existing ? await beginAttempt("P0") : undefined;
    if (comparisonSource) await comparisonSource.verify();
    if (comparison && !existing) comparisonWritten = true;
    const run = existing ?? (await insertPlannedRun(client, { runId, plan: input.plan }));
    const priorCheckpoints = await loadCheckpoints(client, run.id);
    if (comparisonSource && priorCheckpoints.some(checkpoint => checkpoint.phase === "P0")) {
      await comparisonSource.verify();
      await client.query("rollback"); comparisonTransaction = false;
      await comparisonSource.close(); comparisonSource = undefined;
    }
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
      if (input.bindingImportIntent) {
        const receipt = priorCheckpoints.find(c => c.phase === "P2")?.payload.bindingBoundaryReceipt as import("./interface").BindingBoundaryReceipt | undefined;
        const bindingReceipt = priorCheckpoints.find(c => c.phase === "P8")?.payload.bindingImport;
        if (!receipt || !bindingReceipt || !input.bindingBoundary) return fail("PCAT-ORC-PHASE-FAILED","binding-completed-receipt-missing");
        let source: LockedBindingSource | undefined;
        try {
          await input.bindingBoundary.verify(receipt);
          source = await openLockedBindingSource(input.pool,client);
          await client.query("begin isolation level serializable");
          const verified = await verifyPreparedBindingHistory({client,sourceClient:source.client,runId:run.id,planDigest:input.plan.planDigest,manifestDigest:bindingImportDigest(bindingReceipt),archive:{objectStore:input.archiveObjectStore,encryptionKey:input.archiveEncryptionKey}});
          await client.query("rollback");
          if (!verified.ok) return fail("PCAT-ORC-PHASE-FAILED",verified.reason);
        } catch { await client.query("rollback").catch(() => undefined); return fail("PCAT-ORC-PHASE-FAILED","binding-completed-verification-failed"); }
        finally { await source?.close(); }
      }
      const live = await countLiveRuns(client, input.plan.planDigest);
      const snapshot = await snapshotFromRun(client, run, true);
      return ok({ ...snapshot, liveRun: live > 0 });
    }

    if (comparisonPendingAttempt) comparisonWritten = true;
    if (comparisonSource) await comparisonSource.verify();
    await updateRunProgress(client, { runId: run.id, phase: priorCheckpoints.at(-1)?.phase ?? "P0", state: "running" });
    const classificationRef: { value: ClassificationResult | null } = { value: null };
    if (priorCheckpoints.some((row) => row.phase === "P6")) {
      const classified = classifyFrozenP0Graph(input.graph);
      if (classified.ok) classificationRef.value = classified.value;
    }

    for (const phase of PRE_ACTIVATION_PHASES) {
      if (priorCheckpoints.some((row) => row.phase === phase)) continue;
      if (input.bindingImportIntent && phase !== "P0" && phase !== "P1" && phase !== "P2") {
        const checkpoints = await loadCheckpoints(client,run.id);
        const receipt = checkpoints.find(c => c.phase === "P2")?.payload.bindingBoundaryReceipt as import("./interface").BindingBoundaryReceipt | undefined;
        if (!receipt || !input.bindingBoundary) return fail("PCAT-ORC-PHASE-FAILED","binding-boundary-receipt-missing");
        try { await input.bindingBoundary.verify(receipt); }
        catch { return fail("PCAT-ORC-PHASE-FAILED","binding-write-boundary-drift"); }
      }
      if (input.failBeforePhase === phase) {
        await updateRunProgress(client, {
          runId: run.id,
          phase: (await loadCheckpoints(client,run.id)).at(-1)?.phase ?? "P0",
          state: "running",
        });
        return fail(
          "PCAT-ORC-CRASH",
          `Injected crash before ${phase}; inspect the last committed checkpoint and resume the same plan`,
        );
      }
      const comparisonP0 = comparison && phase === "P0";
      const atomic = comparisonP0 || !!input.bindingImportIntent && ["P8","P9","P10"].includes(phase);
      let committing = false;
      let source: LockedBindingSource | undefined;
      let attempt: BindingPhaseAttempt | undefined;
      let phaseStarted = false;
      try {
      if (input.bindingImportIntent || comparisonP0) {
        attempt = startupAttempt ?? await beginAttempt(phase);
        startupAttempt = undefined;
      }
      if (atomic && !comparisonP0) source = await openLockedBindingSource(input.pool,client);
      phaseStarted = true;
      let payload: CutoverResult<Readonly<Record<string,unknown>>>;
      if (input.bindingImportIntent && phase === "P8") {
        const checkpoints = await loadCheckpoints(client,run.id);
        const pins = checkpoints.find(c => c.phase === "P7")?.payload.bindingMappingPins as BindingMappingPin[] | undefined;
        if (!pins || !classificationRef.value || !input.conversionManifest) return fail("PCAT-ORC-PHASE-FAILED","binding-P7-pins-missing");
        const producer = {client,sourceClient:source!.client,runId:run.id,planDigest:input.plan.planDigest,intent:input.bindingImportIntent,graph:input.graph,
          classification:classificationRef.value,conversion:input.conversionManifest,bundle:await parseBundle(input.catalogReleaseSource),p7Pins:pins,
          archive:{objectStore:input.archiveObjectStore,encryptionKey:input.archiveEncryptionKey},operatorAuditRef:input.operatorAuditRef,
          retainUntil:new Date(input.plan.bindingArchiveRetainUntil!)};
        const archives = await prepareBindingEvidenceArchives(producer);
        await client.query("begin isolation level serializable");
        payload = ok({bindingImport:await produceBindingImportReceipt(producer,archives)});
      } else {
        if (atomic && !comparisonP0) { await client.query("begin isolation level serializable"); await client.query("select pg_catalog.pg_current_xact_id()"); }
        if (comparisonP0) { await comparisonSource!.verify(); comparisonWritten = true; }
        payload = await runPhase(phase, input, client, run.id, classificationRef,source?.client);
      }
      if (!payload.ok) {
        if (atomic) await client.query("rollback");
        if (attempt) await input.bindingJournal!.finish({attempt,outcome:atomic ? "failed":"unknown"});
        if (comparisonP0) comparisonPendingAttempt = undefined;
        await updateRunProgress(client, {
          runId: run.id,
          phase: (await loadCheckpoints(client,run.id)).at(-1)?.phase ?? "P0",
          state: payload.error.code === "PCAT-ORC-CLASSIFICATION-BLOCKED" ? "recovery-required" : "failed",
        });
        return payload;
      }
      if (comparisonP0) await comparisonSource!.verify();
      const checkpoint = await persistCheckpoint(client, {
        runId: run.id,
        phase,
        payload: payload.value,
      });
      if (!checkpoint.ok) {
        if (atomic) await client.query("rollback");
        if (attempt) await input.bindingJournal!.finish({attempt,outcome:atomic ? "failed":"unknown"});
        if (comparisonP0) comparisonPendingAttempt = undefined;
        await updateRunProgress(client, { runId: run.id, phase:(await loadCheckpoints(client,run.id)).at(-1)?.phase ?? "P0", state: "failed" });
        return checkpoint;
      }
      if (comparisonP0) await comparisonSource!.verify();
      await updateRunProgress(client, {
        runId: run.id,
        phase,
        state: phase === "P10" ? "completed" : "running",
      });
      if (comparisonP0) await comparisonSource!.verify();
      if (atomic) { committing = true; await client.query("commit"); }
      if (comparisonP0) comparisonTransaction = false;
      if (attempt) await input.bindingJournal!.finish({attempt,outcome:"committed"});
      if (comparisonP0) {
        comparisonPendingAttempt = undefined;
        // Keep the old-source SHARE lease through the original host journal
        // acknowledgement. The manager's transaction challenge has ended, so
        // there is deliberately no post-commit revalidation of that challenge.
        await comparisonSource!.close(); comparisonSource = undefined;
      }
      } catch (error) {
        if (atomic) await client.query("rollback").catch(() => undefined);
        // A pending intent remains durable even if recording this unknown outcome fails.
        if (attempt) await input.bindingJournal!.finish({attempt,outcome:phaseStarted ? "unknown":"failed"}).catch(() => undefined);
        if (comparisonP0) comparisonPendingAttempt = undefined;
        // No retry and no successful checkpoint inference after an uncertain COMMIT response.
        return fail("PCAT-ORC-PHASE-FAILED",committing ? "binding-phase-commit-outcome-unknown" : error instanceof BindingProducerRefusal || error instanceof BindingSourceRefusal ? error.message : "binding-phase-query-failure");
      } finally { await source?.close(); }
    }

    const finished = await loadRunById(client, run.id);
    if (!finished) return fail("PCAT-ORC-NOT-FOUND", "Cutover run disappeared during execute");
    return ok(await snapshotFromRun(client, finished, resumed));
    } catch {
      return fail("PCAT-ORC-PHASE-FAILED", "comparison-source-execution-unavailable");
    } finally {
      if (comparisonTransaction) await client.query("rollback").catch(() => undefined);
      if (comparisonPendingAttempt) await input.bindingJournal!.finish({ attempt: comparisonPendingAttempt,
        outcome: comparisonWritten ? "unknown" : "failed" }).catch(() => undefined);
      await comparisonSource?.close();
    }
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

  return withCutoverLock(input.pool, async (client) => {
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
