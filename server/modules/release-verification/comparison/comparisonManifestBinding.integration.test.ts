import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import pg from "pg";
import { expect, it } from "vitest";

import { getAuthContextForExternalIdentity } from "../../auth/repository";
import { compileCatalogRelease } from "../../catalog-kernel/compiler";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { classifyFrozenP0Graph } from "../../catalog-cutover/classifier";
import {
  firstReleaseBundle,
  populatedCutoverGraph,
  seedPopulatedCutover,
} from "../../../testing/parameterCatalog/cutoverPopulatedFixture";
import { createDisposableParameterCatalogDatabase } from "../../../testing/parameterCatalog";
import { createLocalArchiveObjectStore } from "../../catalog-cutover/archive";
import {
  appendMappingVersion,
  readCurrentMappingHead,
} from "../../catalog-cutover/mapping";
import { readCompletedCutoverMappingManifest } from "../../catalog-cutover/completedMappingManifest";
import { fixtureCutoverIdentities } from "../../catalog-cutover/identities";
import { parseMappingManifestV2 } from "../../catalog-cutover/mappingManifest";
import { executeCutover, planCutover } from "../../catalog-cutover/orchestrator";
import { fixtureObservedQuiescence } from "../../catalog-cutover/quiescence";
import { fixtureObservedRecoveryPoint } from "../../catalog-cutover/recoveryPointObservation";
import { createParameterModule } from "../../parameters/parameterModuleRepository";

const sqlQuote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

