import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import pg from "pg";
import { expect, it } from "vitest";

import { getAuthContextForExternalIdentity } from "../../auth/repository";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { seedOrganization, seedUser } from "../../../testing/fixtures";
import {
  createDisposableParameterCatalogDatabase,
} from "../../../testing/parameterCatalog";
import {
  populatedCutoverGraph,
  seedPopulatedCutover,
} from "../../../testing/parameterCatalog/cutoverPopulatedFixture";
import {
  installParameterModuleComparisonCatalogFixture,
  registerParameterModuleComparisonDriver,
} from "../../../testing/parameterCatalog/registryProjection";
import { compileCatalogRelease } from "../../catalog-kernel/compiler";
import {
  refreshAuthoritativeSource,
  validCatalogReleaseBundle,
} from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { adoptPreexistingCatalog } from "../../catalog-publication/runtime/adoption";
import { evaluateDualFactReadiness } from "../../catalog-publication/runtime/readiness";
import { createLocalArchiveObjectStore } from "../../catalog-cutover/archive";
import { readCurrentMappingHead, appendMappingVersion } from "../../catalog-cutover/mapping";
import { classifyFrozenP0Graph } from "../../catalog-cutover/classifier";
import { fixtureCutoverIdentities } from "../../catalog-cutover/identities";
import { parseMappingManifestV2 } from "../../catalog-cutover/mappingManifest";
import { executeCutover, planCutover } from "../../catalog-cutover/orchestrator";
import { fixtureObservedQuiescence } from "../../catalog-cutover/quiescence";
import { fixtureObservedRecoveryPoint } from "../../catalog-cutover/recoveryPointObservation";
import { CatalogSubjectId } from "../../parameter-catalog-contract";
import {
  createParameterModule,
  deleteParameterModule,
} from "../../parameters/parameterModuleRepository";
import { provideModParameterCatalogComparisonCaseBatchV2 } from "../../parameter-modules/parameterCatalogComparisonContribution";
import { writeModParameterCatalogComparisonCasesV2 } from "./caseResultV2Writer";

const sqlQuote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

function comparisonCatalogBundle(additionalDrivers: number) {
  const complete = validCatalogReleaseBundle();
  const release = structuredClone(complete.releases[0]!);
  const subject = release.documents.find((document) => document.kind === "subject");
  if (!subject || subject.kind !== "subject") throw new Error("MOD D02 Catalog subject fixture is missing");
  for (let index = 0; index < additionalDrivers; index += 1) {
    const subjectId = CatalogSubjectId(`csub_mod_page_${index}`);
    const clone = structuredClone(subject);
    Object.assign(clone.content, {
      id: subjectId,
      canonicalKey: `driver:mod-page-${index}`,
      selector: { ...clone.content.selector, value: `mod-page-${index}` },
    });
    release.documents.push(clone);
  }
  const expanded = { ...release, documents: [...release.documents] };
  refreshAuthoritativeSource(expanded as Parameters<typeof refreshAuthoritativeSource>[0]);
  return {
    schemaVersion: complete.schemaVersion,
    targetReleaseId: expanded.manifest.release.id,
    releases: [expanded],
  };
}

