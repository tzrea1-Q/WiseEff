import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RootDatabase, Queryable } from "../../server/shared/database/client";
import type { ObjectStore } from "../../server/modules/logs/objectStore";
import { getAuthContext } from "../../server/modules/auth/repository";
import { canEditParameters, canAdminParameters } from "../../server/modules/parameter-kernel/policy";
import { collectPublicationPolicyInstanceSnapshot } from "../../server/modules/catalog-publication/authorization/instanceSnapshot";
import { reviewedSeedProjectSources } from "../../server/modules/parameter-bindings/seedInitialization/seedSources";
import { canonicalSeedInitializationDigest, type SeedDigestFile } from "../../server/modules/parameter-bindings/seedInitialization/digest";
import { resolveSeedInitializationPlan, assertSeedInitializationPlanApplicable } from "../../server/modules/parameter-bindings/seedInitialization/plan";
import { captureProjectParameterPlane, assertProjectParameterPlaneArchived, ARCHIVED_PARAMETER_PLANE_RELATIONS, parameterPlaneScopePredicate } from "../../server/modules/parameter-bindings/seedInitialization/archive";
import { curateReviewedSeedPlacementCapacity } from "../../server/modules/parameter-bindings/seedInitialization/placementCapacity";
import { materializeSeedSources } from "../../server/modules/parameter-bindings/seedInitialization/materialize";
import { disposeProjectParameterPlaneResidue } from "../../server/modules/parameter-bindings/seedInitialization/dispose";
import { buildSeedReconciliation } from "./seedReconciliation";
import { seedRebuildDigest, sealSeedRebuildPlan, confirmSeedRebuildPlan, type SealedSeedRebuildPlan } from "./seedRebuildPlan";
import { captureSeedPreservation, verifySeedPreservation, type SeedPreservation } from "./seedRebuildPreservation";
import { reviewedSeedIdentities, verifySeedIdentities } from "./seedRebuildVerification";

export type SeedArchive = { projectId: string; archiveId: string; archiveDigest: string };
export type SeedRebuildState = {
  version: 1; runId: string; plan: SealedSeedRebuildPlan;
  baseline: SeedPreservation; expectedIdentities: string[];
  originalParameterDigest: string;
  policy: { revision: number; capabilityContractRevision: string | null; lowRiskSingleActorPublish: boolean };
  phase: "planned" | "catalog" | "archiving" | "materializing" | "disposing" | "verified" | "recovery-required";
  archives: SeedArchive[];
  preparedInputs?: Record<string, unknown>;
  publications: Record<string, { candidateId: string; artifactDigest: string; releaseId: string; releaseDigest: string; receiptId?: string }>;
};
export type SeedRebuildContext = { db: RootDatabase; store: ObjectStore; repoRoot: string };

export async function seedRebuildActor(db: Queryable, actor: string, organizationId: string) {
  const auth = await getAuthContext(db, actor);
  if (!auth.user.isActive || auth.organization.id !== organizationId || !canEditParameters(auth) || !canAdminParameters(auth)
    || ["atlas", "aurora", "nebula"].some((id) => !canEditParameters(auth, id))) {
    throw new Error("seed-rebuild-actor-forbidden");
  }
  return auth;
}

async function sourceFacts(repoRoot: string, organizationId: string) {
  const sources = await reviewedSeedProjectSources(repoRoot, { board: true, json: true });
  const manifest = buildSeedReconciliation(repoRoot).manifest;
  const reviewed = JSON.parse(await readFile(path.join(repoRoot, "src/config/seed-reconciliation/manifest.json"), "utf8"));
  if (seedRebuildDigest(manifest) !== seedRebuildDigest(reviewed)) throw new Error("seed-rebuild-unreviewed-source-drift");
  return {
    sources,
    seedDigest: canonicalSeedInitializationDigest({ organizationId,
      files: sources.flatMap((project) => project.files.map((file) => ({ ...file, projectId: project.projectId }))) as SeedDigestFile[] }),
    sourceDigest: seedRebuildDigest(manifest), expectedIdentities: reviewedSeedIdentities(manifest),
  };
}

