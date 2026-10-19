import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { createLocalObjectStore } from "../logs/objectStore";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { addConfigSetFile, createConfigSet } from "./configSetService";
import { registerParameterFileRoutes } from "./routes";
import { uploadProjectParameterFile } from "./service";
import type { SourceRevisionRequestDto } from "./sourceRevisionRoutes";
import type { SourceRevisionPreview } from "./sourceRevisionService";

const ORG = "org-source-http", PROJECT = "project-source-http", AUTHOR = "user-source-http-author", REVIEWER = "user-source-http-reviewer";
const author = makeTestAuthContext({ organizationId: ORG, userId: AUTHOR, roles: [{ roleId: "admin", projectId: null }] });
const reviewer = makeTestAuthContext({ organizationId: ORG, userId: REVIEWER, roles: [{ roleId: "admin", projectId: null }] });
const outsider = makeTestAuthContext({ organizationId: ORG, userId: "user-source-http-outsider", roles: [{ roleId: "admin", projectId: null }] });
const foreign = makeTestAuthContext({ organizationId: "org-source-http-foreign", userId: "user-source-http-foreign", roles: [{ roleId: "admin", projectId: null }] });
const source = `/dts-v1/;\n/ { compatible = "test,board"; model = "source HTTP";\n charger: charger { compatible = "acme,power"; iin_max = <36>; };\n};\n`;

