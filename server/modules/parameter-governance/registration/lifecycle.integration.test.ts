import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../catalog-publication/runtime/provisionRuntimeLogins";
import { CatalogSubjectId, type CatalogReleasePin } from "../../parameter-catalog-contract/index";
import { createGovernanceCatalogQueries } from "../queries/index";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../../../testing/testDatabase";
import { createRegistrationService } from "./service";
import type { RegistrationResult } from "./result";
import { withRegistrationUnitOfWork } from "./unitOfWork";
import { writeGuardedRegistration } from "./internalGuardedRegistrationWriter";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { makeTestAuthContext } from "../../../testing/authContext";

describe("conditional registration lifecycle on the real application SQL LOGIN", () => {
  let database: EphemeralTestDatabase;
  let admin: pg.Pool;
  let api: pg.Pool;
  let pin: CatalogReleasePin;
  let token: string;
  let organizationId: string;
  let moduleId: string;
  let registration: RegistrationResult;
  const context = { actorKind: "org-admin" as const, principalId: "lifecycle-admin" };
  const version = (result: RegistrationResult) => `${result.registrationStatus}:${result.registrationVersion}`;
  const lifecycle = (kind: "retire" | "restore", result = registration) => ({
    kind, organizationId, registrationId: result.registrationId, expectedRelease: pin,
    expectedRegistrationVersion: version(result), idempotencyKey: randomUUID(), context, reason: "lifecycle regression",
  });
  const auditedContext = async (requestId: string) => {
    const userId = `audit-${randomUUID()}`;
    await admin.query("insert into public.users(id,organization_id,name,title,is_active) values ($1,$2,'Lifecycle admin','Admin',true)", [userId, organizationId]);
    return { actorKind: "org-admin" as const, principalId: userId, requestId,
      invocation: createUserInvocation(makeTestAuthContext({ userId, organizationId })) };
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("reglifecycle");
    admin = new pg.Pool({ connectionString: database.url });
    const bundle = validCatalogReleaseBundle();
    const first = { schemaVersion: bundle.schemaVersion, targetReleaseId: bundle.releases[0]!.manifest.release.id, releases: [bundle.releases[0]!] };
    const compiled = compileCatalogRelease(first);
    if (!compiled.ok) throw new Error("lifecycle fixture did not compile");
    const installed = await installPublishedRelease(admin, { mode: "bootstrap", source: jsonCatalogReleaseSource(first), expectedTargetDigest: compiled.value.aggregateDigest });
    expect(installed.ok).toBe(true);
    pin = { id: compiled.value.release.id, digest: compiled.value.release.digest };
    token = `reglife${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: token });
    api = new pg.Pool({ connectionString: runtime.apiUrl, max: 4 });
    expect((await api.query("select session_user, current_user, rolsuper from pg_roles where rolname = current_user")).rows[0])
      .toEqual({ session_user: runtime.apiRole, current_user: runtime.apiRole, rolsuper: false });
  }, 120_000);

  beforeEach(async () => {
    const id = randomUUID();
    organizationId = `org-${id}`;
    moduleId = `mod-${id}`;
    await admin.query("insert into public.organizations(id,name) values ($1,'Lifecycle')", [organizationId]);
    await admin.query(`insert into public.attribution_subjects(id,organization_id,subject_kind,display_name,origin,source_key)
      values ($1,$2,'driver-registration','Driver','curated',$1)`, [`attr-${id}`, organizationId]);
    await admin.query(`insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id)
      values ($1,$2,'Driver',$1,1,'driver-group','curated',$3)`, [moduleId, organizationId, `attr-${id}`]);
    const result = await createRegistrationService(api).execute({ kind: "register", organizationId,
      subjectId: CatalogSubjectId("csub_acme_power"), subjectKind: "driver", expectedRelease: pin,
      placement: { mode: "use-default" }, destinationModuleId: moduleId, method: "explicit",
      proof: {}, idempotencyKey: randomUUID(), context });
    if (!result.ok) throw new Error(`registration failed: ${JSON.stringify(result.error)}`);
    registration = result.value;
  });

  afterAll(async () => {
    await api?.end();
    if (token && database) expect((await dropLabRuntimeLogins(database.url, token)).failed).toEqual([]);
    await admin?.end();
    await database?.drop();
  });

  it("uses one exact read/write ETag and rejects stale or ABA writes while allowing lost-response retries", async () => {
    const service = createRegistrationService(api);
    const query = { organizationId, registrationId: registration.registrationId, observedCatalogReleaseId: pin.id,
      authScope: { organizationId, principalId: context.principalId } };
    const read = await createGovernanceCatalogQueries(api).getRegistration(query);
    expect(read).toMatchObject({ ok: true, value: { etag: `${registration.registrationId}:${version(registration)}` } });
    const retire = lifecycle("retire");
    const retired = await service.execute(retire);
    expect(retired.ok).toBe(true);
    if (!retired.ok) return;
    expect(retired.value.registrationStatus).toBe("retired");
    const { previousRegistrationStatus: _previous, ...replayed } = retired.value;
    expect(await service.execute(retire)).toEqual({ ok: true, value: { ...replayed, outcome: "replayed" } });
    expect(await service.execute({ ...retire, idempotencyKey: randomUUID() }))
      .toMatchObject({ ok: false, error: { kind: "registration-conflict" } });
    expect(await service.execute({ ...retire, expectedRegistrationVersion: version(retired.value) }))
      .toMatchObject({ ok: false, error: { kind: "revision-conflict" } });
    const restored = await service.execute(lifecycle("restore", retired.value));
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.registrationStatus).toBe("active");
    expect(BigInt(restored.value.registrationVersion!)).toBeGreaterThan(BigInt(registration.registrationVersion!));
    expect(await service.execute({ ...retire, idempotencyKey: randomUUID() }))
      .toMatchObject({ ok: false, error: { kind: "registration-conflict" } });
    // A late retry observes the retained current pair; it must never reapply the old retire.
    expect(await service.execute(retire)).toMatchObject({ ok: true, value: { outcome: "replayed", registrationStatus: "active" } });
    expect(await createGovernanceCatalogQueries(api).getRegistration(query))
      .toMatchObject({ ok: true, value: { etag: `${registration.registrationId}:${version(restored.value)}` } });
  });

  it("checks the locked row so two concurrent versions cannot both commit", async () => {
    const service = createRegistrationService(api);
    const results = await Promise.all([service.execute(lifecycle("retire")), service.execute(lifecycle("retire"))]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ ok: false, error: { kind: "registration-conflict" } });
  });

  it("audits the readable reason and actual locked before/after state once with the real user", async () => {
    const service = createRegistrationService(api);
    const actor = await auditedContext("audit-retire");
    const command = { ...lifecycle("retire"), reason: "Remove unused driver", context: actor };
    const retired = await service.execute(command);
    if (!retired.ok) throw new Error(JSON.stringify(retired.error));
    expect((await service.execute(command)).ok).toBe(true);
    const restore = await service.execute({ ...lifecycle("restore", retired.value), reason: "Driver needed again", context: { ...actor, requestId: "audit-restore" } });
    if (!restore.ok) throw new Error(JSON.stringify(restore.error));
    expect(await service.execute({ ...command, idempotencyKey: randomUUID() })).toMatchObject({ ok: false, error: { kind: "registration-conflict" } });
    const events = await api.query(`select actor_user_id, organization_id, action, trace_id,
      metadata->>'reason' as reason, metadata->>'beforeStatus' as before_status, metadata->>'afterStatus' as after_status
      from public.audit_events where target_id=$1 order by created_at,id`, [registration.registrationId]);
    expect(events.rows).toEqual([
      { actor_user_id: actor.principalId, organization_id: organizationId, action: "registration-retire", trace_id: "audit-retire",
        reason: "Remove unused driver", before_status: "active", after_status: "retired" },
      { actor_user_id: actor.principalId, organization_id: organizationId, action: "registration-restore", trace_id: "audit-restore",
        reason: "Driver needed again", before_status: "retired", after_status: "active" },
    ]);
    // An already-active restore is audited as active -> active, never an invented retired state.
    expect((await service.execute({ ...lifecycle("restore", restore.value), context: { ...actor, requestId: "audit-noop" } })).ok).toBe(true);
    expect((await api.query("select metadata->>'beforeStatus' as before_status, metadata->>'afterStatus' as after_status from public.audit_events where trace_id='audit-noop'")).rows)
      .toEqual([{ before_status: "active", after_status: "active" }]);
  });

  it("rolls back lifecycle, idempotency and audit together when audit persistence fails", async () => {
    const command = { ...lifecycle("retire"), context: await auditedContext("audit-injected-failure") };
    await admin.query(`create function public.registration_lifecycle_reject_audit() returns trigger language plpgsql as $$
      begin if new.trace_id='audit-injected-failure' then raise exception 'injected-audit-persistence-failure'; end if; return new; end $$;
      create trigger registration_lifecycle_reject_audit before insert on public.audit_events
      for each row execute function public.registration_lifecycle_reject_audit()`);
    try {
      await expect(createRegistrationService(api).execute(command)).rejects.toThrow("injected-audit-persistence-failure");
      expect((await api.query("select status from parameter_catalog.organization_subject_registrations where id=$1", [registration.registrationId])).rows)
        .toEqual([{ status: "active" }]);
      expect((await api.query("select 1 from parameter_catalog.governance_command_idempotency where organization_id=$1 and idempotency_key=$2", [organizationId, command.idempotencyKey])).rows).toEqual([]);
      expect((await api.query("select 1 from public.audit_events where target_id=$1", [registration.registrationId])).rows).toEqual([]);
    } finally {
      await admin.query("drop trigger registration_lifecycle_reject_audit on public.audit_events; drop function public.registration_lifecycle_reject_audit()");
    }
    expect((await createRegistrationService(api).execute(command)).ok).toBe(true);
    expect((await api.query("select 1 from public.audit_events where target_id=$1", [registration.registrationId])).rows).toHaveLength(1);
  });

  it("rolls back status and reservation on partial failure and keeps cross-organization IDs hidden", async () => {
    const command = lifecycle("retire");
    await expect(withRegistrationUnitOfWork(api, async (client) => {
      expect((await writeGuardedRegistration(client, command)).ok).toBe(true);
      throw new Error("injected-lifecycle-failure");
    })).rejects.toThrow("injected-lifecycle-failure");
    expect((await admin.query("select status from parameter_catalog.organization_subject_registrations where id=$1", [registration.registrationId])).rows[0]?.status).toBe("active");
    expect((await admin.query("select 1 from parameter_catalog.governance_command_idempotency where organization_id=$1 and idempotency_key=$2", [organizationId, command.idempotencyKey])).rowCount).toBe(0);
    const otherOrg = `other-${randomUUID()}`;
    await admin.query("insert into public.organizations(id,name) values ($1,'Other')", [otherOrg]);
    expect(await createRegistrationService(api).execute({ ...command, organizationId: otherOrg }))
      .toMatchObject({ ok: false, error: { kind: "registration-not-found" } });
    expect((await createRegistrationService(api).execute(command)).ok).toBe(true);
  });

  it("restores a retained registration with unset placement after its empty module was deleted", async () => {
    const service = createRegistrationService(api);
    const retired = await service.execute(lifecycle("retire"));
    if (!retired.ok) throw new Error(JSON.stringify(retired.error));
    await admin.query("delete from public.parameter_modules where organization_id=$1 and id=$2", [organizationId, moduleId]);
    const restored = await service.execute(lifecycle("restore", retired.value));
    expect(restored).toMatchObject({ ok: true, value: { registrationStatus: "active", moduleId: null, registrationId: registration.registrationId, placementId: registration.placementId } });
  });

  it("excludes only this organization's retired subjects before definition pagination", async () => {
    const retired = await createRegistrationService(api).execute(lifecycle("retire"));
    expect(retired.ok).toBe(true);
    const queries = createGovernanceCatalogQueries(api);
    const universe = [CatalogSubjectId("csub_acme_power"), CatalogSubjectId("csub_unregistered")];
    const base = { organizationId, registration: "not-retired" as const, catalogSubjectIds: universe,
      authScope: { organizationId, principalId: context.principalId } };
    expect(await queries.selectSubjectIds(base)).toMatchObject({ ok: true, value: { kind: "only", ids: ["csub_unregistered"] } });
    const otherOrg = `other-${randomUUID()}`;
    await admin.query("insert into public.organizations(id,name) values ($1,'Other')", [otherOrg]);
    expect(await queries.selectSubjectIds({ ...base, organizationId: otherOrg, authScope: { ...base.authScope, organizationId: otherOrg } }))
      .toMatchObject({ ok: true, value: { kind: "only", ids: universe } });
    expect(await queries.selectSubjectIds({ ...base, organizationId: otherOrg }))
      .toMatchObject({ ok: false, error: { kind: "not-found", resource: "organization" } });
  });
});