async function databaseIdentity(db: Queryable) {
  const result = await db.query<{ oid: string; name: string; serverAddress: string; serverPort: number }>(`
    select oid::text as oid,current_database() as name,inet_server_addr()::text as "serverAddress",
    inet_server_port() as "serverPort" from pg_database where datname=current_database()`);
  if (!result.rows[0]) throw new Error("seed-rebuild-database-identity-missing");
  return result.rows[0];
}

async function parameterInventoryDigest(db: Queryable, store: ObjectStore, organizationId: string) {
  const fingerprints: unknown[] = [];
  for (const project of ["atlas", "aurora", "nebula"]) {
    for (const relation of ARCHIVED_PARAMETER_PLANE_RELATIONS) {
      const rows = await db.query<{ digest: string }>(`select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') as digest
        from ${relation.from} t where ${parameterPlaneScopePredicate(relation.scope)} order by 1 limit 5001`, [organizationId, project]);
      if (rows.rows.length > 5000) throw new Error("seed-rebuild-archive-row-limit");
      fingerprints.push([project, relation.key, rows.rows]);
    }
  }
  const keys = await db.query<{ storage_key: string }>(`select distinct v.storage_key from public.project_parameter_file_versions v
    join public.project_parameter_files f on f.id=v.file_id where f.organization_id=$1 and f.project_id=any($2::text[])
    order by v.storage_key`, [organizationId, ["atlas", "aurora", "nebula"]]);
  if (!store.getBounded) throw new Error("seed-rebuild-bounded-object-read-required");
  for (const row of keys.rows) fingerprints.push([row.storage_key,
    seedRebuildDigest((await store.getBounded(row.storage_key, 64 * 1024 * 1024)).toString("base64"))]);
  return seedRebuildDigest(fingerprints);
}

function inventoryOf(state: Pick<SeedRebuildState, "baseline" | "expectedIdentities" | "originalParameterDigest" | "policy">) {
  return { baseline: state.baseline, expectedIdentities: state.expectedIdentities,
    originalParameterDigest: state.originalParameterDigest, policy: state.policy };
}

export async function planSeedRebuild(ctx: SeedRebuildContext, input: {
  runId: string; organizationId: string; actorUserId: string; candidateSha: string;
}): Promise<SeedRebuildState> {
  const sources = await sourceFacts(ctx.repoRoot, input.organizationId);
  return ctx.db.transaction(async (db) => {
    await db.query("set transaction isolation level repeatable read, read only");
    const actor = await seedRebuildActor(db, input.actorUserId, input.organizationId);
    if (!actor.permissions.includes("catalog:author")) throw new Error("seed-rebuild-catalog-author-required");
    const projects = await resolveSeedInitializationPlan(db, { organizationId: input.organizationId, seedDigest: sources.seedDigest });
    assertSeedInitializationPlanApplicable(projects);
    // This operator repairs the observed old-only deployment. Never retire an existing canonical project silently.
    const existing = await db.query<{ count: string }>("select count(*)::text as count from parameter_catalog.project_parameter_bindings");
    if (existing.rows[0]?.count !== "0") throw new Error("seed-rebuild-canonical-data-already-present");
    const priorSeed = await db.query("select 1 from public.seed_initialization_runs where organization_id=$1 and seed_digest=$2 limit 1",
      [input.organizationId, sources.seedDigest]);
    if (priorSeed.rows.length) throw new Error("seed-rebuild-existing-seed-run-requires-review");
    const policy = await collectPublicationPolicyInstanceSnapshot(db);
    if (!policy.adopted || policy.artifactSourceKind !== "adopted-preexisting" || !policy.publicationEnabled
      || !policy.currentReleaseId || !policy.currentReleaseDigest) {
      throw new Error("seed-rebuild-adopted-publication-required");
    }
    const baseline = await captureSeedPreservation(db, ctx.store, input.organizationId);
    const inventory = { baseline, expectedIdentities: sources.expectedIdentities,
      originalParameterDigest: await parameterInventoryDigest(db, ctx.store, input.organizationId),
      policy: { revision: policy.policyRevision, capabilityContractRevision: policy.capabilityContractRevision,
        lowRiskSingleActorPublish: policy.lowRiskSingleActorPublish } };
    const plan = sealSeedRebuildPlan({
      version: 1, scope: "atlas-aurora-nebula", organizationId: input.organizationId,
      actorUserId: input.actorUserId, candidateSha: input.candidateSha,
      database: await databaseIdentity(db), seedDigest: sources.seedDigest, sourceDigest: sources.sourceDigest,
      catalog: { id: policy.currentReleaseId, digest: policy.currentReleaseDigest },
      targets: projects.targets.map((target) => target.projectId).sort(),
      inventoryDigest: seedRebuildDigest(inventory),
    });
    return { version: 1, runId: input.runId, plan, ...inventory,
      phase: "planned", archives: [], publications: {} };
  });
}

