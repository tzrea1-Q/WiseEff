import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import pg from "pg";
import { expect, it } from "vitest";

import { createLocalAuthService } from "../../auth/localAuth";
import { hashLocalAccountPassword, hashLocalSessionToken } from "../../auth/localAccountCredentials";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { seedOrganization, seedUser } from "../../../testing/fixtures";
import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { populatedCutoverGraph, seedPopulatedCutover } from "../../../testing/parameterCatalog/cutoverPopulatedFixture";
import {
  installParameterModuleComparisonCatalogFixture,
  registerParameterModuleComparisonDriver,
} from "../../../testing/parameterCatalog/registryProjection";
import { compileCatalogRelease } from "../../catalog-kernel/compiler";
import { refreshAuthoritativeSource, validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { adoptPreexistingCatalog } from "../../catalog-publication/runtime/adoption";
import { createLocalArchiveObjectStore } from "../../catalog-cutover/archive";
import { executeCutover, planCutover } from "../../catalog-cutover/orchestrator";
import { fixtureCutoverIdentities } from "../../catalog-cutover/identities";
import { fixtureObservedQuiescence } from "../../catalog-cutover/quiescence";
import { fixtureObservedRecoveryPoint } from "../../catalog-cutover/recoveryPointObservation";
import { CatalogSubjectId } from "../../parameter-catalog-contract";
import { createParameterModule } from "../../parameters/parameterModuleRepository";
import { captureOfflineModD02PreP11 } from "./offlineModD02Capture";
import { createOfflineModD02SourceReader } from "./offlineModD02SourceReader";
import { serializeCanonical } from "./corpusContributionSchema";

it("captures real pre-P11 MOD D02 cases through fixed source and function-only logins", async () => {
  const fixture = await createEphemeralTestDatabase("modcapture");
  const ownerDatabase = createPostgresDatabase(fixture.url);
  const ownerPool = getRootPostgresPool(ownerDatabase)!;
  const client = new pg.Client({ connectionString: fixture.url });
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), "mod-d02-capture-"));
  let readerDatabase: ReturnType<typeof createPostgresDatabase> | null = null;
  let captureDatabase: ReturnType<typeof createPostgresDatabase> | null = null;
  const organizationId = "mod-capture-org";
  const otherOrganizationId = "mod-capture-other-org";
  const principalId = "mod-capture-admin";
  const otherPrincipalId = "mod-capture-other-admin";
  const identityA = "mod-capture-identity-a";
  const identityB = "mod-capture-identity-b";
  try {
    await client.connect();
    const canonicalSample = { nested: { escaped: "中😀\n\\\"" }, list: [1, null, true] };
    const sqlCanonical = await client.query<{ value: string; uri: string }>(
      `select parameter_catalog.mod_d02_canonical_json($1::jsonb) as value,
              parameter_catalog.mod_d02_uri_component($2) as uri`,
      [JSON.stringify(canonicalSample), "module /中😀"],
    );
    expect(sqlCanonical.rows[0]).toEqual({
      value: serializeCanonical(canonicalSample).toString("utf8").trimEnd(),
      uri: encodeURIComponent("module /中😀"),
    });
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
    const localPassword = randomBytes(24).toString("hex");
    await client.query(
      `insert into public.user_password_credentials (user_id, username, password_hash)
       values ($1, $2, $3)`,
      [principalId, "mod.capture.admin", await hashLocalAccountPassword(localPassword)],
    );
    const login = await createLocalAuthService(ownerDatabase).login(
      { username: "mod.capture.admin", password: localPassword },
      { requestId: "mod-capture-login" },
    );
    expect(login.auth.roles).toContainEqual({ projectId: null, roleId: "admin" });

    const installed = await installParameterModuleComparisonCatalogFixture(ownerPool, 1);
    const complete = validCatalogReleaseBundle();
    const release = structuredClone(complete.releases[0]!);
    const subject = release.documents.find((document) => document.kind === "subject");
    if (!subject || subject.kind !== "subject") throw new Error("Catalog fixture subject is unavailable");
    const secondSubject = structuredClone(subject);
    Object.assign(secondSubject.content, {
      id: CatalogSubjectId("csub_mod_page_0"),
      canonicalKey: "driver:mod-page-0",
      selector: { ...secondSubject.content.selector, value: "mod-page-0" },
    });
    release.documents.push(secondSubject);
    refreshAuthoritativeSource(release as Parameters<typeof refreshAuthoritativeSource>[0]);
    const bundle = { schemaVersion: complete.schemaVersion, targetReleaseId: release.manifest.release.id, releases: [release] };
    const compiled = compileCatalogRelease(bundle);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(installed.pin).toEqual({ id: compiled.value.release.id, digest: compiled.value.release.digest });
    const source = jsonCatalogReleaseSource(bundle);

    const moduleA = await createParameterModule(ownerDatabase, {
      organizationId, name: "amba", kind: "driver-group", sourceKey: "compatible:acme,power",
    });
    const moduleB = await createParameterModule(ownerDatabase, {
      organizationId, name: "MOD D02 driver B", kind: "driver-group", sourceKey: "compatible:mod-page-0",
    });
    await registerParameterModuleComparisonDriver(ownerPool, {
      organizationId, destinationModuleId: moduleA.id, subjectId: CatalogSubjectId("csub_acme_power"),
      release: installed.pin, idempotencyKey: "mod-capture-register-a", principalId,
    });
    await registerParameterModuleComparisonDriver(ownerPool, {
      organizationId, destinationModuleId: moduleB.id, subjectId: installed.additionalSubjectIds[0]!,
      release: installed.pin, idempotencyKey: "mod-capture-register-b", principalId,
    });
    const foreignModule = await createParameterModule(ownerDatabase, {
      organizationId: otherOrganizationId, name: "Other org", kind: "driver-group", sourceKey: "compatible:acme,power",
    });
    await registerParameterModuleComparisonDriver(ownerPool, {
      organizationId: otherOrganizationId, destinationModuleId: foreignModule.id,
      subjectId: CatalogSubjectId("csub_acme_power"), release: installed.pin,
      idempotencyKey: "mod-capture-register-other", principalId: otherPrincipalId,
    });

    const baseGraph = populatedCutoverGraph();
    const graph = {
      ...baseGraph,
      identities: [
        ...baseGraph.identities.map((identity) => ({ ...identity,
          ownerScopeKind: "organization" as const, ownerScopeId: organizationId })),
        ...[moduleA, moduleB].map((module) => ({
          id: module.id === moduleA.id ? identityA : identityB,
          sourceSystem: "wiseeff-v1", sourceKind: "parameter-module" as const,
          ownerScopeKind: "organization" as const, ownerScopeId: organizationId, sourceId: module.id,
        })),
      ],
      specs: baseGraph.specs.map((spec) => spec.id === "s7orc-spec-r1"
        ? { ...spec, organizationId, specificationKey: "s7p7.r9.historical",
            definitionLifecycle: "deprecated" as const, propertyKey: "s7p7,historical" }
        : { ...spec, organizationId }),
      specVersions: baseGraph.specVersions.map((version) => version.parameterSpecId === "s7orc-spec-r1"
        ? { ...version, lifecycle: "deprecated" as const, versionStatus: "superseded" as const }
        : version),
      modules: [moduleA, moduleB].map((module) => ({
        id: module.id, organizationId, kind: "driver-group" as const, origin: "curated" as const,
        name: module.name, attributionSubjectId: module.attributionSubjectId,
      })),
    };
    await seedPopulatedCutover(client, graph);
    const plan = await planCutover({ graph, targetArtifactSha: "b".repeat(40),
      targetCatalogReleaseDigest: installed.pin.digest,
      identities: fixtureCutoverIdentities("mod-capture-run"), catalogReleaseSource: source });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const run = await executeCutover({ pool: ownerPool, plan: plan.value, graph,
      catalogReleaseSource: source, archiveObjectStore: createLocalArchiveObjectStore(archiveRoot),
      archiveEncryptionKey: randomBytes(32), operatorAuditRef: "audit-mod-capture",
      quiescence: fixtureObservedQuiescence(), recoveryPoint: fixtureObservedRecoveryPoint() });
    expect(run, JSON.stringify(run)).toMatchObject({ ok: true, value: { state: "completed" } });
    if (!run.ok) return;
    const materialization = await ownerPool.query<{ compiled_fingerprint: string }>(
      "select compiled_fingerprint from parameter_catalog.catalog_materializations where release_id = $1",
      [installed.pin.id],
    );
    const adopted = await adoptPreexistingCatalog(ownerPool, {
      expectedCurrent: installed.pin, actorPrincipalId: principalId,
      sourceBytes: Buffer.from(JSON.stringify(bundle)), artifactDigest: installed.pin.digest,
      evidenceKind: "synthetic-fixture", adoptionEvidence: {
        source_bundle_digest: installed.pin.digest,
        verification_digest: materialization.rows[0]!.compiled_fingerprint,
        data_mode: "fresh", collected_at: "2026-09-29T00:00:00.000Z", approved_by: principalId,
      },
    });
    expect(adopted, JSON.stringify(adopted)).toMatchObject({ ok: true });
    await client.query("begin");
    try {
      await client.query("set local role catalog_migration_owner");
      await client.query("select catalog_publication.revise_publication_policy(false, false, 'catalog-capability/v1', $1)", [principalId]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }

    // Passwords exist only in the disposable cluster and never leave this test.
    const readerPassword = randomBytes(24).toString("hex");
    const capturePassword = randomBytes(24).toString("hex");
    await client.query(`alter role wiseeff_mod_d02_source_reader password '${readerPassword}'`);
    await client.query(`alter role wiseeff_mod_d02_capture password '${capturePassword}'`);
    const readerUrl = new URL(fixture.url);
    readerUrl.username = "wiseeff_mod_d02_source_reader";
    readerUrl.password = readerPassword;
    readerDatabase = createPostgresDatabase(readerUrl.toString());
    const captureUrl = new URL(fixture.url);
    captureUrl.username = "wiseeff_mod_d02_capture";
    captureUrl.password = capturePassword;
    captureDatabase = createPostgresDatabase(captureUrl.toString());
    const readerPool = getRootPostgresPool(readerDatabase)!;
    for (const database of [readerDatabase, captureDatabase]) {
      const role = await database.query<{ session_user: string; current_user: string; rolsuper: boolean; rolbypassrls: boolean }>(
        "select session_user, current_user, rolsuper, rolbypassrls from pg_catalog.pg_roles where rolname = current_user",
      );
      expect(role.rows).toHaveLength(1);
      expect(role.rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
      expect(role.rows[0]?.session_user).toBe(role.rows[0]?.current_user);
    }
    const foreignRows = await readerPool.query<{ id: string }>(
      "select id from public.parameter_modules where organization_id = $1",
      [otherOrganizationId],
    );
    expect(foreignRows.rows).toEqual([{ id: foreignModule.id }]); // Column grant is all-row, not database tenant isolation.
    await expect(readerPool.query("select password_hash from public.user_password_credentials"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(readerPool.query("select id from public.audit_events"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(readerPool.query("select id from public.parameter_module_dismissed_compatibles"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(readerPool.query("insert into public.audit_events(id) values ('forbidden')"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(readerPool.query("set role catalog_mod_d02_capture_owner"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(readerPool.query(
      "select parameter_catalog.capture_mod_d02_pre_activation_v2(null,null,null,null,null,null,null)",
    )).rejects.toMatchObject({ code: "42501" });
    await expect(captureDatabase.query("select id from public.auth_sessions"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(captureDatabase.query(
      "insert into parameter_catalog.parameter_catalog_comparison_cases(id) values ('forbidden')",
    )).rejects.toMatchObject({ code: "42501" });
    const beforeSession = await client.query<{ last_used_at: Date | null }>(
      "select last_used_at from public.auth_sessions where user_id = $1", [principalId],
    );
    await client.query(`create function public.test_mod_d02_capture_fault() returns trigger language plpgsql as $$
      begin
        if new.selection_legacy_identity_id = '${identityB}' then
          raise exception 'controlled second result failure';
        end if;
        return new;
      end $$`);
    await client.query(`create trigger test_mod_d02_capture_fault before insert
      on parameter_catalog.parameter_catalog_comparison_results
      for each row execute function public.test_mod_d02_capture_fault()`);
    const captureInput = {
      sourceDatabase: readerDatabase, sourcePool: readerPool, captureDatabase,
      token: login.session.token, runId: run.value.runId,
      requestId: "mod-capture-request", enabled: true, authProvider: "local",
      expectedPlanDigest: plan.value.planDigest,
      expectedArtifactSha: plan.value.targetArtifactSha,
      expectedCatalogReleaseDigest: installed.pin.digest,
    } as const;
    const produced = await createOfflineModD02SourceReader({
      database: readerDatabase, pool: readerPool, enabled: true, authProvider: "local",
    })({ token: login.session.token, runId: run.value.runId });
    const directCapture = (batch: unknown, tokenHash = hashLocalSessionToken(login.session.token)) =>
      captureDatabase!.query(
        "select parameter_catalog.capture_mod_d02_pre_activation_v2($1,$2,$3,$4,$5,$6::jsonb,$7)",
        [run.value.runId, produced.sessionId, tokenHash, produced.principalId, produced.organizationId,
          JSON.stringify(batch), "mod-capture-forged"],
      );
    const forged = structuredClone(produced.batch) as unknown as { cases: Array<{ result: string; caseId: string; checksum: string }>;
      selectionProjectionDigest: string };
    forged.cases[0]!.result = "exact-equivalent";
    await expect(directCapture(forged)).rejects.toMatchObject({ code: "23514" });
    const falseProjection = structuredClone(produced.batch) as unknown as typeof forged;
    falseProjection.selectionProjectionDigest = `sha256:${"f".repeat(64)}`;
    await expect(directCapture(falseProjection)).rejects.toMatchObject({ code: "23514" });
    const falseChecksum = structuredClone(produced.batch) as unknown as typeof forged;
    falseChecksum.cases[0]!.checksum = "f".repeat(64);
    await expect(directCapture(falseChecksum)).rejects.toMatchObject({ code: "23514" });
    const falseCaseId = structuredClone(produced.batch) as unknown as typeof forged;
    falseCaseId.cases[0]!.caseId = "pcat_cmp_v2:forged";
    await expect(directCapture(falseCaseId)).rejects.toMatchObject({ code: "23514" });
    const extraEvidence = structuredClone(produced.batch) as unknown as typeof forged & { cases: Array<{ note?: string }> };
    extraEvidence.cases[0]!.note = "untrusted-extra-field";
    await expect(directCapture(extraEvidence)).rejects.toMatchObject({ code: "23514" });
    const extraReference = structuredClone(produced.batch) as unknown as typeof forged & {
      cases: Array<{ protectedReference: { note?: string } }> };
    extraReference.cases[0]!.protectedReference.note = "untrusted-extra-field";
    await expect(directCapture(extraReference)).rejects.toMatchObject({ code: "23514" });
    await expect(directCapture(produced.batch, "a".repeat(43)))
      .rejects.toMatchObject({ code: "42501" });
    await expect(captureOfflineModD02PreP11({ ...captureInput, expectedPlanDigest: "sha256:wrong" }))
      .rejects.toThrow("differs from the maintenance plan pins");
    await expect(captureOfflineModD02PreP11({ ...captureInput, expectedCatalogReleaseDigest: "sha256:wrong" }))
      .rejects.toThrow("differs from the maintenance plan pins");
    const otherPassword = randomBytes(24).toString("hex");
    await client.query(
      `insert into public.user_password_credentials (user_id, username, password_hash)
       values ($1, $2, $3)`,
      [otherPrincipalId, "mod.capture.other", await hashLocalAccountPassword(otherPassword)],
    );
    const otherLogin = await createLocalAuthService(ownerDatabase).login(
      { username: "mod.capture.other", password: otherPassword },
      { requestId: "mod-capture-other-login" },
    );
    await expect(captureOfflineModD02PreP11({ ...captureInput, token: otherLogin.session.token }))
      .rejects.toThrow();
    await expect(captureOfflineModD02PreP11(captureInput))
      .rejects.toThrow("controlled second result failure");
    const emptyResultSql = `select
         (select count(*)::text from parameter_catalog.parameter_catalog_comparison_cases
           where cutover_run_id = $1 and consumer_family = 'MOD') as cases,
         (select count(*)::text from parameter_catalog.parameter_catalog_comparison_results result
           join parameter_catalog.parameter_catalog_comparison_cases comparison_case
             on comparison_case.id = result.comparison_case_id
           where comparison_case.cutover_run_id = $1 and comparison_case.consumer_family = 'MOD') as results,
         (select count(*)::text from public.audit_events where kind = 'mod-d02-comparison-capture'
           and target_id = $1) as audits`;
    const emptyResult = await client.query<{ cases: string; results: string; audits: string }>(
      emptyResultSql, [run.value.runId],
    );
    expect(emptyResult.rows).toEqual([{ cases: "0", results: "0", audits: "0" }]);
    await client.query("drop trigger test_mod_d02_capture_fault on parameter_catalog.parameter_catalog_comparison_results");
    await client.query("drop function public.test_mod_d02_capture_fault()");
    await client.query(`create function public.test_mod_d02_audit_fault() returns trigger language plpgsql as $$
      begin
        if new.kind = 'mod-d02-comparison-capture' then raise exception 'controlled audit failure'; end if;
        return new;
      end $$`);
    await client.query(`create trigger test_mod_d02_audit_fault before insert on public.audit_events
      for each row execute function public.test_mod_d02_audit_fault()`);
    await expect(captureOfflineModD02PreP11(captureInput)).rejects.toThrow("controlled audit failure");
    expect((await client.query(emptyResultSql, [run.value.runId])).rows).toEqual(emptyResult.rows);
    await client.query("drop trigger test_mod_d02_audit_fault on public.audit_events");
    await client.query("drop function public.test_mod_d02_audit_fault()");
    const receipt = await captureOfflineModD02PreP11({
      ...captureInput,
    });
    expect(receipt.sourceIdentity).toMatchObject({ session_user: "wiseeff_mod_d02_source_reader", current_user: "wiseeff_mod_d02_source_reader" });
    expect(receipt.captureIdentity).toMatchObject({ session_user: "wiseeff_mod_d02_capture", current_user: "wiseeff_mod_d02_capture" });
    expect(receipt).toMatchObject({ organizationId, selectionRunId: run.value.runId,
      caseCount: 2, newlyWrittenCount: 2, replayedWriteCount: 0,
      selectionStatusCounts: { appended: 2, replayed: 0 }, fullReport: { available: false } });
    const saved = await client.query<{ count: string }>(
      `select count(*)::text from parameter_catalog.parameter_catalog_comparison_results result
       join parameter_catalog.parameter_catalog_comparison_cases comparison_case
         on comparison_case.id = result.comparison_case_id
       where comparison_case.cutover_run_id = $1 and comparison_case.consumer_family = 'MOD'`,
      [run.value.runId],
    );
    expect(saved.rows[0]?.count).toBe("2");
    const replay = await captureOfflineModD02PreP11({
      ...captureInput,
      requestId: "mod-capture-request-retry", enabled: true, authProvider: "local",
    });
    expect(replay).toMatchObject({ newlyWrittenCount: 0, replayedWriteCount: 2 });
    const afterSession = await client.query<{ last_used_at: Date | null }>(
      "select last_used_at from public.auth_sessions where user_id = $1", [principalId],
    );
    expect(afterSession.rows).toEqual(beforeSession.rows);
    await client.query("update public.parameter_modules set source_key = $2 where id = $1", [
      moduleA.id, "compatible:changed-after-capture",
    ]);
    await expect(captureOfflineModD02PreP11(captureInput)).rejects.toThrow();
    const unchanged = await client.query<{ results: string; audits: string }>(
      `select
         (select count(*)::text from parameter_catalog.parameter_catalog_comparison_results result
           join parameter_catalog.parameter_catalog_comparison_cases comparison_case
             on comparison_case.id = result.comparison_case_id
           where comparison_case.cutover_run_id = $1 and comparison_case.consumer_family = 'MOD') as results,
         (select count(*)::text from public.audit_events where kind = 'mod-d02-comparison-capture'
           and target_id = $1) as audits`, [run.value.runId],
    );
    expect(unchanged.rows).toEqual([{ results: "2", audits: "1" }]);
    await client.query("update public.auth_sessions set revoked_at = now() where user_id = $1", [principalId]);
    await expect(captureOfflineModD02PreP11(captureInput)).rejects.toThrow("Session is not active");
  } finally {
    await readerDatabase?.close().catch(() => undefined);
    await captureDatabase?.close().catch(() => undefined);
    await client.query("alter role wiseeff_mod_d02_source_reader password null").catch(() => undefined);
    await client.query("alter role wiseeff_mod_d02_capture password null").catch(() => undefined);
    await client.end().catch(() => undefined);
    await ownerDatabase.close().catch(() => undefined);
    await fixture.drop().catch(() => undefined);
    await rm(archiveRoot, { recursive: true, force: true });
  }
}, 180_000);
