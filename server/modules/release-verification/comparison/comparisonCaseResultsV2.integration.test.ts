import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import pg from "pg";
import { expect, it } from "vitest";

import { getAuthContextForExternalIdentity } from "../../auth/repository";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { createLocalAuthService } from "../../auth/localAuth";
import { hashLocalAccountPassword, hashLocalSessionToken } from "../../auth/localAccountCredentials";
import { createDatabase, createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
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
import { getParameterModuleRegistry } from "../../parameter-modules/service";
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
  const sourceReaderRole = `s7_mod_case_reader_${randomBytes(5).toString("hex")}`;
  const sourceReaderPassword = randomBytes(24).toString("hex");
  let writerDatabase: ReturnType<typeof createPostgresDatabase> | null = null;
  let sourceReaderDatabase: ReturnType<typeof createPostgresDatabase> | null = null;
  let writerRoleCreated = false;
  let sourceReaderRoleCreated = false;

  const organizationId = "s7-mod-case-org";
  const otherOrganizationId = "s7-mod-case-other-org";
  const principalId = "s7-mod-case-admin";
  const otherPrincipalId = "s7-mod-case-other-admin";
  const projectAdminId = "s7-mod-case-project-admin";
  const moduleAIdentityId = "s7orc-lid-r1-mod-a";
  const moduleBIdentityId = "s7orc-lid-r10-mod-b";

  try {
    await client.connect();
    await seedOrganization(client, { id: organizationId });
    await seedOrganization(client, { id: otherOrganizationId });
    await seedUser(client, { id: principalId, organizationId });
    await seedUser(client, { id: otherPrincipalId, organizationId: otherOrganizationId });
    await seedUser(client, { id: projectAdminId, organizationId });
    await client.query(
      `insert into public.user_role_bindings(id,user_id,organization_id,project_id,role_id)
       values ($1,$2,$3,null,'admin'),($4,$5,$6,null,'admin'),($7,$8,$9,$10,'admin')`,
      [`role-${principalId}`, principalId, organizationId,
        `role-${otherPrincipalId}`, otherPrincipalId, otherOrganizationId,
        `role-${projectAdminId}`, projectAdminId, organizationId, "s7-mod-case-project"],
    );
    const localPassword = randomBytes(24).toString("hex");
    const projectAdminPassword = randomBytes(24).toString("hex");
    await client.query(
      `insert into public.user_password_credentials (user_id, username, password_hash)
       values ($1, $2, $3), ($4, $5, $6)`,
      [principalId, "s7.mod.reader.admin", await hashLocalAccountPassword(localPassword),
        projectAdminId, "s7.mod.reader.project-admin", await hashLocalAccountPassword(projectAdminPassword)],
    );
    const sessionClock = new Date("2026-09-30T00:00:00.000Z");
    const localAdminLogin = await createLocalAuthService(ownerDatabase, {
      now: () => sessionClock,
    }).login(
      { username: "s7.mod.reader.admin", password: localPassword },
      { requestId: "s7-mod-case-reader-login" },
    );
    expect(localAdminLogin.auth.roles).toContainEqual({ projectId: null, roleId: "admin" });
    const projectAdminLogin = await createLocalAuthService(ownerDatabase, {
      now: () => sessionClock,
    }).login(
      { username: "s7.mod.reader.project-admin", password: projectAdminPassword },
      { requestId: "s7-mod-case-project-admin-login" },
    );
    expect(projectAdminLogin.auth.roles).toContainEqual({ projectId: "s7-mod-case-project", roleId: "admin" });
    const localSessionHash = hashLocalSessionToken(localAdminLogin.session.token);
    const localSessionIdResult = await client.query<{ id: string }>(
      "select id from public.auth_sessions where token_hash = $1",
      [localSessionHash],
    );
    expect(localSessionIdResult.rows).toHaveLength(1);
    const localSessionId = localSessionIdResult.rows[0]!.id;

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
    const navigation = await getParameterModuleRegistry(scopedDatabase, invocationAuth);
    expect(navigation.item.navigationOnly).toBe(true);
    expect(navigation.item.mappings).toEqual([]);
    expect(navigation.item.modules).toHaveLength(2);
    for (const module of navigation.item.modules) {
      expect(module.sourceKey).toBeNull();
      expect(module.attributionSubjectId).toBeNull();
    }
    expect(batch.cases.find((item) => item.protectedReference.id === moduleA.id)?.legacyObservation)
      .toMatchObject({ status: "value", value: { sourceKey: "compatible:acme,power" } });
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
        "select to_jsonb(user_row) as row from public.users user_row where id = any($1::text[]) order by id",
        [[principalId, projectAdminId]],
      );
      const roleBindings = await client.query<{ row: unknown }>(
        "select to_jsonb(binding) as row from public.user_role_bindings binding where user_id = any($1::text[]) and organization_id = $2 order by user_id, id",
        [[principalId, projectAdminId], organizationId],
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
    const fingerprint = (value: unknown): string =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const captureBusinessFingerprint = async () => fingerprint(await captureBusinessRows());
    const captureSessionFingerprint = async () => {
      const result = await client.query<{ row: unknown }>(
        `select to_jsonb(session_row) as row
           from public.auth_sessions session_row
          where user_id = any($1::text[])
          order by user_id, id`,
        [[principalId, projectAdminId]],
      );
      return fingerprint(result.rows.map(({ row }) => row));
    };
    const captureArchiveFingerprint = async () => {
      const names = (await readdir(archiveRoot, { withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort();
      const objects = await Promise.all(names.map(async (name) => [
        name,
        createHash("sha256").update(await readFile(path.join(archiveRoot, name))).digest("hex"),
      ] as const));
      return fingerprint(objects);
    };
    const assertReaderReadUnchanged = async <T>(read: () => Promise<T>, expected: T): Promise<T> => {
      const businessBefore = await captureBusinessFingerprint();
      const sessionsBefore = await captureSessionFingerprint();
      const archivesBefore = await captureArchiveFingerprint();
      const result = await read();
      expect(result).toBe(expected);
      expect((await captureBusinessFingerprint()) === businessBefore).toBe(true);
      expect((await captureSessionFingerprint()) === sessionsBefore).toBe(true);
      expect((await captureArchiveFingerprint()) === archivesBefore).toBe(true);
      return result;
    };
    const businessRowsBeforeWrite = await captureBusinessFingerprint();
    const authSessionFingerprintBeforeRead = await captureSessionFingerprint();
    const archiveFingerprintBeforeRead = await captureArchiveFingerprint();

    await client.query(`create role ${sourceReaderRole} login password ${sqlQuote(sourceReaderPassword)} noinherit nosuperuser nobypassrls`);
    sourceReaderRoleCreated = true;
    await client.query(`alter role ${sourceReaderRole} set default_transaction_read_only = on`);
    await client.query(`alter role ${sourceReaderRole} set log_min_duration_statement = 0`);
    await client.query(`alter role ${sourceReaderRole} set log_parameter_max_length = 0`);
    await client.query(`grant usage on schema public, parameter_catalog, catalog_publication to ${sourceReaderRole}`);
    const sourceReaderSelectColumns = [
      ["public.users", ["id", "organization_id", "name", "email", "title", "is_active"]],
      ["public.organizations", ["id", "name"]],
      ["public.user_role_bindings", ["user_id", "project_id", "role_id"]],
      ["public.user_password_credentials", ["user_id", "username"]],
      ["public.roles", ["id", "permissions"]],
      ["public.parameter_modules", ["id", "organization_id", "name", "parent_id", "sort_order", "description", "scope", "importance", "kind", "origin", "source_key", "attribution_subject_id", "path"]],
      ["public.parameter_module_mappings", ["id", "organization_id", "parameter_module_id", "match_kind", "match_value", "priority"]],
      ["public.projects", ["id", "organization_id"]],
      ["parameter_catalog.parameter_catalog_cutover_runs", ["id", "source_snapshot_fingerprint", "target_artifact_sha", "target_catalog_release_digest", "migration_contract_version", "plan_digest", "current_phase", "state"]],
      ["parameter_catalog.parameter_catalog_cutover_checkpoints", ["cutover_run_id", "phase", "checkpoint_digest", "payload", "committed_at"]],
      ["parameter_catalog.parameter_catalog_cutover_events", ["cutover_run_id", "phase", "event_kind", "payload"]],
      ["parameter_catalog.catalog_releases", ["id", "release_digest", "predecessor_release_id", "release_version", "release_sequence", "published_at"]],
      ["parameter_catalog.legacy_mapping_versions", ["id", "legacy_identity_id", "cutover_run_id", "version_number", "source_checksum", "graph_fingerprint", "r_class", "target_kind", "target_id", "archive_id", "evidence_archive_id", "supersedes_version_id"]],
      ["parameter_catalog.legacy_identities", ["id", "source_kind", "source_id", "owner_scope_kind", "owner_scope_id"]],
      ["parameter_catalog.catalog_state", ["current_catalog_release_id"]],
      ["parameter_catalog.catalog_materializations", ["release_id", "compiled_fingerprint", "database_fingerprint", "installed_at"]],
      ["parameter_catalog.catalog_release_subjects", ["release_id", "subject_id", "lifecycle", "selector_snapshot", "tombstone_provenance"]],
      ["parameter_catalog.catalog_subjects", ["id", "kind", "canonical_key"]],
      ["parameter_catalog.catalog_release_subject_aliases", ["release_id", "alias_id", "lifecycle", "tombstone_provenance"]],
      ["parameter_catalog.catalog_subject_aliases", ["id", "subject_id", "selector_kind", "normalized_selector"]],
      ["parameter_catalog.catalog_release_definition_heads", ["release_id", "definition_id", "revision_id"]],
      ["parameter_catalog.parameter_definitions", ["id", "subject_id", "property_key"]],
      ["parameter_catalog.definition_revisions", ["id", "definition_id", "revision_number", "catalog_release_id", "content_digest", "content"]],
      ["parameter_catalog.catalog_activation_receipts", ["id", "kind", "release_id", "release_digest", "created_at"]],
      ["parameter_catalog.organization_subject_registrations", ["id", "organization_id", "subject_id", "status", "registration_method", "current_placement_id", "updated_at"]],
      ["parameter_catalog.subject_placements", ["id", "organization_id", "registration_id", "module_id", "updated_at"]],
      ["parameter_catalog.current_project_parameter_bindings", ["id", "organization_id", "registration_id"]],
      ["catalog_publication.publication_policies", ["singleton", "revision", "publication_enabled", "low_risk_single_actor_publish", "capability_contract_revision", "updated_at", "updated_by_principal_id"]],
      ["catalog_publication.release_artifacts", ["artifact_digest"]],
    ] as const;
    for (const [relation, columns] of sourceReaderSelectColumns) {
      await client.query(`grant select (${columns.join(", ")}) on ${relation} to ${sourceReaderRole}`);
    }

    const sourceReaderUrl = new URL(fixture.url);
    sourceReaderUrl.username = sourceReaderRole;
    sourceReaderUrl.password = sourceReaderPassword;
    const sourceReaderDb = createPostgresDatabase(sourceReaderUrl.toString());
    sourceReaderDatabase = sourceReaderDb;
    const sourceReaderPool = getRootPostgresPool(sourceReaderDb)!;
    expect(getRootPostgresPool(sourceReaderDb)).toBe(sourceReaderPool);
    const sourceReaderSession = await sourceReaderPool.query<{
      session_user: string;
      current_user: string;
      rolsuper: boolean;
      rolinherit: boolean;
      rolbypassrls: boolean;
      default_transaction_read_only: string;
      log_min_duration_statement: string;
      log_parameter_max_length: string;
      membership_count: number;
      username_select: boolean;
      password_hash_select: boolean;
      auth_sessions_select: boolean;
      auth_sessions_update: boolean;
      module_insert: boolean;
      module_update: boolean;
      module_delete: boolean;
      comparison_case_insert: boolean;
      comparison_result_insert: boolean;
      comparison_case_update: boolean;
      comparison_case_delete: boolean;
      comparison_result_update: boolean;
      comparison_result_delete: boolean;
      audit_select: boolean;
      dismissed_compatible_select: boolean;
      public_schema_create: boolean;
      parameter_catalog_schema_create: boolean;
      catalog_publication_schema_create: boolean;
      database_temp: boolean;
      assert_catalog_subject_active_execute: boolean;
    }>(
      `select session_user, current_user, role.rolsuper, role.rolinherit, role.rolbypassrls,
              current_setting('default_transaction_read_only') as default_transaction_read_only,
              current_setting('log_min_duration_statement') as log_min_duration_statement,
              current_setting('log_parameter_max_length') as log_parameter_max_length,
              (select count(*)::int from pg_auth_members membership where membership.member = role.oid) as membership_count,
              has_column_privilege(current_user, 'public.user_password_credentials', 'username', 'select') as username_select,
              has_column_privilege(current_user, 'public.user_password_credentials', 'password_hash', 'select') as password_hash_select,
              has_table_privilege(current_user, 'public.auth_sessions', 'select') as auth_sessions_select,
              has_table_privilege(current_user, 'public.auth_sessions', 'update') as auth_sessions_update,
              has_table_privilege(current_user, 'public.parameter_modules', 'insert') as module_insert,
              has_table_privilege(current_user, 'public.parameter_modules', 'update') as module_update,
              has_table_privilege(current_user, 'public.parameter_modules', 'delete') as module_delete,
              has_table_privilege(current_user, 'parameter_catalog.parameter_catalog_comparison_cases', 'insert') as comparison_case_insert,
              has_table_privilege(current_user, 'parameter_catalog.parameter_catalog_comparison_results', 'insert') as comparison_result_insert,
              has_table_privilege(current_user, 'parameter_catalog.parameter_catalog_comparison_cases', 'update') as comparison_case_update,
              has_table_privilege(current_user, 'parameter_catalog.parameter_catalog_comparison_cases', 'delete') as comparison_case_delete,
              has_table_privilege(current_user, 'parameter_catalog.parameter_catalog_comparison_results', 'update') as comparison_result_update,
              has_table_privilege(current_user, 'parameter_catalog.parameter_catalog_comparison_results', 'delete') as comparison_result_delete,
              has_table_privilege(current_user, 'public.audit_events', 'select') as audit_select,
              has_table_privilege(current_user, 'public.parameter_module_dismissed_compatibles', 'select') as dismissed_compatible_select,
              has_schema_privilege(current_user, 'public', 'create') as public_schema_create,
              has_schema_privilege(current_user, 'parameter_catalog', 'create') as parameter_catalog_schema_create,
              has_schema_privilege(current_user, 'catalog_publication', 'create') as catalog_publication_schema_create,
              has_database_privilege(current_user, current_database(), 'temp') as database_temp,
              has_function_privilege(current_user, 'parameter_catalog.assert_catalog_subject_active(text,text,text,text)', 'execute') as assert_catalog_subject_active_execute
         from pg_roles role
        where role.rolname = current_user`,
    );
    expect(sourceReaderSession.rows).toEqual([{
      session_user: sourceReaderRole,
      current_user: sourceReaderRole,
      rolsuper: false,
      rolinherit: false,
      rolbypassrls: false,
      default_transaction_read_only: "on",
      log_min_duration_statement: "0",
      log_parameter_max_length: "0",
      membership_count: 0,
      username_select: true,
      password_hash_select: false,
      auth_sessions_select: false,
      auth_sessions_update: false,
      module_insert: false,
      module_update: false,
      module_delete: false,
      comparison_case_insert: false,
      comparison_result_insert: false,
      comparison_case_update: false,
      comparison_case_delete: false,
      comparison_result_update: false,
      comparison_result_delete: false,
      audit_select: false,
      dismissed_compatible_select: false,
      public_schema_create: false,
      parameter_catalog_schema_create: false,
      catalog_publication_schema_create: false,
      database_temp: true,
      assert_catalog_subject_active_execute: false,
    }]);
    const executableVolatileDefinerFunctions = await sourceReaderPool.query<{ signature: string }>(
      `select format('%I.%I(%s)', namespace.nspname, procedure.proname,
                     pg_get_function_identity_arguments(procedure.oid)) as signature
         from pg_proc procedure
         join pg_namespace namespace on namespace.oid = procedure.pronamespace
        where namespace.nspname = any($1::text[])
          and procedure.prosecdef
          and procedure.provolatile = 'v'
          and has_function_privilege(current_user, procedure.oid, 'execute')
        order by signature`,
      [["public", "parameter_catalog", "catalog_publication"]],
    );
    expect(executableVolatileDefinerFunctions.rows.map(({ signature }) => signature)).toEqual([]);
    const assertReaderSqlState = async (sql: string, values: unknown[] = []) => {
      const deniedClient = await sourceReaderPool.connect();
      let state: string | null = null;
      try {
        await deniedClient.query("set default_transaction_read_only = off");
        await deniedClient.query("begin");
        try {
          await deniedClient.query(sql, values);
        } catch (error) {
          const code = (error as { code?: unknown }).code;
          state = typeof code === "string" ? code : "unknown";
        }
        await deniedClient.query("rollback");
      } finally {
        await deniedClient.query("rollback").catch(() => undefined);
        await deniedClient.query("set default_transaction_read_only = on").catch(() => undefined);
        deniedClient.release();
      }
      expect(state).toBe("42501");
    };
    await assertReaderSqlState(
      `insert into parameter_catalog.parameter_catalog_comparison_cases
        (id, cutover_run_id, gate_id, consumer_family, case_key, protected_reference)
       values ('reader-denied-comparison-case', $1, 'PCAT-CMP-D02', 'MOD', 'reader-denied-case', true)`,
      [runB.value.runId],
    );
    await assertReaderSqlState(
      `insert into parameter_catalog.parameter_catalog_comparison_results
        (comparison_case_id, outcome, evidence)
       values ('reader-denied-comparison-result', 'exact-equivalent', '{}'::jsonb)`,
    );
    await assertReaderSqlState("select id from public.audit_events limit 0");
    await assertReaderSqlState("select id from public.parameter_module_dismissed_compatibles limit 0");
    await assertReaderSqlState(
      "select parameter_catalog.assert_catalog_subject_active('crel_x','sha256:x','csub_x','active')",
    );
    expect(invocationAuth.roles).toContainEqual({ projectId: null, roleId: "admin" });
    const sourceReaderTransaction = await sourceReaderPool.connect();
    try {
      await sourceReaderTransaction.query("begin");
      const readOnly = await sourceReaderTransaction.query<{ transaction_read_only: string }>(
        "select current_setting('transaction_read_only') as transaction_read_only",
      );
      expect(readOnly.rows[0]?.transaction_read_only).toBe("on");
      await sourceReaderTransaction.query("rollback");
    } finally {
      sourceReaderTransaction.release();
    }
    const sourceReaderReadiness = await evaluateDualFactReadiness(sourceReaderPool, { dataMode: "new-empty" });
    if (sourceReaderReadiness.status !== "ready") {
      const detail = sourceReaderReadiness.status === "not-ready"
        ? sourceReaderReadiness.reasons.join(",")
        : sourceReaderReadiness.status;
      throw new Error(`MOD D02 source-reader readiness failed: ${detail}`);
    }
    const directForeignSource = await sourceReaderPool.query<{ id: string; organization_id: string }>(
      "select id, organization_id from public.parameter_modules where id = $1",
      [foreignSameSourceModule.id],
    );
    expect(directForeignSource.rows).toEqual([{
      id: foreignSameSourceModule.id,
      organization_id: otherOrganizationId,
    }]);
    const sourceReaderBatch = await provideModParameterCatalogComparisonCaseBatchV2({
      database: sourceReaderDb,
      pool: sourceReaderPool,
      runId: runB.value.runId,
      invocation,
    });
    expect(sourceReaderBatch.sourceInventoryCount).toBe(2);
    expect(sourceReaderBatch.inventory.map((item) => item.id).sort()).toEqual([moduleA.id, moduleB.id].sort());
    expect(sourceReaderBatch.inventory.every((item) =>
      item.ownerScopeKind === "organization" && item.ownerScopeId === organizationId,
    )).toBe(true);
    expect(sourceReaderBatch.inventory.some((item) => item.id === foreignSameSourceModule.id)).toBe(false);
    expect(sourceReaderBatch.blockers).toEqual([]);
    expect(sourceReaderBatch.cases).toHaveLength(2);
    expect(sourceReaderBatch.cases.every((item) => item.canonicalObservation.status === "value")).toBe(true);
    expect(sourceReaderBatch.cases.every((item) =>
      item.context.selection?.status === "appended" &&
      item.context.selection?.mappingVersion.targetKind === null &&
      Boolean(item.context.selection?.mappingVersion.archiveId),
    )).toBe(true);
    expect(sourceReaderBatch.cases.map((item) => item.context.selection?.legacyIdentityId).sort())
      .toEqual([moduleAIdentityId, moduleBIdentityId].sort());

    const sessionColumns = ["id", "user_id", "organization_id", "token_hash", "expires_at", "revoked_at"];
    await client.query(
      `grant select (${sessionColumns.join(", ")}) on public.auth_sessions to ${sourceReaderRole}`,
    );
    const sessionCandidate = async (token: string) => {
      const candidate = await sourceReaderPool.query<{
        id: string;
        user_id: string;
        organization_id: string;
        expires_at: string;
        revoked_at: string | null;
      }>(
        `select id, user_id, organization_id, expires_at::text as expires_at, revoked_at::text as revoked_at
           from public.auth_sessions
          where token_hash = $1
          limit 1`,
        [hashLocalSessionToken(token)],
      );
      const row = candidate.rows[0];
      if (!row) return "invalid";
      if (token === localAdminLogin.session.token) expect(row.id).toBe(localSessionId);
      if (row.revoked_at) return "revoked";
      if (new Date(row.expires_at).getTime() <= sessionClock.getTime()) return "expired";
      try {
        const currentAuth = await getAuthContextForExternalIdentity(sourceReaderDb, {
          organizationId: row.organization_id,
          subject: row.user_id,
        });
        return currentAuth.roles.some((role) =>
          role.projectId === null && (role.roleId === "admin" || role.roleId === "platform-admin"),
        )
          ? "active-admin"
          : "active-without-org-admin";
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code === "FORBIDDEN") return "inactive";
        if (code === "UNAUTHENTICATED") return "no-current-role";
        return "auth-query-failed";
      }
    };
    try {
      await assertReaderReadUnchanged(() => sessionCandidate(localAdminLogin.session.token), "active-admin");
      await assertReaderReadUnchanged(
        () => sessionCandidate(projectAdminLogin.session.token),
        "active-without-org-admin",
      );
      const unknownSessionToken = `we_local_${randomBytes(32).toString("base64url")}`;
      await assertReaderReadUnchanged(() => sessionCandidate(unknownSessionToken), "invalid");

      await client.query("update public.auth_sessions set expires_at = $2 where id = $1", [
        localSessionId,
        new Date(sessionClock.getTime() - 1).toISOString(),
      ]);
      await assertReaderReadUnchanged(() => sessionCandidate(localAdminLogin.session.token), "expired");
      await client.query("update public.auth_sessions set expires_at = $2 where id = $1", [
        localSessionId,
        localAdminLogin.session.expiresAt,
      ]);

      await client.query("update public.auth_sessions set revoked_at = $2 where id = $1", [
        localSessionId,
        sessionClock.toISOString(),
      ]);
      await assertReaderReadUnchanged(() => sessionCandidate(localAdminLogin.session.token), "revoked");
      await client.query("update public.auth_sessions set revoked_at = null where id = $1", [localSessionId]);

      await client.query("update public.users set is_active = false where id = $1", [principalId]);
      await assertReaderReadUnchanged(() => sessionCandidate(localAdminLogin.session.token), "inactive");
      await client.query("update public.users set is_active = true where id = $1", [principalId]);

      await client.query("update public.user_role_bindings set role_id = 'software-user' where id = $1", [
        `role-${principalId}`,
      ]);
      await assertReaderReadUnchanged(() => sessionCandidate(localAdminLogin.session.token), "active-without-org-admin");
      await client.query("update public.user_role_bindings set role_id = 'admin' where id = $1", [
        `role-${principalId}`,
      ]);

      await assertReaderReadUnchanged(async () => {
        const sessionResolveClient = await sourceReaderPool.connect();
        let localResolveFailureState: string | null = null;
        try {
          const defaultReadOnly = await sessionResolveClient.query<{ setting: string }>(
            "select current_setting('default_transaction_read_only') as setting",
          );
          expect(defaultReadOnly.rows[0]?.setting).toBe("on");
          await sessionResolveClient.query("set default_transaction_read_only = off");
          const sessionResolveDatabase = createDatabase(sessionResolveClient);
          try {
            await createLocalAuthService(sessionResolveDatabase, {
              now: () => sessionClock,
            }).resolveSession(`Bearer ${localAdminLogin.session.token}`);
          } catch (error) {
            const code = (error as { code?: unknown }).code;
            localResolveFailureState = typeof code === "string" ? code : "unknown";
          }
        } finally {
          await sessionResolveClient.query("set default_transaction_read_only = on").catch(() => undefined);
          sessionResolveClient.release();
        }
        return localResolveFailureState;
      }, "42501");

      const roleAttemptClient = await sourceReaderPool.connect();
      let setRoleFailureState: string | null = null;
      try {
        try {
          await roleAttemptClient.query("set role parameter_governance_writer_role");
        } catch (error) {
          const code = (error as { code?: unknown }).code;
          setRoleFailureState = typeof code === "string" ? code : "unknown";
        }
      } finally {
        roleAttemptClient.release();
      }
      expect(setRoleFailureState).toBe("42501");
    } finally {
      await client.query(
        `revoke select (${sessionColumns.join(", ")}) on public.auth_sessions from ${sourceReaderRole}`,
      );
    }
    expect((await captureBusinessFingerprint()) === businessRowsBeforeWrite).toBe(true);
    expect((await captureSessionFingerprint()) === authSessionFingerprintBeforeRead).toBe(true);
    expect((await captureArchiveFingerprint()) === archiveFingerprintBeforeRead).toBe(true);

    const sourceReaderWriteClient = await sourceReaderPool.connect();
    let deniedReaderWriteState: string | null = null;
    try {
      await sourceReaderWriteClient.query("set default_transaction_read_only = off");
      await sourceReaderWriteClient.query("begin");
      try {
        await sourceReaderWriteClient.query("update public.parameter_modules set name = name where false");
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        deniedReaderWriteState = typeof code === "string" ? code : "unknown";
      }
      await sourceReaderWriteClient.query("rollback");
    } finally {
      await sourceReaderWriteClient.query("set default_transaction_read_only = on").catch(() => undefined);
      sourceReaderWriteClient.release();
    }
    expect(deniedReaderWriteState).toBe("42501");

    await client.query(`revoke select (username) on public.user_password_credentials from ${sourceReaderRole}`);
    let revokedReadState: string | null = null;
    try {
      await provideModParameterCatalogComparisonCaseBatchV2({
        database: sourceReaderDb,
        pool: sourceReaderPool,
        runId: runB.value.runId,
        invocation,
      });
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      revokedReadState = typeof code === "string" ? code : "unknown";
    }
    expect(revokedReadState).toBe("42501");
    expect((await captureBusinessFingerprint()) === businessRowsBeforeWrite).toBe(true);
    expect((await captureSessionFingerprint()) === authSessionFingerprintBeforeRead).toBe(true);
    expect((await captureArchiveFingerprint()) === archiveFingerprintBeforeRead).toBe(true);

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
      expect((await captureBusinessFingerprint()) === businessRowsBeforeWrite).toBe(true);
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
    expect((await captureBusinessFingerprint()) === businessRowsBeforeWrite).toBe(true);

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
    await sourceReaderDatabase?.close().catch(() => undefined);
    await writerDatabase?.close().catch(() => undefined);
    if (sourceReaderRoleCreated) {
      await client.query(`drop owned by ${sourceReaderRole}`).catch(() => undefined);
      await client.query(`drop role ${sourceReaderRole}`).catch(() => undefined);
    }
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
