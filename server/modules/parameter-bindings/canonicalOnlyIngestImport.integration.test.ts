import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { seedCoreGraph } from "../../testing/fixtures";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createLocalObjectStore } from "../logs/objectStore";
import { addConfigSetFile, createConfigSet } from "../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { createOrReuseBinding, upsertBindingRevisionValues } from "../parameter-topology/bindingService";
import { resolveModuleIdForBinding } from "../parameter-modules/resolveModuleForBinding";
import { asValueClient, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "./catalogProjectValueSync";
import type { ParameterImportBatchDto } from "../parameters/types";

const organizationId = "org-1089";
const projectId = "project-1089";
const userId = "admin-1089";
const admin = makeTestAuthContext({ userId, organizationId });
const source = `/dts-v1/;
/ {
  reg = <0>;
  charger: device@0 { compatible = "acme,power"; reg = <1>; iin_max = <1000>; status = "okay"; };
  legacy: sc8562@6e { compatible = "sc,sc8562"; reg = <2>; gpio_int = <1>; unknown_setting = <2>; };
};
`;
const legacyTables = ["parameter_specs", "parameter_spec_versions", "driver_schemas", "driver_schema_versions", "dts_property_specs",
  "project_parameter_bindings", "project_parameter_binding_revisions", "parameter_spec_review_tasks",
  "parameter_spec_matcher_overrides", "dts_property_occurrence_spec_decisions", "parameter_drafts"];

describe("#1089 canonical-only assembled upload and import", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let directory: string;
  let configSetId: string;
  let revisionId: string;

  beforeEach(async () => {
    lane = await createEphemeralTestDatabase("canonical-only-1089");
    db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-1089-"));
    storage = createLocalObjectStore(directory);
    await seedCoreGraph(db, { organization: { id: organizationId }, users: [{ id: userId }], projects: [{ id: projectId }] });
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('role-1089',$1,$2,null,'admin')", [userId, organizationId]);
    await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power", compatible: "acme,power",
      businessName: "Power", driverName: "Acme", idempotencyKey: "driver-1089", reason: "Canonical ingest regression" });
    const set = await createConfigSet(db, admin, { projectId, name: "default" });
    configSetId = set.id;
    const file = await uploadProjectParameterFile(db, storage, admin, { projectId, fileName: "board.dts", bytes: Buffer.from(source) }, {});
    await addConfigSetFile(db, admin, { configSetId, fileId: file.file.id, role: "base", sortOrder: 0 });
    const revision = await ingestConfigRevision(db, { organizationId, projectId, configSetId, entryFile: "board.dts",
      includeSearchPaths: ["."], overlayOrder: [], members: [{ fileId: file.file.id, fileVersionId: file.version.id,
        fileName: "board.dts", sourceName: "board.dts", role: "base", sortOrder: 0, content: source }] }, admin);
    revisionId = revision.id;
  }, 120_000);

  afterEach(async () => {
    await db?.close();
    await lane?.drop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function post<Body = { error: { message: string; details?: Record<string, unknown> } }>(path: string, body: unknown) {
    return requestJson<Body>(createWiseEffServer({ db, objectStore: storage }), path, {
      method: "POST", headers: { "x-wiseeff-user": userId }, body: JSON.stringify(body),
    });
  }

  async function snapshot() {
    const counts: Record<string, unknown> = {};
    for (const table of legacyTables) counts[table] = (await db.query(`select count(*)::text as count from ${table}`)).rows;
    return counts;
  }

  async function materialize() {
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Canonical Catalog fixture is unavailable");
    await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog,
      { organizationId, projectId, configSetId, configRevisionId: revisionId }));
    return (await db.query<{ id: string; definition_id: string; current_value_id: string }>(
      "select id,definition_id,current_value_id from parameter_catalog.current_project_parameter_bindings where project_id=$1", [projectId])).rows[0]!;
  }

  it.each([false, true])("ordinary upload preserves continuity and canonical pins without legacy DML (fenced=%s)", async (fenced) => {
    const before = await snapshot();
    const nodes = (await db.query("select logical_node_id,node_locator from dts_logical_node_revisions where config_revision_id=$1 order by node_locator", [revisionId])).rows;
    if (fenced) {
      await db.query("create sequence upload_legacy_attempts");
      await db.query(`create function refuse_upload_legacy_projection() returns trigger language plpgsql as $$
        begin perform nextval('upload_legacy_attempts'); raise exception 'Legacy projection is fenced' using errcode='42501'; end $$`);
      for (const table of legacyTables) await db.query(`create trigger upload_legacy_fence before insert or update or delete on ${table} for each statement execute function refuse_upload_legacy_projection()`);
    }
    const response = await post(`/api/v1/projects/${projectId}/parameter-files`, { fileName: "board.dts", contentBase64: Buffer.from(source).toString("base64") });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(await snapshot()).toEqual(before);
    if (fenced) expect((await db.query("select is_called from upload_legacy_attempts")).rows).toEqual([{ is_called: false }]);
    const latest = (await db.query<{ id: string }>("select id from dts_config_revisions where config_set_id=$1 order by revision_number desc limit 1", [configSetId])).rows[0]!;
    expect(latest.id).not.toBe(revisionId);
    expect((await db.query("select logical_node_id,node_locator from dts_logical_node_revisions where config_revision_id=$1 order by node_locator", [latest.id])).rows).toEqual(nodes);
    expect((await db.query(`select pin.config_revision_id,pin.definition_id,pin.project_value_id,binding.current_value_id
      from parameter_catalog.project_value_source_pins pin join parameter_catalog.current_project_parameter_bindings binding on binding.id=pin.binding_id
      where binding.project_id=$1 and pin.project_value_id=binding.current_value_id`, [projectId])).rows).toEqual([
      expect.objectContaining({ config_revision_id: latest.id, definition_id: "pdef_acme_power_iin_max" }),
    ]);
    expect((await db.query("select count(*)::int as count from parameter_catalog.parameter_observations where project_id=$1 and config_revision_id=$2 and source_occurrence_id is not null", [projectId, latest.id])).rows[0]!.count).toBeGreaterThan(0);
    expect((await db.query(`select count(*)::int as count from parameter_catalog.parameter_review_evidence evidence
      join parameter_catalog.parameter_observations observation on observation.id=evidence.observation_id
      where observation.project_id=$1 and observation.config_revision_id=$2`, [projectId, latest.id])).rows[0]!.count).toBeGreaterThan(0);
  });

  async function preview(id?: string) {
    return post<{ item: ParameterImportBatchDto }>("/api/v1/parameter-import-batches", { projectId, sourceName: "1089.txt",
      items: [{ ...(id ? { id } : {}), name: "iin_max", module: "Power", risk: "Low", unit: "mA", range: "0..5000", currentValue: "2000" }] });
  }

  function draft(bindingId: string, baseRevisionId = revisionId) {
    return post(`/api/v2/projects/${projectId}/parameter-bindings/${bindingId}/drafts`, {
      baseRevisionId, targetValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", value: "2000", raw: "2000" }]] }, reason: "Exact canonical identity",
    });
  }

  it("refuses a retained legacy Binding with a real source head on preview and draft", async () => {
    await materialize();
    await db.query("insert into parameter_specs(id,organization_id,source_kind,specification_key) values ('legacy-spec-1089',$1,'manual','legacy/iin_max')", [organizationId]);
    await db.query(`insert into parameter_spec_versions(id,parameter_spec_id,version,display_name,description,value_shape,lifecycle)
      values ('legacy-version-1089','legacy-spec-1089',1,'iin_max','Historical input current','{"kind":"cells","bits":32}'::jsonb,'active')`);
    await db.query(`insert into dts_property_specs(id,parameter_spec_id,property_key,schema_namespace)
      values ('legacy-property-1089','legacy-spec-1089','iin_max','vendor')`);
    const node = (await db.query<{ logical_node_id: string }>(
      "select logical_node_id from dts_logical_node_revisions where config_revision_id=$1 and node_locator='/device@0'", [revisionId])).rows[0]!;
    const binding = await createOrReuseBinding(db, { organizationId, key: {
      projectId, logicalNodeId: node.logical_node_id, parameterSpecId: "legacy-spec-1089",
      moduleId: await resolveModuleIdForBinding(db, { organizationId, driverModule: null, compatible: null, nodeType: null }),
    } });
    await upsertBindingRevisionValues(db, { bindingId: binding.id, configRevisionId: revisionId,
      parameterSpecVersionId: "legacy-version-1089", values: { rawValue: "<1000>", schemaState: "valid", policyState: "pass",
        typedValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "1000", value: "1000" }]] } } });
    const before = await snapshot();
    expect((await preview(binding.id)).status).toBe(404);
    const refused = await draft(binding.id);
    expect(refused.status).toBe(404);
    expect(refused.body.error.details).toMatchObject({ reason: "canonical-binding-required", bindingId: binding.id });
    expect((await preview(randomUUID())).status).toBe(404);
    expect((await draft(randomUUID())).status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it("reports a property-name-only match as a conflict, never a draft identity", async () => {
    await materialize();
    const response = await preview();
    expect(response.status).toBe(201);
    expect(response.body.item.items[0]).toMatchObject({ classification: "conflict", explanation: expect.stringContaining("canonical") });
    expect(response.body.item.items[0]!.projectParameterValueId).toBeUndefined();
    expect((await post(`/api/v1/parameter-import-batches/${response.body.item.id}/apply`, {})).status).toBe(400);
    expect((await draft("iin_max")).status).toBe(404);
  });

  it("refuses missing source pins on preview and draft", async () => {
    const binding = await materialize();
    await db.transaction(async (tx) => {
      await tx.query("alter table parameter_catalog.project_value_source_pins disable trigger project_value_source_pins_immutable");
      await tx.query("delete from parameter_catalog.project_value_source_pins where binding_id=$1", [binding.id]);
      await tx.query("set constraints all immediate");
      await tx.query("alter table parameter_catalog.project_value_source_pins enable trigger project_value_source_pins_immutable");
    });
    expect((await preview(binding.id)).status).toBe(404);
    expect((await draft(binding.id)).status).toBe(409);
  });

  it("refuses ambiguous occurrences while an exact Binding remains usable", async () => {
    await materialize();
    const sibling = await uploadProjectParameterFile(db, storage, admin, { projectId, fileName: "sibling.dts",
      bytes: Buffer.from(source.replace("device@0", "device@1")) }, {});
    const set = await createConfigSet(db, admin, { projectId, name: "sibling" });
    await addConfigSetFile(db, admin, { configSetId: set.id, fileId: sibling.file.id, role: "base", sortOrder: 0 });
    const revision = await ingestConfigRevision(db, { organizationId, projectId, configSetId: set.id, entryFile: "sibling.dts", includeSearchPaths: ["."], overlayOrder: [],
      members: [{ fileId: sibling.file.id, fileVersionId: sibling.version.id, fileName: "sibling.dts", sourceName: "sibling.dts", role: "base", sortOrder: 0,
        content: source.replace("device@0", "device@1") }] }, admin);
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog!, { organizationId, projectId, configSetId: set.id, configRevisionId: revision.id }));
    expect((await preview("pdef_acme_power_iin_max")).status).toBe(409);
    expect((await draft("pdef_acme_power_iin_max")).status).toBe(404);
  });

  it("previews, stages and replays exact canonical identity without advancing tips", async () => {
    const binding = await materialize();
    const before = await snapshot();
    const response = await preview(binding.id);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.item.items[0]).toMatchObject({ classification: "updated", definitionId: binding.definition_id,
      projectParameterValueId: binding.id, baseRevisionId: revisionId, baseCurrentValueId: binding.current_value_id });
    const staged = await post(`/api/v1/parameter-import-batches/${response.body.item.id}/apply`, {});
    expect(staged.status, JSON.stringify(staged.body)).toBe(200);
    expect((await post(`/api/v1/parameter-import-batches/${response.body.item.id}/apply`, {})).status).toBe(200);
    expect((await db.query("select current_value_id from parameter_catalog.project_parameter_bindings where id=$1", [binding.id])).rows).toEqual([{ current_value_id: binding.current_value_id }]);
    expect(await snapshot()).toEqual(before);
    expect((await draft(binding.id)).status).toBe(201);
    expect((await draft(binding.id, randomUUID())).status).toBe(409);
  });
});
