import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../../../testing/testDatabase";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { firstAcmePredecessor, frozenPageIdentity, integerContent } from "../../catalog-publication/builder/predecessorHarness";
import { buildCompleteSuccessor } from "../../catalog-publication/builder/completeSuccessor";
import { refreshSuccessorSource } from "../../catalog-publication/builder/bundleCodec";
import { compileCatalogRelease } from "../compiler";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../catalog-publication/runtime/provisionRuntimeLogins";
import { createCatalogKernel, jsonCatalogReleaseSource, CatalogSubjectId, DriverCompatible, NormalizedNodeTypeName } from "../interface";
import { installPublishedRelease } from "../install/installer";
import { listOrganizationOwnedSubjects, readCatalogSubjectOwner, readOrganizationSubjectOwner } from "../ownerSchema";
import { createRegistrationService } from "../../parameter-governance/registration/service";
import { loadOrganizationCatalogSnapshot } from "../../parameter-modules/recognitionSettings";
import { lockOrganizationModuleRecognition } from "../../parameter-modules/recognitionLock";
import { createGovernanceCatalogQueries } from "../../parameter-governance/queries";
import { mapCatalogSubject } from "../../parameter-catalog-api/read/dto";
import { createSourceBackedBindingService } from "../../parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import { readCurrentManagedSourceBindingIds } from "../../parameter-bindings/queries/currentManagedBindings";
import { CatalogReleaseDigest, ParameterDefinitionId, DefinitionRevisionId, SubjectRegistrationId, type CatalogReleasePin } from "../../parameter-catalog-contract";

