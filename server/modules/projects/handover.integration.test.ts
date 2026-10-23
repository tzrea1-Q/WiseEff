import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { requestJson } from "../../test/testClient";
import { getAuthContext } from "../auth/repository";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { createConfigSet, addConfigSetFile } from "../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { registerCanonicalJsonSource } from "../parameter-files/canonicalJsonSource";
import { getRootPostgresPool } from "../../shared/database/client";
import { loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { loadCanonicalBindingPins } from "../parameter-bindings/drafts/repository";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { asValueClient, syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";

type Item = { id: string; kind: string; projectId: string; responsibleUserId: string | null; pending: boolean; version: string; historicalAttribution: unknown; candidates: Array<{ id: string; name: string }> };
describe("project business handover (real HTTP/PostgreSQL)", () => {
  let db: RootDatabase, ephemeral: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  const objectStore = createMemoryObjectStore();
  beforeEach(async () => {
    ephemeral = await createEphemeralTestDatabase("project_handover"); db = createPostgresDatabase(ephemeral.url);
    await db.query("insert into organizations(id,name) values('handover-home','Home'),('handover-org','Project organization')");
    for (const [id, org, role] of [["platform", "home", "platform-admin"], ["admin", "org", "admin"], ["author", "org", "software-user"], ["editor", "org", "software-user"], ["viewer", "org", "guest"], ["reviewer", "org", "software-committer"]]) {
      await db.query("insert into users(id,organization_id,name,title,is_active) values($1,$2,$1,'Engineer',true)", [`handover-${id}`, `handover-${org}`]);
      await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id,project_id) values($1,$2,$3,$4,$5)", [`handover-${id}-role`, `handover-${id}`, `handover-${org}`, role, id === "reviewer" ? "handover-project" : null]);
    }
    await db.query("insert into projects(id,organization_id,name,code,status) values('handover-project','handover-org','Handover project','HANDOVER','initialized')");
    await db.query("insert into project_members(organization_id,project_id,user_id,roles) values('handover-org','handover-project','handover-author',array['software-user']),('handover-org','handover-project','handover-editor',array['software-user'])");
  });
  afterEach(async () => { setParameterIdentityMode(null); await db?.close(); await ephemeral?.drop(); });
  async function api<T = unknown>(path: string, method = "GET", body?: unknown, actor = "platform", scope = "handover-org") {
    const auth = await getAuthContext(db, `handover-${actor}`);
    return requestJson<T>(createWiseEffServer({ db, objectStore, auth: { mode: "production", verifier: { verify: async () => auth } } }),
      `${path.startsWith("/") ? path : `/api/v1/${path}`}${path.includes("?") ? "&" : "?"}organizationId=${scope}`, { method, headers: { Authorization: "Bearer fixture" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function legacyDraft(id = "retained-draft", author = "author") {
    await db.query("insert into parameter_definitions(id,organization_id,name,description,explanation,config_format,module,default_range,unit,risk) values('handover-definition','handover-org','Legacy parameter','','','dts','Module','','','Low') on conflict do nothing");
    await db.query("insert into project_parameter_values(id,organization_id,project_id,parameter_definition_id,current_value,recommended_value) values('handover-value','handover-org','handover-project','handover-definition','0','1') on conflict do nothing");
    await db.query("insert into parameter_drafts(id,organization_id,project_id,project_parameter_value_id,user_id,target_value,reason) values($1,'handover-org','handover-project','handover-value',$2,'1','Retained work')", [id, `handover-${author}`]);
  }
  it("keeps a deleted member's unfinished draft visible and explicitly pending without rewriting its original author", async () => {
    await legacyDraft();
    expect((await api("users/handover-author/activation", "PATCH", { isActive: false })).status).toBe(200);
    const stopped = await api<{ items: Item[] }>("organization/project-handovers");
    expect(stopped.status, stopped.bodyText).toBe(200);
    expect(stopped.body.items).toContainEqual(expect.objectContaining({ id: "retained-draft", pending: true, responsibleUserId: "handover-author" }));
    expect((await api("users/handover-author", "DELETE")).status).toBe(204);
    const list = await api<{ items: Item[] }>("organization/project-handovers");
    const draft = list.body.items.find(item => item.id === "retained-draft")!;
    expect(draft).toMatchObject({ kind: "parameter-draft", pending: true, responsibleUserId: null,
      historicalAttribution: { organization: { id: "handover-org" }, actors: { user_id: { id: "handover-author", name: "handover-author" } } } });
    expect(draft.candidates.map(candidate => candidate.id)).toContain("handover-editor");
    expect(draft.candidates.map(candidate => candidate.id)).not.toContain("handover-viewer");
    expect((await api("organization/project-handovers/parameter-draft/retained-draft", "PATCH", { responsibleUserId: "handover-editor", expectedVersion: draft.version })).status).toBe(200);
    const assigned = (await api<{ items: Item[] }>("organization/project-handovers")).body.items.find(item => item.id === draft.id)!;
    expect(assigned).toMatchObject({ responsibleUserId: "handover-editor", pending: false, historicalAttribution: draft.historicalAttribution });
  });
  async function canonicalDraft() {
    const admin = await getAuthContext(db, "handover-admin");
    await installConfigurationSourceFixture(db, admin, { subjectId: "csub_handover", schemaId: "wiseeff.handover" });
    const set = await createConfigSet(db, admin, { projectId: "handover-project", name: "Source" });
    const upload = await uploadProjectParameterFile(db, objectStore, admin, { projectId: "handover-project", fileName: "settings.json", bytes: Buffer.from('{"limit":36.5}') });
    await addConfigSetFile(db, admin, { configSetId: set.id, fileId: upload.file.id, role: "base", sortOrder: 0 });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Canonical fixture unavailable");
    const source = await db.transaction(tx => registerCanonicalJsonSource(tx, objectStore, admin, snapshot, {
      projectId: "handover-project", configSetId: set.id, fileId: upload.file.id, fileVersionId: upload.version.id,
      configurationSchemaId: "wiseeff.handover", rootPointer: "", mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/limit" }],
      invocation: createUserInvocation(admin), requestId: "handover-source", refusalSink: createTrustedRefusalAuditSink(db)
    }));
    const binding = source.bindings[0]!;
    const pin = await loadCanonicalBindingPins(db, { organizationId: "handover-org", projectId: "handover-project", bindingId: binding.id });
    const path = `/api/v2/projects/handover-project/parameter-bindings/${binding.id}/drafts`;
    const result = await api<{ item: { draftId: string } }>(path, "POST", { baseRevisionId: pin!.configRevisionId, sourceTarget: { format: "json", sourceText: "48" }, reason: "Original unfinished parameter work" }, "author");
    expect(result.status, result.bodyText).toBe(201);
    return { id: result.body.item.draftId, path, pin: pin!, fileId: upload.file.id, fileVersionId: upload.version.id, configSetId: set.id };
  }
  it("lets a qualified successor edit and submit the retained canonical draft through normal project APIs", async () => {
    const draft = await canonicalDraft();
    await api("users/handover-author", "DELETE");
    const item = (await api<{ items: Item[] }>("organization/project-handovers")).body.items.find(item => item.id === draft.id)!;
    expect(item).toMatchObject({ kind: "value-draft", responsibleUserId: null, pending: true });
    const assigned = await api(`organization/project-handovers/value-draft/${draft.id}`, "PATCH", { responsibleUserId: "handover-editor", expectedVersion: item.version });
    expect(assigned.status, assigned.bodyText).toBe(200);
    const mine = await api<{ items: Array<{ id: string; targetValue: string }> }>("/api/v2/projects/handover-project/parameter-value-drafts", "GET", undefined, "editor");
    expect(mine.body.items).toContainEqual(expect.objectContaining({ id: draft.id, targetValue: "48" }));
    const edited = await api<{ item: { draftId: string } }>(draft.path, "POST", { baseRevisionId: draft.pin.configRevisionId, sourceTarget: { format: "json", sourceText: "52" }, reason: "Successor completed work" }, "editor");
    expect(edited.status, edited.bodyText).toBe(201); expect(edited.body.item.draftId).toBe(draft.id);
    const retained = (await api<{ items: Item[] }>("organization/project-handovers")).body.items.find(item => item.id === draft.id)!;
    expect(retained.historicalAttribution).toEqual(item.historicalAttribution);
    const submitted = await api<{ item: { id: string } }>(`/api/v2/projects/handover-project/parameter-value-drafts/${draft.id}/submit`, "POST", { assignedToUserId: "handover-reviewer" }, "editor");
    expect(submitted.status, submitted.bodyText).toBe(201);
    await api("users/handover-reviewer/activation", "PATCH", { isActive: false });
    const review = (await api<{ items: Item[] }>("organization/project-handovers")).body.items.find(item => item.id === submitted.body.item.id)!;
    expect(review).toMatchObject({ kind: "value-review", pending: true, responsibleUserId: "handover-reviewer" });
    const reassigned = await api(`organization/project-handovers/value-review/${review.id}`, "PATCH", { responsibleUserId: "handover-admin", expectedVersion: review.version });
    expect(reassigned.status, reassigned.bodyText).toBe(200);
    const approved = await api(`/api/v2/projects/handover-project/parameter-value-change-requests/${review.id}/review`, "POST", { decision: "approve" }, "admin");
    expect(approved.status, approved.bodyText).toBe(200);
  });
  it("keeps Agent-origin pending work and initializes a project after its original creator is deleted", async () => {
    await legacyDraft();
    await db.query("insert into parameter_drafts(id,organization_id,project_id,project_parameter_value_id,user_id,target_value,reason,initiator_type,initiator_session_id,initiator_tool_call_id,initiator_approval_id) values('agent-draft','handover-org','handover-project','handover-value','handover-editor','2','Approved Agent draft','agent','original-session','original-tool','original-approval')");
    await db.query("update projects set initialization_status='not_initialized' where id='handover-project'");
    const draftBody = { projectName: "Handover project", projectCode: "HANDOVER", ownerUserId: "handover-author", sourceProjectIds: [], primarySourceProjectId: null, supplementSourceProjectIds: [], selectedModuleIds: [], selectedRisks: [], selectedSourceBindingIds: [], bindingSnapshots: [], emptyLibrary: true, notes: "Unfinished initialization" };
    const opened = await api<{ item: { id: string } }>("parameters/projects/handover-project/initialization/draft", "PUT", draftBody, "author");
    expect(opened.status, opened.bodyText).toBe(200);
    expect((await api("users/handover-author", "DELETE")).status).toBe(204);
    expect((await api("users/handover-editor", "DELETE")).status).toBe(204);
    const list = (await api<{ items: Item[] }>("organization/project-handovers")).body.items;
    expect(list.find(item => item.id === "agent-draft")).toMatchObject({ pending: true, historicalAttribution: { actors: { user_id: { id: "handover-editor" } } } });
    expect((await db.query<{ historical_attribution: unknown }>("select historical_attribution from parameter_drafts where id='agent-draft'")).rows[0].historical_attribution).toMatchObject({ execution: { initiatorType: "agent", approvalId: "original-approval" } });
    const initialization = list.find(item => item.kind === "initialization-draft")!;
    expect(initialization).toMatchObject({ pending: true, responsibleUserId: null });
    expect((await api(`organization/project-handovers/initialization-draft/${initialization.id}`, "PATCH", { responsibleUserId: "handover-admin", expectedVersion: initialization.version })).status).toBe(200);
    const updated = await api("parameters/projects/handover-project/initialization/draft", "PUT", { ...draftBody, ownerUserId: "handover-admin", notes: "Administrator completed initialization" }, "admin");
    expect(updated.status, updated.bodyText).toBe(200);
    const submitted = await api("parameters/projects/handover-project/initialization/submit", "POST", {}, "admin");
    expect(submitted.status, submitted.bodyText).toBe(201);
  });
  it("reassigns current and future review duties independently, leaves unassigned stages visible and preserves actual review signatures", async () => {
    await legacyDraft();
    await db.query(`insert into parameter_change_requests(id,organization_id,project_id,project_parameter_value_id,parameter_definition_id,base_version,current_value,target_value,status,submitter_user_id,assigned_to_user_id,workflow_hardware_committer_user_id,workflow_software_committer_user_id,workflow_software_user_id)
      values('handover-request','handover-org','handover-project','handover-value','handover-definition',1,'0','1','hardware_review','handover-author','handover-reviewer','handover-reviewer','handover-reviewer','handover-editor')`);
    await api("users/handover-reviewer/activation", "PATCH", { isActive: false });
    let items = (await api<{ items: Item[] }>("organization/project-handovers")).body.items;
    const hardware = items.find(item => item.kind === "hardware-review")!, software = items.find(item => item.kind === "software-review")!;
    expect(hardware.pending).toBe(true); expect(software.pending).toBe(true);
    expect((await api("organization/project-handovers/software-review/handover-request", "PATCH", { responsibleUserId: null, expectedVersion: software.version })).status).toBe(200);
    items = (await api<{ items: Item[] }>("organization/project-handovers")).body.items;
    expect(items.find(item => item.kind === "software-review")).toMatchObject({ responsibleUserId: null, pending: true });
    const current = items.find(item => item.kind === "hardware-review")!;
    expect((await api("organization/project-handovers/hardware-review/handover-request", "PATCH", { responsibleUserId: "handover-editor", expectedVersion: current.version })).status).toBe(400);
    expect((await api("organization/project-handovers/hardware-review/handover-request", "PATCH", { responsibleUserId: "handover-admin", expectedVersion: current.version })).status).toBe(200);
    const review = await api("parameter-change-requests/handover-request/review", "POST", { decision: "reject", note: "Actual successor reviewed" }, "admin");
    expect(review.status, review.bodyText).toBe(200);
    expect((await db.query("select reviewer_user_id,historical_attribution from parameter_review_decisions where request_id='handover-request'")).rows).toEqual([expect.objectContaining({ reviewer_user_id: "handover-admin", historical_attribution: expect.objectContaining({ actors: { reviewer_user_id: expect.objectContaining({ id: "handover-admin" }) } }) })]);
    expect((await db.query<{ historical_attribution: unknown }>("select historical_attribution from parameter_change_requests where id='handover-request'")).rows[0].historical_attribution).toMatchObject({ actors: { submitter_user_id: { id: "handover-author" } } });
  });
  it("checks current qualification, tenant scope, competing draft ownership and optimistic concurrency without losing pending work", async () => {
    await legacyDraft();
    const item = (await api<{ items: Item[] }>("organization/project-handovers")).body.items[0];
    const assign = (responsibleUserId: string | null, expectedVersion = item.version, actor = "platform", scope = "handover-org") => api("organization/project-handovers/parameter-draft/retained-draft", "PATCH", { responsibleUserId, expectedVersion }, actor, scope);
    expect((await assign("handover-platform", item.version, "admin")).status).toBe(400);
    expect((await assign("handover-viewer")).status).toBe(400);
    expect((await assign("handover-editor", item.version, "editor")).status).toBe(403);
    expect((await assign("handover-editor", item.version, "admin", "handover-home")).status).toBe(403);
    expect((await assign("handover-editor", item.version, "platform", "handover-home")).status).toBe(404);
    await db.query("delete from project_members where user_id='handover-editor'");
    expect((await assign("handover-editor")).status).toBe(400);
    await db.query("insert into project_members(organization_id,project_id,user_id,roles) values('handover-org','handover-project','handover-editor',array['software-user'])");
    await legacyDraft("competing-draft", "editor");
    expect((await assign("handover-editor")).status).toBe(409);
    const results = await Promise.all([assign(null), assign("handover-admin")]);
    expect(results.map(result => result.status).sort()).toEqual([200,409]);
    const updated = (await api<{ items: Item[] }>("organization/project-handovers")).body.items.find(work => work.id === item.id)!;
    await db.query("create function reject_project_handover_audit() returns trigger language plpgsql as $$ begin if new.kind='project-handover' then raise exception 'controlled rejection'; end if; return new; end $$; create trigger reject_project_handover_audit before insert on audit_events for each row execute function reject_project_handover_audit()");
    expect((await assign(updated.responsibleUserId ? null : "handover-admin", updated.version)).status).toBe(500);
    expect((await api<{ items: Item[] }>("organization/project-handovers")).body.items.find(work => work.id === item.id)).toMatchObject({ responsibleUserId: updated.responsibleUserId, version: updated.version });
    expect((await db.query("select id from parameter_drafts where id=any($1::text[])", [["retained-draft","competing-draft"]])).rowCount).toBe(2);
  });
  it("continues an orphan node-enablement draft through the real structured edit and staged submission APIs", async () => {
    setParameterIdentityMode("semantic");
    // Match the deployed semantic cutover, as in nodeEnablementCurrentRead:
    // node-only requests have no retired flat parameter/value identity.
    await db.query("alter table parameter_change_requests drop column parameter_definition_id,drop column project_parameter_value_id");
    await db.query("alter table parameter_history_entries drop column parameter_definition_id,drop column project_parameter_value_id");
    const admin = await getAuthContext(db, "handover-admin");
    await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power", compatible: "acme,power", businessName: "Power", driverName: "Charger", idempotencyKey: "handover-node", reason: "Handover node fixture" });
    const set = await createConfigSet(db, admin, { projectId: "handover-project", name: "Source" });
    const source = '/dts-v1/; / { charger: charger { compatible="acme,power"; iin_max=<1000>; status="okay"; }; };';
    const upload = await uploadProjectParameterFile(db, objectStore, admin, { projectId: "handover-project", fileName: "board.dts", bytes: Buffer.from(source) });
    await addConfigSetFile(db, admin, { configSetId: set.id, fileId: upload.file.id, role: "base", sortOrder: 0 });
    const revision = await ingestConfigRevision(db, { organizationId: "handover-org", projectId: "handover-project", configSetId: set.id, entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [], members: [{ fileId: upload.file.id, fileVersionId: upload.version.id, fileName: "board.dts", sourceName: "board.dts", role: "base", sortOrder: 0, content: source }] }, admin);
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Missing Catalog fixture");
    await db.transaction(tx => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog, { organizationId: "handover-org", projectId: "handover-project", configSetId: set.id, configRevisionId: revision.id }));
    const node = (await db.query<{ logical_node_id: string }>("select logical_node_id from dts_logical_node_revisions where config_revision_id=$1 and name='charger'", [revision.id])).rows[0];
    const body = { logicalNodeId: node.logical_node_id, baseRevisionId: revision.id, target: "force-disabled", reason: "Unfinished structural work" };
    const staged = await api<{ item: { draftId: string } }>("/api/v2/projects/handover-project/node-enablement-drafts", "POST", body, "author");
    expect(staged.status, staged.bodyText).toBe(201);
    await api("users/handover-author", "DELETE");
    const item = (await api<{ items: Item[] }>("organization/project-handovers")).body.items.find(item => item.id === staged.body.item.draftId)!;
    expect((await api(`organization/project-handovers/parameter-draft/${item.id}`, "PATCH", { responsibleUserId: "handover-editor", expectedVersion: item.version })).status).toBe(200);
    const saved = await api<{ item: { draftId: string } }>("/api/v2/projects/handover-project/node-enablement-drafts", "POST", { ...body, reason: "Successor continued structural work" }, "editor");
    expect(saved.status, saved.bodyText).toBe(201); expect(saved.body.item.draftId).toBe(item.id);
    for (const [id, role] of [["hardware", "hardware-committer"], ["merge", "software-user"]]) {
      await db.query("insert into users(id,organization_id,name,title,is_active) values($1,'handover-org',$1,'Engineer',true)", [`handover-${id}`]);
      await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values($1,$2,'handover-org','handover-project',$3)", [`handover-${id}-role`, `handover-${id}`, role]);
    }
    const submitted = await api("parameter-submission-rounds", "POST", { projectId: "handover-project", items: [{ draftId: item.id, editSubjectKind: "node-enablement", logicalNodeId: node.logical_node_id, action: "set", targetValue: '"disabled"', reason: "Successor continued structural work" }], assignees: { hardwareCommitterId: "handover-hardware", softwareCommitterId: "handover-reviewer", softwareUserId: "handover-merge" } }, "editor");
    expect(submitted.status, submitted.bodyText).toBe(201);
  });
  it("retains unfinished source candidates and lets the administrator resume their actual source inspection without impersonating the creator", async () => {
    const source = await canonicalDraft();
    await db.query("insert into users(id,organization_id,name,title,is_active) values('handover-sourceauthor','handover-org','Source author','Admin',true)");
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('handover-sourceauthor-role','handover-sourceauthor','handover-org','admin')");
    const created = await api<{ item: { id: string } }>("projects/handover-project/parameter-file-candidates", "POST", { fileId: source.fileId, fileName: "settings.json", contentBase64: Buffer.from('{"limit":44}').toString("base64") }, "sourceauthor");
    expect(created.status, created.bodyText).toBe(201);
    await api("users/handover-sourceauthor", "DELETE");
    const item = (await api<{ items: Item[] }>("organization/project-handovers")).body.items.find(item => item.kind === "source-draft" && item.id === created.body.item.id)!;
    expect(item).toMatchObject({ responsibleUserId: null, pending: true });
    const claimed = await api(`organization/project-handovers/source-draft/${item.id}`, "PATCH", { responsibleUserId: "handover-platform", expectedVersion: item.version });
    expect(claimed.status, claimed.bodyText).toBe(200);
    const resumed = await api<{ item: { id: string } }>(`projects/handover-project/parameter-file-candidates/${item.id}`);
    expect(resumed.status, resumed.bodyText).toBe(200); expect(resumed.body.item.id).toBe(item.id);
    expect((await api(`projects/handover-project/parameter-file-candidates/${item.id}/impact`)).status).toBe(200);
    expect((await db.query("select created_by_user_id,responsible_user_id,historical_attribution from project_parameter_file_candidates where id=$1", [item.id])).rows[0]).toMatchObject({ created_by_user_id: null, responsible_user_id: "handover-platform", historical_attribution: { actors: { created_by_user_id: { id: "handover-sourceauthor" } } } });
  });
});