it("binds a comparison result only to its exact completed-manifest selection", async () => {
  const database = await createDisposableParameterCatalogDatabase("s7comparisonbind");
  const pool = new pg.Pool({ connectionString: database.url, max: 4 });
  const client = new pg.Client({ connectionString: database.url });
  const objectRoot = await mkdtemp(path.join(os.tmpdir(), "s7comparisonbind-"));
  const organizationId = "s7-comparison-bind-org";
  const principalId = "s7-comparison-bind-admin";
  const writerRole = `s7_cmp_writer_${randomBytes(5).toString("hex")}`;
  const writerPassword = randomBytes(24).toString("hex");
  let writer: pg.Client | null = null;
  let writerRoleCreated = false;
  const moduleIdentityId = "z-s7orc-lid-mod";
  let moduleId = "";
  const baseGraph = populatedCutoverGraph();
  let graph: ReturnType<typeof populatedCutoverGraph>;

  try {
    await client.connect();
    await client.query("insert into public.organizations(id,name) values ($1,$1)", [organizationId]);
    await client.query(
      `insert into public.users(id,organization_id,name,email,title,is_active)
       values ($1,$2,$1,$3,'S7 comparison binding fixture',true)`,
      [principalId, organizationId, `${principalId}@example.test`],
    );
    await client.query(
      `insert into public.user_role_bindings(id,user_id,organization_id,project_id,role_id)
       values ($1,$2,$3,null,'admin')`,
      [`role-${principalId}`, principalId, organizationId],
    );
    const module = await createParameterModule(pool, {
      organizationId,
      name: "S7 comparison module",
    });
    moduleId = module.id;
    graph = {
      ...baseGraph,
      identities: [
        ...baseGraph.identities.map((identity) => ({
          ...identity,
          ownerScopeKind: "organization" as const,
          ownerScopeId: organizationId,
        })),
        {
          id: moduleIdentityId,
          sourceSystem: "wiseeff-v1",
          sourceKind: "parameter-module" as const,
          ownerScopeKind: "organization" as const,
          ownerScopeId: organizationId,
          sourceId: moduleId,
        },
      ],
      specs: baseGraph.specs.map((spec) => spec.id === "s7orc-spec-r1"
        ? {
            ...spec,
            organizationId,
            specificationKey: "s7p7.r9.historical",
            definitionLifecycle: "deprecated" as const,
            propertyKey: "s7p7,historical",
          }
        : { ...spec, organizationId }),
      specVersions: baseGraph.specVersions.map((version) =>
        version.parameterSpecId === "s7orc-spec-r1"
          ? { ...version, lifecycle: "deprecated" as const, versionStatus: "superseded" as const }
          : version,
      ),
      modules: [{
        id: moduleId,
        organizationId,
        kind: "business" as const,
        origin: "curated" as const,
        name: "S7 comparison module",
        attributionSubjectId: null,
      }],
    };
    await seedPopulatedCutover(client, graph);

    const bundle = firstReleaseBundle();
    const source = jsonCatalogReleaseSource(bundle);
    const compiled = compileCatalogRelease(bundle);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source,
      expectedTargetDigest: compiled.value.release.digest,
    });
    expect(installed.ok).toBe(true);

    const planFor = async (artifact: string) => planCutover({
      graph,
      targetArtifactSha: artifact.repeat(40),
      targetCatalogReleaseDigest: compiled.value.release.digest,
      identities: fixtureCutoverIdentities("s7-comparison-binding"),
      catalogReleaseSource: source,
    });
    const planA = await planFor("a");
    expect(planA.ok).toBe(true);
    if (!planA.ok) return;
    const objectStore = createLocalArchiveObjectStore(objectRoot);
    const failArchiveWrite = {
      ...objectStore,
      async putExclusive() {
        throw new Error("controlled P7 archive failure after first mapping append");
      },
    };
    const runA = await executeCutover({
      pool,
      plan: planA.value,
      graph,
      catalogReleaseSource: source,
      archiveObjectStore: failArchiveWrite,
      archiveEncryptionKey: randomBytes(32),
      operatorAuditRef: "audit-s7-comparison-binding-a",
      quiescence: fixtureObservedQuiescence(),
      recoveryPoint: fixtureObservedRecoveryPoint(),
    });
    expect(runA).toMatchObject({ ok: false, error: { code: "PCAT-ORC-PHASE-FAILED" } });

    const planB = await planFor("b");
    expect(planB.ok).toBe(true);
    if (!planB.ok) return;
    const runB = await executeCutover({
      pool,
      plan: planB.value,
      graph,
      catalogReleaseSource: source,
      archiveObjectStore: objectStore,
      archiveEncryptionKey: randomBytes(32),
      operatorAuditRef: "audit-s7-comparison-binding-b",
      quiescence: fixtureObservedQuiescence(),
      recoveryPoint: fixtureObservedRecoveryPoint(),
    });
    expect(runB).toMatchObject({ ok: true, value: { state: "completed" } });
    if (!runB.ok) return;

    const p7 = runB.value.checkpoints.find((checkpoint) => checkpoint.phase === "P7");
    const manifest = parseMappingManifestV2(p7?.payload.mappingManifest);
    expect(manifest).not.toBeNull();
    if (!p7 || !manifest) return;
    const replay = manifest.selections.find((selection) => selection.legacyIdentityId === "s7orc-lid-r1");
    const moduleSelection = manifest.selections.find((selection) => selection.legacyIdentityId === moduleIdentityId);
    expect(replay?.status).toBe("replayed");
    expect(moduleSelection?.sourceKind).toBe("parameter-module");
    expect(moduleSelection?.sourceId).toBe(moduleId);
    expect(moduleSelection?.status).toBe("appended");
    if (!replay || !moduleSelection) return;

    const auth = await getAuthContextForExternalIdentity(client, {
      organizationId,
      subject: principalId,
    });
    const completed = await readCompletedCutoverMappingManifest({ pool, runId: runB.value.runId, auth });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.value.fullRunDigest).toBe(manifest.digest);

    const classification = classifyFrozenP0Graph(graph);
    expect(classification.ok).toBe(true);
    if (!classification.ok) return;
    const head = await readCurrentMappingHead({ client, identityId: replay.legacyIdentityId });
    expect(head.ok).toBe(true);
    if (!head.ok || replay.mappingVersion.targetKind === null || replay.mappingVersion.targetId === null) return;
    const advanced = await appendMappingVersion({
      client,
      cutoverRunId: runB.value.runId,
      classification: classification.value,
      identityId: replay.legacyIdentityId,
      sourceChecksum: "sha256:s7-comparison-binding-later-head",
      expectedHead: { casVersion: head.value.casVersion, versionId: head.value.currentVersionId },
      outcome: {
        kind: "operational",
        targetKind: replay.mappingVersion.targetKind,
        targetId: replay.mappingVersion.targetId,
      },
    });
    expect(advanced).toMatchObject({ ok: true, value: { status: "appended" } });
    if (!advanced.ok || advanced.value.status !== "appended") return;
    expect(advanced.value.head.currentVersionId).not.toBe(replay.mappingVersion.id);
    expect(await readCompletedCutoverMappingManifest({ pool, runId: runB.value.runId, auth })).toEqual(completed);

    const runPins = {
      selection_run_id: runB.value.runId,
      selection_plan_digest: completed.value.planDigest,
      selection_catalog_release_id: completed.value.catalogRelease.id,
      selection_catalog_release_digest: completed.value.catalogRelease.digest,
      selection_manifest_digest: completed.value.fullRunDigest,
      selection_p7_checkpoint_digest: completed.value.p7CheckpointDigest,
    };
    const insertCase = async (input: {
      id: string;
      family: string;
      gate: string;
      key: string;
      phase: "pre-activation" | "post-p13" | null;
      sourceKind: string;
      sourceId: string;
      ownerKind: string | null;
      ownerId: string;
      runId?: string;
    }) => writer!.query(
      `insert into parameter_catalog.parameter_catalog_comparison_cases (
         id, cutover_run_id, gate_id, consumer_family, case_key, protected_reference,
         comparison_phase, protected_reference_kind, protected_reference_id,
         protected_reference_owner_scope_kind, protected_reference_owner_scope_id
       ) values ($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10)`,
      [input.id, input.runId ?? runB.value.runId, input.gate, input.family, input.key,
        input.phase, input.sourceKind, input.sourceId, input.ownerKind, input.ownerId],
    );
    const insertResult = async (input: {
      caseId: string;
      outcome?: string;
      mappingVersionId?: string | null;
      selectedIdentityId?: string;
      selectedVersionId?: string;
      pins?: typeof runPins;
      omitSelection?: boolean;
    }) => {
      const outcome = input.outcome ?? "declared-expected-difference";
      return writer!.query(
        `insert into parameter_catalog.parameter_catalog_comparison_results (
           comparison_case_id, outcome, mapping_version_id, rule_id, evidence,
           selection_run_id, selection_plan_digest, selection_catalog_release_id,
           selection_catalog_release_digest, selection_manifest_digest,
           selection_p7_checkpoint_digest, selection_legacy_identity_id,
           selection_mapping_version_id
         ) values ($1,$2,$3,$4,'{}'::jsonb,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [input.caseId, outcome,
          input.mappingVersionId === undefined ? replay.mappingVersion.id : input.mappingVersionId,
          outcome === "declared-expected-difference" ? "PCAT-CMP-D02-SUBJECT-IDENTITY" : null,
          ...(input.omitSelection
            ? [null, null, null, null, null, null, null, null]
            : [
                ...(Object.values(input.pins ?? runPins)),
                input.selectedIdentityId ?? replay.legacyIdentityId,
                input.selectedVersionId ?? replay.mappingVersion.id,
              ])],
      );
    };
    const bindingForCase = (selection: typeof replay, caseId: string) => ({
      id: caseId,
      family: "runtime",
      gate: "PCAT-CMP-D01",
      key: `runtime:PCAT-CMP-D01:${selection.sourceKind}:${selection.sourceId}:${caseId}`,
      phase: "pre-activation" as const,
      sourceKind: selection.sourceKind,
      sourceId: selection.sourceId,
      ownerKind: selection.ownerScopeKind,
      ownerId: selection.ownerScopeId,
    });
    const forceDeferredCheck = async (query: () => Promise<unknown>): Promise<pg.DatabaseError> => {
      await writer!.query("begin");
      return captureDatabaseError((async () => {
        try {
          await query();
          await writer!.query("set constraints all immediate");
          await writer!.query("commit");
        } catch (error) {
          await writer!.query("rollback");
          throw error;
        }
      })());
    };
    const assertNoCaseOrResult = async (caseId: string) => {
      const comparisonCase = await client.query<{ count: string }>(
        `select count(*)::text as count from parameter_catalog.parameter_catalog_comparison_cases where id = $1`,
        [caseId],
      );
      const result = await client.query<{ count: string }>(
        `select count(*)::text as count from parameter_catalog.parameter_catalog_comparison_results where comparison_case_id = $1`,
        [caseId],
      );
      expect(comparisonCase.rows[0]?.count).toBe("0");
      expect(result.rows[0]?.count).toBe("0");
    };
    const rejectedCase = async (
      caseInput: Parameters<typeof insertCase>[0],
      resultInput: Parameters<typeof insertResult>[0],
      expectedConstraint = "comparison_result_manifest_selection_fk",
    ) => {
      const error = await forceDeferredCheck(async () => {
        await insertCase(caseInput);
        await insertResult(resultInput);
      });
      expect(error.code).toBe("23503");
      expect(error.constraint).toBe(expectedConstraint);
      await assertNoCaseOrResult(caseInput.id);
    };
    const insertV1Case = (id: string) => writer!.query(
      `insert into parameter_catalog.parameter_catalog_comparison_cases (
         id, cutover_run_id, gate_id, consumer_family, case_key, protected_reference
       ) values ($1,$2,'PCAT-CMP-D01','runtime',$3,true)`,
      [id, runB.value.runId, `v1:${id}`],
    );

    await client.query(`create role ${writerRole} login password ${sqlQuote(writerPassword)} nosuperuser nobypassrls`);
    writerRoleCreated = true;
    await client.query(`grant usage on schema parameter_catalog to ${writerRole}`);
    await client.query(`grant select on
      parameter_catalog.parameter_catalog_comparison_cases,
      parameter_catalog.parameter_catalog_comparison_results,
      parameter_catalog.parameter_catalog_cutover_runs,
      parameter_catalog.parameter_catalog_cutover_checkpoints,
      parameter_catalog.parameter_catalog_cutover_events,
      parameter_catalog.catalog_releases,
      parameter_catalog.legacy_identities,
      parameter_catalog.legacy_mapping_versions
      to ${writerRole}`);
    await client.query(`grant insert on
      parameter_catalog.parameter_catalog_comparison_cases,
      parameter_catalog.parameter_catalog_comparison_results
      to ${writerRole}`);
    const writerUrl = new URL(database.url);
    writerUrl.username = writerRole;
    writerUrl.password = writerPassword;
    writer = new pg.Client({ connectionString: writerUrl.toString() });
    await writer.connect();
    const roleReceipt = await writer.query<{ session_user: string; current_user: string; rolsuper: boolean; rolbypassrls: boolean }>(
      `select session_user, current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(roleReceipt.rows).toEqual([{
      session_user: writerRole,
      current_user: writerRole,
      rolsuper: false,
      rolbypassrls: false,
    }]);

    for (const invalidCase of [
      { ...bindingForCase(replay, "comparison-missing-phase"), phase: null },
      { ...bindingForCase(replay, "comparison-missing-owner-kind"), ownerKind: null },
    ]) {
      await expect(insertCase(invalidCase)).rejects.toMatchObject({
        code: "23514",
        constraint: "parameter_catalog_comparison_case_v2_binding_ck",
      });
      await assertNoCaseOrResult(invalidCase.id);
    }

    const replayCase = bindingForCase(replay, "comparison-replay-selected");
    await insertCase(replayCase);
    await writer.query("begin");
    await insertResult({ caseId: replayCase.id });
    await writer.query("set constraints all immediate");
    await writer.query("commit");
    const replayResidue = await client.query<{ mapping_version_id: string; selected_mapping_version_id: string }>(
      `select mapping_version_id, selection_mapping_version_id as selected_mapping_version_id
         from parameter_catalog.parameter_catalog_comparison_results where comparison_case_id = $1`,
      [replayCase.id],
    );
    expect(replayResidue.rows).toEqual([{
      mapping_version_id: replay.mappingVersion.id,
      selected_mapping_version_id: replay.mappingVersion.id,
    }]);

    await insertCase({
      id: "comparison-mod-exact-selected",
      family: "MOD",
      gate: "PCAT-CMP-D02",
      key: `MOD:PCAT-CMP-D02-SUBJECT-IDENTITY:${moduleSelection.sourceKind}:${moduleSelection.sourceId}`,
      phase: "pre-activation",
      sourceKind: moduleSelection.sourceKind,
      sourceId: moduleSelection.sourceId,
      ownerKind: moduleSelection.ownerScopeKind,
      ownerId: moduleSelection.ownerScopeId,
    });
    await writer.query("begin");
    await insertResult({
      caseId: "comparison-mod-exact-selected",
      outcome: "exact-equivalent",
      mappingVersionId: null,
      selectedIdentityId: moduleSelection.legacyIdentityId,
      selectedVersionId: moduleSelection.mappingVersion.id,
    });
    await writer.query("set constraints all immediate");
    await writer.query("commit");
    expect((await client.query<{ mapping_version_id: string | null; selection_mapping_version_id: string }>(
      `select mapping_version_id, selection_mapping_version_id
         from parameter_catalog.parameter_catalog_comparison_results where comparison_case_id = $1`,
      ["comparison-mod-exact-selected"],
    )).rows).toEqual([{
      mapping_version_id: null,
      selection_mapping_version_id: moduleSelection.mappingVersion.id,
    }]);

    await insertV1Case("comparison-v1-same-run");
    await writer.query("begin");
    await insertResult({
      caseId: "comparison-v1-same-run",
      mappingVersionId: moduleSelection.mappingVersion.id,
      omitSelection: true,
    });
    await writer.query("set constraints all immediate");
    await writer.query("commit");
    expect((await client.query<{ mapping_version_id: string; selection_run_id: string | null; selection_mapping_version_id: string | null }>(
      `select mapping_version_id, selection_run_id, selection_mapping_version_id
         from parameter_catalog.parameter_catalog_comparison_results where comparison_case_id = $1`,
      ["comparison-v1-same-run"],
    )).rows).toEqual([{
      mapping_version_id: moduleSelection.mappingVersion.id,
      selection_run_id: null,
      selection_mapping_version_id: null,
    }]);

    await insertV1Case("comparison-v1-unqueryable");
    await writer.query("begin");
    await insertResult({
      caseId: "comparison-v1-unqueryable",
      outcome: "unqueryable/protected-reference-missing",
      mappingVersionId: null,
      omitSelection: true,
    });
    await writer.query("set constraints all immediate");
    await writer.query("commit");
    expect((await client.query<{ outcome: string; selection_run_id: string | null; selection_legacy_identity_id: string | null }>(
      `select outcome, selection_run_id, selection_legacy_identity_id
         from parameter_catalog.parameter_catalog_comparison_results where comparison_case_id = $1`,
      ["comparison-v1-unqueryable"],
    )).rows).toEqual([{
      outcome: "unqueryable/protected-reference-missing",
      selection_run_id: null,
      selection_legacy_identity_id: null,
    }]);

    const v1CrossRunError = await forceDeferredCheck(async () => {
      await insertV1Case("comparison-v1-cross-run");
      await insertResult({
        caseId: "comparison-v1-cross-run",
        mappingVersionId: replay.mappingVersion.id,
        omitSelection: true,
      });
    });
    expect(v1CrossRunError.code).toBe("23503");
    expect(v1CrossRunError.constraint).toBe("comparison_result_mapping_run_fk");
    await assertNoCaseOrResult("comparison-v1-cross-run");

    await rejectedCase(bindingForCase(replay, "comparison-replay-unselected-head"), {
      caseId: "comparison-replay-unselected-head",
      mappingVersionId: advanced.value.head.currentVersionId,
      selectedVersionId: advanced.value.head.currentVersionId,
    });
    await rejectedCase(bindingForCase(replay, "comparison-replay-wrong-identity"), {
      caseId: "comparison-replay-wrong-identity",
      selectedIdentityId: moduleSelection.legacyIdentityId,
      selectedVersionId: moduleSelection.mappingVersion.id,
      mappingVersionId: moduleSelection.mappingVersion.id,
    });
    await rejectedCase({
      ...bindingForCase(replay, "comparison-replay-wrong-owner"),
      ownerId: "foreign-organization",
    }, { caseId: "comparison-replay-wrong-owner" });
    await rejectedCase(bindingForCase(replay, "comparison-replay-wrong-plan"), {
      caseId: "comparison-replay-wrong-plan",
      pins: { ...runPins, selection_plan_digest: "sha256:wrong-plan" },
    });
    await rejectedCase(bindingForCase(replay, "comparison-replay-omitted-selection"), {
      caseId: "comparison-replay-omitted-selection",
      omitSelection: true,
    });
    await rejectedCase(bindingForCase(replay, "comparison-replay-corrupt-manifest-pin"), {
      caseId: "comparison-replay-corrupt-manifest-pin",
      pins: { ...runPins, selection_manifest_digest: `sha256:${"0".repeat(64)}` },
    });
    await rejectedCase(bindingForCase(replay, "comparison-replay-wrong-release-digest"), {
      caseId: "comparison-replay-wrong-release-digest",
      pins: { ...runPins, selection_catalog_release_digest: `sha256:${"0".repeat(64)}` },
    });
    const failedRun = await client.query<{ id: string }>(
      `select id from parameter_catalog.parameter_catalog_cutover_runs where plan_digest = $1`,
      [planA.value.planDigest],
    );
    expect(failedRun.rows).toHaveLength(1);
    const failedRunId = failedRun.rows[0]?.id;
    expect(failedRunId).toBeTruthy();
    if (!failedRunId) return;
    await rejectedCase({
      ...bindingForCase(replay, "comparison-replay-incomplete-run"),
      runId: failedRunId,
    }, {
      caseId: "comparison-replay-incomplete-run",
      pins: {
        ...runPins,
        selection_run_id: failedRunId,
        selection_plan_digest: planA.value.planDigest,
      },
    });

    const phaseCaseId = "comparison-mod-post-phase-key";
    await insertCase({
      id: phaseCaseId,
      family: replayCase.family,
      gate: replayCase.gate,
      key: replayCase.key,
      phase: "post-p13",
      sourceKind: replay.sourceKind,
      sourceId: replay.sourceId,
      ownerKind: replay.ownerScopeKind,
      ownerId: replay.ownerScopeId,
    });
    const phaseRows = await client.query<{ comparison_phase: string; count: string }>(
      `select comparison_phase, count(*)::text as count
         from parameter_catalog.parameter_catalog_comparison_cases
        where cutover_run_id = $1 and gate_id = 'PCAT-CMP-D01'
          and consumer_family = 'runtime' and case_key = $2
        group by comparison_phase order by comparison_phase`,
      [runB.value.runId, replayCase.key],
    );
    expect(phaseRows.rows).toEqual([
      { comparison_phase: "post-p13", count: "1" },
      { comparison_phase: "pre-activation", count: "1" },
    ]);

  } finally {
    await writer?.end().catch(() => undefined);
    if (writerRoleCreated) {
      await client.query(`drop owned by ${writerRole}`).catch(() => undefined);
      await client.query(`drop role ${writerRole}`).catch(() => undefined);
    }
    await client.end().catch(() => undefined);
    await pool.end().catch(() => undefined);
    await database.close().catch(() => undefined);
    await rm(objectRoot, { recursive: true, force: true });
  }
}, 120_000);

async function captureDatabaseError(action: Promise<unknown>): Promise<pg.DatabaseError> {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(pg.DatabaseError);
    return error as pg.DatabaseError;
  }
  throw new Error("Expected PostgreSQL to reject the operation");
}