export async function checkSeedRebuildState(ctx: SeedRebuildContext, state: SeedRebuildState, confirmedDigest: string, candidateSha: string) {
  if (seedRebuildDigest(inventoryOf(state)) !== state.plan.inventoryDigest) {
    throw new Error("seed-rebuild-inventory-tampered");
  }
  const facts = await sourceFacts(ctx.repoRoot, state.plan.organizationId);
  const { digest: _digest, ...original } = state.plan;
  confirmSeedRebuildPlan(state.plan, confirmedDigest, { ...original, candidateSha,
    database: await databaseIdentity(ctx.db), seedDigest: facts.seedDigest, sourceDigest: facts.sourceDigest });
  await seedRebuildActor(ctx.db, state.plan.actorUserId, state.plan.organizationId);
  const projects = await resolveSeedInitializationPlan(ctx.db, { organizationId: state.plan.organizationId, seedDigest: facts.seedDigest });
  assertSeedInitializationPlanApplicable(projects);
  const policy = await collectPublicationPolicyInstanceSnapshot(ctx.db);
  if (!policy.publicationEnabled || policy.policyRevision !== state.policy.revision
    || policy.capabilityContractRevision !== state.policy.capabilityContractRevision
    || policy.lowRiskSingleActorPublish !== state.policy.lowRiskSingleActorPublish) throw new Error("seed-rebuild-policy-drift");
  if (["planned", "catalog"].includes(state.phase)
    && await parameterInventoryDigest(ctx.db, ctx.store, state.plan.organizationId) !== state.originalParameterDigest) {
    throw new Error("seed-rebuild-parameter-inventory-drift");
  }
  return facts;
}

