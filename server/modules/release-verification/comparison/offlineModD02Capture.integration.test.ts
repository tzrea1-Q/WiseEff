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
import { captureOfflineModD02PreP11, captureOfflineModD02PreP11FromUrls } from "./offlineModD02Capture";
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
  let captureClient: pg.Client | null = null;
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
    captureClient = new pg.Client({ connectionString: captureUrl.toString() });
    await captureClient.connect();
    for (const name of [
      "auth_sessions", "organizations", "users", "user_role_bindings", "parameter_modules",
      "projects", "parameter_catalog_cutover_runs", "parameter_catalog_cutover_checkpoints",
      "catalog_state", "catalog_activation_receipts", "publication_policies",
      "parameter_catalog_comparison_cases", "parameter_catalog_comparison_results", "audit_events",
    ]) {
      await captureClient.query(`create temporary table ${name} (id text)`);
    }
    await captureClient.query("set search_path = pg_temp, public, parameter_catalog, catalog_publication");
    const tempBoundary = await captureClient.query<{ can_temp: boolean; shadow_resolves: boolean }>(
      `select pg_catalog.has_database_privilege(session_user, current_database(), 'TEMP') as can_temp,
              pg_catalog.to_regclass('auth_sessions') = pg_catalog.to_regclass('pg_temp.auth_sessions') as shadow_resolves`,
    );
    expect(tempBoundary.rows).toEqual([{ can_temp: true, shadow_resolves: true }]);
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
    await captureClient!.query("begin");
    await expect(captureClient!.query("lock table parameter_catalog.catalog_activation_receipts in share mode"))
      .rejects.toMatchObject({ code: "42501" });
    await captureClient!.query("rollback");
    await expect(captureDatabase.query(
      "insert into parameter_catalog.parameter_catalog_comparison_cases(id) values ('forbidden')",
    )).rejects.toMatchObject({ code: "42501" });
    const receiptLockPrivilege = await client.query<{ allowed: boolean }>(
      "select pg_catalog.has_table_privilege('catalog_mod_d02_capture_owner', 'parameter_catalog.catalog_activation_receipts', 'UPDATE') as allowed",
    );
    expect(receiptLockPrivilege.rows).toEqual([{ allowed: true }]);
    await client.query("begin");
    let immutableReceiptError: { code?: string } | undefined;
    try {
      await client.query("set local role catalog_mod_d02_capture_owner");
      await client.query(
        `update parameter_catalog.catalog_activation_receipts
            set release_digest = release_digest
          where id = (select id from parameter_catalog.catalog_activation_receipts limit 1)`,
      );
    } catch (error) {
      immutableReceiptError = error as { code?: string };
    } finally {
      await client.query("rollback");
    }
    expect(immutableReceiptError?.code).toBe("55000");
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
    const captureInput = {
      sourceDatabase: readerDatabase, sourcePool: readerPool, captureDatabase,
      token: login.session.token, runId: run.value.runId,
      requestId: `${run.value.runId}:mod-d02-pre-p11`, enabled: true, authProvider: "local",
      expectedPlanDigest: plan.value.planDigest,
      expectedArtifactSha: plan.value.targetArtifactSha,
      expectedCatalogReleaseDigest: installed.pin.digest,
    } as const;
    const produced = await createOfflineModD02SourceReader({
      database: readerDatabase, pool: readerPool, enabled: true, authProvider: "local",
    })({ token: login.session.token, runId: run.value.runId });
    const directCapture = (
      batch: unknown,
      tokenHash = hashLocalSessionToken(login.session.token),
      requestId = "mod-capture-forged",
    ) => captureClient!.query(
        "select parameter_catalog.capture_mod_d02_pre_activation_v2($1,$2,$3,$4,$5,$6::jsonb,$7)",
        [run.value.runId, produced.sessionId, tokenHash, produced.principalId, produced.organizationId,
          JSON.stringify(batch), requestId],
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

    // A source connection can read successfully before capture rechecks mutable authorization and source facts.
    await client.query("update public.auth_sessions set revoked_at = now() where id = $1", [produced.sessionId]);
    await expect(directCapture(produced.batch)).rejects.toMatchObject({ code: "42501" });
    await client.query("update public.auth_sessions set revoked_at = null where id = $1", [produced.sessionId]);
    await client.query("delete from public.user_role_bindings where id = $1", [`role-${principalId}`]);
    await expect(directCapture(produced.batch)).rejects.toMatchObject({ code: "42501" });
    await client.query(
      `insert into public.user_role_bindings(id,user_id,organization_id,project_id,role_id)
       values ($1,$2,$3,null,'admin')`,
      [`role-${principalId}`, principalId, organizationId],
    );
    await client.query("update public.parameter_modules set source_key = $2 where id = $1", [
      moduleA.id, "compatible:changed-between-read-and-capture",
    ]);
    await expect(directCapture(produced.batch)).rejects.toMatchObject({ code: "23514" });
    await client.query("update public.parameter_modules set source_key = $2 where id = $1", [
      moduleA.id, "compatible:acme,power",
    ]);
    const reviseCapability = async (revision: string) => {
      await client.query("begin");
      try {
        await client.query("set local role catalog_migration_owner");
        await client.query(
          "select catalog_publication.revise_publication_policy(false, false, $1, $2)",
          [revision, principalId],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
    };
    await reviseCapability("catalog-capability/v999");
    await expect(directCapture(produced.batch)).rejects.toMatchObject({ code: "23514" });
    await reviseCapability("catalog-capability/v1");

    await expect(captureOfflineModD02PreP11({ ...captureInput, expectedPlanDigest: "sha256:wrong" }))
      .rejects.toThrow("differs from the maintenance plan pins");
    await expect(captureOfflineModD02PreP11({ ...captureInput, expectedArtifactSha: "wrong-artifact" }))
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
    await client.query(`create trigger test_mod_d02_capture_fault before insert
      on parameter_catalog.parameter_catalog_comparison_results
      for each row execute function public.test_mod_d02_capture_fault()`);
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

    // The fixed function's session/admin locks stay held while its writes are in flight.
    const blocker = new pg.Client({ connectionString: fixture.url });
    const mutation = new pg.Client({ connectionString: fixture.url });
    await blocker.connect();
    await mutation.connect();
    const lockKey = 891002;
    let captureOutcome: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
    try {
      await client.query(`create function public.test_mod_d02_capture_lock() returns trigger language plpgsql as $$
        begin
          perform pg_catalog.pg_advisory_xact_lock(${lockKey}::bigint);
          return new;
        end $$`);
      await client.query(`create trigger test_mod_d02_capture_lock before insert
        on parameter_catalog.parameter_catalog_comparison_cases
        for each row execute function public.test_mod_d02_capture_lock()`);
      await blocker.query("begin");
      const blockerPid = Number((await blocker.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      )).rows[0]?.pid);
      await blocker.query("select pg_catalog.pg_advisory_xact_lock($1::bigint)", [lockKey]);
      await captureClient!.query("begin");
      const capturePid = Number((await captureClient!.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      )).rows[0]?.pid);
      captureOutcome = directCapture(produced.batch, undefined, captureInput.requestId).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      let isBlocked = false;
      for (let attempt = 0; attempt < 100 && !isBlocked; attempt += 1) {
        const waitState = await client.query<{ blocked: boolean }>(
          `select wait_event_type = 'Lock' and $2::integer = any(pg_catalog.pg_blocking_pids(pid)) as blocked
             from pg_catalog.pg_stat_activity where pid = $1`,
          [capturePid, blockerPid],
        );
        isBlocked = waitState.rows[0]?.blocked === true;
        if (!isBlocked) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(isBlocked).toBe(true);
      await mutation.query("begin");
      await mutation.query("set local lock_timeout = '150ms'");
      let revokeError: { code?: string } | undefined;
      try {
        await mutation.query("update public.auth_sessions set revoked_at = now() where id = $1", [produced.sessionId]);
      } catch (error) {
        revokeError = error as { code?: string };
      }
      expect(revokeError?.code).toBe("55P03");
      await mutation.query("rollback");
      // Even a zero-row INSERT requests ROW EXCLUSIVE and must wait for the
      // capture function's SHARE lock on the append-only receipt relation.
      await mutation.query("begin");
      await mutation.query("set local lock_timeout = '150ms'");
      let receiptInsertError: { code?: string } | undefined;
      try {
        await mutation.query(
          `insert into parameter_catalog.catalog_activation_receipts
           select * from parameter_catalog.catalog_activation_receipts where false`,
        );
      } catch (error) {
        receiptInsertError = error as { code?: string };
      }
      expect(receiptInsertError?.code).toBe("55P03");
      await mutation.query("rollback");
    } finally {
      await blocker.query("rollback").catch(() => undefined);
      await mutation.query("rollback").catch(() => undefined);
    }
    const concurrentOutcome = await captureOutcome!;
    expect(concurrentOutcome.ok).toBe(false);
    if (!concurrentOutcome.ok) {
      expect(concurrentOutcome.error).toHaveProperty("message", "controlled second result failure");
    }
    await captureClient!.query("rollback").catch(() => undefined);
    await blocker.end();
    await mutation.end();
    await client.query("drop trigger test_mod_d02_capture_lock on parameter_catalog.parameter_catalog_comparison_cases");
    await client.query("drop function public.test_mod_d02_capture_lock()");
    expect((await client.query(emptyResultSql, [run.value.runId])).rows).toEqual(emptyResult.rows);

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
    const shadowedSuccess = await directCapture(produced.batch, undefined, captureInput.requestId);
    expect(shadowedSuccess.rows[0]?.capture_mod_d02_pre_activation_v2).toMatchObject({
      newlyWrittenCount: 2, replayedWriteCount: 0,
    });
    const spoofedRelationCounts = await captureClient!.query(
      `select
         (select count(*)::text from pg_temp.auth_sessions) as auth_sessions,
         (select count(*)::text from pg_temp.organizations) as organizations,
         (select count(*)::text from pg_temp.users) as users,
         (select count(*)::text from pg_temp.user_role_bindings) as user_role_bindings,
         (select count(*)::text from pg_temp.parameter_modules) as parameter_modules,
         (select count(*)::text from pg_temp.projects) as projects,
         (select count(*)::text from pg_temp.parameter_catalog_cutover_runs) as cutover_runs,
         (select count(*)::text from pg_temp.parameter_catalog_cutover_checkpoints) as cutover_checkpoints,
         (select count(*)::text from pg_temp.catalog_state) as catalog_state,
         (select count(*)::text from pg_temp.catalog_activation_receipts) as activation_receipts,
         (select count(*)::text from pg_temp.publication_policies) as publication_policies,
         (select count(*)::text from pg_temp.parameter_catalog_comparison_cases) as comparison_cases,
         (select count(*)::text from pg_temp.parameter_catalog_comparison_results) as comparison_results,
         (select count(*)::text from pg_temp.audit_events) as audit_events`,
    );
    expect(Object.values(spoofedRelationCounts.rows[0] ?? {})).toEqual(Array(14).fill("0"));
    expect((await client.query(emptyResultSql, [run.value.runId])).rows).toEqual([
      { cases: "2", results: "2", audits: "1" },
    ]);
    const receipt = await captureOfflineModD02PreP11({
      ...captureInput,
    });
    expect(receipt.sourceIdentity).toMatchObject({ session_user: "wiseeff_mod_d02_source_reader", current_user: "wiseeff_mod_d02_source_reader" });
    expect(receipt.captureIdentity).toMatchObject({ session_user: "wiseeff_mod_d02_capture", current_user: "wiseeff_mod_d02_capture" });
    expect(receipt).toMatchObject({ organizationId, selectionRunId: run.value.runId,
      caseCount: 2, newlyWrittenCount: 0, replayedWriteCount: 2,
      selectionStatusCounts: { appended: 2, replayed: 0 }, fullReport: { available: false } });
    const saved = await client.query<{ count: string }>(
      `select count(*)::text from parameter_catalog.parameter_catalog_comparison_results result
       join parameter_catalog.parameter_catalog_comparison_cases comparison_case
         on comparison_case.id = result.comparison_case_id
       where comparison_case.cutover_run_id = $1 and comparison_case.consumer_family = 'MOD'`,
      [run.value.runId],
    );
    expect(saved.rows[0]?.count).toBe("2");
    const wrapperSourceUrl = new URL(readerUrl.toString());
    const wrapperCaptureUrl = new URL(captureUrl.toString());
    const wrapperSourceApplication = "mod-d02-wrapper-source-test";
    const wrapperCaptureApplication = "mod-d02-wrapper-capture-test";
    wrapperSourceUrl.searchParams.set("application_name", wrapperSourceApplication);
    wrapperCaptureUrl.searchParams.set("application_name", wrapperCaptureApplication);
    const countWrapperConnections = async () => (await client.query<{ count: string }>(
      `select count(*)::text as count from pg_catalog.pg_stat_activity
        where application_name in ($1, $2)`,
      [wrapperSourceApplication, wrapperCaptureApplication],
    )).rows[0]?.count;
    const captureFromUrls = (token: string) => captureOfflineModD02PreP11FromUrls({
      sourceDatabaseUrl: wrapperSourceUrl.toString(),
      captureDatabaseUrl: wrapperCaptureUrl.toString(),
      token, runId: run.value.runId, requestId: captureInput.requestId,
      expectedPlanDigest: plan.value.planDigest,
      expectedArtifactSha: plan.value.targetArtifactSha,
      expectedCatalogReleaseDigest: installed.pin.digest,
      enabled: true, authProvider: "local",
    });
    const replay = await captureFromUrls(login.session.token);
    expect(replay).toMatchObject({ newlyWrittenCount: 0, replayedWriteCount: 2 });
    expect(await countWrapperConnections()).toBe("0");
    const firstAudit = await client.query<{ count: string }>(
      "select count(*)::text as count from public.audit_events where kind = 'mod-d02-comparison-capture' and target_id = $1",
      [run.value.runId],
    );
    expect(firstAudit.rows[0]?.count).toBe("1");
    const distinctRequestId = `${run.value.runId}:mod-d02-distinct-replay`;
    const distinctReplay = await captureOfflineModD02PreP11({
      ...captureInput, requestId: distinctRequestId,
    });
    expect(distinctReplay).toMatchObject({ newlyWrittenCount: 0, replayedWriteCount: 2 });
    const bothAudits = await client.query<{ count: string }>(
      "select count(*)::text as count from public.audit_events where kind = 'mod-d02-comparison-capture' and target_id = $1",
      [run.value.runId],
    );
    expect(bothAudits.rows[0]?.count).toBe("2");

    const requestAudit = await client.query<{ id: string; metadata: Record<string, unknown> }>(
      "select id, metadata from public.audit_events where kind = 'mod-d02-comparison-capture' and trace_id = $1",
      [captureInput.requestId],
    );
    expect(requestAudit.rows).toHaveLength(1);
    const requestAuditId = requestAudit.rows[0]!.id;
    // Simulate privileged audit-row corruption to prove the fixed-key replay compares every stable field.
    const stableAuditFields: Array<{ column: string; changed: string; original: string | null }> = [
      { column: "organization_id", changed: otherOrganizationId, original: organizationId },
      { column: "project_id", changed: "unexpected-project", original: null },
      { column: "actor_user_id", changed: otherPrincipalId, original: principalId },
      { column: "actor_type", changed: "agent", original: "user" },
      { column: "app", changed: "unexpected-app", original: "release-verification" },
      { column: "kind", changed: "unexpected-kind", original: "mod-d02-comparison-capture" },
      { column: "action", changed: "unexpected-action", original: "capture-pre-activation" },
      { column: "severity", changed: "High", original: "Medium" },
      { column: "target_type", changed: "project", original: "cutover-run" },
      { column: "target_id", changed: "unexpected-target", original: run.value.runId },
      { column: "trace_id", changed: "changed-request-id", original: captureInput.requestId },
    ];
    for (const field of stableAuditFields) {
      await client.query(`update public.audit_events set ${field.column} = $1 where id = $2`, [
        field.changed, requestAuditId,
      ]);
      await expect(directCapture(produced.batch, undefined, captureInput.requestId))
        .rejects.toMatchObject({ code: "23514" });
      await client.query(`update public.audit_events set ${field.column} = $1 where id = $2`, [
        field.original, requestAuditId,
      ]);
    }
    await client.query(
      "update public.audit_events set metadata = jsonb_set(metadata, '{batchDigest}', to_jsonb('sha256:changed'::text)) where id = $1",
      [requestAuditId],
    );
    await expect(directCapture(produced.batch, undefined, captureInput.requestId))
      .rejects.toMatchObject({ code: "23514" });
    await client.query("update public.audit_events set metadata = $1::jsonb where id = $2", [
      JSON.stringify(requestAudit.rows[0]!.metadata), requestAuditId,
    ]);
    expect((await client.query(emptyResultSql, [run.value.runId])).rows).toEqual([
      { cases: "2", results: "2", audits: "2" },
    ]);

    await expect(captureFromUrls("invalid-session-token"))
      .rejects.toThrow("Session is not active");
    expect(await countWrapperConnections()).toBe("0");
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
    expect(unchanged.rows).toEqual([{ results: "2", audits: "2" }]);
    await client.query("update public.auth_sessions set revoked_at = now() where user_id = $1", [principalId]);
    await expect(captureOfflineModD02PreP11(captureInput)).rejects.toThrow("Session is not active");
  } finally {
    await readerDatabase?.close().catch(() => undefined);
    await captureDatabase?.close().catch(() => undefined);
    await captureClient?.end().catch(() => undefined);
    await client.query("alter role wiseeff_mod_d02_source_reader password null").catch(() => undefined);
    await client.query("alter role wiseeff_mod_d02_capture password null").catch(() => undefined);
    await client.end().catch(() => undefined);
    await ownerDatabase.close().catch(() => undefined);
    await fixture.drop().catch(() => undefined);
    await rm(archiveRoot, { recursive: true, force: true });
  }
}, 180_000);
