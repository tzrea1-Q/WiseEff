import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { createDisposableParameterCatalogDatabase, type ParameterCatalogDatabase } from "../../testing/parameterCatalog";
import { makeTestAuthContext } from "../../testing/authContext";
import { installPublishedCatalogChain, nodeTypeAndSecondDriverSuccessorBundle, refreshReleaseSource } from "../catalog-kernel/runtime/catalogChain.fixture";
import { compileCatalogRelease } from "../catalog-kernel/compiler";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { createCatalogKernel, DriverCompatible, jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { captureCurrentCatalogPin } from "../catalog-publication/runtime";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { createSourceBackedBindingService } from "../parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import { CatalogSubjectId, DefinitionRevisionId, ParameterDefinitionId, SubjectRegistrationId } from "../parameter-catalog-contract";
import { loadOrganizationCatalogSnapshot } from "../parameter-modules/recognitionSettings";
import { moduleStructureExportSchema, moduleStructurePreviewResponseSchema, moduleStructureUpdateDocumentSchema } from "../contracts/dtoSchemas/moduleStructure";

type Document = z.infer<typeof moduleStructureUpdateDocumentSchema>;
const subjectId = "csub_acme_charger";

describe("module structure organization recognition type correction", () => {
  let fixture: ParameterCatalogDatabase;
  let db: ReturnType<typeof createPostgresDatabase>;
  let api: ReturnType<typeof createPostgresDatabase>;
  const runToken = `mskind${randomUUID().replaceAll("-", "").slice(0, 12)}`;

  beforeAll(async () => {
    fixture = await createDisposableParameterCatalogDatabase("structurekind");
    db = createPostgresDatabase(fixture.url);
    const pool = getRootPostgresPool(db)!;
    const chain = await installPublishedCatalogChain(pool);
    const original = nodeTypeAndSecondDriverSuccessorBundle();
    const release = structuredClone(original.releases.at(-1)!) as Parameters<typeof refreshReleaseSource>[0];
    const template = release.documents.find(document => document.kind === "definition");
    if (!template || template.kind !== "definition") throw new Error("Missing definition fixture");
    const definition = structuredClone(template);
    definition.content.id = "pdef_conversion_current";
    definition.content.subjectId = subjectId;
    definition.content.propertyKey = "conversion_current";
    definition.content.revision.id = "drev_conversion_current_1";
    definition.content.revision.number = 1;
    definition.content.revision.matching = { sourceProperty: "conversion_current", selectorKind: "node-type-name" };
    release.documents.push(definition);
    refreshReleaseSource(release);
    const bundle = { ...original, releases: [...original.releases.slice(0, -1), release] };
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    const installed = await installPublishedRelease(pool, { mode: "advance", source: jsonCatalogReleaseSource(bundle),
      expectedCurrent: chain.pinC, expectedTargetDigest: compiled.value.aggregateDigest });
    if (!installed.ok) throw new Error(JSON.stringify(installed.error));
    const runtime = await provisionPublicationRuntimeLogins(fixture.url, { mode: "lab", runToken });
    api = createPostgresDatabase(runtime.apiUrl);
    expect((await api.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
  }, 120_000);

  afterAll(async () => { await api?.close(); if (fixture) await dropLabRuntimeLogins(fixture.url, runToken); await db?.close(); await fixture?.close(); });

  async function organization(id: string, registered = true) {
    await db.query("insert into organizations(id,name) values ($1,$1)", [id]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [`${id}-admin`, id]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ($1,$2,$3,'admin')", [`${id}-role`, `${id}-admin`, id]);
    await db.query("insert into parameter_modules(id,organization_id,name,path,kind,origin) values ($1,$2,'Module',$1,'business','curated')", [`${id}-module`, id]);
    if (registered) await db.transaction(async tx => {
      await tx.query("set constraints all deferred");
      await tx.query(`insert into parameter_catalog.organization_subject_registrations(id,organization_id,subject_id,status,registration_method,proof,current_placement_id)
        values ($1,$2,$3,'active','explicit','{}',$4)`, [`${id}-registration`, id, subjectId, `${id}-placement`]);
      await tx.query(`insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin)
        values ($1,$2,$3,$4,'curated')`, [`${id}-placement`, `${id}-registration`, id, `${id}-module`]);
    });
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: id, userId: `${id}-admin`, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const path = `/api/v2/organizations/${id}/module-structure`;
    const exported = async () => {
      const response = await requestJson(app, `${path}/exports`, { method: "POST", body: "{}" });
      expect(response.status, response.bodyText).toBe(200);
      return moduleStructureExportSchema.parse(response.body);
    };
    const preview = async (document: Document, resolutions: Record<string, "current" | "file"> = {}) =>
      requestJson(app, `${path}/previews`, { method: "POST", body: JSON.stringify({ document, resolutions }) });
    const apply = async (document: Document, token: string, key: string, resolutions: Record<string, "current" | "file"> = {}) =>
      requestJson(app, `${path}/applies`, { method: "POST", body: JSON.stringify({ document, resolutions, token, idempotencyKey: key, reason: "Correct compatible driver recognition" }) });
    return { app, path, exported, preview, apply };
  }

  function correction(document: Document, explicitKind = false): Document {
    const edited = structuredClone(document);
    const subject = edited.subjects.find(row => row.subjectId === subjectId)!;
    if (explicitKind) subject.kind = "driver";
    subject.recognition = { ...subject.recognition!, mode: "override", override: { ...subject.recognition!.effective,
      compatibles: ["fdw,fm1230_swi"] } };
    return edited;
  }

  it("converts a root locally, preserves populated identities and source history, replays and resets", async () => {
    const org = "kind-source", source = await organization(org), other = await organization("kind-other");
    await db.query("insert into projects(id,organization_id,name,code) values ('kind-project',$1,'Retained','KIND')", [org]);
    const pool = getRootPostgresPool(db)!;
    const pin = await captureCurrentCatalogPin(pool);
    if (!pin) throw new Error("Missing Catalog release");
    const loaded = await createCatalogKernel(pool).loadPinnedCatalog(pin);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.error));
    const binding = await createSourceBackedBindingService(pool).stabilize({ snapshot: loaded.value, organizationId: org,
      projectId: "kind-project", logicalNodeId: "charger", registrationId: SubjectRegistrationId(`${org}-registration`),
      definitionId: ParameterDefinitionId("pdef_conversion_current"), effectiveRevisionId: DefinitionRevisionId("drev_conversion_current_1"), expectedEffectiveRevisionId: null });
    if (!binding.ok) throw new Error(JSON.stringify(binding.error));
    const retained = async () => ({
      bindings: (await db.query("select * from parameter_catalog.project_parameter_bindings where organization_id=$1 order by id", [org])).rows,
      values: (await db.query("select * from parameter_catalog.project_parameter_values where binding_id=$1 order by id", [binding.value.binding.id])).rows,
      history: (await db.query("select * from parameter_catalog.binding_history_events where binding_id=$1 order by id", [binding.value.binding.id])).rows,
      definitions: (await db.query("select * from parameter_catalog.parameter_definitions where subject_id=$1 order by id", [subjectId])).rows,
    });
    const before = await retained();
    expect(before.bindings.length).toBe(1); expect(before.values.length).toBeGreaterThan(0); expect(before.history.length).toBeGreaterThan(0);
    const document = await source.exported(), edited = correction(document);
    const preview = await source.preview(edited);
    expect(preview.status, preview.bodyText).toBe(200);
    const planned = moduleStructurePreviewResponseSchema.parse(preview.body);
    expect(planned.changes).toEqual(expect.arrayContaining([{ moduleId: `subject:${subjectId}`, field: "kind", before: "node-type", after: "driver" }]));
    expect(planned.impact).toEqual(expect.arrayContaining([expect.objectContaining({ subjectId, projectId: "kind-project", bindingCount: 1 })]));
    expect((await db.query("select 1 from registration_recognition_rules where organization_id=$1", [org])).rowCount).toBe(0);
    const applied = await source.apply(edited, planned.token, "correct-root");
    expect(applied.status, applied.bodyText).toBe(200);
    expect((await source.apply(edited, planned.token, "correct-root")).body).toEqual(applied.body);
    expect(await retained()).toEqual(before);
    expect((await db.query("select kind from parameter_catalog.catalog_subjects where id=$1", [subjectId])).rows).toEqual([{ kind: "node-type" }]);
    expect((await db.query("select id,current_placement_id from parameter_catalog.organization_subject_registrations where organization_id=$1", [org])).rows)
      .toEqual([{ id: `${org}-registration`, current_placement_id: `${org}-placement` }]);
    const updated = await source.exported();
    expect(updated.subjects[0]).toMatchObject({ kind: "driver", recognition: { mode: "override", effective: {
      compatibles: ["fdw,fm1230_swi"], nodeTypeName: null, driverNature: "physical-device", instanceCardinality: "multiple" } } });
    expect((await other.exported()).subjects[0]).toMatchObject({ kind: "node-type", recognition: { mode: "inherit" } });
    const localSnapshot = await loadOrganizationCatalogSnapshot(api, org, loaded.value);
    expect(localSnapshot.resolveSubject({ driverCompatibles: [DriverCompatible("fdw,fm1230_swi")], nodeTypeFallback: { kind: "absent" } }))
      .toMatchObject({ status: "matched", subject: { id: subjectId, kind: "driver" } });
    expect(loaded.value.getSubject(CatalogSubjectId(subjectId))).toMatchObject({ subject: { kind: "node-type" } });
    const otherSnapshot = await loadOrganizationCatalogSnapshot(api, "kind-other", loaded.value);
    expect(otherSnapshot.resolveSubject({ driverCompatibles: [DriverCompatible("fdw,fm1230_swi")], nodeTypeFallback: { kind: "absent" } }))
      .toMatchObject({ status: "unknown" });
    expect((await source.preview(edited)).body).toMatchObject({ changes: [], conflicts: [] });
    expect((await source.preview(updated)).body).toMatchObject({ changes: [], conflicts: [] });
    const reset: Document = structuredClone(updated);
    reset.subjects[0].recognition = { ...reset.subjects[0].recognition!, mode: "inherit", override: null };
    const resetPreview = await source.preview(reset);
    expect(resetPreview.status, resetPreview.bodyText).toBe(200);
    const resetPlan = moduleStructurePreviewResponseSchema.parse(resetPreview.body);
    expect(resetPlan.changes).toEqual(expect.arrayContaining([{ moduleId: `subject:${subjectId}`, field: "kind", before: "driver", after: "node-type" }]));
    expect((await source.apply(reset, resetPlan.token, "reset-root")).status).toBe(200);
    expect((await source.exported()).subjects[0]).toMatchObject({ kind: "node-type", recognition: { mode: "inherit", effective: { nodeTypeName: "charger", compatibles: [] } } });
    expect(await retained()).toEqual(before);
  });

  it("rejects invalid selectors without writes and fences concurrent edits, stale previews and audit failures", async () => {
    const org = "kind-fences", source = await organization(org);
    const document = await source.exported(), edited = correction(document, true);
    const invalid = structuredClone(edited);
    invalid.subjects[0].recognition!.override!.compatibles = ["fdw,*"];
    const rejected = await source.preview(invalid);
    expect(rejected.status, rejected.bodyText).toBe(400);
    expect(rejected.body).toMatchObject({ error: { details: { issues: expect.arrayContaining([expect.objectContaining({
      code: "wildcard-forbidden", jsonPointer: "/subjects/0/recognition/override/compatibles/0" })]) } } });
    const first = await source.preview(edited);
    expect(first.status, first.bodyText).toBe(200);
    await db.query(`insert into registration_recognition_rules(organization_id,registration_id,canonical_subject_id,node_type_name)
      values ($1,$2,$3,'renamed_node')`, [org, `${org}-registration`, subjectId]);
    expect((await source.apply(edited, moduleStructurePreviewResponseSchema.parse(first.body).token, "stale")).status).toBe(409);
    const conflict = await source.preview(edited);
    expect(conflict.status, conflict.bodyText).toBe(200);
    expect(conflict.body).toMatchObject({ conflicts: [expect.objectContaining({ key: `${subjectId}:recognition.kind` })] });
    expect((await source.preview(edited, { [`${subjectId}:recognition.kind`]: "current" })).body).toMatchObject({ changes: [], conflicts: [] });
    const resolutions = { [`${subjectId}:recognition.kind`]: "file" as const };
    const reviewed = await source.preview(edited, resolutions);
    expect(reviewed.status, reviewed.bodyText).toBe(200);
    const token = moduleStructurePreviewResponseSchema.parse(reviewed.body).token;
    await db.query(`create function fail_kind_audit() returns trigger language plpgsql as $$ begin
      if new.organization_id='kind-fences' and new.action='module-structure-update' then raise exception 'injected correction audit failure'; end if; return new; end $$;
      create trigger fail_kind_audit before insert on audit_events for each row execute function fail_kind_audit()`);
    try {
      expect((await source.apply(edited, token, "audit-rollback", resolutions)).status).toBe(500);
      expect((await db.query("select node_type_name,compatibles from registration_recognition_rules where organization_id=$1", [org])).rows)
        .toEqual([{ node_type_name: "renamed_node", compatibles: [] }]);
    } finally { await db.query("drop trigger fail_kind_audit on audit_events; drop function fail_kind_audit()"); }
    expect((await source.apply(edited, token, "audit-rollback", resolutions)).status).toBe(200);
    const denied = await requestJson(source.app, "/api/v2/organizations/kind-other/module-structure/previews", { method: "POST", body: JSON.stringify({ document: edited, resolutions: {} }) });
    expect(denied.status).toBe(403);
  });

  it("copies the corrected type into new and existing registrations with explicit conflict resolution", async () => {
    const source = await organization("kind-copy-source");
    const edited = correction(await source.exported());
    const preview = await source.preview(edited);
    expect(preview.status, preview.bodyText).toBe(200);
    expect((await source.apply(edited, moduleStructurePreviewResponseSchema.parse(preview.body).token, "copy-source")).status).toBe(200);
    const document = await source.exported();
    for (const registered of [false, true]) {
      const id = `kind-copy-${registered}`, target = await organization(id, registered);
      const input = { mode: "copy", document, mappings: { [document.modules[0].ref]: `${id}-module` }, resolutions: {} as Record<string, "current" | "file"> };
      const plan = () => requestJson(target.app, `${target.path}/previews`, { method: "POST", body: JSON.stringify(input) });
      let planned = await plan();
      expect(planned.status, planned.bodyText).toBe(200);
      if (registered) {
        expect(planned.body).toMatchObject({ conflicts: expect.arrayContaining([expect.objectContaining({ key: `subject:${subjectId}:recognition` })]) });
        input.resolutions[`subject:${subjectId}:recognition`] = "current";
        expect((await plan()).body).toMatchObject({ changes: [], conflicts: [] });
        input.resolutions[`subject:${subjectId}:recognition`] = "file";
        planned = await plan();
      }
      const result = moduleStructurePreviewResponseSchema.parse(planned.body);
      expect(result.conflicts).toEqual([]);
      const applied = await requestJson(target.app, `${target.path}/applies`, { method: "POST", body: JSON.stringify({ ...input,
        token: result.token, idempotencyKey: `copy-${registered}`, reason: "Copy corrected driver recognition" }) });
      expect(applied.status, applied.bodyText).toBe(200);
      expect((await target.exported()).subjects[0]).toMatchObject({ subjectId, kind: "driver", recognition: { effective: { compatibles: ["fdw,fm1230_swi"], nodeTypeName: null } } });
      if (registered) expect((await db.query("select id from parameter_catalog.organization_subject_registrations where organization_id=$1", [id])).rows).toEqual([{ id: `${id}-registration` }]);
      expect((await plan()).body).toMatchObject({ changes: [], conflicts: [] });
    }
  });

  it("registers a canonical root node with an explicit driver correction and rejects ambiguous selectors", async () => {
    const id = "kind-new", target = await organization(id, false);
    const document: Document = await target.exported();
    document.subjects.push({ subjectId, kind: "driver", state: "active", placement: { kind: "module", moduleRef: `${id}-module` },
      recognition: { mode: "override", override: { compatibles: ["fdw,fm1230_swi"] } } });
    const ambiguous = structuredClone(document);
    ambiguous.subjects[0].recognition!.override!.nodeTypeName = "different_node";
    const invalid = await target.preview(ambiguous);
    expect(invalid.status, invalid.bodyText).toBe(400);
    expect(invalid.body).toMatchObject({ error: { details: { issues: [expect.objectContaining({ code: "ambiguous-recognition-correction" })] } } });
    const preview = await target.preview(document);
    expect(preview.status, preview.bodyText).toBe(200);
    const token = moduleStructurePreviewResponseSchema.parse(preview.body).token;
    const applied = await target.apply(document, token, "register-corrected");
    expect(applied.status, applied.bodyText).toBe(200);
    expect((await target.apply(document, token, "register-corrected")).body).toEqual(applied.body);
    expect((await target.exported()).subjects[0]).toMatchObject({ subjectId, kind: "driver", recognition: { effective: { compatibles: ["fdw,fm1230_swi"], nodeTypeName: null } } });
  });

  it("applies the whole file correction after a concurrent reset of node or corrected-driver overrides", async () => {
    for (const driver of [false, true]) {
      const id = `kind-reset-race-${driver}`, target = await organization(id);
      await db.query(`insert into registration_recognition_rules(organization_id,registration_id,canonical_subject_id,compatibles,node_type_name,driver_nature,instance_cardinality)
        values ($1,$2,$3,$4,$5,$6,$7)`, [id, `${id}-registration`, subjectId, driver ? ["old,driver"] : [],
        driver ? null : "charger", driver ? "logical-service" : null, driver ? "multiple" : null]);
      const original = await target.exported(), edited = correction(original);
      await db.query("delete from registration_recognition_rules where organization_id=$1", [id]);
      const unresolved = await target.preview(edited);
      expect(unresolved.status, unresolved.bodyText).toBe(200);
      expect(unresolved.body).toMatchObject({ conflicts: [expect.objectContaining({ key: `${subjectId}:recognition.kind` })] });
      const resolutions = { [`${subjectId}:recognition.kind`]: "file" as const };
      const chosen = await target.preview(edited, resolutions);
      expect(chosen.status, chosen.bodyText).toBe(200);
      const planned = moduleStructurePreviewResponseSchema.parse(chosen.body);
      expect(planned.conflicts).toEqual([]);
      const applied = await target.apply(edited, planned.token, "concurrent-reset-file", resolutions);
      expect(applied.status, applied.bodyText).toBe(200);
      expect((await target.exported()).subjects[0]).toMatchObject({ kind: "driver", recognition: { effective: {
        compatibles: ["fdw,fm1230_swi"], driverNature: driver ? "logical-service" : "physical-device" } } });
    }
  });
});