export async function verifySeedRebuild(ctx: SeedRebuildContext, state: SeedRebuildState) {
  if (state.archives.length !== 3 || new Set(state.archives.map((item) => item.projectId)).size !== 3) {
    throw new Error("seed-rebuild-all-archives-required");
  }
  for (const archive of state.archives) await assertProjectParameterPlaneArchived(ctx.db, ctx.store,
    { ...archive, organizationId: state.plan.organizationId });
  const identities = await verifySeedIdentities(ctx.db, state.plan.organizationId, state.expectedIdentities);
  const sources = await reviewedSeedProjectSources(ctx.repoRoot, { board: true, json: true });
  const expectedFiles = new Map<string, Buffer>(sources.flatMap((project) => project.files.map((file) =>
    [`${project.projectId}:${file.name}`, Buffer.from(file.content)] as const)));
  const files = await ctx.db.query<{ project_id: string; source_name: string; storage_key: string }>(`
    select distinct b.project_id,m.source_name,v.storage_key
    from parameter_catalog.current_project_parameter_bindings b
    join parameter_catalog.project_value_source_pins p on p.binding_id=b.id and p.project_value_id=b.current_value_id
    join public.dts_config_revision_members m on m.config_revision_id=p.config_revision_id
      and m.file_id=p.file_id and m.file_version_id=p.file_version_id
    join public.project_parameter_file_versions v on v.id=p.file_version_id
    where b.organization_id=$1 and b.project_id=any($2::text[])`, [state.plan.organizationId, state.plan.targets]);
  if (files.rows.length !== expectedFiles.size || !ctx.store.getBounded) throw new Error("seed-rebuild-source-files-mismatch");
  for (const file of files.rows) {
    const key = `${file.project_id}:${file.source_name}`;
    const expected = expectedFiles.get(key);
    if (!expected || !(await ctx.store.getBounded(file.storage_key, 64 * 1024 * 1024)).equals(expected)) {
      throw new Error("seed-rebuild-source-bytes-mismatch");
    }
    expectedFiles.delete(key);
  }
  await verifySeedPreservation(ctx.db, ctx.store, state.plan.organizationId, state.baseline);
  return identities;
}

/** Call only behind the host lock and verified maintenance/recovery gate. Never replay ambiguous stages. */
export async function rebuildSeedProjects(ctx: SeedRebuildContext, state: SeedRebuildState,
  save: (state: SeedRebuildState) => Promise<void>) {
  if (state.phase === "verified") return verifySeedRebuild(ctx, state);
  if (state.phase !== "catalog" || !state.publications["configuration-schema"]?.receiptId
    || !state.publications.vendor?.receiptId) throw new Error("seed-rebuild-publication-or-recovery-required");
  const auth = await seedRebuildActor(ctx.db, state.plan.actorUserId, state.plan.organizationId);
  await verifySeedPreservation(ctx.db, ctx.store, state.plan.organizationId, state.baseline);
  const facts = await sourceFacts(ctx.repoRoot, state.plan.organizationId);
  const transition = async (phase: SeedRebuildState["phase"]) => { state.phase = phase; await save(state); };
  try {
    await transition("archiving");
    for (const projectId of state.plan.targets) {
      const archive = await captureProjectParameterPlane(ctx.db, ctx.store, auth, { projectId });
      state.archives.push({ projectId, archiveId: archive.archiveId, archiveDigest: archive.archiveDigest });
      await save(state);
      await assertProjectParameterPlaneArchived(ctx.db, ctx.store, { organizationId: state.plan.organizationId,
        projectId, archiveId: archive.archiveId, archiveDigest: archive.archiveDigest });
    }
    await transition("materializing");
    await curateReviewedSeedPlacementCapacity(ctx.db, { organizationId: state.plan.organizationId });
    const outcome = await materializeSeedSources(ctx.db, ctx.store, auth, {
      organizationId: state.plan.organizationId, seedDigest: facts.seedDigest, sources: facts.sources,
    });
    if (outcome.status !== "completed") throw new Error("seed-rebuild-unexpected-materializer-replay");
    await verifySeedRebuild(ctx, state);
    await transition("disposing");
    // Old parameter objects can be shared with preserved nonparameter records. Retain those bytes.
    const protectedKeys = new Set(state.baseline.objects.map((item) => item.key));
    const store: ObjectStore = { ...ctx.store, delete: async (key) => {
      if (!protectedKeys.has(key)) await ctx.store.delete?.(key);
    } };
    for (const archive of state.archives) await disposeProjectParameterPlaneResidue(ctx.db, store, auth,
      { role: "cutover-operator", approvalRef: `seed-rebuild:${state.runId}:${state.plan.digest}` }, archive);
    const result = await verifySeedRebuild(ctx, state);
    await transition("verified");
    return result;
  } catch (error) {
    state.phase = "recovery-required";
    await save(state);
    throw error;
  }
}