it("writes only blocking MOD D02 evidence from a complete scoped inventory and pins it to completed P7", async () => {
  const fixture = await createDisposableParameterCatalogDatabase("modcasev2");
  const ownerDatabase = createPostgresDatabase(fixture.url);
  const ownerPool = getRootPostgresPool(ownerDatabase)!;
  const client = new pg.Client({ connectionString: fixture.url });
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), "mod-case-v2-"));
  const writerRole = `s7_mod_case_writer_${randomBytes(5).toString("hex")}`;
  const writerPassword = randomBytes(24).toString("hex");
  let writerDatabase: ReturnType<typeof createPostgresDatabase> | null = null;
  let writerRoleCreated = false;

  const organizationId = "s7-mod-case-org";
  const otherOrganizationId = "s7-mod-case-other-org";
  const principalId = "s7-mod-case-admin";
  const otherPrincipalId = "s7-mod-case-other-admin";
  const moduleAIdentityId = "s7orc-lid-r1-mod-a";
  const moduleBIdentityId = "s7orc-lid-r10-mod-b";

  try {
    await client.connect();
    await seedOrganization(client, { id: organizationId });
    await seedOrganization(client, { id: otherOrganizationId });
    await seedUser(client, { id: principalId, organizationId });
    await seedUser(client, { id: otherPrincipalId, organizationId: otherOrganizationId });
    await client.query(
      `insert into public.user_role_bindings(id,user_id,organization_id,project_id,role_id)
       values ($1,$2,$3,null,'admin'),($4,$5,$6,null,'admin')`,
      [`role-${principalId}`, principalId, organizationId,
        `role-${otherPrincipalId}`, otherPrincipalId, otherOrganizationId],
    );

    const installed = await installParameterModuleComparisonCatalogFixture(ownerPool, 1);
    const bundle = comparisonCatalogBundle(1);
    const source = jsonCatalogReleaseSource(bundle);
    const compiled = compileCatalogRelease(bundle);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(installed.pin).toEqual({ id: compiled.value.release.id, digest: compiled.value.release.digest });

    const moduleA = await createParameterModule(ownerDatabase, {
      organizationId,
      name: "amba",
      kind: "driver-group",
      sourceKey: "compatible:acme,power",
    });
    const moduleB = await createParameterModule(ownerDatabase, {
      organizationId,
      name: "MOD D02 driver B",
      kind: "driver-group",
      sourceKey: "compatible:mod-page-0",
    });
    await registerParameterModuleComparisonDriver(ownerPool, {
      organizationId,
      destinationModuleId: moduleA.id,
      subjectId: CatalogSubjectId("csub_acme_power"),
      release: installed.pin,
      idempotencyKey: "s7-mod-case-register-a",
      principalId,
    });
    await registerParameterModuleComparisonDriver(ownerPool, {
      organizationId,
      destinationModuleId: moduleB.id,
      subjectId: installed.additionalSubjectIds[0]!,
      release: installed.pin,
      idempotencyKey: "s7-mod-case-register-b",
      principalId,
    });

    const baseGraph = populatedCutoverGraph();
    const graphForModules = (modules: readonly [typeof moduleA, ...(typeof moduleA)[]]) => ({
      ...baseGraph,
      identities: [
        ...baseGraph.identities.map((identity) => ({
          ...identity,
          ownerScopeKind: "organization" as const,
          ownerScopeId: organizationId,
        })),
        ...modules.map((module) => ({
          id: module.id === moduleA.id ? moduleAIdentityId : moduleBIdentityId,
          sourceSystem: "wiseeff-v1",
          sourceKind: "parameter-module" as const,
          ownerScopeKind: "organization" as const,
          ownerScopeId: organizationId,
          sourceId: module.id,
        })),
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
      modules: modules.map((module) => ({
        id: module.id,
        organizationId,
        kind: "driver-group" as const,
        origin: "curated" as const,
        name: module.name,
        attributionSubjectId: module.attributionSubjectId,
      })),
    });
    const graph = graphForModules([moduleA, moduleB]);
    await seedPopulatedCutover(client, graph);

    const planA = await planCutover({
      graph,
      targetArtifactSha: "a".repeat(40),
      targetCatalogReleaseDigest: installed.pin.digest,
      identities: fixtureCutoverIdentities("mod-case-v2-a"),
      catalogReleaseSource: source,
    });
    expect(planA.ok).toBe(true);
    if (!planA.ok) return;

    const archiveStore = createLocalArchiveObjectStore(archiveRoot);
    const failFirstArchiveWrite = {
      ...archiveStore,
      async putExclusive() {
        throw new Error("controlled P7 archive failure after replayable mapping append");
      },
    };
    const runA = await executeCutover({
      pool: ownerPool,
      plan: planA.value,
      graph,
      catalogReleaseSource: source,
      archiveObjectStore: failFirstArchiveWrite,
      archiveEncryptionKey: randomBytes(32),
      operatorAuditRef: "audit-s7-mod-case-v2-a",
      quiescence: fixtureObservedQuiescence(),
      recoveryPoint: fixtureObservedRecoveryPoint(),
    });
    expect(runA).toMatchObject({ ok: false, error: { code: "PCAT-ORC-PHASE-FAILED" } });

    const planB = await planCutover({
      graph,
      targetArtifactSha: "b".repeat(40),
      targetCatalogReleaseDigest: installed.pin.digest,
      identities: fixtureCutoverIdentities("mod-case-v2-b"),
      catalogReleaseSource: source,
    });
    expect(planB.ok).toBe(true);
    if (!planB.ok) return;
    const runB = await executeCutover({
      pool: ownerPool,
      plan: planB.value,
      graph,
      catalogReleaseSource: source,
      archiveObjectStore: archiveStore,
      archiveEncryptionKey: randomBytes(32),
      operatorAuditRef: "audit-s7-mod-case-v2-b",
      quiescence: fixtureObservedQuiescence(),
      recoveryPoint: fixtureObservedRecoveryPoint(),
    });
    expect(runB, JSON.stringify(runB)).toMatchObject({ ok: true, value: { state: "completed" } });
    if (!runB.ok) return;

    const p7 = runB.value.checkpoints.find((checkpoint) => checkpoint.phase === "P7");
    const mappingManifest = parseMappingManifestV2(p7?.payload.mappingManifest);
    expect(mappingManifest).not.toBeNull();
    if (!mappingManifest) return;
    const stableSpecSelection = mappingManifest.selections.find((selection) => selection.legacyIdentityId === "s7orc-lid-r1");
    const selectionA = mappingManifest.selections.find((selection) => selection.legacyIdentityId === moduleAIdentityId);
    const selectionB = mappingManifest.selections.find((selection) => selection.legacyIdentityId === moduleBIdentityId);
    expect(stableSpecSelection?.status).toBe("replayed");
    expect(selectionA?.status).toBe("appended");
    expect(selectionB?.status).toBe("appended");
    expect(selectionA?.rClass).toBe("R1");
    expect(selectionB?.rClass).toBe("R10");
    expect(selectionA?.mappingVersion.archiveId).toBeTruthy();
    expect(selectionA?.mappingVersion.targetKind).toBeNull();
    expect(selectionB?.mappingVersion.archiveId).toBeTruthy();
    expect(selectionB?.mappingVersion.targetKind).toBeNull();

    const classification = classifyFrozenP0Graph(graph);
    expect(classification.ok).toBe(true);
    if (!classification.ok || !selectionA?.mappingVersion.archiveId || !selectionB?.mappingVersion.archiveId) return;
    const selectedHead = await readCurrentMappingHead({ client, identityId: moduleAIdentityId });
    expect(selectedHead.ok).toBe(true);
    if (!selectedHead.ok) return;
    const advancedHead = await appendMappingVersion({
      client,
      cutoverRunId: runB.value.runId,
      classification: classification.value,
      identityId: moduleAIdentityId,
      sourceChecksum: "sha256:s7-mod-case-v2-later-head",
      expectedHead: {
        casVersion: selectedHead.value.casVersion,
        versionId: selectedHead.value.currentVersionId,
      },
      outcome: { kind: "archived", archiveId: selectionA.mappingVersion.archiveId },
    });
    expect(advancedHead).toMatchObject({ ok: true, value: { status: "appended" } });
    if (!advancedHead.ok || advancedHead.value.status !== "appended") return;
    expect(advancedHead.value.head.currentVersionId).not.toBe(selectionA.mappingVersion.id);

    const foreignSameSourceModule = await createParameterModule(ownerDatabase, {
      organizationId: otherOrganizationId,
      name: "Other organization same compatible",
      kind: "driver-group",
      sourceKey: "compatible:acme,power",
    });
    await registerParameterModuleComparisonDriver(ownerPool, {
      organizationId: otherOrganizationId,
      destinationModuleId: foreignSameSourceModule.id,
      subjectId: CatalogSubjectId("csub_acme_power"),
      release: installed.pin,
      idempotencyKey: "s7-mod-case-register-other-org",
      principalId: otherPrincipalId,
    });

    const materialization = await ownerPool.query<{ compiled_fingerprint: string }>(
      "select compiled_fingerprint from parameter_catalog.catalog_materializations where release_id = $1",
      [installed.pin.id],
    );
    const adopted = await adoptPreexistingCatalog(ownerPool, {
      expectedCurrent: installed.pin,
      actorPrincipalId: principalId,
      sourceBytes: Buffer.from(JSON.stringify(bundle)),
      artifactDigest: installed.pin.digest,
      evidenceKind: "synthetic-fixture",
      adoptionEvidence: {
        source_bundle_digest: installed.pin.digest,
        verification_digest: materialization.rows[0]!.compiled_fingerprint,
        data_mode: "fresh",
        collected_at: "2026-09-29T00:00:00.000Z",
        approved_by: principalId,
      },
    });
    expect(adopted, JSON.stringify(adopted)).toMatchObject({ ok: true });
    await client.query("begin");
    try {
      await client.query("set local role catalog_migration_owner");
      const revision = await client.query<{ revise_publication_policy: string }>(
        `select catalog_publication.revise_publication_policy(false, false, 'catalog-capability/v1', $1)`,
        [principalId],
      );
      expect(Number(revision.rows[0]?.revise_publication_policy)).toBeGreaterThan(0);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }

    await client.query(`create role ${writerRole} login password ${sqlQuote(writerPassword)} nosuperuser nobypassrls`);
    writerRoleCreated = true;
    await client.query(`grant usage on schema public, parameter_catalog to ${writerRole}`);
    await client.query(`grant usage on schema catalog_publication to ${writerRole}`);
    // Dedicated disposable-PG capability grants only; this login is NOSUPERUSER/NOBYPASSRLS and is not a deployment role.
    await client.query(`grant select on all tables in schema public, parameter_catalog to ${writerRole}`);
    await client.query(`grant select on
      catalog_publication.release_artifacts,
      catalog_publication.publication_policies
      to ${writerRole}`);
    await client.query(`grant execute on function parameter_catalog.assert_catalog_subject_active(text,text,text,text) to ${writerRole}`);
    await client.query(`grant insert on
      parameter_catalog.parameter_catalog_comparison_cases,
      parameter_catalog.parameter_catalog_comparison_results
      to ${writerRole}`);
    const writerUrl = new URL(fixture.url);
    writerUrl.username = writerRole;
    writerUrl.password = writerPassword;
    const scopedDatabase = createPostgresDatabase(writerUrl.toString());
    writerDatabase = scopedDatabase;
    const writerPool = getRootPostgresPool(scopedDatabase)!;
    const roleReceipt = await writerPool.query<{ session_user: string; current_user: string; rolsuper: boolean; rolbypassrls: boolean }>(
      `select session_user, current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(roleReceipt.rows).toEqual([{
      session_user: writerRole,
      current_user: writerRole,
      rolsuper: false,
      rolbypassrls: false,
    }]);
    const probeLock = async (sql: string, values: readonly unknown[] = []) => {
      const connection = await writerPool.connect();
      try {
        await connection.query("begin");
        try {
          const result = await connection.query(sql, [...values]);
          await connection.query("rollback");
          return { ok: true as const, rowCount: result.rowCount };
        } catch (error) {
          await connection.query("rollback").catch(() => undefined);
          const databaseError = error as { code?: unknown; message?: unknown };
          return {
            ok: false as const,
            sqlstate: typeof databaseError.code === "string" ? databaseError.code : "unknown",
            detail: typeof databaseError.message === "string" ? databaseError.message : String(error),
          };
        }
      } finally {
        connection.release();
      }
    };
    const deniedLockProbes = {
      usersForKeyShare: await probeLock(
        "select id from public.users where id = $1 and organization_id = $2 for key share",
        [principalId, organizationId],
      ),
      roleBindingsForKeyShare: await probeLock(
        "select id from public.user_role_bindings where user_id = $1 and organization_id = $2 for key share",
        [principalId, organizationId],
      ),
      protectedTableShare: await probeLock(
        "lock table public.parameter_modules, parameter_catalog.organization_subject_registrations, parameter_catalog.subject_placements in share mode",
      ),
    };
    expect(deniedLockProbes, JSON.stringify(deniedLockProbes)).toMatchObject({
      usersForKeyShare: { ok: false, sqlstate: "42501", detail: "permission denied for table users" },
      roleBindingsForKeyShare: { ok: false, sqlstate: "42501", detail: "permission denied for table user_role_bindings" },
      protectedTableShare: { ok: false, sqlstate: "42501", detail: "permission denied for table parameter_modules" },
    });
    // Disposable-lane capability probe only. The NOSUPERUSER login is not a deployable runner role.
    // Row locks need only UPDATE(id); the explicit SHARE table lock needs table-level UPDATE on its three relations.
    await client.query(`grant update (id) on
      public.users,
      public.user_role_bindings
      to ${writerRole}`);
    await client.query(`grant update on
      public.parameter_modules,
      parameter_catalog.organization_subject_registrations,
      parameter_catalog.subject_placements
      to ${writerRole}`);
    const grantedLockProbes = {
      usersForShare: await probeLock(
        "select id from public.users where id = $1 and organization_id = $2 for share",
        [principalId, organizationId],
      ),
      roleBindingsForShare: await probeLock(
        "select id from public.user_role_bindings where user_id = $1 and organization_id = $2 for share",
        [principalId, organizationId],
      ),
      protectedTableShare: await probeLock(
        "lock table public.parameter_modules, parameter_catalog.organization_subject_registrations, parameter_catalog.subject_placements in share mode",
      ),
    };
    expect(grantedLockProbes, JSON.stringify(grantedLockProbes)).toMatchObject({
      usersForShare: { ok: true },
      roleBindingsForShare: { ok: true },
      protectedTableShare: { ok: true },
    });
    const scopedReadiness = await evaluateDualFactReadiness(writerPool, { dataMode: "new-empty" });
    expect(scopedReadiness, JSON.stringify(scopedReadiness)).toMatchObject({ status: "ready" });

    const invocationAuth = await getAuthContextForExternalIdentity(ownerDatabase, {
      organizationId,
      subject: principalId,
    });
    const invocation = createUserInvocation(invocationAuth);
    const writerInput = {
      database: scopedDatabase,
      pool: writerPool,
      runId: runB.value.runId,
      invocation,
      phase: "pre-activation" as const,
    };
    const readComparisonResidue = async () => {
      const residue = await client.query<{ cases: string; results: string }>(
        `select
           (select count(*)::text from parameter_catalog.parameter_catalog_comparison_cases
             where cutover_run_id = $1 and gate_id = 'PCAT-CMP-D02' and consumer_family = 'MOD') as cases,
           (select count(*)::text from parameter_catalog.parameter_catalog_comparison_results result
             join parameter_catalog.parameter_catalog_comparison_cases comparison_case
               on comparison_case.id = result.comparison_case_id
            where comparison_case.cutover_run_id = $1 and comparison_case.gate_id = 'PCAT-CMP-D02'
              and comparison_case.consumer_family = 'MOD') as results`,
        [runB.value.runId],
      );
      return residue.rows[0] ?? null;
    };
    const batch = await provideModParameterCatalogComparisonCaseBatchV2({
      database: scopedDatabase,
      pool: writerPool,
      runId: runB.value.runId,
      invocation,
    });
    expect(batch.sourceInventoryCount).toBe(2);
    expect(batch.inventory.map((item) => item.id).sort()).toEqual([moduleA.id, moduleB.id].sort());
    expect(batch.inventory.every((item) =>
      item.ownerScopeKind === "organization" && item.ownerScopeId === organizationId,
    )).toBe(true);
    expect(batch.blockers).toEqual([]);
    expect(batch.cases).toHaveLength(2);
    const subjectsByModule = new Map([[moduleA.id, "csub_acme_power"], [moduleB.id, installed.additionalSubjectIds[0]!]]);
    const pinnedVersionsByIdentity = new Map([
      [moduleAIdentityId, selectionA.mappingVersion.id],
      [moduleBIdentityId, selectionB.mappingVersion.id],
    ]);
    for (const item of batch.cases) {
      expect(item.canonicalObservation).toMatchObject({
        status: "value",
        value: { organizationId, subject: { id: subjectsByModule.get(item.protectedReference.id) } },
      });
      expect(item.context.selection?.status).toBe("appended");
      expect(item.context.selection?.mappingVersion.targetKind).toBeNull();
      expect(item.context.selection?.mappingVersion.archiveId).toBeTruthy();
      expect(item.context.selection?.mappingVersion.id).toBe(
        pinnedVersionsByIdentity.get(item.context.selection?.legacyIdentityId ?? ""),
      );
      expect(item.result).toBe("unexplained-difference");
      expect(item.expectedDifference).toBeNull();
    }
    const foreignModuleSource = await ownerPool.query<{ organization_id: string; source_key: string }>(
      "select organization_id, source_key from public.parameter_modules where id = $1",
      [foreignSameSourceModule.id],
    );
    expect(foreignModuleSource.rows).toEqual([{
      organization_id: otherOrganizationId,
      source_key: "compatible:acme,power",
    }]);
    const foreignInvocationAuth = await getAuthContextForExternalIdentity(ownerDatabase, {
      organizationId: otherOrganizationId,
      subject: otherPrincipalId,
    });
    const foreignInvocation = createUserInvocation(foreignInvocationAuth);
    const foreignWriterInput = { ...writerInput, invocation: foreignInvocation };
    await expect(provideModParameterCatalogComparisonCaseBatchV2({
      database: scopedDatabase,
      pool: writerPool,
      runId: runB.value.runId,
      invocation: foreignInvocation,
    })).rejects.toThrow("MOD comparison completed manifest is unavailable");
    await expect(writeModParameterCatalogComparisonCasesV2(foreignWriterInput))
      .rejects.toThrow("MOD comparison completed manifest is unavailable");
    expect(await readComparisonResidue()).toEqual({ cases: "0", results: "0" });

    const unattachedModule = await createParameterModule(ownerDatabase, {
      organizationId,
      name: "MOD D02 unassociated inventory blocker",
      kind: "driver-group",
      sourceKey: "compatible:unassociated",
    });
    const blockedBatch = await provideModParameterCatalogComparisonCaseBatchV2({
      database: scopedDatabase,
      pool: writerPool,
      runId: runB.value.runId,
      invocation,
    });
    expect(blockedBatch.sourceInventoryCount).toBe(3);
    expect(blockedBatch.blockers).toHaveLength(1);
    const blockedWrite = writeModParameterCatalogComparisonCasesV2(writerInput);
    await expect(blockedWrite).rejects.toThrow("full organization inventory has 1 unqueryable case(s)");
    expect(await readComparisonResidue()).toEqual({ cases: "0", results: "0" });
    const removedUnattachedModule = await deleteParameterModule(ownerDatabase, {
      organizationId,
      moduleId: unattachedModule.id,
    });
    expect(removedUnattachedModule).toBe(true);

    const captureBusinessRows = async () => {
      const users = await client.query<{ row: unknown }>(
        "select to_jsonb(user_row) as row from public.users user_row where id = $1",
        [principalId],
      );
      const roleBindings = await client.query<{ row: unknown }>(
        "select to_jsonb(binding) as row from public.user_role_bindings binding where user_id = $1 and organization_id = $2 order by id",
        [principalId, organizationId],
      );
      const modules = await client.query<{ row: unknown }>(
        "select to_jsonb(module_row) as row from public.parameter_modules module_row where id = any($1::text[]) order by id",
        [[moduleA.id, moduleB.id]],
      );
      const registrations = await client.query<{ row: unknown }>(
        "select to_jsonb(registration) as row from parameter_catalog.organization_subject_registrations registration where organization_id = $1 and subject_id = any($2::text[]) order by id",
        [organizationId, [...subjectsByModule.values()]],
      );
      const placements = await client.query<{ row: unknown }>(
        "select to_jsonb(placement) as row from parameter_catalog.subject_placements placement where organization_id = $1 and module_id = any($2::text[]) order by id",
        [organizationId, [moduleA.id, moduleB.id]],
      );
      return {
        users: users.rows.map(({ row }) => row),
        roleBindings: roleBindings.rows.map(({ row }) => row),
        modules: modules.rows.map(({ row }) => row),
        registrations: registrations.rows.map(({ row }) => row),
        placements: placements.rows.map(({ row }) => row),
      };
    };
    const businessRowsBeforeWrite = await captureBusinessRows();

    const faultFunction = "parameter_catalog.test_fail_second_mod_d02_result_insert";
    const faultTrigger = "test_fail_second_mod_d02_result_insert";
    await client.query(`create function ${faultFunction}() returns trigger
      language plpgsql as $$
      declare insert_count integer;
      begin
        insert_count := coalesce(nullif(current_setting('modcasev2.result_insert_count', true), ''), '0')::integer + 1;
        perform set_config('modcasev2.result_insert_count', insert_count::text, true);
        if insert_count = 2 then
          raise exception using errcode = 'P0001', message = 'controlled second MOD D02 result insert failure';
        end if;
        return new;
      end
      $$`);
    await client.query(`grant execute on function ${faultFunction}() to ${writerRole}`);
    await client.query(`create trigger ${faultTrigger}
      before insert on parameter_catalog.parameter_catalog_comparison_results
      for each row execute function ${faultFunction}()`);
    try {
      await expect(writeModParameterCatalogComparisonCasesV2(writerInput))
        .rejects.toThrow("controlled second MOD D02 result insert failure");
      expect(await readComparisonResidue()).toEqual({ cases: "0", results: "0" });
      expect(await captureBusinessRows()).toEqual(businessRowsBeforeWrite);
    } finally {
      await client.query(`drop trigger if exists ${faultTrigger} on parameter_catalog.parameter_catalog_comparison_results`);
      await client.query(`drop function if exists ${faultFunction}()`);
    }

    const written = await writeModParameterCatalogComparisonCasesV2(writerInput);
    expect(written).toMatchObject({
      coverage: "organization-projection",
      sourceInventoryCount: 2,
      caseCount: 2,
      newlyWrittenCount: 2,
      replayedWriteCount: 0,
      selectionStatusCounts: { appended: 2, replayed: 0 },
      fullReport: { available: false },
    });
    expect(written.fullReport).not.toHaveProperty("passed");
    const replayed = await writeModParameterCatalogComparisonCasesV2(writerInput);
    expect(replayed).toMatchObject({
      caseIds: written.caseIds,
      newlyWrittenCount: 0,
      replayedWriteCount: 2,
      fullReport: { available: false },
    });
    const persisted = await client.query<{ outcome: string; selection_legacy_identity_id: string; evidence: { result?: string; expectedDifference?: unknown } }>(
      `select result.outcome, result.selection_legacy_identity_id, result.evidence
         from parameter_catalog.parameter_catalog_comparison_results result
         join parameter_catalog.parameter_catalog_comparison_cases comparison_case
           on comparison_case.id = result.comparison_case_id
        where comparison_case.cutover_run_id = $1 and comparison_case.gate_id = 'PCAT-CMP-D02'
          and comparison_case.consumer_family = 'MOD'
        order by result.selection_legacy_identity_id`,
      [runB.value.runId],
    );
    expect(persisted.rows).toHaveLength(2);
    expect(persisted.rows.map((row) => row.outcome)).toEqual(["unexplained-difference", "unexplained-difference"]);
    expect(persisted.rows.map((row) => row.selection_legacy_identity_id).sort()).toEqual([moduleAIdentityId, moduleBIdentityId].sort());
    expect(persisted.rows.every((row) =>
      row.evidence?.result === "unexplained-difference" && row.evidence.expectedDifference === null,
    )).toBe(true);
    expect(await captureBusinessRows()).toEqual(businessRowsBeforeWrite);

    const immutableRows = async () => {
      const rows = await client.query<{ comparison_case: unknown; result: unknown }>(
        `select to_jsonb(comparison_case) as comparison_case, to_jsonb(result) as result
           from parameter_catalog.parameter_catalog_comparison_cases comparison_case
           join parameter_catalog.parameter_catalog_comparison_results result
             on result.comparison_case_id = comparison_case.id
          where comparison_case.cutover_run_id = $1 and comparison_case.gate_id = 'PCAT-CMP-D02'
            and comparison_case.consumer_family = 'MOD'
          order by comparison_case.id`,
        [runB.value.runId],
      );
      return rows.rows;
    };
    const immutableRowsBeforeSourceDrift = await immutableRows();
    // Controlled owner-side corruption in this disposable DB; the production writer call below remains separate.
    const changedSource = await ownerPool.query<{ id: string; source_key: string }>(
      `update public.parameter_modules
          set source_key = $3
        where organization_id = $1 and id = $2
        returning id, source_key`,
      [organizationId, moduleA.id, "compatible:source-drift-after-v2-write"],
    );
    expect(changedSource.rows).toEqual([{
      id: moduleA.id,
      source_key: "compatible:source-drift-after-v2-write",
    }]);
    await expect(writeModParameterCatalogComparisonCasesV2(writerInput))
      .rejects.toThrow("result key is already bound to different evidence");
    expect(await immutableRows()).toEqual(immutableRowsBeforeSourceDrift);
  } finally {
    await writerDatabase?.close().catch(() => undefined);
    if (writerRoleCreated) {
      await client.query(`drop owned by ${writerRole}`).catch(() => undefined);
      await client.query(`drop role ${writerRole}`).catch(() => undefined);
    }
    await client.end().catch(() => undefined);
    await ownerDatabase.close().catch(() => undefined);
    await fixture.close().catch(() => undefined);
    await rm(archiveRoot, { recursive: true, force: true });
  }
}, 180_000);
