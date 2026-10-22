import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createLocalObjectStore } from "../logs/objectStore";
import { addConfigSetFile, createConfigSet } from "../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "./catalogProjectValueSync";

const ORG = "org-upload-sync", PROJECT = "project-upload-sync", ADMIN = "user-upload-sync";
const admin = makeTestAuthContext({ organizationId: ORG, userId: ADMIN, roles: [{ roleId: "admin", projectId: null }] });
const base = '/dts-v1/; / { compatible = "test,board"; charger: charger { compatible = "acme,power"; iin_max = <36>; }; };';

// A project without a "default" set used to re-sync whichever set sorted first
// after every upload; a Canonical overlay there made unrelated uploads 409.
describe("parameter file upload materializes only the revision it ingested", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>, directory: string;
  const post = <T,>(path: string, body: unknown) => requestJson<T>(createWiseEffServer({ db, objectStore: storage }), path,
    { method: "POST", headers: { "x-wiseeff-user": ADMIN }, body: JSON.stringify(body) });
  const upload = (fileName: string, text: string) => post<{ item: { id: string } }>(`/api/v1/projects/${PROJECT}/parameter-files`,
    { fileName, contentBase64: Buffer.from(text).toString("base64") });

  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("upload-sync-scope");
    db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-upload-sync-")); storage = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'Upload sync')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Upload admin','Admin',true)", [ADMIN, ORG]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Upload project','UPLOADSYNC','initialized')", [PROJECT, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('upload-sync-role',$1,$2,'admin')", [ADMIN, ORG]);
    await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power", compatible: "acme,power", businessName: "Upload sync",
      driverName: "Upload charger", idempotencyKey: "upload-sync-register", reason: "Upload sync scope regression" });
    const configSetId = (await createConfigSet(db, admin, { projectId: PROJECT, name: "a-overlay" })).id;
    const uploaded = await uploadProjectParameterFile(db, storage, admin, { projectId: PROJECT, fileName: "board.dts", bytes: Buffer.from(base) });
    await addConfigSetFile(db, admin, { configSetId, fileId: uploaded.file.id, role: "base", sortOrder: 0 });
    const revision = await ingestConfigRevision(db, { organizationId: ORG, projectId: PROJECT, configSetId, entryFile: "board.dts",
      includeSearchPaths: ["."], overlayOrder: [], members: [{ fileId: uploaded.file.id, fileVersionId: uploaded.version.id,
        fileName: "board.dts", sourceName: "board.dts", role: "base", sortOrder: 0, content: base }] }, admin);
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Missing upload sync Catalog fixture");
    await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), snapshot,
      { organizationId: ORG, projectId: PROJECT, configSetId, configRevisionId: revision.id }));
    const candidate = await post<{ item: { id: string } }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates`, {
      fileName: "limits-overlay.dts", contentBase64: Buffer.from("/dts-v1/; /plugin/; &charger { iin_max = <42>; };").toString("base64") });
    expect(candidate.status, candidate.bodyText).toBe(201);
    const addition = `/api/v1/projects/${PROJECT}/config-sets/${configSetId}/member-addition`;
    const body = { candidateId: candidate.body.item.id, role: "overlay", sortOrder: 1 };
    const preview = await post<{ item: { proofToken: string } }>(`${addition}/preview`, body);
    expect(preview.status, preview.bodyText).toBe(200);
    const applied = await post(`${addition}/apply`, { ...body, proofToken: preview.body.item.proofToken,
      reason: "Overlay overrides the bound property", clientMutationId: "upload-sync-overlay" });
    expect(applied.status, applied.bodyText).toBe(200);
  }, 120_000);

  afterAll(async () => {
    await db?.close(); await lane?.drop(); if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("uploads a loose file without re-materializing another configuration set", async () => {
    const before = await listCatalogBindingRowsForProject(db, admin, { projectId: PROJECT });
    expect(before).toEqual([expect.objectContaining({ rawValue: "<42>" })]);
    const response = await upload("loose.dts", '/dts-v1/; / { loose { compatible = "acme,power"; iin_max = <5>; }; };');
    expect(response.status, response.bodyText).toBe(201);
    expect(await listCatalogBindingRowsForProject(db, admin, { projectId: PROJECT })).toEqual(before);
  });

  it("materializes the uploaded member's own configuration revision", async () => {
    const fresh = '/dts-v1/; / { compatible = "test,board"; spare { compatible = "acme,power"; iin_max = <7>; }; };';
    const configSetId = (await createConfigSet(db, admin, { projectId: PROJECT, name: "z-fresh" })).id;
    const first = await upload("fresh.dts", fresh);
    expect(first.status, first.bodyText).toBe(201);
    await addConfigSetFile(db, admin, { configSetId, fileId: first.body.item.id, role: "base", sortOrder: 0 });
    const member = await upload("fresh.dts", fresh);
    expect(member.status, member.bodyText).toBe(201);
    const latest = (await db.query<{ id: string }>(
      "select id from dts_config_revisions where config_set_id=$1 order by revision_number desc limit 1", [configSetId])).rows[0]!;
    const pins = await db.query<{ raw_text: string }>(`select property.raw_text
      from parameter_catalog.current_project_parameter_bindings binding
      join parameter_catalog.project_value_source_pins pin on pin.project_value_id=binding.current_value_id and pin.binding_id=binding.id
      join dts_property_occurrences property on property.id=pin.property_occurrence_id
      where binding.project_id=$1 and pin.config_revision_id=$2`, [PROJECT, latest.id]);
    expect(pins.rows).toEqual([{ raw_text: "<7>" }]);
  });
});
