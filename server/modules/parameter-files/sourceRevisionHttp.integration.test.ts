import { mkdtemp, rm } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { createWiseEffServer } from "../../app";
import { createTokenVerifier } from "../auth/tokenVerifier";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createAgentInvocation, createSystemInvocation } from "../auth/trustedInvocation";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { createLocalObjectStore } from "../logs/objectStore";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { registerParameterTopologyRoutes } from "../parameter-topology/routes";
import { addConfigSetFile, createConfigSet } from "./configSetService";
import { registerParameterFileRoutes } from "./routes";
import { uploadProjectParameterFile } from "./service";
import type { SourceRevisionRequestDto } from "./sourceRevisionRoutes";
import type { SourceRevisionPreview } from "./sourceRevisionService";
import { applySourceRevisionCandidate } from "./sourceRevisionCommit";

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
    registerParameterTopologyRoutes(router, { db: api, getCurrentAuthContext: () => auth });
    return createHttpServer(router);
  }
  function post<T>(url: string, body: unknown, auth = author) {
    return requestJson<T>(route(auth), url, { method: "POST", body: JSON.stringify(body) });
  }
  async function prepare(text: string, mutation: string) {
    const created = await post<{ item: { id: string } }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates`, {
      fileId, fileName: "board.dts", contentBase64: Buffer.from(text).toString("base64"), intent: "source_revision",
      expectedCurrentVersionId: versionId, expectedConfigRevisionId: revisionId, clientMutationId: mutation
    });
    expect(created.status, created.bodyText).toBe(201);
    const candidateId = created.body.item.id;
    const preview = await requestJson<{ item: SourceRevisionPreview }>(route(), `/api/v1/projects/${PROJECT}/parameter-file-candidates/${candidateId}/source-preview`);
    expect(preview.status, preview.bodyText).toBe(200);
    return { candidateId, preview: preview.body.item };
  }
  async function stage(text: string, mutation: string) {
    const { candidateId, preview } = await prepare(text, mutation);
    const submitted = await post<{ item: { requestId: string; status: string } }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates/${candidateId}/source-submit`, {
      expectedCurrentVersionId: versionId, expectedProofToken: preview.proofToken,
      clientMutationId: `${mutation}-submit`, reason: "Synthetic HTTP source revision", assignedToUserId: REVIEWER
    });
    expect(submitted.status, submitted.bodyText).toBe(200);
    return { id: submitted.body.item.requestId, proofDigest: preview.proofToken, preview, text };
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
    const administratorDetail = await requestJson<{ item: SourceRevisionRequestDto }>(route(outsider), `${path}/${pending.id}`);
    expect(administratorDetail.status, administratorDetail.bodyText).toBe(200);
    expect(administratorDetail.body.item).toMatchObject({ before: source,after: pending.text,canAdminister: true });
    const administratorQueue = await requestJson<{ items: SourceRevisionRequestDto[] }>(route(outsider), `${path}?status=pending`);
    expect(administratorQueue.body.items.map((item) => item.id)).toContain(pending.id);
    expect((await requestJson(route(foreign), `${path}/${pending.id}`)).status).toBe(404);
    await db.query("delete from user_role_bindings where id='source-http-reviewer-role'");
    expect((await post(`${path}/${pending.id}/review`, { decision: "approve", proofDigest: pending.proofDigest }, reviewer)).status).toBe(403);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('source-http-reviewer-role',$1,$2,null,'admin')", [REVIEWER, ORG]);
    expect((await post(`${path}/${pending.id}/review`, { decision: "approve", proofDigest: "0".repeat(64) }, reviewer)).status).toBe(409);
    const approved = await post<{ item: SourceRevisionRequestDto }>(`${path}/${pending.id}/review`, { decision: "approve", proofDigest: pending.proofDigest }, reviewer);
    expect(approved.status, approved.bodyText).toBe(200);
    expect(approved.body.item).toMatchObject({ status: "approved", applicationMode: "separate_review", reviewerUserId: REVIEWER });
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

  it("lets another administrator cancel an orphaned request with a reason and unblock a fresh submission", async () => {
    const pending = await stage(`${source}\n/* orphaned request */\n`,"http-orphan");
    const frozen = (await db.query("select source_revision_context,candidate_member_manifest,candidate_binding_manifest,reason from project_parameter_value_change_requests where id=$1",[pending.id])).rows;
    await db.query("update users set is_active=false where id=any($1::text[])",[[AUTHOR,REVIEWER]]);
    try {
      const detail = await requestJson<{ item: SourceRevisionRequestDto }>(route(outsider),`${path}/${pending.id}`);
      expect(detail.status,detail.bodyText).toBe(200);
      expect(detail.body.item).toMatchObject({ canAdminister: true,after: pending.text });
      const body = { proofDigest: pending.proofDigest,expectedAssignedToUserId: REVIEWER,reason: "双方已离职，解除配置阻塞" };
      expect((await post(`${path}/${pending.id}/cancel`,{ ...body,reason: " " },outsider)).status).toBe(400);
      expect((await post(`${path}/${pending.id}/cancel`,{ ...body,proofDigest: "0".repeat(64) },outsider)).status).toBe(409);
      const cancel = () => post<{ item: SourceRevisionRequestDto }>(`${path}/${pending.id}/cancel`,body,outsider);
      const cancelled = await cancel();
      expect(cancelled.status,cancelled.bodyText).toBe(200);
      expect(cancelled.body.item).toMatchObject({ status: "withdrawn",reviewerUserId: null,
        cancellation: { userId: outsider.user.id,name: "Outsider",reason: body.reason } });
      expect((await cancel()).body).toEqual(cancelled.body);
      expect((await db.query("select source_revision_context,candidate_member_manifest,candidate_binding_manifest,reason from project_parameter_value_change_requests where id=$1",[pending.id])).rows).toEqual(frozen);
      expect((await db.query("select actor_type,actor_user_id,metadata->>'reason' as reason from audit_events where target_id=$1 and action='source-request-cancelled'",[pending.id])).rows)
        .toEqual([{ actor_type: "user",actor_user_id: outsider.user.id,reason: body.reason }]);
    } finally { await db.query("update users set is_active=true where id=any($1::text[])",[[AUTHOR,REVIEWER]]); }
    const next = await stage(`${source}\n/* unblocked legitimate submission */\n`,"http-after-cancel");
    expect((await post(`${path}/${next.id}/withdraw`,{})).status).toBe(200);
  });

  it("reassigns only to a current eligible non-author and preserves the frozen proof and real reviewer", async () => {
    const active = (await db.query<{ storage_key: string }>("select storage_key from project_parameter_file_versions where id=$1",[versionId])).rows[0]!;
    const text = `${(await storage.get(active.storage_key)).toString("utf8")}\n/* reassigned unchanged source */\n`;
    const pending = await stage(text,"http-reassign");
    const frozen = (await db.query("select source_revision_context,candidate_member_manifest,candidate_binding_manifest,reason from project_parameter_value_change_requests where id=$1",[pending.id])).rows;
    const body = { proofDigest: pending.proofDigest,expectedAssignedToUserId: REVIEWER,assignedToUserId: outsider.user.id };
    const endpoint = `${path}/${pending.id}/reassign`;
    expect((await post(endpoint,{ ...body,assignedToUserId: AUTHOR },outsider)).status).toBe(400);
    expect((await post(endpoint,{ ...body,assignedToUserId: foreign.user.id },outsider)).status).toBe(400);
    await db.query("update user_role_bindings set role_id='software-user' where id='source-http-outsider-role'");
    try { expect((await post(endpoint,body,reviewer)).status).toBe(400); }
    finally { await db.query("update user_role_bindings set role_id='admin' where id='source-http-outsider-role'"); }
    await expect(api.transaction((tx) => tx.query("update project_parameter_value_change_requests set assigned_to_user_id=$2 where id=$1",[pending.id,outsider.user.id])))
      .rejects.toMatchObject({ code: "23514" });
    const reassign = () => post<{ item: SourceRevisionRequestDto }>(endpoint,body,outsider);
    const reassigned = await reassign();
    expect(reassigned.status,reassigned.bodyText).toBe(200);
    expect(reassigned.body.item).toMatchObject({ status: "pending",assignedToUserId: outsider.user.id,reviewerUserId: null });
    expect((await reassign()).body).toEqual(reassigned.body);
    expect((await post(endpoint,{ ...body,assignedToUserId: REVIEWER },outsider)).status).toBe(409);
    expect((await db.query("select source_revision_context,candidate_member_manifest,candidate_binding_manifest,reason from project_parameter_value_change_requests where id=$1",[pending.id])).rows).toEqual(frozen);
    expect((await db.query("select actor_user_id,metadata->>'fromAssignedToUserId' as previous,metadata->>'toAssignedToUserId' as assigned from audit_events where target_id=$1 and action='source-request-reassigned'",[pending.id])).rows)
      .toEqual([{ actor_user_id: outsider.user.id,previous: REVIEWER,assigned: outsider.user.id }]);
    expect((await post(`${path}/${pending.id}/review`,{ decision: "approve",proofDigest: pending.proofDigest },reviewer)).status).toBe(403);
    const approved = await post<{ item: SourceRevisionRequestDto }>(`${path}/${pending.id}/review`,{ decision: "approve",proofDigest: pending.proofDigest },outsider);
    expect(approved.status,approved.bodyText).toBe(200);
    expect(approved.body.item.reviewerUserId).toBe(outsider.user.id);
    versionId = approved.body.item.appliedSourceResult!.fileVersionId; revisionId = approved.body.item.appliedSourceResult!.configRevisionId;
    expect((await post(endpoint,body,outsider)).status).toBe(409);
  });

  it("rechecks current administration and rolls back cancellation when its audit fails", async () => {
    const pending = await stage(`${source}\n/* administrative refusals */\n`,"http-admin-refusals");
    const body = { proofDigest: pending.proofDigest,expectedAssignedToUserId: REVIEWER,reason: "Cancel with a committed audit" };
    expect((await post(`${path}/${pending.id}/cancel`,body,foreign)).status).toBe(404);
    await db.query("update user_role_bindings set role_id='software-user' where id='source-http-outsider-role'");
    try {
      expect((await post(`${path}/${pending.id}/cancel`,body,outsider)).status).toBe(403);
      expect((await requestJson(route(outsider),`${path}/${pending.id}`)).status).toBe(404);
      const queue = await requestJson<{ items: SourceRevisionRequestDto[] }>(route(outsider),`${path}?status=pending`);
      expect(queue.body.items).toEqual([]);
    } finally { await db.query("update user_role_bindings set role_id='admin' where id='source-http-outsider-role'"); }
    await db.query(`create function public.fail_source_administration_audit_test() returns trigger language plpgsql as $$ begin
      if new.action='source-request-cancelled' then raise exception 'Synthetic audit failure'; end if; return new; end $$`);
    await db.query("create trigger fail_source_administration_audit_test before insert on audit_events for each row execute function public.fail_source_administration_audit_test()");
    try { expect((await post(`${path}/${pending.id}/cancel`,body,outsider)).status).toBe(500); }
    finally { await db.query("drop trigger fail_source_administration_audit_test on audit_events"); await db.query("drop function public.fail_source_administration_audit_test()"); }
    const stillPending = await requestJson<{ item: SourceRevisionRequestDto }>(route(),`${path}/${pending.id}`);
    expect(stillPending.body.item).toMatchObject({ status: "pending",cancellation: null,assignedToUserId: REVIEWER });
    await expect(api.transaction((tx) => tx.query("update project_parameter_value_change_requests set status='withdrawn' where id=$1",[pending.id])))
      .rejects.toMatchObject({ code: "23514" });
    expect((await post(`${path}/${pending.id}/cancel`,body,outsider)).status).toBe(200);
    await expect(api.transaction((tx) => tx.query("update project_parameter_value_change_requests set status='pending' where id=$1",[pending.id])))
      .rejects.toMatchObject({ code: "23514" });
  });

  it("preserves the existing file administrator scope when a role binding carries another project ID", async () => {
    const pending = await stage(`${source}\n/* existing administrator scope */\n`,"http-admin-scope");
    await db.query("insert into projects(id,organization_id,name,code,status) values('source-http-other-project',$1,'Other project','OTHER','initialized')",[ORG]);
    await db.query("update user_role_bindings set project_id='source-http-other-project' where id='source-http-outsider-role'");
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values('source-http-outsider-software',$1,$2,$3,'software-committer')",[outsider.user.id,ORG,PROJECT]);
    try {
      const cancelBody = { proofDigest: pending.proofDigest,expectedAssignedToUserId: REVIEWER,reason: "Keep the existing administrator scope" };
      const cancelled = await post(`${path}/${pending.id}/cancel`,cancelBody,outsider);
      expect(cancelled.status,cancelled.bodyText).toBe(200);
      const next = await stage(`${source}\n/* existing reviewer eligibility */\n`,"http-admin-scope-reviewer");
      const reassigned = await post(`${path}/${next.id}/reassign`,{ proofDigest: next.proofDigest,
        expectedAssignedToUserId: REVIEWER,assignedToUserId: outsider.user.id },reviewer);
      expect(reassigned.status,reassigned.bodyText).toBe(200);
      expect((await post(`${path}/${next.id}/cancel`,{ ...cancelBody,proofDigest: next.proofDigest,expectedAssignedToUserId: outsider.user.id },outsider)).status).toBe(200);
    } finally {
      await db.query("update user_role_bindings set project_id=null where id='source-http-outsider-role'");
      await db.query("delete from user_role_bindings where id='source-http-outsider-software'");
    }
  });

  it("serializes cancellation with approval and reassignment with rejection without partial source changes", async () => {
    const activeText = async () => (await storage.get((await db.query<{ storage_key: string }>("select storage_key from project_parameter_file_versions where id=$1",[versionId])).rows[0]!.storage_key)).toString("utf8");
    const original = await activeText();
    const pending = await stage(`${original}\n/* cancel versus approve */\n`,"http-admin-cancel-race");
    const outcomes = await Promise.all([
      post<{ item: SourceRevisionRequestDto }>(`${path}/${pending.id}/cancel`,{ proofDigest: pending.proofDigest,expectedAssignedToUserId: REVIEWER,reason: "Cancel race" },outsider),
      post<{ item: SourceRevisionRequestDto }>(`${path}/${pending.id}/review`,{ decision: "approve",proofDigest: pending.proofDigest },reviewer)
    ]);
    expect(outcomes.map((reply) => reply.status).sort(),outcomes.map((reply) => reply.bodyText).join("\n")).toEqual([200,409]);
    const final = await requestJson<{ item: SourceRevisionRequestDto }>(route(outsider),`${path}/${pending.id}`);
    expect(["withdrawn","approved"]).toContain(final.body.item.status);
    if (final.body.item.status === "approved") {
      expect(final.body.item.reviewerUserId).toBe(REVIEWER);
      versionId = final.body.item.appliedSourceResult!.fileVersionId; revisionId = final.body.item.appliedSourceResult!.configRevisionId;
      expect(await activeText()).toBe(pending.text);
    } else { expect(final.body.item.reviewerUserId).toBeNull(); expect(await activeText()).toBe(original); }
    expect((await db.query("select id from audit_events where target_id=$1 and action in ('source-request-cancelled','value-change-applied')",[pending.id])).rows).toHaveLength(1);
    const second = await stage(`${await activeText()}\n/* reassign versus reject */\n`,"http-admin-reassign-race");
    const competing = await Promise.all([
      post(`${path}/${second.id}/reassign`,{ proofDigest: second.proofDigest,expectedAssignedToUserId: REVIEWER,assignedToUserId: outsider.user.id },outsider),
      post(`${path}/${second.id}/review`,{ decision: "reject",proofDigest: second.proofDigest,note: "Review race" },reviewer)
    ]);
    expect(competing.filter((reply) => reply.status===200),competing.map((reply) => reply.bodyText).join("\n")).toHaveLength(1);
    expect(competing.every((reply) => [200,403,409].includes(reply.status))).toBe(true);
    const current = await requestJson<{ item: SourceRevisionRequestDto }>(route(outsider),`${path}/${second.id}`);
    if (current.body.item.status === "pending") {
      expect(current.body.item.assignedToUserId).toBe(outsider.user.id); expect(current.body.item.reviewerUserId).toBeNull();
      expect((await post(`${path}/${second.id}/review`,{ decision: "reject",proofDigest: second.proofDigest },outsider)).status).toBe(200);
    } else expect(current.body.item).toMatchObject({ status: "rejected",reviewerUserId: REVIEWER });
  });

  it("lets one current administrator directly apply a preview without inventing a reviewer", async () => {
    const text = source.replace("<36>", "<43>") + "\n/* directly applied by the sole administrator */\n";
    const { candidateId, preview } = await prepare(text, "http-direct");
    const body = { expectedCurrentVersionId: versionId, expectedProofToken: preview.proofToken,
      clientMutationId: "http-direct-apply", reason: "Administrator verified the complete source diff" };
    const apply = () => post<{ item: SourceRevisionRequestDto }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates/${candidateId}/source-apply`, body);
    expect((await post(`/api/v1/projects/${PROJECT}/parameter-file-candidates/${candidateId}/source-apply`, { ...body, assignedToUserId: AUTHOR })).status).toBe(400);
    await db.query("update users set is_active=false where id=any($1::text[])", [[REVIEWER, outsider.user.id]]);
    const singleAdminPreview = await requestJson<{ item: SourceRevisionPreview }>(route(), `/api/v1/projects/${PROJECT}/parameter-file-candidates/${candidateId}/source-preview`);
    expect(singleAdminPreview.body.item.reviewers).toHaveLength(0);
    const applied = await apply().finally(() => db.query("update users set is_active=true where id=any($1::text[])", [[REVIEWER, outsider.user.id]]));
    expect(applied.status, applied.bodyText).toBe(200);
    expect(applied.body.item).toMatchObject({ status: "approved", applicationMode: "administrator_direct",
      submitterUserId: AUTHOR, assignedToUserId: null, reviewerUserId: null });
    const receipt = applied.body.item.appliedSourceResult!;
    expect(receipt.fileVersionId).not.toBe(versionId);
    expect(receipt.configRevisionId).not.toBe(revisionId);
    const retry = await apply();
    expect(retry.status, retry.bodyText).toBe(200);
    expect(retry.body.item.appliedSourceResult).toEqual(receipt);
    const detail = await requestJson<{ item: SourceRevisionRequestDto }>(route(), `${path}/${applied.body.item.id}`);
    expect(detail.body.item.after).toBe(text);
    expect((await listCatalogBindingRowsForProject(api, author, { projectId: PROJECT }))[0]).toMatchObject({ id: bindingId, rawValue: "<43>" });
    expect((await db.query(`select actor_type,actor_user_id,metadata->>'applicationMode' as application_mode
      from audit_events where target_id=$1 and action='value-change-applied'`, [applied.body.item.id])).rows).toEqual([
      { actor_type: "user", actor_user_id: AUTHOR, application_mode: "administrator_direct" }
    ]);
    await expect(db.transaction((tx) => tx.query("update project_parameter_value_change_requests set source_revision_application_mode='separate_review' where id=$1",
      [applied.body.item.id]))).rejects.toMatchObject({ code: "23514" });
    expect((await post(`${path}/${applied.body.item.id}/review`, { decision: "approve", proofDigest: preview.proofToken })).status).toBe(403);
    versionId = receipt.fileVersionId; revisionId = receipt.configRevisionId;
  });

  it("rechecks the preview, organization, current administrator role, sensitive nodes and pending reviews before direct application", async () => {
    const text = source.replace("<36>", "<43>") + "\n/* checked refusals */\n";
    const { candidateId, preview } = await prepare(text, "http-direct-refusals");
    const url = `/api/v1/projects/${PROJECT}/parameter-file-candidates/${candidateId}/source-apply`;
    const body = { expectedCurrentVersionId: versionId, expectedProofToken: preview.proofToken,
      clientMutationId: "http-direct-refusals", reason: "Refusal paths leave source untouched" };
    expect((await post(url, { ...body, expectedProofToken: "0".repeat(64) })).status).toBe(409);
    expect((await post(url, { ...body, expectedCurrentVersionId: "old-version" })).status).toBe(409);
    expect((await post(url, body, foreign)).status).toBe(404);
    await db.query("update user_role_bindings set role_id='software-user' where id='source-http-author-role'");
    try { expect((await post(url, body)).status).toBe(403); }
    finally { await db.query("update user_role_bindings set role_id='admin' where id='source-http-author-role'"); }
    await db.query(`insert into dts_sensitive_node_rules(id,organization_id,project_id,match_type,pattern,risk_tier,required_capability)
      values ('source-http-sensitive',$1,$2,'compatible','acme,power','critical','platform:access')`, [ORG, PROJECT]);
    try { expect((await post(url, body)).status).toBe(403); }
    finally { await db.query("delete from dts_sensitive_node_rules where id='source-http-sensitive'"); }
    const pending = await stage(`${text}\n/* independent review remains pending */\n`, "http-pending-direct-conflict");
    const conflict = await post(url, body);
    expect(conflict.status, conflict.bodyText).toBe(409);
    expect((await post(`${path}/${pending.id}/withdraw`, {})).status).toBe(200);
    expect((await db.query("select current_version_id from project_parameter_files where id=$1", [fileId])).rows[0]).toMatchObject({ current_version_id: versionId });
    expect((await listCatalogBindingRowsForProject(api, author, { projectId: PROJECT }))[0]).toMatchObject({ id: bindingId, rawValue: "<43>" });
  });

  it("refuses Agent and system invocations even when an Agent already has a human approval", async () => {
    const first = await prepare(source.replace("<36>", "<43>") + "\n/* human operation only */\n", "http-direct-user-only");
    for (const invocation of [createAgentInvocation(author, { sessionId: "source-agent", toolCallId: "source-tool",
      approval: { required: true, approvalId: "already-approved" } }), createSystemInvocation({ kind: "job", name: "source-job" })]) {
      await expect(applySourceRevisionCandidate(api, storage, author, { projectId: PROJECT, candidateId: first.candidateId,
        expectedCurrentVersionId: versionId, expectedProofToken: first.preview.proofToken, reason: "Not a direct human operation", clientMutationId: "user-only" },
      { invocation, requestId: "source-human-only", refusalSink: createTrustedRefusalAuditSink(db) })).rejects.toMatchObject({
        code: "FORBIDDEN", details: { code: "parameter-source-user-required", requireHuman: true }
      });
    }
    expect((await db.query("select id from project_parameter_value_change_requests where candidate_id=$1", [first.candidateId])).rows).toHaveLength(0);
  });

  it("applies comment-only edits once under concurrent retries and rejects a competing stale preview", async () => {
    const text = source.replace("<36>", "<43>") + "\n/* comment-only direct application */\n";
    const first = await prepare(text, "http-direct-comments");
    const stale = await prepare(`${text}\n/* competing preview */\n`, "http-direct-competing");
    expect(first.preview.impact.parameterChanges).toBe(0);
    const body = { expectedCurrentVersionId: versionId, expectedProofToken: first.preview.proofToken,
      clientMutationId: "http-direct-comments", reason: "Comments do not require a second administrator" };
    const apply = () => post<{ item: SourceRevisionRequestDto }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates/${first.candidateId}/source-apply`, body);
    const [one, two] = await Promise.all([apply(), apply()]);
    expect(one.status, one.bodyText).toBe(200); expect(two.status, two.bodyText).toBe(200);
    expect(one.body.item.appliedSourceResult).toEqual(two.body.item.appliedSourceResult);
    expect((await db.query("select id from audit_events where target_id=$1 and action='value-change-applied'", [one.body.item.id])).rows).toHaveLength(1);
    const competed = await post(`/api/v1/projects/${PROJECT}/parameter-file-candidates/${stale.candidateId}/source-apply`, {
      ...body, clientMutationId: "http-direct-competing", expectedProofToken: stale.preview.proofToken
    }, outsider);
    expect(competed.status, competed.bodyText).toBe(409);
    expect((await listCatalogBindingRowsForProject(api, author, { projectId: PROJECT }))[0]).toMatchObject({ id: bindingId, rawValue: "<43>" });
    const receipt = one.body.item.appliedSourceResult!;
    versionId = receipt.fileVersionId; revisionId = receipt.configRevisionId;
  });

  it("returns a conflict when different administrators race to apply different confirmed source previews", async () => {
    const first = await prepare(source.replace("<36>", "<44>") + "\n/* first administrator */\n", "http-direct-race-a");
    const second = await prepare(source.replace("<36>", "<45>") + "\n/* second administrator */\n", "http-direct-race-b");
    const apply = (prepared: typeof first, mutation: string, auth = author) => post<{ item: SourceRevisionRequestDto }>(
      `/api/v1/projects/${PROJECT}/parameter-file-candidates/${prepared.candidateId}/source-apply`, {
        expectedCurrentVersionId: versionId, expectedProofToken: prepared.preview.proofToken, clientMutationId: mutation, reason: "Race uses frozen proofs"
      }, auth);
    const replies = await Promise.all([apply(first, "http-direct-race-a"), apply(second, "http-direct-race-b", outsider)]);
    expect(replies.map((reply) => reply.status).sort(), replies.map((reply) => reply.bodyText).join("\n")).toEqual([200, 409]);
    const winner = replies.find((reply) => reply.status === 200)!.body.item;
    const receipt = winner.appliedSourceResult!;
    versionId = receipt.fileVersionId; revisionId = receipt.configRevisionId;
    expect((await listCatalogBindingRowsForProject(api, author, { projectId: PROJECT }))[0]).toMatchObject({ id: bindingId,
      rawValue: replies[0]!.status === 200 ? "<44>" : "<45>" });
  });

  it("lets a scoped platform actor reassign and cancel target requests while keeping approval with the separate target reviewer", async () => {
    const HOME = "source-platform-home", PLATFORM = "source-platform-actor", secret = "source-operating-scope-only";
    await db.query("insert into organizations(id,name) values($1,'Platform Home')", [HOME]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values($1,$2,'Platform administrator','Platform',true)", [PLATFORM, HOME]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('source-platform-grant',$1,$2,'platform-admin')", [PLATFORM, HOME]);
    const actual = createWiseEffServer({ db: api, objectStore: storage, env: { AUTH_PROVIDER: "hmac" }, auth: { mode: "production", verifier: createTokenVerifier({ issuer: "source-operating", secret }) } });
    const scoped = <T,>(url: string, body?: unknown, userId = PLATFORM, organizationId = HOME) => {
      const payload = Buffer.from(JSON.stringify({ iss: "source-operating", sub: userId, org: organizationId, exp: 9_999_999_999 })).toString("base64url");
      return requestJson<T>(actual, `${url}${url.includes("?") ? "&" : "?"}organizationId=${ORG}`, {
        method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    };
    async function targetPending(mutation: string) {
      const currentFile = (await db.query<{ current_version_id: string }>("select current_version_id from project_parameter_files where id=$1", [fileId])).rows[0]!;
      const currentRevision = (await db.query<{ id: string }>("select id from dts_config_revisions where config_set_id=$1 order by revision_number desc limit 1", [configSetId])).rows[0]!;
      const candidate = await scoped<{ item: { id: string } }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates`, {
        fileId, fileName: "board.dts", contentBase64: Buffer.from(`${source}\n/* ${mutation} */\n`).toString("base64"), intent: "source_revision",
        expectedCurrentVersionId: currentFile.current_version_id, expectedConfigRevisionId: currentRevision.id, clientMutationId: mutation
      });
      expect(candidate.status, candidate.bodyText).toBe(201);
      const preview = await scoped<{ item: SourceRevisionPreview }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates/${candidate.body.item.id}/source-preview`);
      expect(preview.status, preview.bodyText).toBe(200);
      const submitted = await scoped<{ item: { requestId: string } }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates/${candidate.body.item.id}/source-submit`, {
        expectedCurrentVersionId: currentFile.current_version_id, expectedProofToken: preview.body.item.proofToken,
        clientMutationId: `${mutation}-submit`, reason: "Target source managed by a real platform actor", assignedToUserId: REVIEWER
      });
      expect(submitted.status, submitted.bodyText).toBe(200);
      return { id: submitted.body.item.requestId, digest: preview.body.item.proofToken };
    }
    const pending = await targetPending("cross-organization-approval");
    const reassigned = await scoped(`${path}/${pending.id}/reassign`, { proofDigest: pending.digest, expectedAssignedToUserId: REVIEWER, assignedToUserId: outsider.user.id });
    expect(reassigned.status, reassigned.bodyText).toBe(200);
    expect((await scoped(`${path}/${pending.id}/reassign`, { proofDigest: pending.digest, expectedAssignedToUserId: outsider.user.id, assignedToUserId: REVIEWER })).status).toBe(200);
    expect((await scoped(`${path}/${pending.id}/review`, { decision: "approve", proofDigest: pending.digest })).status).toBe(403);
    const approved = await scoped<{ item: SourceRevisionRequestDto }>(`${path}/${pending.id}/review`, { decision: "approve", proofDigest: pending.digest }, REVIEWER, ORG);
    expect(approved.status, approved.bodyText).toBe(200);
    versionId = approved.body.item.appliedSourceResult!.fileVersionId;
    revisionId = approved.body.item.appliedSourceResult!.configRevisionId;
    const cancelled = await targetPending("cross-organization-cancellation");
    const cancellation = await scoped<{ item: SourceRevisionRequestDto }>(`${path}/${cancelled.id}/cancel`, {
      proofDigest: cancelled.digest, expectedAssignedToUserId: REVIEWER, reason: "Administrator cancels the target draft"
    });
    expect(cancellation.status, cancellation.bodyText).toBe(200);
    expect(cancellation.body.item).toMatchObject({ status: "withdrawn", cancellation: { userId: PLATFORM } });
    expect((await db.query("select organization_id from users where id=$1", [PLATFORM])).rows).toEqual([{ organization_id: HOME }]);
    const audit = (await db.query<{ organization_id: string; actor_user_id: string; metadata: Record<string, unknown> }>(
      "select organization_id,actor_user_id,metadata from audit_events where target_id=$1 and action='source-request-cancelled'", [cancelled.id])).rows[0];
    expect(audit).toMatchObject({ organization_id: ORG, actor_user_id: PLATFORM, metadata: { actorHomeOrganizationId: HOME, operatingOrganizationId: ORG } });
    const directCandidate = await scoped<{ item: { id: string } }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates`, {
      fileId, fileName: "board.dts", contentBase64: Buffer.from(`${source}\n/* explicit target administrator application */\n`).toString("base64"),
      intent: "source_revision", expectedCurrentVersionId: versionId, expectedConfigRevisionId: revisionId, clientMutationId: "target-direct-preview"
    });
    expect(directCandidate.status, directCandidate.bodyText).toBe(201);
    const directPreview = await scoped<{ item: SourceRevisionPreview }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates/${directCandidate.body.item.id}/source-preview`);
    expect(directPreview.status, directPreview.bodyText).toBe(200);
    const applied = await scoped<{ item: SourceRevisionRequestDto }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates/${directCandidate.body.item.id}/source-apply`, {
      expectedCurrentVersionId: versionId, expectedProofToken: directPreview.body.item.proofToken,
      clientMutationId: "target-direct-apply", reason: "Administrator confirms the existing direct-application workflow"
    });
    expect(applied.status, applied.bodyText).toBe(200);
    expect(applied.body.item).toMatchObject({ applicationMode: "administrator_direct", submitterUserId: PLATFORM, assignedToUserId: null, reviewerUserId: null });
    versionId = applied.body.item.appliedSourceResult!.fileVersionId;
    revisionId = applied.body.item.appliedSourceResult!.configRevisionId;
  });

  it("retains source review, version and binding-history authors after rename and account deletion", async () => {
    const pending = await stage(`${source}\n/* attribution */\n`, "http-history-attribution");
    const rejected = await post<{ item: SourceRevisionRequestDto }>(`${path}/${pending.id}/review`, {
      decision: "reject", proofDigest: pending.proofDigest, note: "Preserve this historical review"
    }, reviewer);
    expect(rejected.status, rejected.bodyText).toBe(200);
    await db.query("update users set name='Replacement name' where id=any($1::text[])", [[AUTHOR, REVIEWER]]);
    await db.query("update organizations set name='Renamed organization' where id=$1", [ORG]);
    const read = () => requestJson<{ item: SourceRevisionRequestDto }>(route(outsider), `${path}/${pending.id}`);
    expect((await read()).body.item).toMatchObject({ submitterName: "Author", reviewerName: "Reviewer", organizationName: "Source HTTP" });
    await db.query("delete from users where id=any($1::text[])", [[AUTHOR, REVIEWER]]);
    expect((await read()).body.item).toMatchObject({ submitterUserId: null, reviewerUserId: null,
      submitterName: "Author", reviewerName: "Reviewer" });
    const versions = await requestJson<{ items: Array<{ createdByDisplayName: string | null }> }>(route(outsider),
      `/api/v1/projects/${PROJECT}/parameter-files/${fileId}/versions`);
    expect(versions.status, versions.bodyText).toBe(200);
    expect(versions.body.items.map((item) => item.createdByDisplayName)).toContain("Author");
    const history = await requestJson<{ items: Array<{ actor: string | null }> }>(route(outsider),
      `/api/v2/projects/${PROJECT}/bindings/${bindingId}/history`);
    expect(history.status, history.bodyText).toBe(200);
    expect(history.body.items.map((item) => item.actor)).toContain("Reviewer");
  });
});
