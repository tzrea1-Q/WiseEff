import { randomUUID } from "node:crypto";
import { createWiseEffServer } from "../../../app";
import { requestJson } from "../../../test/testClient";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { refreshSuccessorSource } from "../../catalog-publication/builder/bundleCodec";
import { createCatalogKernel, jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../catalog-publication/runtime/provisionRuntimeLogins";
import { CatalogReleaseDigest, CatalogSubjectId, DefinitionRevisionId, ParameterDefinitionId, type CatalogReleasePin } from "../../parameter-catalog-contract/index";
import { createGovernanceCatalogQueries } from "../queries/index";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../../../testing/testDatabase";
import { createRegistrationService } from "./service";
import { executeBatchRegistration } from "./batch";
import { listUnregisteredSubjects } from "./readRepository";
import { createEvidenceIngest } from "../evidence";
import { createReviewQueueReader } from "../review";
import { createReviewItemResolver } from "../resolveReviewItem";
import type { RegistrationResult } from "./result";
import { withRegistrationUnitOfWork } from "./unitOfWork";
import { writeGuardedRegistration } from "./internalGuardedRegistrationWriter";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { makeTestAuthContext } from "../../../testing/authContext";
import type { MovePlacementCommand } from "./command";
import { assertCatalogSubjectActive } from "./guardAdapter";
import { createSourceBackedBindingService } from "../../parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import { aggregateBindingDashboardHotspots } from "../../parameter-bindings/dashboardRead";
import { readRegistry } from "../../parameter-modules/repository";
import { createDatabase, createPostgresDatabase } from "../../../shared/database/client";
import { createParameterModuleForAuth, deleteParameterModuleForAuth, moveParameterModuleForAuth, updateParameterModuleForAuth } from "../../parameters/service";
import type { Queryable } from "../../../shared/database/client";
import { lockOrganizationModuleRecognition } from "../../parameter-modules/recognitionLock";
import { lockSourceCatalogGovernance } from "../../parameter-bindings/catalogProjectValueSync";

describe("conditional registration lifecycle on the real application SQL LOGIN", () => {
  let database: EphemeralTestDatabase;
  let admin: pg.Pool;
  let api: pg.Pool;
  let apiDatabase: ReturnType<typeof createPostgresDatabase>;
  let pin: CatalogReleasePin;
  let token: string;
  let organizationId: string;
  let moduleId: string;
  let registration: RegistrationResult;
  let initialBundle: ReturnType<typeof validCatalogReleaseBundle>;
  const targetSubject = CatalogSubjectId("csub_replacement_target");
  const thirdSubject = CatalogSubjectId("csub_replacement_third");
  const emptySubject = CatalogSubjectId("csub_removal_without_definitions");
  const configSubject = CatalogSubjectId("csub_placement_configuration");
  const nodeSubject = CatalogSubjectId("csub_placement_node");
  const ownedNodeSubject = CatalogSubjectId("csub_owned_lifecycle_node");
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
    await admin.query(`insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin)
      values ($1,$2,$3,$1,1,'business','curated')`, [id, organization, name]);
    return id;
  };
  const registerTarget = async (subjectId = targetSubject, destinationModuleId?: string) => {
    const targetModuleId = destinationModuleId ?? await createModule("Target");
    const written = await createRegistrationService(api).execute({ kind: "register", organizationId, subjectId,
      subjectKind: subjectId === nodeSubject ? "node-type" : "driver", expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: targetModuleId,
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
    const extra = [targetSubject, thirdSubject, emptySubject].flatMap((id) => {
      const selector = id === targetSubject ? "acme,replacement-target" : id === thirdSubject ? "acme,replacement-third" : "acme,without-definitions";
      return [
        { ...structuredClone(subject), content: { ...structuredClone(subject.content), id, canonicalKey: `driver:${selector}`,
          selector: { ...structuredClone(subject.content.selector), value: selector } } },
        { ...structuredClone(alias), content: { ...structuredClone(alias.content), id: `alias-${id}`, subjectId: id, normalizedSelector: `${selector}-v1` } },
        ...(id === emptySubject ? [] : [{ ...structuredClone(definition), content: { ...structuredClone(definition.content), id: `pdef_${id}_iin_max`, subjectId: id,
          revision: { ...structuredClone(definition.content.revision), id: `drev_${id}_iin_max_1` } } }]),
      ];
    });
    const configuration = { ...structuredClone(subject), content: { id: configSubject, kind: "configuration-schema" as const,
      canonicalKey: "wiseeff.placement-config", lifecycle: "active" as const,
      selector: { kind: "configuration-schema-id" as const, value: "wiseeff.placement-config", provenance: { source: initial.sources[0]!.path } },
      subtype: {}, tombstone: null } };
    const node = { ...structuredClone(subject), content: { id: nodeSubject, kind: "node-type" as const,
      canonicalKey: "battery1", lifecycle: "active" as const,
      selector: { kind: "node-type-name" as const, value: "battery1", provenance: { source: initial.sources[0]!.path } },
      subtype: {}, tombstone: null } };
    const ownedNode = { ...structuredClone(node), content: { ...structuredClone(node.content), id: ownedNodeSubject,
      canonicalKey: "owned_lifecycle_node", ownerSubjectId: targetSubject,
      selector: { ...structuredClone(node.content.selector), value: "owned_lifecycle_node" } } };
    const release = refreshSuccessorSource({ ...initial, documents: [...initial.documents, ...extra, configuration, node, ownedNode] }, initial.sources[0]!.path);
    const first = { schemaVersion: bundle.schemaVersion, targetReleaseId: release.manifest.release.id, releases: [release] };
    initialBundle = first;
    const compiled = compileCatalogRelease(first);
    if (!compiled.ok) throw new Error("lifecycle fixture did not compile");
    const installed = await installPublishedRelease(admin, { mode: "bootstrap", source: jsonCatalogReleaseSource(first), expectedTargetDigest: compiled.value.aggregateDigest });
    expect(installed.ok).toBe(true);
    pin = { id: compiled.value.release.id, digest: compiled.value.release.digest };
    token = `reglife${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: token });
    api = new pg.Pool({ connectionString: runtime.apiUrl, max: 4 });
    apiDatabase = createPostgresDatabase(runtime.apiUrl);
    expect((await api.query("select session_user, current_user, rolsuper, rolinherit from pg_roles where rolname = current_user")).rows[0])
      .toEqual({ session_user: runtime.apiRole, current_user: runtime.apiRole, rolsuper: false, rolinherit: false });
  }, 120_000);

  beforeEach(async () => {
    const id = randomUUID();
    organizationId = `org-${id}`;
    moduleId = `mod-${id}`;
    await admin.query("insert into public.organizations(id,name) values ($1,'Lifecycle')", [organizationId]);
    await admin.query(`insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin)
      values ($1,$2,'Driver',$1,1,'business','curated')`, [moduleId, organizationId]);
    const result = await createRegistrationService(api).execute({ kind: "register", organizationId,
      subjectId: CatalogSubjectId("csub_acme_power"), subjectKind: "driver", expectedRelease: pin,
      placement: { mode: "use-default" }, destinationModuleId: moduleId, method: "explicit",
      proof: {}, idempotencyKey: randomUUID(), context });
    if (!result.ok) throw new Error(`registration failed: ${JSON.stringify(result.error)}`);
    registration = result.value;
  });

  it("transfers a driver lifecycle with its owned child and preserves the child identity", async () => {
    const userId = `transfer-admin-${randomUUID()}`;
    await admin.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [userId, organizationId]);
    await admin.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ($1,$2,$3,'admin')", [randomUUID(), userId, organizationId]);
    const app = createWiseEffServer({ db: apiDatabase, auth: { mode: "production", verifier: { verify: async () => makeTestAuthContext({ userId, organizationId, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const base = `/api/v2/organizations/${organizationId}/module-structure`;
    let exported = await requestJson(app, `${base}/exports`, { method: "POST", body: "{}" });
    const doc = exported.body as { subjects: Array<{ subjectId: string; operation?: string }>; [key: string]: unknown };
    doc.subjects.push({ subjectId: targetSubject, operation: "register", placement: { kind: "module", moduleRef: moduleId } } as never);
    const run = async (document: unknown, key: string) => {
      const preview = await requestJson(app, `${base}/previews`, { method: "POST", body: JSON.stringify({ document, resolutions: {} }) });
      expect(preview.status, preview.bodyText).toBe(200);
      const result = await requestJson(app, `${base}/applies`, { method: "POST", body: JSON.stringify({ document, resolutions: {}, token: (preview.body as { token: string }).token, idempotencyKey: key, reason: "Reviewed" }) });
      expect(result.status, result.bodyText).toBe(200);
    };
    await run(doc, "child-register");
    const child = (await admin.query<{ id: string }>("select id from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2", [organizationId, ownedNodeSubject])).rows[0]!.id;
    exported = await requestJson(app, `${base}/exports`, { method: "POST", body: "{}" });
    const childEdit = structuredClone(exported.body) as typeof doc;
    childEdit.subjects.find(subject => subject.subjectId === ownedNodeSubject)!.operation = "retire";
    const childPreview = await requestJson(app, `${base}/previews`, { method: "POST", body: JSON.stringify({ document: childEdit, resolutions: {} }) });
    expect(childPreview.status).toBe(409);
    const staleEdit = structuredClone(exported.body) as typeof doc;
    staleEdit.subjects.find(subject => subject.subjectId === targetSubject)!.operation = "retire";
    const stalePreview = await requestJson(app, `${base}/previews`, { method: "POST", body: JSON.stringify({ document: staleEdit, resolutions: {} }) });
    expect(stalePreview.status, stalePreview.bodyText).toBe(200);
    await admin.query("update parameter_catalog.organization_subject_registrations set updated_at=updated_at + interval '1 second' where id=$1", [child]);
    const stale = await requestJson(app, `${base}/applies`, { method: "POST", body: JSON.stringify({ document: staleEdit, resolutions: {}, token: (stalePreview.body as { token: string }).token, idempotencyKey: "stale-child", reason: "Reviewed" }) });
    expect(stale.status).toBe(409);
    for (const operation of ["retire", "restore"] as const) {
      exported = await requestJson(app, `${base}/exports`, { method: "POST", body: "{}" });
      const document = exported.body as typeof doc;
      document.subjects.find(subject => subject.subjectId === targetSubject)!.operation = operation;
      await run(document, `child-${operation}`);
      expect((await admin.query("select id,status,cascade_retired from parameter_catalog.organization_subject_registrations where id=$1", [child])).rows).toEqual([{ id: child, status: operation === "retire" ? "retired" : "active", cascade_retired: operation === "retire" }]);
    }
    await admin.query("update parameter_catalog.organization_subject_registrations set status='retired',cascade_retired=false where id=$1", [child]);
    for (const operation of ["retire", "restore"] as const) {
      exported = await requestJson(app, `${base}/exports`, { method: "POST", body: "{}" });
      const document = exported.body as typeof doc;
      document.subjects.find(subject => subject.subjectId === targetSubject)!.operation = operation;
      await run(document, `historical-${operation}`);
    }
    expect((await admin.query("select status,cascade_retired from parameter_catalog.organization_subject_registrations where id=$1", [child])).rows).toEqual([{ status: "retired", cascade_retired: false }]);
  });

  it("reads effective modules for every registration in the requested organization", async () => {
    const shared = await registerTarget(targetSubject, moduleId);
    const unset = await registerTarget(thirdSubject);
    await admin.query("update parameter_catalog.subject_placements set module_id = null where id = $1", [unset.placementId]);
    const rows = await api.query(`select registration_id, subject_id, module_id, via_owner_registration_id
      from parameter_catalog.registration_effective_module where organization_id = $1 order by registration_id`, [organizationId]);
    expect(rows.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ registration_id: registration.registrationId, module_id: moduleId, via_owner_registration_id: null }),
      expect.objectContaining({ registration_id: shared.registrationId, module_id: moduleId, via_owner_registration_id: null }),
      expect.objectContaining({ registration_id: unset.registrationId, module_id: null, via_owner_registration_id: null }),
      expect.objectContaining({ subject_id: ownedNodeSubject, module_id: moduleId, via_owner_registration_id: shared.registrationId }),
    ]));
    expect(rows.rows).toHaveLength(4);
    expect((await api.query("select * from parameter_catalog.registration_effective_module where organization_id = $1", ["other-org"])).rows).toEqual([]);
  });

  it("rechecks an apparent no-op move after a competing move commits", async () => {
    const parent = await createModule("Parent");
    const child = await createModule("Child");
    const userId = `module-admin-${randomUUID()}`;
    await admin.query("insert into public.users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [userId, organizationId]);
    await admin.query("update public.parameter_modules set parent_id=$1,path=$1||'/'||id,depth=2 where id=$2", [parent, child]);
    const holder = await admin.connect();
    const caller = await api.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`parameter-module-tree:${organizationId}`]);
      await holder.query("update public.parameter_modules set parent_id=null,path=id,depth=1 where id=$1", [child]);
      const pending = moveParameterModuleForAuth(createDatabase(caller as unknown as Queryable),
        makeTestAuthContext({ userId, organizationId }), child, { parentId: parent });
      await new Promise(resolve => setTimeout(resolve, 100));
      await holder.query("commit");
      expect((await pending).parentId).toBe(parent);
      expect((await admin.query("select parent_id from public.parameter_modules where id=$1", [child])).rows[0].parent_id).toBe(parent);
    } finally {
      await holder.query("rollback");
      holder.release();
      caller.release();
    }
  });

  it("serializes opposing moves without committing a cycle", async () => {
    const first = await createModule("First");
    const second = await createModule("Second");
    const userId = `module-admin-${randomUUID()}`;
    await admin.query("insert into public.users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [userId, organizationId]);
    const callers = await Promise.all([api.connect(), api.connect()]);
    try {
      const auth = makeTestAuthContext({ userId, organizationId });
      const results = await Promise.allSettled([
        moveParameterModuleForAuth(createDatabase(callers[0] as unknown as Queryable), auth, first, { parentId: second }),
        moveParameterModuleForAuth(createDatabase(callers[1] as unknown as Queryable), auth, second, { parentId: first }),
      ]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
      const rows = (await admin.query("select id,parent_id from public.parameter_modules where id=any($1::text[])", [[first, second]])).rows;
      expect(rows.filter(row => row.parent_id === null)).toHaveLength(1);
    } finally {
      callers.forEach(client => client.release());
    }
  });

  it("creates a child using its parent's committed path after a competing move", async () => {
    const grandparent = await createModule("Grandparent");
    const parent = await createModule("Parent");
    const userId = `module-admin-${randomUUID()}`;
    await admin.query("insert into public.users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [userId, organizationId]);
    await admin.query("update public.parameter_modules set parent_id=$1,path=$1||'/'||id,depth=2 where id=$2", [grandparent, parent]);
    const holder = await admin.connect();
    const caller = await api.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`parameter-module-tree:${organizationId}`]);
      await holder.query("update public.parameter_modules set parent_id=null,path=id,depth=1 where id=$1", [parent]);
      const pending = createParameterModuleForAuth(createDatabase(caller as unknown as Queryable),
        makeTestAuthContext({ userId, organizationId }), { name: "Child", parentId: parent });
      await new Promise(resolve => setTimeout(resolve, 100));
      await holder.query("commit");
      const created = await pending;
      expect(created.path).toBe(`${parent}/${created.id}`);
    } finally {
      await holder.query("rollback");
      holder.release();
      caller.release();
    }
  });

  it("serializes module creation with organization recognition updates", async () => {
    const userId = `module-admin-${randomUUID()}`;
    await admin.query("insert into public.users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [userId, organizationId]);
    const holder = await api.connect();
    const caller = await api.connect();
    try {
      await holder.query("begin");
      await lockOrganizationModuleRecognition(holder as unknown as Queryable, organizationId);
      const pending = createParameterModuleForAuth(createDatabase(caller as unknown as Queryable),
        makeTestAuthContext({ userId, organizationId }), { name: "Concurrent" });
      const completedWhileLocked = await Promise.race([pending.then(() => true), new Promise<false>(resolve => setTimeout(() => resolve(false), 100))]);
      await holder.query("commit");
      await pending;
      expect(completedWhileLocked).toBe(false);
    } finally {
      await holder.query("rollback");
      holder.release();
      caller.release();
    }
  });

  it.each(["update", "delete"] as const)("serializes module %s with recognition updates", async (operation) => {
    const userId = `module-admin-${randomUUID()}`;
    const target = await createModule("Concurrent");
    await admin.query("insert into public.users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [userId, organizationId]);
    const holder = await api.connect();
    const caller = await api.connect();
    try {
      await holder.query("begin");
      await lockOrganizationModuleRecognition(holder as unknown as Queryable, organizationId);
      const db = createDatabase(caller as unknown as Queryable);
      const auth = makeTestAuthContext({ userId, organizationId });
      const pending = operation === "update" ? updateParameterModuleForAuth(db, auth, target, { name: "Changed" })
        : deleteParameterModuleForAuth(db, auth, target);
      const completedWhileLocked = await Promise.race([pending.then(() => true), new Promise<false>(resolve => setTimeout(() => resolve(false), 100))]);
      await holder.query("commit");
      await pending;
      expect(completedWhileLocked).toBe(false);
    } finally {
      await holder.query("rollback");
      holder.release();
      caller.release();
    }
  });

  it("rolls back a module creation when its audit fails", async () => {
    const userId = `module-admin-${randomUUID()}`;
    const requestId = `reject-module-audit-${randomUUID()}`;
    await admin.query("insert into public.users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [userId, organizationId]);
    await admin.query(`create function public.reject_module_test_audit() returns trigger language plpgsql as $$
      begin if new.trace_id like 'reject-module-audit-%' then raise exception 'module audit failure'; end if; return new; end $$;
      create trigger reject_module_test_audit before insert on public.audit_events for each row execute function public.reject_module_test_audit()`);
    const caller = await api.connect();
    try {
      await expect(createParameterModuleForAuth(createDatabase(caller as unknown as Queryable),
        makeTestAuthContext({ userId, organizationId }), { name: "Rollback" }, { requestId })).rejects.toThrow("module audit failure");
      expect((await admin.query("select id from public.parameter_modules where organization_id=$1 and name='Rollback'", [organizationId])).rows).toEqual([]);
      expect((await admin.query("select id from public.audit_events where trace_id=$1", [requestId])).rows).toEqual([]);
    } finally {
      caller.release();
      await admin.query("drop trigger reject_module_test_audit on public.audit_events; drop function public.reject_module_test_audit()");
    }
  });

  it("registers active owned subjects with their driver", async () => {
    const driver = await registerTarget(targetSubject, moduleId);
    const children = await api.query(`select registration.registration_method, placement.module_id, effective.module_id as effective_module_id,
      effective.via_owner_registration_id
      from parameter_catalog.organization_subject_registrations registration
      join parameter_catalog.subject_placements placement on placement.id=registration.current_placement_id
      join parameter_catalog.registration_effective_module effective on effective.registration_id=registration.id
      where registration.organization_id=$1 and registration.subject_id=$2`, [organizationId, ownedNodeSubject]);
    expect(children.rows).toEqual([{ registration_method: "explicit", module_id: null,
      effective_module_id: moduleId, via_owner_registration_id: driver.registrationId }]);
    const childId = (await api.query<{ id: string }>(`select id from parameter_catalog.organization_subject_registrations
      where organization_id=$1 and subject_id=$2`, [organizationId, ownedNodeSubject])).rows[0]!.id;
    const queries = createGovernanceCatalogQueries(api);
    const query = { organizationId, registrationId: childId, observedCatalogReleaseId: pin.id,
      authScope: { organizationId, principalId: context.principalId } };
    expect(await queries.getRegistration(query)).toMatchObject({ ok: true, value: { ownerSubjectId: targetSubject, structural: true,
      placement: { ownerSubjectId: targetSubject, structural: true, moduleId } } });
    expect(await queries.getPlacement(query)).toMatchObject({ ok: true, value: { ownerSubjectId: targetSubject, structural: true, moduleId } });
  });

  it("lists only unowned subjects for batch registration and audits cascaded children", async () => {
    const listed = await listUnregisteredSubjects(api, organizationId, pin.id, "all");
    expect(listed.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: targetSubject, childCount: 1 })]));
    expect(listed.items.map((item) => item.id)).not.toContain(ownedNodeSubject);
    const actor = await auditedContext("batch-owned");
    const refused = await executeBatchRegistration(api, { organizationId, expectedRelease: pin, idempotencyKey: randomUUID(),
      rows: [{ subjectId: ownedNodeSubject, target: { type: "existing-module", moduleId } }], actorKind: "org-admin",
      principalId: actor.principalId, invocation: actor.invocation, requestId: actor.requestId });
    expect(refused).toMatchObject({ ok: false, error: [{ subjectId: ownedNodeSubject, code: "owned-child", field: "subject" }] });
    const result = await executeBatchRegistration(api, { organizationId, expectedRelease: pin, idempotencyKey: randomUUID(),
      rows: [{ subjectId: targetSubject, target: { type: "existing-module", moduleId }, displayAlias: "设备展示名" }], actorKind: "org-admin",
      principalId: actor.principalId, invocation: actor.invocation, requestId: actor.requestId });
    expect(result.ok).toBe(true);
    expect((await api.query(`select display_alias from parameter_catalog.organization_subject_registrations
      where organization_id=$1 and subject_id=$2`, [organizationId, targetSubject])).rows).toEqual([{ display_alias: "设备展示名" }]);
    const rows = await api.query(`select subject_id,registration_method,proof from parameter_catalog.organization_subject_registrations
      where organization_id=$1 and subject_id in ($2,$3) order by subject_id`, [organizationId, targetSubject, ownedNodeSubject]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].proof).toEqual(rows.rows[1].proof);
    expect(rows.rows.every((row: { registration_method: string }) => row.registration_method === "explicit")).toBe(true);
    const audit = await api.query("select metadata from public.audit_events where trace_id='batch-owned'");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata.cascadedRegistrations).toEqual([expect.objectContaining({ subjectId: ownedNodeSubject })]);
  });

  it("registers and audits owned children when a review resolves to their driver", async () => {
    const actor = await auditedContext("review-owned");
    const reviewContext = { actorKind: "org-admin" as const, principalId: actor.principalId, organizationId };
    const ingested = await createEvidenceIngest(api).ingest({ organizationId, sourceIdentity: `review-${randomUUID()}`,
      catalogReleaseId: pin.id, matcherRevision: "review-owned", matcherOutput: { status: "unknown" }, evidence: { propertyKey: "owned_review" } });
    expect(ingested.ok).toBe(true);
    const listed = await createReviewQueueReader(api).list({ organizationId, capturedRelease: pin, context: reviewContext });
    if (!listed.ok || !listed.value.items[0]) throw new Error("Review item unavailable");
    const item = listed.value.items[0];
    const resolved = await createReviewItemResolver(api).resolve({ resolution: "register-subject", organizationId,
      reviewItemId: item.id, expectedRelease: pin, etag: item.etag, idempotencyKey: randomUUID(), context: reviewContext,
      invocation: actor.invocation, requestId: actor.requestId, reason: item.reason, subjectId: targetSubject, subjectKind: "driver",
      placement: { mode: "use-default" }, destinationModuleId: moduleId, proof: { review: "owned" } });
    expect(resolved.ok).toBe(true);
    const rows = await api.query(`select subject_id,registration_method,proof from parameter_catalog.organization_subject_registrations
      where organization_id=$1 and subject_id in ($2,$3) order by subject_id`, [organizationId, targetSubject, ownedNodeSubject]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((row: { registration_method: string }) => row.registration_method === "review")).toBe(true);
    expect(rows.rows[0].proof).toEqual(rows.rows[1].proof);
    const audit = await api.query("select metadata from public.audit_events where trace_id='review-owned' and action='review-item-resolved'");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata.cascadedRegistrations).toEqual([expect.objectContaining({ subjectId: ownedNodeSubject })]);
  });

  it("automatically registers a proven owned observation and its owner only once", async () => {
    const command = { kind: "register" as const, organizationId, subjectId: ownedNodeSubject, subjectKind: "node-type" as const,
      expectedRelease: pin, placement: { mode: "use-default" as const }, destinationModuleId: moduleId,
      method: "automatic" as const, proof: { ownerSubjectId: targetSubject, source: "observation" },
      idempotencyKey: randomUUID(), context: { actorKind: "trusted-system" as const, principalId: "observation" } };
    const service = createRegistrationService(api);
    const unproven = await service.execute({ ...command, proof: { ownerSubjectId: "wrong-owner" }, idempotencyKey: randomUUID() });
    expect(unproven).toMatchObject({ ok: false, error: { kind: "invalid-command", reason: "请登记其所属驱动" } });
    expect((await api.query(`select id from parameter_catalog.organization_subject_registrations
      where organization_id=$1 and subject_id in ($2,$3)`, [organizationId, targetSubject, ownedNodeSubject])).rows).toEqual([]);
    const first = await service.execute(command);
    expect(first).toMatchObject({ ok: true, value: { subjectId: ownedNodeSubject, moduleId: null, ownerSubjectId: targetSubject, structural: true } });
    const second = await service.execute(command);
    expect(second).toMatchObject({ ok: true, value: { outcome: "replayed", subjectId: ownedNodeSubject } });
    const rows = await api.query(`select subject_id, registration_method from parameter_catalog.organization_subject_registrations
      where organization_id=$1 and subject_id in ($2,$3) order by subject_id`, [organizationId, targetSubject, ownedNodeSubject]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((row: { registration_method: string }) => row.registration_method === "automatic")).toBe(true);
  });

  it("preserves an existing structural child registration while automatically registering its owner", async () => {
    const client = await admin.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      await client.query(`insert into parameter_catalog.organization_subject_registrations
        (id,organization_id,subject_id,status,registration_method,proof,current_placement_id)
        values ('legacy-child-registration',$1,$2,'active','explicit','{}','legacy-child-placement')`, [organizationId, ownedNodeSubject]);
      await client.query(`insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin)
        values ('legacy-child-placement','legacy-child-registration',$1,null,'curated')`, [organizationId]);
      await client.query("commit");
    } finally { await client.query("rollback").catch(() => undefined); client.release(); }
    const result = await createRegistrationService(api).execute({ kind: "register", organizationId, subjectId: ownedNodeSubject,
      subjectKind: "node-type", expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: moduleId,
      method: "automatic", proof: { ownerSubjectId: targetSubject }, idempotencyKey: randomUUID(),
      context: { actorKind: "trusted-system", principalId: "observation" } });
    expect(result).toMatchObject({ ok: true, value: { registrationId: "legacy-child-registration", ownerSubjectId: targetSubject, structural: true } });
    const rows = await api.query(`select subject_id from parameter_catalog.organization_subject_registrations
      where organization_id=$1 and subject_id in ($2,$3)`, [organizationId, targetSubject, ownedNodeSubject]);
    expect(rows.rows).toHaveLength(2);
  });

  it("retires existing active children when their previously unregistered driver is retired", async () => {
    const client = await admin.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      await client.query(`insert into parameter_catalog.organization_subject_registrations
        (id,organization_id,subject_id,status,registration_method,proof,current_placement_id)
        values ('retire-existing-child',$1,$2,'active','explicit','{}','retire-existing-placement')`, [organizationId, ownedNodeSubject]);
      await client.query(`insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin)
        values ('retire-existing-placement','retire-existing-child',$1,null,'curated')`, [organizationId]);
      await client.query("commit");
    } finally { await client.query("rollback").catch(() => undefined); client.release(); }
    const service = createRegistrationService(api);
    const retired = await service.execute({ kind: "retire-unregistered", organizationId, subjectId: targetSubject,
      expectedRelease: pin, idempotencyKey: randomUUID(), context, reason: "driver not used" });
    expect(retired.ok).toBe(true);
    expect((await api.query("select status,cascade_retired from parameter_catalog.organization_subject_registrations where id='retire-existing-child'")).rows)
      .toEqual([{ status: "retired", cascade_retired: true }]);
    if (!retired.ok) return;
    expect((await service.execute(lifecycle("restore", retired.value))).ok).toBe(true);
    expect((await api.query("select status from parameter_catalog.organization_subject_registrations where id='retire-existing-child'")).rows)
      .toEqual([{ status: "active" }]);
  });

  it("registers missing active children when restoring a previously unregistered driver", async () => {
    const service = createRegistrationService(api);
    const auditContext = await auditedContext("restore-missing-child");
    const retired = await service.execute({ kind: "retire-unregistered", organizationId, subjectId: targetSubject,
      expectedRelease: pin, idempotencyKey: randomUUID(), context: auditContext, reason: "driver not used" });
    if (!retired.ok) throw new Error(JSON.stringify(retired.error));
    expect((await service.execute({ ...lifecycle("restore", retired.value), context: auditContext })).ok).toBe(true);
    const rows = await api.query(`select registration.status, placement.module_id
      from parameter_catalog.organization_subject_registrations registration
      join parameter_catalog.subject_placements placement on placement.id=registration.current_placement_id
      where registration.organization_id=$1 and registration.subject_id=$2`, [organizationId, ownedNodeSubject]);
    expect(rows.rows).toEqual([{ status: "active", module_id: null }]);
    expect((await api.query(`select metadata from public.audit_events where organization_id=$1 and action='registration-restore'
      and target_id=$2`, [organizationId, retired.value.registrationId])).rows[0]?.metadata.cascadedRegistrations)
      .toEqual([expect.objectContaining({ subjectId: ownedNodeSubject })]);
  });

  it("serializes concurrent registrations of a driver and its children", async () => {
    const service = createRegistrationService(api);
    const concurrentOrg = `concurrent-${randomUUID()}`;
    await admin.query("insert into public.organizations(id,name) values ($1,'Concurrent')", [concurrentOrg]);
    const concurrentModule = await createModule("Concurrent", concurrentOrg);
    const command = { kind: "register" as const, organizationId: concurrentOrg, subjectId: targetSubject, subjectKind: "driver" as const,
      expectedRelease: pin, placement: { mode: "use-default" as const }, destinationModuleId: concurrentModule,
      method: "explicit" as const, proof: {}, context };
    const results = await Promise.all([service.execute({ ...command, idempotencyKey: randomUUID() }),
      service.execute({ ...command, idempotencyKey: randomUUID() })]);
    expect(results.every((result) => result.ok)).toBe(true);
    const rows = await api.query(`select subject_id from parameter_catalog.organization_subject_registrations
      where organization_id=$1 and subject_id in ($2,$3)`, [concurrentOrg, targetSubject, ownedNodeSubject]);
    expect(rows.rows).toHaveLength(2);
  });

  it("orders batch and single registration before locking destination categories", async () => {
    const actor = await auditedContext("concurrent-batch");
    const [batch, single] = await Promise.all([
      executeBatchRegistration(api, { organizationId, expectedRelease: pin, idempotencyKey: randomUUID(),
        rows: [{ subjectId: targetSubject, target: { type: "existing-module", moduleId } }],
        actorKind: "org-admin", principalId: actor.principalId, invocation: actor.invocation, requestId: actor.requestId }),
      createRegistrationService(api).execute({ kind: "register", organizationId, subjectId: thirdSubject, subjectKind: "driver",
        expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: `single-${randomUUID()}`,
        newDestination: { parentModuleId: moduleId, name: "Single destination" }, method: "explicit", proof: {}, idempotencyKey: randomUUID(), context }),
    ]);
    expect(batch.ok).toBe(true);
    expect(single.ok).toBe(true);
    expect((await api.query(`select id from parameter_catalog.organization_subject_registrations
      where organization_id=$1 and subject_id in ($2,$3,$4)`, [organizationId, targetSubject, thirdSubject, ownedNodeSubject])).rows).toHaveLength(3);
  });

  it("serializes source approvals that register drivers in different organizations", async () => {
    const otherOrganizationId = `source-concurrent-${randomUUID()}`;
    await admin.query("insert into public.organizations(id,name) values ($1,'Concurrent source')", [otherOrganizationId]);
    const otherModuleId = await createModule("Source concurrent", otherOrganizationId);
    const register = (scope: string, destinationModuleId: string) => withRegistrationUnitOfWork(api, async (client) => {
      await lockSourceCatalogGovernance(client as unknown as Queryable, scope);
      return writeGuardedRegistration(client, { kind: "register", organizationId: scope, subjectId: targetSubject,
        subjectKind: "driver", expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId,
        method: "explicit", proof: {}, idempotencyKey: randomUUID(), context });
    });
    const results = await Promise.all([register(organizationId, moduleId), register(otherOrganizationId, otherModuleId)]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect((await admin.query(`select organization_id,count(*)::int as count from parameter_catalog.organization_subject_registrations
      where subject_id in ($1,$2) and organization_id in ($3,$4) group by organization_id order by organization_id`,
    [targetSubject, ownedNodeSubject, organizationId, otherOrganizationId])).rows).toEqual(expect.arrayContaining([
      { organization_id: organizationId, count: 2 }, { organization_id: otherOrganizationId, count: 2 }]));
  });

  it("orders an ordinary registration against a source approval in the same organization", async () => {
    const source = withRegistrationUnitOfWork(api, async (client) => {
      await lockSourceCatalogGovernance(client as unknown as Queryable, organizationId);
      return writeGuardedRegistration(client, { kind: "register", organizationId, subjectId: targetSubject,
        subjectKind: "driver", expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: moduleId,
        method: "explicit", proof: {}, idempotencyKey: randomUUID(), context });
    });
    const ordinary = createRegistrationService(api).execute({ kind: "register", organizationId, subjectId: thirdSubject,
      subjectKind: "driver", expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: moduleId,
      method: "explicit", proof: {}, idempotencyKey: randomUUID(), context });
    expect((await Promise.all([source, ordinary])).every((result) => result.ok)).toBe(true);
  });

  it("replays a cascaded driver registration without changing its result or children", async () => {
    const service = createRegistrationService(api);
    const command = { kind: "register" as const, organizationId, subjectId: targetSubject, subjectKind: "driver" as const,
      expectedRelease: pin, placement: { mode: "use-default" as const }, destinationModuleId: moduleId,
      method: "explicit" as const, proof: {}, idempotencyKey: randomUUID(), context };
    const first = await service.execute(command);
    if (!first.ok) throw new Error(JSON.stringify(first.error));
    expect(await service.execute(command)).toEqual({ ok: true, value: { ...first.value, outcome: "replayed" } });
    expect((await api.query(`select id from parameter_catalog.organization_subject_registrations
      where organization_id=$1 and subject_id=$2`, [organizationId, ownedNodeSubject])).rows).toHaveLength(1);
  });

  it("does not hold the recognition lock while waiting for publication", async () => {
    const publisher = await admin.connect();
    let pending: ReturnType<ReturnType<typeof createRegistrationService>["execute"]> | undefined;
    try {
      await publisher.query("begin");
      await publisher.query("select parameter_catalog.acquire_current_pointer_lock_exclusive()");
      const publisherPid = (await publisher.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      pending = createRegistrationService(api).execute({ kind: "register", organizationId, subjectId: targetSubject, subjectKind: "driver",
        expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: moduleId,
        method: "explicit", proof: {}, idempotencyKey: randomUUID(), context });
      await vi.waitFor(async () => {
        const blocked = await admin.query("select pid from pg_stat_activity where $1=any(pg_blocking_pids(pid))", [publisherPid]);
        expect(blocked.rows.length).toBeGreaterThan(0);
      }, { timeout: 3000, interval: 25 });
      await publisher.query("set local lock_timeout='2s'");
      await lockOrganizationModuleRecognition(publisher as unknown as Queryable, organizationId);
      await publisher.query("commit");
      expect((await pending).ok).toBe(true);
      pending = undefined;
    } finally {
      await publisher.query("rollback").catch(() => undefined);
      if (pending) await pending.catch(() => undefined);
      publisher.release();
    }
  });

  it("moves the driver and inherited reads without writing the child placement", async () => {
    const driver = await registerTarget(targetSubject, moduleId);
    const before = await api.query(`select placement.id,placement.module_id,placement.updated_at::text
      from parameter_catalog.subject_placements placement
      join parameter_catalog.organization_subject_registrations registration on registration.id=placement.registration_id
      where registration.organization_id=$1 and registration.subject_id=$2`, [organizationId, ownedNodeSubject]);
    const destination = await createModule("Inherited destination");
    const moved = await createRegistrationService(api).execute({ kind: "move-placement", organizationId, registrationId: driver.registrationId,
      destinationModuleId: destination, expectedRelease: pin, idempotencyKey: randomUUID(), context });
    expect(moved.ok).toBe(true);
    const after = await api.query(`select placement.id,placement.module_id,placement.updated_at::text
      from parameter_catalog.subject_placements placement
      join parameter_catalog.organization_subject_registrations registration on registration.id=placement.registration_id
      where registration.organization_id=$1 and registration.subject_id=$2`, [organizationId, ownedNodeSubject]);
    expect(after.rows).toEqual(before.rows);
    expect((await api.query(`select module_id,via_owner_registration_id from parameter_catalog.registration_effective_module
      where organization_id=$1 and subject_id=$2`, [organizationId, ownedNodeSubject])).rows)
      .toEqual([{ module_id: destination, via_owner_registration_id: driver.registrationId }]);
  });

  it("retires and restores owned registrations with their driver and refuses direct child operations", async () => {
    const driver = await registerTarget(targetSubject, moduleId);
    const child = (await api.query<{ id: string; current_placement_id: string }>(`select id,current_placement_id
      from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2`, [organizationId, ownedNodeSubject])).rows[0]!;
    const service = createRegistrationService(api);
    const direct = await service.execute({ kind: "register", organizationId, subjectId: ownedNodeSubject, subjectKind: "node-type",
      expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: moduleId, method: "explicit",
      proof: {}, idempotencyKey: randomUUID(), context });
    expect(direct).toMatchObject({ ok: false, error: { kind: "invalid-command", reason: "请登记其所属驱动" } });
    for (const kind of ["retire", "restore"] as const) {
      expect(await service.execute({ ...lifecycle(kind, driver), registrationId: child.id as typeof driver.registrationId,
        expectedRegistrationVersion: undefined })).toMatchObject({ ok: false, error: { kind: "invalid-command" } });
    }
    expect(await service.execute({ kind: "move-placement", organizationId, registrationId: child.id as typeof driver.registrationId,
      destinationModuleId: moduleId, expectedRelease: pin, idempotencyKey: randomUUID(), context }))
      .toMatchObject({ ok: false, error: { kind: "invalid-command" } });
    const retired = await service.execute(lifecycle("retire", driver));
    expect(retired.ok).toBe(true);
    expect((await api.query("select status from parameter_catalog.organization_subject_registrations where id=$1", [child.id])).rows[0]).toEqual({ status: "retired" });
    if (!retired.ok) throw new Error(JSON.stringify(retired.error));
    const restored = await service.execute(lifecycle("restore", retired.value));
    expect(restored.ok).toBe(true);
    expect((await api.query("select status,current_placement_id from parameter_catalog.organization_subject_registrations where id=$1", [child.id])).rows[0])
      .toEqual({ status: "active", current_placement_id: child.current_placement_id });
  });

  it("does not restore a child that was already retired before its driver", async () => {
    const driver = await registerTarget(targetSubject, moduleId);
    await admin.query(`update parameter_catalog.organization_subject_registrations set status='retired'
      where organization_id=$1 and subject_id=$2`, [organizationId, ownedNodeSubject]);
    const service = createRegistrationService(api);
    const retired = await service.execute(lifecycle("retire", driver));
    if (!retired.ok) throw new Error(JSON.stringify(retired.error));
    const restored = await service.execute(lifecycle("restore", retired.value));
    expect(restored.ok).toBe(true);
    expect((await api.query(`select status,cascade_retired from parameter_catalog.organization_subject_registrations
      where organization_id=$1 and subject_id=$2`, [organizationId, ownedNodeSubject])).rows).toEqual([{ status: "retired", cascade_retired: false }]);
  });

  it("groups bindings for two registered subjects in the same business module", async () => {
    const shared = await registerTarget(targetSubject, moduleId);
    await seedBindingValueHistory(registration, "pdef_acme_power_iin_max", "drev_acme_power_iin_max_1");
    await seedBindingValueHistory(shared, `pdef_${targetSubject}_iin_max`, `drev_${targetSubject}_iin_max_1`);
    const db = createPostgresDatabase(database.url);
    try {
      const loaded = await createCatalogKernel(admin).loadPinnedCatalog(pin);
      if (!loaded.ok) throw new Error(JSON.stringify(loaded.error));
      const registry = await readRegistry(db, organizationId, loaded.value, { includeAdminSettings: false });
      expect(registry.modules.find(module => module.id === moduleId)).toMatchObject({ parameterCount: 2, definitionCount: 2 });
      const groups = await aggregateBindingDashboardHotspots(db, { organizationId, projectId: null, dimension: "module",
        windowStart: "2000-01-01T00:00:00.000Z", windowEnd: "2100-01-01T00:00:00.000Z" });
      expect(groups).toEqual([expect.objectContaining({ groupId: moduleId, parameterCount: 2, definitionCount: 2 })]);
    } finally {
      await db.close();
    }
  });

  afterAll(async () => {
    await apiDatabase?.close();
    await api?.end();
    if (token && database) expect((await dropLabRuntimeLogins(database.url, token)).failed).toEqual([]);
    await admin?.end();
    await database?.drop();
  });

  it.each([targetSubject, emptySubject])("removes an unregistered subject locally regardless of definition count (%s)", async (subjectId) => {
    const catalogBefore = (await admin.query("select id,current_revision_id from parameter_catalog.parameter_definitions order by id")).rows;
    const modulesBefore = (await admin.query("select id from public.parameter_modules where organization_id=$1 order by id", [organizationId])).rows;
    const service = createRegistrationService(api);
    const actor = await auditedContext(`unregistered-removal-${subjectId}`);
    const command = { kind: "retire-unregistered" as const, organizationId, subjectId, expectedRelease: pin,
      idempotencyKey: randomUUID(), context: actor, reason: "This organization does not use this subject" };
    const written = await service.execute(command);
    if (!written.ok) throw new Error(JSON.stringify(written.error));
    expect(written.value).toMatchObject({ registrationStatus: "retired", previousRegistrationStatus: "unregistered",
      moduleId: null, subjectId, organizationId, registrationMethod: "explicit" });
    const firstId = written.value.registrationId;
    expect((await service.execute(command))).toMatchObject({ ok: true, value: { outcome: "replayed", registrationId: firstId, registrationStatus: "retired", moduleId: null } });
    expect((await admin.query("select id,current_revision_id from parameter_catalog.parameter_definitions order by id")).rows).toEqual(catalogBefore);
    expect((await admin.query("select id from public.parameter_modules where organization_id=$1 order by id", [organizationId])).rows).toEqual(modulesBefore);
    expect((await api.query("select action,metadata from public.audit_events where trace_id=$1", [actor.requestId])).rows)
      .toEqual([{ action: "registration-retire", metadata: expect.objectContaining({ reason: command.reason, beforeStatus: "unregistered", afterStatus: "retired" }) }]);
    const restored = await service.execute(lifecycle("restore", written.value));
    if (!restored.ok) throw new Error(JSON.stringify(restored.error));
    expect(restored.value).toMatchObject({ registrationId: firstId, registrationStatus: "active", moduleId: null });
    const afterRestore = await placements();
    expect(await service.execute(command)).toMatchObject({ ok: true, value: { registrationId: firstId, registrationStatus: "active" } });
    expect(await placements()).toEqual(afterRestore);
    expect(await service.execute({ ...command, idempotencyKey: randomUUID() })).toMatchObject({ ok: false, error: { kind: "registration-conflict" } });
  });

  it("registers two drivers and a configuration schema into the same business category", async () => {
    const service = createRegistrationService(api);
    const results = await Promise.all([targetSubject, thirdSubject].map((subjectId) => service.execute({
      kind: "register", organizationId, subjectId, subjectKind: "driver", expectedRelease: pin,
      placement: { mode: "use-default" }, destinationModuleId: moduleId, method: "explicit",
      proof: {}, idempotencyKey: randomUUID(), context,
    })));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await service.execute({ kind: "register", organizationId, subjectId: configSubject, subjectKind: "configuration-schema",
      expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: moduleId, method: "explicit",
      proof: {}, idempotencyKey: randomUUID(), context })).toMatchObject({ ok: true });
    expect((await placements()).filter((row) => row.module_id === moduleId)).toHaveLength(4);
  });

  it("moves an unset driver to the business parent of an occupied legacy node and rejects typed or foreign targets", async () => {
    const other = await registerTarget(nodeSubject);
    const typed = `legacy-node-${randomUUID()}`;
    const typedDriver = `legacy-driver-${randomUUID()}`;
    const foreignOrg = `foreign-${randomUUID()}`;
    const foreignModule = `foreign-module-${randomUUID()}`;
    await admin.query(`insert into public.attribution_subjects(id,organization_id,subject_kind,display_name,source_key)
      values ($1,$2,'node-type-definition','Legacy node',$1)`, [`attr-${typed}`, organizationId]);
    await admin.query(`insert into public.parameter_modules(id,organization_id,parent_id,name,path,depth,kind,origin,attribution_subject_id)
      values ($1,$2,$3,'Legacy node',$4,2,'node-type','curated',$5)`, [typed, organizationId, moduleId, `${moduleId}/${typed}`, `attr-${typed}`]);
    await admin.query(`insert into public.attribution_subjects(id,organization_id,subject_kind,display_name,source_key)
      values ($1,$2,'driver-registration','Legacy driver',$1)`, [`attr-${typedDriver}`, organizationId]);
    await admin.query(`insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id)
      values ($1,$2,'Legacy driver',$1,1,'driver-group','curated',$3)`, [typedDriver, organizationId, `attr-${typedDriver}`]);
    await admin.query("insert into public.organizations(id,name) values ($1,'Foreign')", [foreignOrg]);
    await admin.query("insert into public.parameter_modules(id,organization_id,name,path,kind,origin) values ($1,$2,'Foreign',$1,'business','curated')", [foreignModule, foreignOrg]);
    await expect(admin.query("update parameter_catalog.subject_placements set module_id=$2 where id=$1", [other.placementId, typed]))
      .rejects.toMatchObject({ code: "23514", constraint: "subject_placement_kind_ck" });
    await expect(admin.query("update parameter_catalog.subject_placements set module_id=$2 where id=$1", [other.placementId, typedDriver]))
      .rejects.toMatchObject({ code: "23514", constraint: "subject_placement_kind_ck" });
    const client = await admin.connect();
    try {
      await client.query("begin");
      await client.query(`insert into parameter_catalog.organization_subject_registrations
        (id,organization_id,subject_id,status,registration_method,proof,current_placement_id)
        values ($1,$2,$3,'active','explicit','{}'::jsonb,$4)`, ["insert-typed-reg", organizationId, thirdSubject, "insert-typed-placement"]);
      await client.query(`insert into parameter_catalog.subject_placements (id,registration_id,organization_id,module_id,origin)
        values ($1,$2,$3,$4,'curated')`, ["insert-typed-placement", "insert-typed-reg", organizationId, typedDriver]);
      await expect(client.query("set constraints all immediate")).rejects.toMatchObject({ code: "23514", constraint: "subject_placement_kind_ck" });
    } finally {
      await client.query("rollback");
      client.release();
    }
    await expect(admin.query("update parameter_catalog.subject_placements set module_id=$2 where id=$1", [other.placementId, foreignModule])).rejects.toBeDefined();
    // Model a placement retained from before migration 0320.
    await admin.query("alter table parameter_catalog.subject_placements disable trigger subject_placement_kind_ck");
    try {
      await admin.query("update parameter_catalog.subject_placements set module_id=$2 where id=$1", [other.placementId, typed]);
    } finally {
      await admin.query("alter table parameter_catalog.subject_placements enable trigger subject_placement_kind_ck");
    }
    await expect(admin.query("update parameter_catalog.subject_placements set module_id=module_id, origin='auto' where id=$1", [other.placementId])).resolves.toBeDefined();
    await admin.query("update parameter_catalog.subject_placements set module_id=null where id=$1", [registration.placementId]);
    const service = createRegistrationService(api);
    const move = { kind: "move-placement" as const, organizationId, registrationId: registration.registrationId,
      expectedRelease: pin, destinationModuleId: moduleId, idempotencyKey: randomUUID(), context };
    expect(await service.execute({ ...move, destinationModuleId: typed })).toMatchObject({ ok: false, error: { kind: "invalid-placement-parent" } });
    expect(await service.execute({ ...move, destinationModuleId: foreignModule, idempotencyKey: randomUUID() })).toMatchObject({ ok: false, error: { kind: "invalid-placement-parent" } });
    expect(await service.execute(move)).toMatchObject({ ok: true, value: { moduleId } });
    expect((await placements()).find((row) => row.id === other.placementId)?.module_id).toBe(typed);
  });

  it("creates a business category in the same transaction as a placement move", async () => {
    const destination = `new-business-${randomUUID()}`;
    const command = { kind: "move-placement" as const, organizationId, registrationId: registration.registrationId,
      expectedRelease: pin, destinationModuleId: destination, newDestination: { parentModuleId: moduleId, name: "Charging" },
      expectedPlacementVersion: registration.placementVersion, idempotencyKey: randomUUID(), context };
    const service = createRegistrationService(api);
    expect(await service.execute(command)).toMatchObject({ ok: true, value: { moduleId: destination } });
    expect(await service.execute(command)).toMatchObject({ ok: true, value: { outcome: "replayed", moduleId: destination } });
    expect((await admin.query("select kind,parent_id,attribution_subject_id from public.parameter_modules where id=$1", [destination])).rows)
      .toEqual([{ kind: "business", parent_id: moduleId, attribution_subject_id: null }]);
  });

  it("creates a registration category against the committed parent tree", async () => {
    const grandparent = await createModule("Grandparent");
    await admin.query("update public.parameter_modules set parent_id=$1,path=$1||'/'||id,depth=2 where id=$2", [grandparent, moduleId]);
    const holder = await admin.connect();
    const destination = `new-business-${randomUUID()}`;
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`parameter-module-tree:${organizationId}`]);
      await holder.query("update public.parameter_modules set parent_id=null,path=id,depth=1 where id=$1", [moduleId]);
      const pending = createRegistrationService(api).execute({ kind: "move-placement", organizationId,
        registrationId: registration.registrationId, expectedRelease: pin, destinationModuleId: destination,
        newDestination: { parentModuleId: moduleId, name: "Created category" }, idempotencyKey: randomUUID(), context });
      await new Promise(resolve => setTimeout(resolve, 100));
      await holder.query("commit");
      expect(await pending).toMatchObject({ ok: true, value: { moduleId: destination } });
      expect((await admin.query("select path from public.parameter_modules where id=$1", [destination])).rows[0].path)
        .toBe(`${moduleId}/${destination}`);
    } finally {
      await holder.query("rollback");
      holder.release();
    }
  });

  it("keeps other organizations independent, rejects stale releases, and never auto-restores a removed subject", async () => {
    const service = createRegistrationService(api);
    const target = await registerTarget();
    const otherOrganization = `other-${randomUUID()}`;
    await admin.query("insert into public.organizations(id,name) values($1,'Other organization')", [otherOrganization]);
    const command = { kind: "retire-unregistered" as const, organizationId: otherOrganization, subjectId: targetSubject,
      expectedRelease: pin, context, idempotencyKey: randomUUID(), reason: "Not used here" };
    expect(await service.execute({ ...command, expectedRelease: { ...pin, digest: CatalogReleaseDigest(`sha256:${"0".repeat(64)}`) } })).toMatchObject({ ok: false, error: { kind: "release-drift" } });
    expect((await api.query("select id from parameter_catalog.organization_subject_registrations where organization_id=$1", [otherOrganization])).rows).toEqual([]);
    expect(await service.execute(command)).toMatchObject({ ok: true, value: { registrationStatus: "retired", moduleId: null } });
    expect((await api.query("select status from parameter_catalog.organization_subject_registrations where id=$1", [target.registrationId])).rows).toEqual([{ status: "active" }]);
    const otherModule = await createModule("Other", otherOrganization);
    expect(await service.execute({ kind: "register", organizationId: otherOrganization, subjectId: targetSubject, subjectKind: "driver",
      expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: otherModule, method: "automatic", proof: {},
      idempotencyKey: randomUUID(), context: { actorKind: "trusted-system", principalId: "ingest" } }))
      .toMatchObject({ ok: false, error: { kind: "auto-restore-forbidden" } });
  });

  it("serializes concurrent registration and first removal without stopping the winning registration", async () => {
    const service = createRegistrationService(api);
    const emptyOrganizationId = `racing-${randomUUID()}`;
    await admin.query("insert into public.organizations(id,name) values($1,'Empty organization')", [emptyOrganizationId]);
    const destinationModuleId = await createModule("Racing", emptyOrganizationId);
    const outcomes = await Promise.all([
      service.execute({ kind: "register", organizationId: emptyOrganizationId, subjectId: targetSubject, subjectKind: "driver", expectedRelease: pin,
        placement: { mode: "use-default" }, destinationModuleId, method: "explicit", proof: {}, idempotencyKey: randomUUID(), context }),
      service.execute({ kind: "retire-unregistered", organizationId: emptyOrganizationId, subjectId: targetSubject, expectedRelease: pin,
        idempotencyKey: randomUUID(), context, reason: "Not used here" }),
    ]);
    expect(outcomes.filter(result => result.ok)).toHaveLength(1);
    expect(outcomes.filter(result => !result.ok)).toHaveLength(1);
    const winner = outcomes.find(result => result.ok)!;
    if (!winner.ok) throw new Error("No winner");
    expect((await api.query("select id,status from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2", [emptyOrganizationId, targetSubject])).rows)
      .toEqual([{ id: winner.value.registrationId, status: winner.value.registrationStatus }]);
  });

  it("rolls back the initial inactive registration, unset placement and idempotency reservation together", async () => {
    const idempotencyKey = randomUUID();
    const before = await placements();
    await expect(withRegistrationUnitOfWork(api, async (client) => {
      const result = await writeGuardedRegistration(client, { kind: "retire-unregistered", organizationId,
        subjectId: targetSubject, expectedRelease: pin, idempotencyKey, context, reason: "Not used here" });
      expect(result.ok).toBe(true);
      throw new Error("abort unregistered removal before commit");
    })).rejects.toThrow("abort unregistered removal before commit");
    expect(await placements()).toEqual(before);
    expect((await api.query("select id from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2", [organizationId, targetSubject])).rows).toEqual([]);
    expect((await api.query("select state from parameter_catalog.governance_command_idempotency where organization_id=$1 and idempotency_key=$2", [organizationId, idempotencyKey])).rows).toEqual([]);
  });

  it("shares a business module, then atomically replaces the explicitly reviewed occupant without deleting identities", async () => {
    const target = await registerTarget();
    await seedBindingValueHistory(registration, "pdef_acme_power_iin_max", "drev_acme_power_iin_max_1");
    await seedBindingValueHistory(target, `pdef_${targetSubject}_iin_max`, `drev_${targetSubject}_iin_max_1`);
    const preserved = await retainedData();
    expect(preserved.bindings).toHaveLength(2);
    expect(preserved.project_values.length).toBeGreaterThanOrEqual(2);
    expect(preserved.history.length).toBeGreaterThanOrEqual(2);
    expect(preserved.source_pins.length).toBeGreaterThanOrEqual(2);
    const command = replacement(target);
    const service = createRegistrationService(api);
    const shared = await service.execute({ ...command, replacement: undefined });
    expect(shared).toMatchObject({ ok: true, value: { moduleId: target.moduleId } });
    expect((await placements()).filter((row) => row.module_id === target.moduleId)).toHaveLength(2);
    const back = await service.execute({ kind: "move-placement", organizationId, registrationId: registration.registrationId,
      destinationModuleId: moduleId, expectedRelease: pin, idempotencyKey: randomUUID(), context });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const actor = await auditedContext("audit-replace-placement");
    const audited = { ...command, expectedPlacementVersion: back.value.placementVersion, context: actor, idempotencyKey: randomUUID() };
    const written = await service.execute(audited);
    if (!written.ok) throw new Error(JSON.stringify(written.error));
    expect(written.value).toMatchObject({ registrationId: registration.registrationId, placementId: registration.placementId,
      moduleId: target.moduleId, replacement: { registrationId: target.registrationId, placementId: target.placementId,
        subjectId: targetSubject, previousModuleId: target.moduleId, previousSourceModuleId: moduleId,
        moduleId: null, registrationStatus: "active" } });
    const after = await placements();
    expect(after).toHaveLength(3);
    expect(after.filter((row) => row.module_id === null)).toHaveLength(2);
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
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.module_id === null)).toHaveLength(2);
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

  it("does not restore a cascade-retired child whose release membership was retired", async () => {
    const userId = `catalog-drift-admin-${randomUUID()}`;
    await admin.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [userId, organizationId]);
    await admin.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ($1,$2,$3,'admin')", [randomUUID(), userId, organizationId]);
    const app = createWiseEffServer({ db: apiDatabase, auth: { mode: "production", verifier: { verify: async () => makeTestAuthContext({ userId, organizationId, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const path = `/api/v2/organizations/${organizationId}/module-structure`;
    const exported = await requestJson(app, `${path}/exports`, { method: "POST", body: "{}" });
    expect(exported.status, exported.bodyText).toBe(200);
    const document = exported.body as { subjects: unknown[]; [key: string]: unknown };
    document.subjects.push({ subjectId: nodeSubject, operation: "register", placement: { kind: "module", moduleRef: moduleId } });
    const preview = await requestJson(app, `${path}/previews`, { method: "POST", body: JSON.stringify({ document, resolutions: {} }) });
    expect(preview.status, preview.bodyText).toBe(200);
    const driver = await registerTarget(targetSubject, moduleId);
    const service = createRegistrationService(api);
    const retired = await service.execute(lifecycle("retire", driver));
    if (!retired.ok) throw new Error(JSON.stringify(retired.error));
    const base = initialBundle.releases[0]!;
    const nextId = "crel_owned_retired";
    const childDocument = base.documents.find((document) => document.kind === "subject" && document.content.id === ownedNodeSubject);
    if (!childDocument || childDocument.kind !== "subject") throw new Error("missing owned child fixture");
    const addedChild = { ...structuredClone(childDocument), content: { ...structuredClone(childDocument.content),
      id: "csub_owned_added_while_retired", canonicalKey: "owned_added_while_retired",
      selector: { ...structuredClone(childDocument.content.selector), value: "owned_added_while_retired" } } };
    const next = refreshSuccessorSource({ ...structuredClone(base), manifest: { ...structuredClone(base.manifest),
      release: { ...base.manifest.release, id: nextId, version: "1.2.0", sequence: 2,
        publishedAt: "2026-09-02T00:00:00Z", predecessor: { id: pin.id, digest: pin.digest } } },
    documents: [...base.documents.map((document) => document.kind === "subject" && (document.content.id === ownedNodeSubject || document.content.id === nodeSubject) ? {
      ...structuredClone(document), content: { ...structuredClone(document.content), lifecycle: "retired" as const,
        tombstone: { reason: "withdrawn", withdrawnByReleaseId: nextId, previousSelector: document.content.id === nodeSubject ? "battery1" : "owned_lifecycle_node" } },
    } : structuredClone(document)), addedChild] }, base.sources[0]!.path);
    const bundle = { ...initialBundle, targetReleaseId: nextId, releases: [base, next] };
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    const installed = await installPublishedRelease(admin, { mode: "advance", source: jsonCatalogReleaseSource(bundle),
      expectedCurrent: pin, expectedTargetDigest: compiled.value.aggregateDigest });
    if (!installed.ok) throw new Error(JSON.stringify(installed.error));
    const stale = await requestJson(app, `${path}/applies`, { method: "POST", body: JSON.stringify({ document, resolutions: {}, token: (preview.body as { token: string }).token, idempotencyKey: "retired-catalog-subject", reason: "Reviewed" }) });
    expect(stale.status).toBe(409);
    const currentPreview = await requestJson(app, `${path}/previews`, { method: "POST", body: JSON.stringify({ document, resolutions: {} }) });
    expect(currentPreview.status).toBe(409);
    expect((await admin.query("select id from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2", [organizationId, nodeSubject])).rowCount).toBe(0);
    const restored = await service.execute({ ...lifecycle("restore", retired.value), expectedRelease: { id: compiled.value.release.id, digest: compiled.value.release.digest } });
    expect(restored.ok).toBe(true);
    expect((await api.query(`select status,cascade_retired from parameter_catalog.organization_subject_registrations
      where organization_id=$1 and subject_id=$2`, [organizationId, ownedNodeSubject])).rows).toEqual([{ status: "retired", cascade_retired: true }]);
    expect((await api.query(`select registration.status,placement.module_id from parameter_catalog.organization_subject_registrations registration
      join parameter_catalog.subject_placements placement on placement.id=registration.current_placement_id
      where registration.organization_id=$1 and registration.subject_id='csub_owned_added_while_retired'`, [organizationId])).rows)
      .toEqual([{ status: "active", module_id: null }]);
  });
});
