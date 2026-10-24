import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { refreshSuccessorSource } from "../../catalog-publication/builder/bundleCodec";
import { createCatalogKernel, jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../catalog-publication/runtime/provisionRuntimeLogins";
import { CatalogSubjectId, DefinitionRevisionId, ParameterDefinitionId, type CatalogReleasePin } from "../../parameter-catalog-contract/index";
import { createGovernanceCatalogQueries } from "../queries/index";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../../../testing/testDatabase";
import { createRegistrationService } from "./service";
import type { RegistrationResult } from "./result";
import { withRegistrationUnitOfWork } from "./unitOfWork";
import { writeGuardedRegistration } from "./internalGuardedRegistrationWriter";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { makeTestAuthContext } from "../../../testing/authContext";
import type { MovePlacementCommand } from "./command";
import { assertCatalogSubjectActive } from "./guardAdapter";
import { createSourceBackedBindingService } from "../../parameter-bindings/binding/__fixtures__/sourceBackedBinding";

describe("conditional registration lifecycle on the real application SQL LOGIN", () => {
  let database: EphemeralTestDatabase;
  let admin: pg.Pool;
  let api: pg.Pool;
  let pin: CatalogReleasePin;
  let token: string;
  let organizationId: string;
  let moduleId: string;
  let registration: RegistrationResult;
  const targetSubject = CatalogSubjectId("csub_replacement_target");
  const thirdSubject = CatalogSubjectId("csub_replacement_third");
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
  const createModule = async (name: string, organization = organizationId) => {
    const id = `${name}-${randomUUID()}`;
    await admin.query(`insert into public.attribution_subjects(id,organization_id,subject_kind,display_name,origin,source_key)
      values ($1,$2,'driver-registration',$3,'curated',$1)`, [`attr-${id}`, organization, name]);
    await admin.query(`insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id)
      values ($1,$2,$3,$1,1,'driver-group','curated',$4)`, [id, organization, name, `attr-${id}`]);
    return id;
  };
  const registerTarget = async (subjectId = targetSubject, destinationModuleId?: string) => {
    const targetModuleId = destinationModuleId ?? await createModule("Target");
    const written = await createRegistrationService(api).execute({ kind: "register", organizationId, subjectId,
      subjectKind: "driver", expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: targetModuleId,
      method: "explicit", proof: {}, idempotencyKey: randomUUID(), context });
    if (!written.ok) throw new Error(JSON.stringify(written.error));
    return written.value;
  };
  const replacement = (target: RegistrationResult, source = registration): MovePlacementCommand => ({
    kind: "move-placement", organizationId, registrationId: source.registrationId, destinationModuleId: target.moduleId!,
    expectedRelease: pin, expectedPlacementVersion: source.placementVersion, idempotencyKey: randomUUID(), context,
    replacement: { registrationId: target.registrationId, placementId: target.placementId,
      expectedPlacementVersion: target.placementVersion!, expectedRegistrationVersion: version(target), reason: "Correct mixed subject ownership" },
  });
  const placements = async () => (await admin.query(`select id,registration_id,module_id,origin,updated_at::text
    from parameter_catalog.subject_placements where organization_id=$1 order by id`, [organizationId])).rows;
  const seedBindingValueHistory = async (owner: RegistrationResult, definitionId: string, revisionId: string) => {
    const project = `replacement-project-${randomUUID()}`;
    await admin.query("insert into public.projects(id,organization_id,name,code) values($1,$2,'Replacement preservation',$3)", [project, organizationId, `RP${randomUUID().slice(0, 8)}`]);
    const loaded = await createCatalogKernel(admin).loadCurrentCatalog(pin);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.error));
    const bound = await createSourceBackedBindingService(admin, { initialPayload: { kind: "number", value: 5 } }).stabilize({
      snapshot: loaded.value, organizationId, projectId: project, logicalNodeId: `replacement-${randomUUID()}`,
      registrationId: owner.registrationId, definitionId: ParameterDefinitionId(definitionId),
      effectiveRevisionId: DefinitionRevisionId(revisionId), expectedEffectiveRevisionId: null,
    });
    if (!bound.ok) throw new Error(JSON.stringify(bound.error));
  };
  const retainedData = async () => (await admin.query(`with owned as (
      select * from parameter_catalog.project_parameter_bindings where organization_id=$1
    ) select
      (select coalesce(jsonb_agg(to_jsonb(binding) order by binding.id),'[]') from owned binding) as bindings,
      (select coalesce(jsonb_agg(to_jsonb(value) order by value.id),'[]')
         from parameter_catalog.project_parameter_values value join owned binding on binding.id=value.binding_id) as project_values,
      (select coalesce(jsonb_agg(to_jsonb(history) order by history.id),'[]')
         from parameter_catalog.binding_history_events history join owned binding on binding.id=history.binding_id) as history,
      (select coalesce(jsonb_agg(to_jsonb(pin) order by pin.id),'[]')
         from parameter_catalog.project_value_source_pins pin join owned binding on binding.id=pin.binding_id) as source_pins`,
    [organizationId])).rows[0];

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("reglifecycle");
    admin = new pg.Pool({ connectionString: database.url });
    const bundle = validCatalogReleaseBundle();
    const initial = structuredClone(bundle.releases[0]!);
    const subject = initial.documents.find((document) => document.kind === "subject");
    const alias = initial.documents.find((document) => document.kind === "alias");
    const definition = initial.documents.find((document) => document.kind === "definition");
    if (subject?.kind !== "subject" || alias?.kind !== "alias" || definition?.kind !== "definition") throw new Error("replacement fixture requires its Subject, alias and Definition");
    const extra = [targetSubject, thirdSubject].flatMap((id) => {
      const selector = id === targetSubject ? "acme,replacement-target" : "acme,replacement-third";
      return [
        { ...structuredClone(subject), content: { ...structuredClone(subject.content), id, canonicalKey: `driver:${selector}`,
          selector: { ...structuredClone(subject.content.selector), value: selector } } },
        { ...structuredClone(alias), content: { ...structuredClone(alias.content), id: `alias-${id}`, subjectId: id, normalizedSelector: `${selector}-v1` } },
        { ...structuredClone(definition), content: { ...structuredClone(definition.content), id: `pdef_${id}_iin_max`, subjectId: id,
          revision: { ...structuredClone(definition.content.revision), id: `drev_${id}_iin_max_1` } } },
      ];
    });
    const release = refreshSuccessorSource({ ...initial, documents: [...initial.documents, ...extra] }, initial.sources[0]!.path);
    const first = { schemaVersion: bundle.schemaVersion, targetReleaseId: release.manifest.release.id, releases: [release] };
    const compiled = compileCatalogRelease(first);
    if (!compiled.ok) throw new Error("lifecycle fixture did not compile");
    const installed = await installPublishedRelease(admin, { mode: "bootstrap", source: jsonCatalogReleaseSource(first), expectedTargetDigest: compiled.value.aggregateDigest });
    expect(installed.ok).toBe(true);
    pin = { id: compiled.value.release.id, digest: compiled.value.release.digest };
    token = `reglife${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: token });
    api = new pg.Pool({ connectionString: runtime.apiUrl, max: 4 });
    expect((await api.query("select session_user, current_user, rolsuper, rolinherit from pg_roles where rolname = current_user")).rows[0])
      .toEqual({ session_user: runtime.apiRole, current_user: runtime.apiRole, rolsuper: false, rolinherit: false });
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

  it("refuses occupied moves, then atomically replaces the explicitly reviewed occupant without swapping or deleting identities", async () => {
    const target = await registerTarget();
    await seedBindingValueHistory(registration, "pdef_acme_power_iin_max", "drev_acme_power_iin_max_1");
    await seedBindingValueHistory(target, `pdef_${targetSubject}_iin_max`, `drev_${targetSubject}_iin_max_1`);
    const preserved = await retainedData();
    expect(preserved.bindings).toHaveLength(2);
    expect(preserved.project_values.length).toBeGreaterThanOrEqual(2);
    expect(preserved.history.length).toBeGreaterThanOrEqual(2);
    expect(preserved.source_pins.length).toBeGreaterThanOrEqual(2);
    const command = replacement(target);
    const before = await placements();
    const service = createRegistrationService(api);
    expect(await service.execute({ ...command, replacement: undefined }))
      .toMatchObject({ ok: false, error: { kind: "placement-occupied" } });
    expect(await placements()).toEqual(before);
    const actor = await auditedContext("audit-replace-placement");
    const audited = { ...command, context: actor };
    const written = await service.execute(audited);
    if (!written.ok) throw new Error(JSON.stringify(written.error));
    expect(written.value).toMatchObject({ registrationId: registration.registrationId, placementId: registration.placementId,
      moduleId: target.moduleId, replacement: { registrationId: target.registrationId, placementId: target.placementId,
        subjectId: targetSubject, previousModuleId: target.moduleId, previousSourceModuleId: moduleId,
        moduleId: null, registrationStatus: "active" } });
    const after = await placements();
    expect(after).toHaveLength(2);
    expect(after.find((row) => row.registration_id === target.registrationId)).toMatchObject({ id: target.placementId, module_id: null });
    expect(after.find((row) => row.registration_id === registration.registrationId)).toMatchObject({ id: registration.placementId, module_id: target.moduleId });
    expect((await api.query("select id,status,current_placement_id from parameter_catalog.organization_subject_registrations where organization_id=$1 order by id", [organizationId])).rows)
      .toEqual(expect.arrayContaining([
        { id: registration.registrationId, status: "active", current_placement_id: registration.placementId },
        { id: target.registrationId, status: "active", current_placement_id: target.placementId },
      ]));
    expect((await api.query("select 1 from parameter_catalog.subject_placements where organization_id=$1 and module_id=$2", [organizationId, moduleId])).rows).toHaveLength(0);
    expect(await service.execute(audited)).toEqual({ ok: true, value: { ...written.value, outcome: "replayed" } });
    expect(await retainedData()).toEqual(preserved);
    const events = await api.query("select actor_user_id,action,trace_id,metadata from public.audit_events where trace_id='audit-replace-placement'");
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({ actor_user_id: actor.principalId, action: "registration-replace-placement",
      trace_id: "audit-replace-placement", metadata: { reason: command.replacement!.reason,
        source: { beforeModuleId: moduleId, afterModuleId: target.moduleId },
        displaced: { registrationId: target.registrationId, previousModuleId: target.moduleId, moduleId: null } } });
  });

  it("rejects stale source, target and lifecycle previews, cross-organization occupants and changed occupancy without partial writes", async () => {
    const service = createRegistrationService(api);
    const target = await registerTarget();
    const command = replacement(target);
    const before = await placements();
    const otherOrganization = `foreign-${randomUUID()}`;
    await admin.query("insert into public.organizations(id,name) values ($1,'Foreign replacement')", [otherOrganization]);
    const foreignModule = await createModule("Foreign", otherOrganization);
    const foreign = await service.execute({ kind: "register", organizationId: otherOrganization, subjectId: targetSubject,
      subjectKind: "driver", expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: foreignModule,
      method: "explicit", proof: {}, idempotencyKey: randomUUID(), context });
    if (!foreign.ok) throw new Error(JSON.stringify(foreign.error));
    for (const bad of [
      { ...command, expectedPlacementVersion: (BigInt(command.expectedPlacementVersion!) - 1n).toString() },
      { ...command, replacement: { ...command.replacement!, expectedPlacementVersion: "1" } },
      { ...command, replacement: { ...command.replacement!, expectedRegistrationVersion: `retired:${target.registrationVersion}` } },
      { ...command, replacement: { ...command.replacement!, registrationId: foreign.value.registrationId,
        placementId: foreign.value.placementId, expectedPlacementVersion: foreign.value.placementVersion!,
        expectedRegistrationVersion: version(foreign.value) } },
    ]) {
      expect(await service.execute({ ...bad, idempotencyKey: randomUUID() })).toMatchObject({ ok: false });
      expect(await placements()).toEqual(before);
    }
    expect((await admin.query("select module_id from parameter_catalog.subject_placements where id=$1", [foreign.value.placementId])).rows)
      .toEqual([{ module_id: foreignModule }]);
    const free = await createModule("Free");
    const moved = await service.execute({ kind: "move-placement", organizationId, registrationId: target.registrationId,
      destinationModuleId: free, expectedRelease: pin, expectedPlacementVersion: target.placementVersion,
      idempotencyKey: randomUUID(), context });
    expect(moved.ok).toBe(true);
    const newOccupant = await registerTarget(thirdSubject, target.moduleId!);
    const changed = await placements();
    expect(await service.execute(command)).toMatchObject({ ok: false, error: { kind: "placement-conflict" } });
    expect(await placements()).toEqual(changed);
    expect((await api.query("select module_id from parameter_catalog.subject_placements where id=$1", [newOccupant.placementId])).rows)
      .toEqual([{ module_id: target.moduleId }]);
  });

  it("replays the first replacement after later moves without touching a new occupant", async () => {
    const service = createRegistrationService(api);
    const target = await registerTarget();
    const command = replacement(target);
    const first = await service.execute(command);
    if (!first.ok) throw new Error(JSON.stringify(first.error));
    const moved = await service.execute({ ...command, replacement: undefined, expectedPlacementVersion: first.value.placementVersion,
      destinationModuleId: moduleId, idempotencyKey: randomUUID() });
    expect(moved.ok).toBe(true);
    await registerTarget(thirdSubject, target.moduleId!);
    const before = await placements();
    expect(await service.execute(command)).toEqual({ ok: true, value: { ...first.value, outcome: "replayed" } });
    expect(await placements()).toEqual(before);
    expect(await service.execute({ ...command, replacement: { ...command.replacement!, reason: "Changed confirmation" } }))
      .toMatchObject({ ok: false, error: { kind: "revision-conflict" } });
  });

  it("allows the displaced active subject to be explicitly assigned again from unset", async () => {
    const target = await registerTarget();
    const service = createRegistrationService(api);
    const first = await service.execute(replacement(target));
    if (!first.ok) throw new Error(JSON.stringify(first.error));
    const unassigned = { ...target, moduleId: null, placementVersion: first.value.replacement!.placementVersion };
    const next = await service.execute(replacement(first.value, unassigned));
    expect(next).toMatchObject({ ok: true, value: { registrationId: target.registrationId, placementId: target.placementId,
      moduleId: target.moduleId, replacement: { registrationId: registration.registrationId, moduleId: null, previousSourceModuleId: null } } });
    expect((await placements()).find((row) => row.registration_id === registration.registrationId)?.module_id).toBeNull();
    expect((await placements()).find((row) => row.registration_id === target.registrationId)?.module_id).toBe(target.moduleId);
  });

  it("serializes opposing replacements without exposing an intermediate detach", async () => {
    const target = await registerTarget();
    const service = createRegistrationService(api);
    const results = await Promise.all([service.execute(replacement(target)), service.execute(replacement(registration, target))]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ ok: false, error: { kind: "placement-conflict" } });
    const failed = results.find((result) => !result.ok);
    if (failed && !failed.ok && failed.error.kind === "placement-conflict") {
      expect([registration.placementId, target.placementId]).toContain(failed.error.placementId);
    }
    const rows = await placements();
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.module_id === null)).toHaveLength(1);
    expect(rows.filter((row) => row.module_id !== null)).toHaveLength(1);
  });

  it("orders an ordinary move against a replacement using the same source version", async () => {
    const target = await registerTarget();
    const free = await createModule("Concurrent free");
    const command = replacement(target);
    const service = createRegistrationService(api);
    const results = await Promise.all([
      service.execute(command),
      service.execute({ ...command, replacement: undefined, destinationModuleId: free, idempotencyKey: randomUUID() }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const failed = results.find((result) => !result.ok);
    expect(failed).toMatchObject({ ok: false, error: { kind: "placement-conflict", placementId: registration.placementId } });
    const rows = await placements();
    const source = rows.find((row) => row.registration_id === registration.registrationId);
    const displaced = rows.find((row) => row.registration_id === target.registrationId);
    if (results[0].ok) {
      expect(source?.module_id).toBe(target.moduleId);
      expect(displaced?.module_id).toBeNull();
    } else {
      expect(source?.module_id).toBe(free);
      expect(displaced?.module_id).toBe(target.moduleId);
    }
  });

  it("refuses a target deleted after preview and never silently turns a replacement into a move", async () => {
    const target = await registerTarget();
    const command = replacement(target);
    await admin.query("delete from public.parameter_modules where organization_id=$1 and id=$2", [organizationId, target.moduleId]);
    const before = await placements();
    expect(await createRegistrationService(api).execute(command)).toMatchObject({ ok: false, error: { kind: "invalid-placement-parent" } });
    expect(await placements()).toEqual(before);
  });

  it("retains a retired target's lifecycle and rejects an outdated active lifecycle confirmation", async () => {
    const target = await registerTarget();
    const command = replacement(target);
    const service = createRegistrationService(api);
    const retired = await service.execute(lifecycle("retire", target));
    if (!retired.ok) throw new Error(JSON.stringify(retired.error));
    const before = await placements();
    expect(await service.execute(command)).toMatchObject({ ok: false, error: { kind: "placement-conflict" } });
    expect(await placements()).toEqual(before);
    const confirmed = await service.execute(replacement(retired.value));
    expect(confirmed).toMatchObject({ ok: true, value: { replacement: { registrationStatus: "retired", moduleId: null } } });
    expect((await api.query("select status,current_placement_id from parameter_catalog.organization_subject_registrations where id=$1", [target.registrationId])).rows)
      .toEqual([{ status: "retired", current_placement_id: target.placementId }]);
  });

  it("invalidates the displaced placement's version monotonically even when its saved clock is ahead", async () => {
    const target = await registerTarget();
    const future = await admin.query<{ version: string }>(`update parameter_catalog.subject_placements
      set updated_at=clock_timestamp()+interval '1 day' where id=$1
      returning (extract(epoch from updated_at)*1000000)::bigint::text as version`, [target.placementId]);
    const expected = future.rows[0]!.version;
    const result = await createRegistrationService(api).execute(replacement({ ...target, placementVersion: expected }));
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(BigInt(result.value.replacement!.placementVersion)).toBeGreaterThan(BigInt(expected));
  });

  it("rolls back both placements, idempotency and audit when replacement audit fails", async () => {
    const target = await registerTarget();
    const command = { ...replacement(target), context: await auditedContext("audit-replacement-failure") };
    const before = await placements();
    await admin.query(`create function public.registration_replacement_reject_audit() returns trigger language plpgsql as $$
      begin if new.trace_id='audit-replacement-failure' then raise exception 'replacement-audit-failure'; end if; return new; end $$;
      create trigger registration_replacement_reject_audit before insert on public.audit_events
      for each row execute function public.registration_replacement_reject_audit()`);
    try {
      await expect(createRegistrationService(api).execute(command)).rejects.toThrow("replacement-audit-failure");
      expect(await placements()).toEqual(before);
      expect((await api.query("select 1 from parameter_catalog.governance_command_idempotency where organization_id=$1 and idempotency_key=$2", [organizationId, command.idempotencyKey])).rows).toEqual([]);
      expect((await api.query("select 1 from public.audit_events where trace_id='audit-replacement-failure'")).rows).toEqual([]);
    } finally {
      await admin.query("drop trigger registration_replacement_reject_audit on public.audit_events; drop function public.registration_replacement_reject_audit()");
    }
    expect((await createRegistrationService(api).execute(command)).ok).toBe(true);
  });

  it("keeps the current release fence until commit and restores the real SQL caller role", async () => {
    const client = await api.connect();
    const observer = await admin.connect();
    try {
      await client.query("begin");
      const original = (await client.query("select current_user as role")).rows[0].role;
      expect(await assertCatalogSubjectActive(client, pin, registration.subjectId)).toEqual({ ok: true, value: true });
      expect((await client.query("select current_user as role")).rows[0].role).toBe(original);
      await observer.query("begin");
      expect((await observer.query("select pg_try_advisory_xact_lock(688004000041::bigint) as acquired")).rows[0].acquired).toBe(false);
      await observer.query("rollback");
      await client.query("commit");
      await observer.query("begin");
      expect((await observer.query("select pg_try_advisory_xact_lock(688004000041::bigint) as acquired")).rows[0].acquired).toBe(true);
    } finally {
      await client.query("rollback").catch(() => undefined);
      await observer.query("rollback").catch(() => undefined);
      client.release(); observer.release();
    }
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