describe("organization child ownership on the application SQL login", () => {
  let database: EphemeralTestDatabase;
  let admin: pg.Pool;
  let api: pg.Pool;
  let db: ReturnType<typeof createPostgresDatabase>;
  let token: string;
  let pin: CatalogReleasePin;
  let organizationId: string;
  let childRegistrationId: string;
  const source = "csub_acme_power", target = "organization-owner-target", child = "organization-owned-child";
  const sibling = "organization-sibling";
  const context = { actorKind: "org-admin" as const, principalId: "organization-owner-admin" };
  const register = async (org: string, subjectId: string) => {
    const moduleId = `${org}-${subjectId}`;
    await admin.query(`insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin)
      values ($1,$2,$1,$1,1,'business','curated')`, [moduleId, org]);
    const result = await createRegistrationService(api).execute({ kind: "register", organizationId: org,
      subjectId: CatalogSubjectId(subjectId), subjectKind: "driver", expectedRelease: pin,
      placement: { mode: "use-default" }, destinationModuleId: moduleId,
      method: "explicit", proof: {}, idempotencyKey: randomUUID(), context });
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result.value;
  };
  const changeOwner = (owner: string | null, id = childRegistrationId) => api.query(`
    update parameter_catalog.organization_subject_registrations set owner_subject_id=$1,updated_at=clock_timestamp()
    where id=$2`, [owner, id]);

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("organization-owners");
    admin = new pg.Pool({ connectionString: database.url });
    const first = firstAcmePredecessor();
    expect((await installPublishedRelease(admin, { mode: "bootstrap", source: jsonCatalogReleaseSource(first.bundle),
      expectedTargetDigest: CatalogReleaseDigest(first.digest) })).ok).toBe(true);
    const built = await buildCompleteSuccessor({ productPath: "m2-core",
      predecessorArtifact: { digest: first.digest, bytes: first.bytes },
      changeSet: [
        { op: "create-subject", kind: "driver", canonicalKey: "driver:vendor,organization-target",
          selector: { kind: "driver-compatible", value: "vendor,organization-target" }, nature: "physical-device", cardinality: "multiple" },
        { op: "create-subject-with-definitions", kind: "node-type", canonicalKey: "node-type:child_unit", ownerSubjectId: source,
          selector: { kind: "node-type-name", value: "child_unit" }, definitions: [{ propertyKey: "weight", content: integerContent("Weight", "Child weight.") }] },
        { op: "create-subject", kind: "node-type", canonicalKey: "node-type:sibling_unit", ownerSubjectId: target,
          selector: { kind: "node-type-name", value: "sibling_unit" } },
      ], frozenIdentity: { ...frozenPageIdentity([{ subjectId: child, propertyKey: "weight", definitionId: "organization-child-weight", revisionId: "organization-child-weight-1" }], "organization-owners"),
        subjects: [{ canonicalKey: "driver:vendor,organization-target", subjectId: target },
          { canonicalKey: "node-type:child_unit", subjectId: child, ownerSubjectId: source },
          { canonicalKey: "node-type:sibling_unit", subjectId: sibling, ownerSubjectId: target }] } });
    if (!built.ok || built.value.kind !== "successor") throw new Error(JSON.stringify(built));
    const artifact = built.value.artifact;
    const bundle = structuredClone(artifact.bundle);
    const release = bundle.releases.find(item => item.manifest.release.id === artifact.targetReleaseId)!;
    const alias = release.documents.find(document => document.kind === "alias");
    if (alias?.kind !== "alias") throw new Error("Alias fixture missing");
    const withAlias = refreshSuccessorSource({ ...release, documents: [...release.documents,
      { ...structuredClone(alias), content: { ...structuredClone(alias.content), id: "organization-sibling-alias",
        subjectId: sibling, selectorKind: "node-type-name", normalizedSelector: "sibling_alias" } }] }, release.sources[0]!.path);
    const publishedBundle = { ...bundle, releases: bundle.releases.map(item => item === release ? withAlias : item) };
    const compiled = compileCatalogRelease(publishedBundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled));
    pin = { id: compiled.value.release.id, digest: compiled.value.release.digest };
    expect((await installPublishedRelease(admin, { mode: "advance", source: jsonCatalogReleaseSource(publishedBundle),
      expectedTargetDigest: pin.digest, expectedCurrent: { id: first.compiled.release.id, digest: CatalogReleaseDigest(first.digest) } })).ok).toBe(true);
    token = `orgowner${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: token });
    api = new pg.Pool({ connectionString: runtime.apiUrl });
    db = createPostgresDatabase(runtime.apiUrl);
    expect((await api.query("select rolsuper from pg_roles where rolname=current_user")).rows[0]).toEqual({ rolsuper: false });
  }, 120_000);
  beforeEach(async () => {
    organizationId = `org-owner-${randomUUID()}`;
    await admin.query("insert into public.organizations(id,name) values ($1,'Organization owners')", [organizationId]);
    await register(organizationId, source);
    await register(organizationId, target);
    childRegistrationId = (await api.query<{ id: string }>(`select id from parameter_catalog.organization_subject_registrations
      where organization_id=$1 and subject_id=$2`, [organizationId, child])).rows[0]!.id;
  });
  afterAll(async () => {
    await api?.end(); if (db) await getRootPostgresPool(db)?.end();
    if (token) await dropLabRuntimeLogins(database.url, token);
    await admin?.end(); await database?.drop();
  });

  it("moves only the organization projection and matcher, retaining definitions, bindings, values and source metadata", async () => {
    const otherOrganization = `other-${organizationId}`;
    await admin.query("insert into public.organizations(id,name) values ($1,'Other')", [otherOrganization]);
    await register(otherOrganization, source);
    const loaded = await createCatalogKernel(api).loadCurrentCatalog(pin);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded));
    const projectId = `project-${organizationId}`;
    await admin.query("insert into public.projects(id,organization_id,name,code) values ($1,$2,'Owner preservation',$1)", [projectId, organizationId]);
    const bound = await createSourceBackedBindingService(admin, { initialPayload: { kind: "number", value: 5 } }).stabilize({
      snapshot: loaded.value, organizationId, projectId, logicalNodeId: "child_unit", registrationId: SubjectRegistrationId(childRegistrationId),
      definitionId: ParameterDefinitionId("organization-child-weight"), effectiveRevisionId: DefinitionRevisionId("organization-child-weight-1"),
      expectedEffectiveRevisionId: null });
    if (!bound.ok) throw new Error(JSON.stringify(bound));
    const bindingId = bound.value.binding.id;
    const retained = async () => (await admin.query(`select
      (select jsonb_agg(to_jsonb(b) order by b.id) from parameter_catalog.project_parameter_bindings b where b.project_id=$1) as bindings,
      (select jsonb_agg(to_jsonb(v) order by v.id) from parameter_catalog.project_parameter_values v join parameter_catalog.project_parameter_bindings b on b.id=v.binding_id where b.project_id=$1) as values,
      (select jsonb_agg(to_jsonb(p) order by p.id) from parameter_catalog.project_value_source_pins p where p.project_id=$1) as pins,
      (select jsonb_agg(to_jsonb(h) order by h.id) from parameter_catalog.binding_history_events h join parameter_catalog.project_parameter_bindings b on b.id=h.binding_id where b.project_id=$1) as history,
      (select jsonb_agg(to_jsonb(v) order by v.id) from public.project_parameter_file_versions v join public.project_parameter_files f on f.id=v.file_id where f.project_id=$1) as file_versions,
      (select jsonb_agg(to_jsonb(d) order by d.id) from parameter_catalog.parameter_definitions d where d.subject_id=$2) as definitions`, [projectId, child])).rows[0];
    const before = await retained();
    await changeOwner(target);
    expect(await retained()).toEqual(before);
    expect(await readCatalogSubjectOwner(api, child)).toBe(source);
    expect(await readOrganizationSubjectOwner(api, organizationId, child)).toBe(target);
    expect(await readOrganizationSubjectOwner(api, otherOrganization, child)).toBe(source);
    expect(await listOrganizationOwnedSubjects(api, organizationId, source, pin.id)).not.toContain(child);
    expect(await listOrganizationOwnedSubjects(api, organizationId, target, pin.id)).toContain(child);
    const effective = await loadOrganizationCatalogSnapshot(db, organizationId, loaded.value);
    const selector = { driverCompatibles: [], nodeTypeFallback: { kind: "present" as const, name: NormalizedNodeTypeName("child_unit") } };
    expect(effective.resolveSubject({ ...selector, ownerContext: [DriverCompatible("vendor,organization-target")] })).toMatchObject({ status: "matched", subject: { id: child, owner: target } });
    expect(effective.resolveSubject({ ...selector, ownerContext: [DriverCompatible("acme,power")] }).status).not.toBe("matched");
    expect(loaded.value.resolveSubject({ ...selector, ownerContext: [DriverCompatible("acme,power")] })).toMatchObject({ status: "matched", subject: { id: child, owner: source } });
    const projection = await createGovernanceCatalogQueries(api).getRegistration({ organizationId, registrationId: childRegistrationId,
      observedCatalogReleaseId: pin.id, authScope: { organizationId, principalId: context.principalId } });
    if (!projection.ok) throw new Error(JSON.stringify(projection));
    expect(projection.value).toMatchObject({ ownerSubjectId: target, placement: { moduleId: `${organizationId}-${target}` } });
    const detail = loaded.value.getSubject(CatalogSubjectId(child));
    if (detail.status !== "found") throw new Error("Child detail missing");
    const registered = { status: "active" as const, id: childRegistrationId, placement: projection.value.placement };
    expect(mapCatalogSubject(detail.subject, registered, { organizationOwnership: true }).ownerSubjectId).toBe(target);
    expect(mapCatalogSubject(detail.subject, registered).ownerSubjectId).toBe(source);
    await api.query("update parameter_catalog.organization_subject_registrations set status='retired' where organization_id=$1 and subject_id=$2", [organizationId, source]);
    expect(await readCurrentManagedSourceBindingIds(db, { organizationId, projectId, bindingIds: [bindingId] })).toEqual(new Set([bindingId]));
    await api.query("update parameter_catalog.organization_subject_registrations set status='retired' where organization_id=$1 and subject_id=$2", [organizationId, target]);
    expect(await readCurrentManagedSourceBindingIds(db, { organizationId, projectId, bindingIds: [bindingId] })).toEqual(new Set());
  });

  it("rejects inactive and non-driver targets", async () => {
    await api.query("update parameter_catalog.organization_subject_registrations set status='retired' where organization_id=$1 and subject_id=$2", [organizationId, target]);
    await expect(changeOwner(target)).rejects.toMatchObject({ code: "23514", constraint: "organization_subject_owner_ck" });
    await expect(changeOwner(sibling)).rejects.toMatchObject({ code: "23503", constraint: "organization_subject_registrations_owner_subject_id_fkey" });
  });

  it("selects the current organization owner module, including retired children only when requested", async () => {
    await changeOwner(target);
    const queries = createGovernanceCatalogQueries(api);
    const select = (owner: string, includeRetired = false) => queries.selectPlacementSubtreeSubjectIds({
      organizationId, moduleId: `${organizationId}-${owner}`, includeRetired,
      authScope: { organizationId, principalId: context.principalId },
    });
    const oldModule = await select(source, true);
    const currentModule = await select(target);
    expect(oldModule.ok && oldModule.value.subjectIds).not.toContain(child);
    expect(currentModule.ok && currentModule.value.subjectIds).toContain(child);
    await api.query("update parameter_catalog.organization_subject_registrations set status='retired' where id=$1", [childRegistrationId]);
    const activeOnly = await select(target);
    const library = await select(target, true);
    expect(activeOnly.ok && activeOnly.value.subjectIds).not.toContain(child);
    expect(library.ok && library.value.subjectIds).toContain(child);
  });

  it("rejects effective node-name collisions including organization recognition overrides", async () => {
    const siblingRegistration = (await api.query<{ id: string }>("select id from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2", [organizationId, sibling])).rows[0]!.id;
    await admin.query(`insert into public.registration_recognition_rules(organization_id,registration_id,canonical_subject_id,compatibles,node_type_name)
      values ($1,$2,$3,'{}','child_unit')`, [organizationId, siblingRegistration, sibling]);
    await expect(changeOwner(target)).rejects.toMatchObject({ code: "23505", constraint: "organization_subject_owner_selector_unique" });
    expect(await readOrganizationSubjectOwner(api, organizationId, child)).toBe(source);
  });

  it("rejects an alias collision and later recognition changes that collide after a move", async () => {
    await admin.query(`insert into public.registration_recognition_rules(organization_id,registration_id,canonical_subject_id,compatibles,node_type_name)
      values ($1,$2,$3,'{}','sibling_alias')`, [organizationId, childRegistrationId, child]);
    await expect(changeOwner(target)).rejects.toMatchObject({ code: "23505", constraint: "organization_subject_owner_selector_unique" });
    await admin.query("delete from public.registration_recognition_rules where organization_id=$1 and registration_id=$2", [organizationId, childRegistrationId]);
    await changeOwner(target);
    await expect(admin.query(`insert into public.registration_recognition_rules(organization_id,registration_id,canonical_subject_id,compatibles,node_type_name)
      values ($1,$2,$3,'{}','sibling_unit')`, [organizationId, childRegistrationId, child]))
      .rejects.toMatchObject({ code: "23505", constraint: "organization_subject_owner_selector_unique" });
  });

  it("preserves retired ownership snapshots and refuses restoring under a retired owner", async () => {
    await api.query("update parameter_catalog.organization_subject_registrations set status='retired' where organization_id=$1 and subject_id in ($2,$3)", [organizationId, child, target]);
    await changeOwner(target);
    expect(await readOrganizationSubjectOwner(api, organizationId, child)).toBe(target);
    await expect(api.query("update parameter_catalog.organization_subject_registrations set status='active' where id=$1", [childRegistrationId]))
      .rejects.toMatchObject({ code: "23514", constraint: "organization_subject_owner_ck" });
  });

  it("re-reads the effective owner after waiting for a concurrent ownership change", async () => {
    const ownerWriter = await api.connect(), recognitionWriter = await api.connect();
    let pending: Promise<{ error?: unknown }> | undefined;
    try {
      await ownerWriter.query("begin");
      await lockOrganizationModuleRecognition(ownerWriter, organizationId);
      const ownerPid = (await ownerWriter.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      await recognitionWriter.query("begin");
      await recognitionWriter.query(`insert into public.registration_recognition_rules
        (organization_id,registration_id,canonical_subject_id,compatibles,node_type_name)
        values ($1,$2,$3,'{}','sibling_unit')`, [organizationId, childRegistrationId, child]);
      pending = recognitionWriter.query("commit").then(() => ({}), error => ({ error }));
      await vi.waitFor(async () => {
        const blocked = await admin.query("select pid from pg_stat_activity where $1=any(pg_blocking_pids(pid))", [ownerPid]);
        expect(blocked.rows.length).toBeGreaterThan(0);
      }, { timeout: 3000, interval: 25 });
      await ownerWriter.query("update parameter_catalog.organization_subject_registrations set owner_subject_id=$1 where id=$2", [target, childRegistrationId]);
      await ownerWriter.query("commit");
      expect((await pending).error).toMatchObject({ code: "23505", constraint: "organization_subject_owner_selector_unique" });
      expect(await readOrganizationSubjectOwner(api, organizationId, child)).toBe(target);
      expect((await api.query("select 1 from public.registration_recognition_rules where registration_id=$1", [childRegistrationId])).rows).toEqual([]);
    } finally {
      await ownerWriter.query("rollback").catch(() => undefined);
      await pending;
      await recognitionWriter.query("rollback").catch(() => undefined);
      ownerWriter.release(); recognitionWriter.release();
    }
  });
});