describe("whole-source HTTP through the real API database role", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let api: ReturnType<typeof createPostgresDatabase>;
  let directory: string;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let fileId: string, versionId: string, revisionId: string, configSetId: string, bindingId: string;
  const runtimeToken = `source_http_${process.pid}`;
  const path = `/api/v2/projects/${PROJECT}/source-revision-requests`;

  function route(auth = author) {
    const router = createRouter();
    registerParameterFileRoutes(router, { db: api, objectStore: storage,
      refusalAuditSink: createTrustedRefusalAuditSink(db), getCurrentAuthContext: () => auth });
    return createHttpServer(router);
  }
  function post<T>(url: string, body: unknown, auth = author) {
    return requestJson<T>(route(auth), url, { method: "POST", body: JSON.stringify(body) });
  }
  async function stage(text: string, mutation: string) {
    const created = await post<{ item: { id: string } }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates`, {
      fileId, fileName: "board.dts", contentBase64: Buffer.from(text).toString("base64"), intent: "source_revision",
      expectedCurrentVersionId: versionId, expectedConfigRevisionId: revisionId, clientMutationId: mutation
    });
    expect(created.status, created.bodyText).toBe(201);
    const candidateId = created.body.item.id;
    const preview = await requestJson<{ item: SourceRevisionPreview }>(route(), `/api/v1/projects/${PROJECT}/parameter-file-candidates/${candidateId}/source-preview`);
    expect(preview.status, preview.bodyText).toBe(200);
    const submitted = await post<{ item: { requestId: string; status: string } }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates/${candidateId}/source-submit`, {
      expectedCurrentVersionId: versionId, expectedProofToken: preview.body.item.proofToken,
      clientMutationId: `${mutation}-submit`, reason: "Synthetic HTTP source revision", assignedToUserId: REVIEWER
    });
    expect(submitted.status, submitted.bodyText).toBe(200);
    return { id: submitted.body.item.requestId, proofDigest: preview.body.item.proofToken, preview: preview.body.item, text };
  }

  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("source-http");
    db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-source-http-"));
    storage = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'Source HTTP'),($2,'Foreign HTTP')", [ORG, foreign.organization.id]);
    await db.query(`insert into users(id,organization_id,name,title,is_active) values
      ($1,$2,'Author','Admin',true),($3,$2,'Reviewer','Admin',true),($4,$2,'Outsider','Admin',true),($5,$6,'Foreign','Admin',true)`,
    [AUTHOR, ORG, REVIEWER, outsider.user.id, foreign.user.id, foreign.organization.id]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Source HTTP','SRCHTTP','initialized')", [PROJECT, ORG]);
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values
      ('source-http-author-role',$1,$2,null,'admin'),('source-http-reviewer-role',$3,$2,null,'admin'),
      ('source-http-outsider-role',$4,$2,null,'admin'),('source-http-foreign-role',$5,$6,null,'admin'),
      ('source-http-reviewer-software',$3,$2,$7,'software-committer')`,
    [AUTHOR, ORG, REVIEWER, outsider.user.id, foreign.user.id, foreign.organization.id, PROJECT]);
    await installDriverSourceFixture(db, author, { subjectId: "csub_acme_power", compatible: "acme,power", businessName: "Source HTTP",
      driverName: "Acme power", idempotencyKey: "source-http-registration", reason: "Synthetic source HTTP acceptance" });
    configSetId = (await createConfigSet(db, author, { projectId: PROJECT, name: "Source HTTP" })).id;
    const uploaded = await uploadProjectParameterFile(db, storage, author, { projectId: PROJECT, fileName: "board.dts", bytes: Buffer.from(source) });
    fileId = uploaded.file.id; versionId = uploaded.version.id;
    await addConfigSetFile(db, author, { configSetId, fileId, role: "base", sortOrder: 0 });
    const revision = await ingestConfigRevision(db, { organizationId: ORG, projectId: PROJECT, configSetId, entryFile: "board.dts",
      includeSearchPaths: ["."], overlayOrder: [], members: [{ fileId, fileVersionId: versionId, fileName: "board.dts", sourceName: "board.dts",
        role: "base", sortOrder: 0, content: source }] }, author);
    revisionId = revision.id;
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Source HTTP Catalog fixture is unavailable.");
    await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog, {
      organizationId: ORG, projectId: PROJECT, configSetId, configRevisionId: revisionId }));
    const bindings = await listCatalogBindingRowsForProject(db, author, { projectId: PROJECT });
    expect(bindings).toHaveLength(1); bindingId = bindings[0]!.id;
    const logins = await provisionPublicationRuntimeLogins(lane.url, { mode: "lab", runToken: runtimeToken });
    api = createPostgresDatabase(logins.apiUrl);
    expect((await api.query<{ owner: boolean }>("select current_user='catalog_migration_owner' as owner")).rows[0]!.owner).toBe(false);
  }, 120_000);

  afterAll(async () => {
    await api?.close();
    if (lane) await dropLabRuntimeLogins(lane.url, runtimeToken);
    await db?.close(); await lane?.drop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("saves exact source through candidate, preview, submit and assigned approval, retaining a real Binding", async () => {
    const pending = await stage(source.replace("<36>", "<42>").replace("\n};", "\n /* reviewed HTTP comment */\n};"), "http-approve");
    expect(pending.preview).toMatchObject({ kind: "source_revision", format: "dts", impact: { parameterChanges: 1 }, reviewers: expect.arrayContaining([{ userId: REVIEWER, name: "Reviewer" }]) });
    const mine = await requestJson<{ items: SourceRevisionRequestDto[] }>(route(), `${path}?mine=true&status=pending`);
    expect(mine.status).toBe(200); expect(mine.body.items.map((item) => item.id)).toContain(pending.id);
    const detail = await requestJson<{ item: SourceRevisionRequestDto }>(route(reviewer), `${path}/${pending.id}`);
    expect(detail.status).toBe(200); expect(detail.body.item).toMatchObject({ before: source, after: pending.text });
    expect((await post(`${path}/${pending.id}/review`, { decision: "approve", proofDigest: pending.proofDigest }, author)).status).toBe(403);
    expect((await post(`${path}/${pending.id}/review`, { decision: "approve", proofDigest: pending.proofDigest }, outsider)).status).toBe(403);
    expect((await requestJson(route(outsider), `${path}/${pending.id}`)).status).toBe(404);
    expect((await requestJson(route(foreign), `${path}/${pending.id}`)).status).toBe(404);
    await db.query("delete from user_role_bindings where id='source-http-reviewer-role'");
    expect((await post(`${path}/${pending.id}/review`, { decision: "approve", proofDigest: pending.proofDigest }, reviewer)).status).toBe(403);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('source-http-reviewer-role',$1,$2,null,'admin')", [REVIEWER, ORG]);
    expect((await post(`${path}/${pending.id}/review`, { decision: "approve", proofDigest: "0".repeat(64) }, reviewer)).status).toBe(409);
    const approved = await post<{ item: SourceRevisionRequestDto }>(`${path}/${pending.id}/review`, { decision: "approve", proofDigest: pending.proofDigest }, reviewer);
    expect(approved.status, approved.bodyText).toBe(200);
    expect(approved.body.item.status).toBe("approved");
    const receipt = approved.body.item.appliedSourceResult!;
    expect(receipt.fileVersionId).not.toBe(versionId); expect(receipt.configRevisionId).not.toBe(revisionId);
    versionId = receipt.fileVersionId; revisionId = receipt.configRevisionId;
    const retry = await post<{ item: SourceRevisionRequestDto }>(`${path}/${pending.id}/review`, { decision: "approve", proofDigest: pending.proofDigest }, reviewer);
    expect(retry.status, retry.bodyText).toBe(200); expect(retry.body.item.appliedSourceResult).toEqual(receipt);
    const after = await requestJson<{ item: SourceRevisionRequestDto }>(route(), `${path}/${pending.id}`);
    expect(after.body.item.after).toBe(pending.text);
    const bindings = await listCatalogBindingRowsForProject(api, author, { projectId: PROJECT });
    expect(bindings).toHaveLength(1); expect(bindings[0]).toMatchObject({ id: bindingId, rawValue: "<42>" });
    const file = (await db.query<{ storage_key: string }>("select storage_key from project_parameter_file_versions where id=$1", [versionId])).rows[0]!;
    expect((await storage.get(file.storage_key)).toString("utf8")).toBe(pending.text);
    expect((await db.query("select id from audit_events where target_id=$1 and action='value-change-applied'", [pending.id])).rows).toHaveLength(1);
  });

  it("rejects and withdraws complete source requests idempotently without advancing source or values", async () => {
    const current = (await db.query<{ storage_key: string }>("select storage_key from project_parameter_file_versions where id=$1", [versionId])).rows[0]!;
    const active = (await storage.get(current.storage_key)).toString("utf8");
    const rejected = await stage(`${active}\n/* reject */\n`, "http-reject");
    const reject = () => post<{ item: SourceRevisionRequestDto }>(`${path}/${rejected.id}/review`, { decision: "reject", proofDigest: rejected.proofDigest, note: "Needs correction" }, reviewer);
    expect((await reject()).body.item.status).toBe("rejected"); expect((await reject()).body.item.status).toBe("rejected");
    expect((await post(`${path}/${rejected.id}/withdraw`, {}, author)).status).toBe(409);
    const withdrawn = await stage(`${active}\n/* withdraw */\n`, "http-withdraw");
    expect((await post(`${path}/${withdrawn.id}/withdraw`, {}, reviewer)).status).toBe(403);
    const withdraw = () => post<{ item: SourceRevisionRequestDto }>(`${path}/${withdrawn.id}/withdraw`, {}, author);
    expect((await withdraw()).body.item.status).toBe("withdrawn"); expect((await withdraw()).body.item.status).toBe("withdrawn");
    expect((await post(`${path}/${withdrawn.id}/review`, { decision: "approve", proofDigest: withdrawn.proofDigest }, reviewer)).status).toBe(409);
    const file = (await db.query<{ current_version_id: string }>("select current_version_id from project_parameter_files where id=$1", [fileId])).rows[0]!;
    expect(file.current_version_id).toBe(versionId);
    expect((await listCatalogBindingRowsForProject(api, author, { projectId: PROJECT }))[0]).toMatchObject({ id: bindingId, rawValue: "<42>" });
  });
});
