import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { seedUser } from "../../testing/fixtures";
import { PARAMETER_DASHBOARD_FIXTURE, seedParameterDashboardFixture } from "../../testing/parameterDashboardFixture";
import { canonicalSourceConflictDecisionResponseSchema,
  canonicalSourceConflictListResponseSchema, canonicalSourceConflictSubmitResponseSchema }
  from "../contracts/dtoSchemas/canonicalConflict";
import { makeTestAuthContext } from "../../testing/authContext";
import { captureConfigurationSourceState, installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createLocalObjectStore } from "../logs/objectStore";
import { asValueClient, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { registerCatalogProjectValueConsumerRoutes } from "../parameter-bindings/catalogProjectValueRoutes";
import { createCanonicalValueDraft } from "../parameter-bindings/drafts/service";
import { insertFileSyncConflict } from "../parameters/fileSyncConflictRepository";
import { loadOwnedProjectValueSourcePin } from "../parameter-bindings/values";
import { loadProjectValueById } from "../parameter-bindings/values/repositories";
import { parseDtsValue } from "../dts";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../parameter-topology/types";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { createCandidate } from "./candidateService";
import { addConfigSetFile, createConfigSet } from "./configSetService";
import { registerParameterFileRoutes } from "./routes";
import { uploadProjectParameterFile } from "./service";

const ORG = "org-906-c-conflict-http";
const PROJECT = "project-906-c-conflict-http";
const ADMIN = "user-906-c-conflict-admin";
const AUTHOR = "user-906-c-conflict-author";
const REVIEWER = "user-906-c-conflict-reviewer";
const OTHER = "user-906-c-conflict-other";
const DEF = "pdef_acme_power_iin_max";
const admin = makeTestAuthContext({ userId: ADMIN, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });
const author = makeTestAuthContext({ userId: AUTHOR, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit"],
  roles: [{ roleId: "software-user", projectId: PROJECT }] });
const reviewer = makeTestAuthContext({ userId: REVIEWER, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: PROJECT }] });
const otherReviewer = makeTestAuthContext({ userId: OTHER, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: PROJECT }] });
const foreign = makeTestAuthContext({ userId: "foreign-906-c-conflict", organizationId: "foreign-906-c-conflict",
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

async function fixture(format: "json" | "dts") {
  const database = await createEphemeralTestDatabase(`issue906-c-conflict-http-${format}`);
  const db = createPostgresDatabase(database.url);
  const directory = await mkdtemp(join(tmpdir(), `wiseeff-906-c-conflict-${format}-`));
  const storage = createLocalObjectStore(directory);
  cleanups.push(async () => { await db.close(); await database.drop(); await rm(directory, { recursive: true, force: true }); });
  await db.query("insert into organizations(id,name) values ($1,'#906 conflict HTTP')", [ORG]);
  await db.query(`insert into users(id,organization_id,name,title,is_active) values
    ($1,$2,'admin','Admin',true),($3,$2,'author','Author',true),
    ($4,$2,'reviewer','Reviewer',true),($5,$2,'other','Reviewer',true)`, [ADMIN, ORG, AUTHOR, REVIEWER, OTHER]);
  await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Conflict HTTP','C906','initialized')", [PROJECT, ORG]);
  await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values
    ('c906-http-admin',$1,$2,null,'admin'),('c906-http-author',$3,$2,$4,'software-user'),
    ('c906-http-reviewer',$5,$2,$4,'software-committer'),('c906-http-other',$6,$2,$4,'software-committer')`,
    [ADMIN, ORG, AUTHOR, PROJECT, REVIEWER, OTHER]);
  const set = await createConfigSet(db, admin, { projectId: PROJECT, name: "Conflict HTTP" });
  let candidate;
  let bindingId: string;
  let otherBindingId: string;
  let baseCurrentValueId: string;
  if (format === "json") {
    await installConfigurationSourceFixture(db, admin, { subjectId: "csub_906_c_conflict_http", schemaId: "wiseeff.906.c.conflict.http" });
    const uploaded = await uploadProjectParameterFile(db, storage, admin, {
      projectId: PROJECT, fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 36.5 }, "other": { "limit": 48 } }\n')
    });
    await addConfigSetFile(db, admin, { configSetId: set.id, fileId: uploaded.file.id, role: "base", sortOrder: 0 });
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Published Catalog unavailable");
    const first = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, catalog, {
      projectId: PROJECT, configSetId: set.id, fileId: uploaded.file.id,
      fileVersionId: uploaded.version.id, configurationSchemaId: "wiseeff.906.c.conflict.http",
      rootPointer: "", mappings: [{ definitionId: DEF, pointer: "/settings/limit" }],
      invocation: createUserInvocation(admin), requestId: "c906-http-register-first",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    const second = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, catalog, {
      projectId: PROJECT, configSetId: set.id, fileId: uploaded.file.id,
      fileVersionId: uploaded.version.id, configurationSchemaId: "wiseeff.906.c.conflict.http",
      rootPointer: "/other", mappings: [{ definitionId: DEF, pointer: "/other/limit" }],
      invocation: createUserInvocation(admin), requestId: "c906-http-register-second",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    bindingId = first.bindings[0]!.id;
    otherBindingId = second.bindings[0]!.id;
    baseCurrentValueId = first.bindings[0]!.currentValueId;
    candidate = await createCandidate(db, storage, admin, {
      projectId: PROJECT, fileId: uploaded.file.id, fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 50 }, "other": { "limit": 60 } }\n')
    });
  } else {
    await installDriverSourceFixture(db, admin, {
      subjectId: "csub_acme_power", compatible: "acme,power",
      businessName: "#906 conflict HTTP", driverName: "Acme power",
      idempotencyKey: "c906-http-driver", reason: "C conflict HTTP"
    });
    const source = `/dts-v1/;\n/ {\n  charger: device@0 {\n    compatible = "acme,power";\n    iin_max = <36>;\n  };\n  backup: device@1 {\n    compatible = "acme,power";\n    iin_max = <36>;\n  };\n};\n`;
    const uploaded = await uploadProjectParameterFile(db, storage, admin, {
      projectId: PROJECT, fileName: "board.dts", bytes: Buffer.from(source)
    });
    await addConfigSetFile(db, admin, { configSetId: set.id, fileId: uploaded.file.id, role: "base", sortOrder: 0 });
    const manifest: ConfigRevisionManifest = {
      organizationId: ORG, projectId: PROJECT, configSetId: set.id,
      entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [],
      members: [{ fileId: uploaded.file.id, fileVersionId: uploaded.version.id,
        fileName: "board.dts", sourceName: "board.dts", role: "base", sortOrder: 0, content: source }]
    };
    const revision = await ingestConfigRevision(db, manifest, admin, { legacyProjection: "skip" });
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Published Catalog unavailable");
    await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog, {
      organizationId: ORG, projectId: PROJECT, configSetId: set.id, configRevisionId: revision.id
    }));
    candidate = await createCandidate(db, storage, admin, {
      projectId: PROJECT, fileId: uploaded.file.id, fileName: "board.dts",
      bytes: Buffer.from(source.replace("iin_max = <36>", "iin_max = <50>").replace("iin_max = <36>", "iin_max = <60>"))
    });
    // The exact selected locator comes from the candidate preview, not a guessed node id.
    const preview = await requestJson<{ item: { bindings: Array<{ bindingId: string; baseCurrentValueId: string; afterText: string }> } }>(
      createHttpServer((() => { const router = createRouter(); registerParameterFileRoutes(router, {
        db, objectStore: storage, getCurrentAuthContext: () => admin }); return router; })()),
      `/api/v1/projects/${PROJECT}/parameter-file-candidates/${candidate.id}/source-preview`
    );
    expect(preview.status).toBe(200);
    const selected = preview.body.item.bindings.find((binding) => binding.afterText === "<50>");
    const other = preview.body.item.bindings.find((binding) => binding.afterText === "<60>");
    if (!selected || !other) throw new Error("DTS candidate targets unavailable");
    bindingId = selected.bindingId;
    otherBindingId = other.bindingId;
    baseCurrentValueId = selected.baseCurrentValueId;
  }
  const pin = await loadOwnedProjectValueSourcePin(db, {
    organizationId: ORG, projectId: PROJECT, bindingId, projectValueId: baseCurrentValueId
  });
  if (!pin) throw new Error("Canonical source pin unavailable");
  const uiDraft = await createCanonicalValueDraft(db, author, {
    projectId: PROJECT, bindingId,
    ...(format === "json" ? { sourceTarget: { format: "json" as const, sourceText: "99" } }
      : { targetValue: parseDtsValue("iin_max", "<99>").value }),
    reason: "UI work", baseRevisionId: pin.configRevisionId,
    baseCurrentValueId
  }, { objectStore: storage, invocation: createUserInvocation(author),
    requestId: "c906-http-ui-draft", refusalSink: createTrustedRefusalAuditSink(db) });
  const route = (auth = admin, objectStore: typeof storage | null = storage) => {
    const router = createRouter();
    const options = { db, objectStore: objectStore ?? undefined, getCurrentAuthContext: () => auth };
    registerParameterFileRoutes(router, options);
    registerCatalogProjectValueConsumerRoutes(router, options);
    return createHttpServer(router);
  };
  return { db, storage, directory, candidate, uiDraft, bindingId, otherBindingId, route, format };
}

describe("#906 C canonical conflict HTTP", () => {
  it.each([
    ["json", "file"], ["json", "draft"], ["dts", "file"], ["dts", "draft"]
  ] as const)("freezes and approves one %s %s value", async (format, choice) => {
    const f = await fixture(format);
    const path = `/api/v1/projects/${PROJECT}/parameter-file-candidates/${f.candidate.id}`;
    const before = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const versionsBefore = (await f.db.query<{ count: string }>(
      "select count(*)::text as count from project_parameter_file_versions where file_id=$1",
      [f.candidate.fileId])).rows[0]!.count;
    const discovered = await requestJson<{ items: Array<{ selectedBindingId: string; selectedDraftId: string;
      choices: { file: { decisionProofDigest: string; targetText: string }; draft: { decisionProofDigest: string; targetText: string } } }> }>(
      f.route(), `${path}/source-conflicts`);
    expect(discovered.status, JSON.stringify(discovered.body)).toBe(200);
    canonicalSourceConflictListResponseSchema.parse(discovered.body);
    expect(discovered.body.items).toHaveLength(1);
    const conflict = discovered.body.items[0]!;
    expect(conflict.selectedBindingId).toBe(f.bindingId);
    expect(conflict.selectedDraftId).toBe(f.uiDraft.id);
    expect(conflict.choices.file.targetText).toBe(format === "json" ? "50" : "<50>");
    expect(conflict.choices.draft.targetText).toBe(format === "json" ? "99" : "<99>");
    expect((await f.db.query("select id from project_parameter_values where organization_id=$1 and project_id=$2",
      [ORG, PROJECT])).rows).toEqual([]);
    const otherCurrent = before.bindings.find((binding) => binding.id === f.otherBindingId)!;
    const otherPin = await loadOwnedProjectValueSourcePin(f.db, {
      organizationId: ORG, projectId: PROJECT, bindingId: f.otherBindingId,
      projectValueId: otherCurrent.currentValueId
    });
    if (!otherPin) throw new Error("Unselected source pin unavailable");
    const unselectedDraft = await createCanonicalValueDraft(f.db, otherReviewer, {
      projectId: PROJECT, bindingId: f.otherBindingId,
      ...(format === "json" ? { sourceTarget: { format: "json" as const, sourceText: "88" } }
        : { targetValue: parseDtsValue("iin_max", "<88>").value }),
      reason: "Other author work", baseRevisionId: otherPin.configRevisionId,
      baseCurrentValueId: otherCurrent.currentValueId
    }, { objectStore: f.storage, invocation: createUserInvocation(otherReviewer),
      requestId: "c906-http-unselected-draft", refusalSink: createTrustedRefusalAuditSink(f.db) });
    const body = { selectedBindingId: f.bindingId, selectedDraftId: f.uiDraft.id,
      choice, expectedDecisionProofDigest: conflict.choices[choice].decisionProofDigest,
      assignedToUserId: REVIEWER, reason: "Choose the selected source value" };
    const submitted = await requestJson<{ item: { requestId: string; status: string; replayed: boolean } }>(
      f.route(), `${path}/source-conflict-submit`, { method: "POST", body: JSON.stringify(body) });
    expect(submitted.status).toBe(201);
    canonicalSourceConflictSubmitResponseSchema.parse(submitted.body);
    expect(submitted.body.item).toMatchObject({ status: "pending", replayed: false });
    const requestId = submitted.body.item.requestId;
    const receipts = await f.db.query<{ metadata: { decisionProofDigest: string; choice: string } }>(
      `select metadata from audit_events where organization_id=$1 and project_id=$2 and target_id=$3
         and action='value-change-submitted' and metadata ? 'decisionProofDigest'`, [ORG, PROJECT, requestId]);
    expect(receipts.rows).toMatchObject([{ metadata: {
      decisionProofDigest: conflict.choices[choice].decisionProofDigest, choice
    } }]);
    const requestPath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${requestId}`;
    const queuePath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests?status=pending`;
    const assignedQueue = await requestJson<{ items: Array<{ id: string }> }>(f.route(reviewer), queuePath);
    const otherQueue = await requestJson<{ items: Array<{ id: string }> }>(f.route(otherReviewer), queuePath);
    const mine = await requestJson<{ items: Array<{ id: string }> }>(f.route(), `${queuePath}&mine=true`);
    expect(assignedQueue.body.items.some((item) => item.id === requestId)).toBe(true);
    expect(otherQueue.body.items.some((item) => item.id === requestId)).toBe(false);
    expect(mine.body.items.some((item) => item.id === requestId)).toBe(true);
    expect((await requestJson(f.route(otherReviewer), `${requestPath}/conflict-decision`)).status).toBe(404);
    expect((await requestJson(f.route(foreign), `${requestPath}/conflict-decision`)).status).toBe(404);
    expect((await requestJson(f.route(otherReviewer), `${requestPath}/source-diff`)).status).toBe(404);
    expect((await requestJson(f.route(otherReviewer, null), `${requestPath}/source-diff`)).status).toBe(404);
    expect((await requestJson(f.route(reviewer, null), `${requestPath}/source-diff`)).status).toBe(500);
    const frozen = await requestJson<{ item: { choice: string; selectedBindingId: string; sourceDiff: { before: string; after: string } } }>(
      f.route(reviewer), `${requestPath}/conflict-decision`);
    expect(frozen.status).toBe(200);
    canonicalSourceConflictDecisionResponseSchema.parse(frozen.body);
    expect(frozen.body.item).toMatchObject({ choice, selectedBindingId: f.bindingId,
      sourceDiff: { before: expect.any(String), after: expect.any(String) } });
    expect((await requestJson(f.route(admin), `${requestPath}/conflict-decision`)).status).toBe(200);
    const nonAssigned = await requestJson(f.route(otherReviewer), `${requestPath}/review`, {
      method: "POST", body: JSON.stringify({ decision: "approve" }) });
    expect(nonAssigned.status).toBe(404);
    expect((await requestJson(f.route(otherReviewer), `${requestPath}/review`, {
      method: "POST", body: JSON.stringify({ decision: "reject" }) })).status).toBe(404);
    const reviewed = await requestJson<{ item: { status: string } }>(f.route(reviewer), `${requestPath}/review`, {
      method: "POST", body: JSON.stringify({ decision: "approve" }) });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.item.status).toBe("approved");
    const after = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const selectedBefore = before.bindings.find((binding) => binding.id === f.bindingId)!;
    const selectedAfter = after.bindings.find((binding) => binding.id === f.bindingId)!;
    const otherBefore = before.bindings.find((binding) => binding.id === f.otherBindingId)!;
    const otherAfter = after.bindings.find((binding) => binding.id === f.otherBindingId)!;
    expect(selectedAfter.currentValueId).not.toBe(selectedBefore.currentValueId);
    expect(otherAfter.currentValueId).not.toBe(otherBefore.currentValueId);
    expect((await loadProjectValueById(asValueClient(f.db), otherAfter.currentValueId))?.value)
      .toEqual(format === "json" ? 48 : expect.anything());
    expect((await loadProjectValueById(asValueClient(f.db), selectedAfter.currentValueId))?.value)
      .toEqual(format === "json" ? (choice === "file" ? 50 : 99) : expect.anything());
    expect(after.pins.length).toBe(before.pins.length + 2);
    expect(after.history.length).toBe(before.history.length + 2);
    expect(after.values.length).toBe(before.values.length + 2);
    expect(after.drafts.some((draft) => draft.id === f.uiDraft.id)).toBe(true);
    expect(after.drafts.some((draft) => draft.id === unselectedDraft.id)).toBe(true);
    const currentFile = (await f.db.query<{ id: string; storage_key: string }>(`select version.id,version.storage_key
      from project_parameter_files file join project_parameter_file_versions version
        on version.id=file.current_version_id where file.id=$1`, [f.candidate.fileId])).rows[0]!;
    const versionsAfter = (await f.db.query<{ count: string }>(
      "select count(*)::text as count from project_parameter_file_versions where file_id=$1",
      [f.candidate.fileId])).rows[0]!.count;
    expect(Number(versionsAfter)).toBe(Number(versionsBefore) + 1);
    const activePins = await Promise.all(after.bindings.map((binding) => loadOwnedProjectValueSourcePin(f.db, {
      organizationId: ORG, projectId: PROJECT, bindingId: binding.id,
      projectValueId: binding.currentValueId
    })));
    expect(activePins.every((pin) => pin?.fileVersionId === currentFile.id)).toBe(true);
    expect(new Set(activePins.map((pin) => pin?.configRevisionId)).size).toBe(1);
    const source = (await f.storage.get(currentFile.storage_key)).toString();
    if (format === "json") {
      expect(source).toContain(`"limit": ${choice === "file" ? 50 : 99}`);
      expect(source).toContain('"limit": 48');
      expect(source).not.toContain('"limit": 60');
    } else {
      expect(source).toContain(`iin_max = <${choice === "file" ? 50 : 99}>`);
      expect(source).toContain("iin_max = <36>");
      expect(source).not.toContain("iin_max = <60>");
    }
    expect((await requestJson(f.route(), `${path}/source-conflict-submit`, {
      method: "POST", body: JSON.stringify(body) })).body).toMatchObject({ item: { requestId, replayed: true } });
  }, 120_000);

  it.each(["reject", "withdraw"] as const)("keeps source unchanged after %s", async (decision) => {
    const f = await fixture("json");
    const path = `/api/v1/projects/${PROJECT}/parameter-file-candidates/${f.candidate.id}`;
    const discovered = await requestJson<{ items: Array<{ choices: { draft: { decisionProofDigest: string } } }> }>(
      f.route(), `${path}/source-conflicts`);
    const body = { selectedBindingId: f.bindingId, selectedDraftId: f.uiDraft.id,
      choice: "draft", expectedDecisionProofDigest: discovered.body.items[0]!.choices.draft.decisionProofDigest,
      assignedToUserId: REVIEWER, reason: "Review UI value" };
    const submitted = await requestJson<{ item: { requestId: string } }>(f.route(), `${path}/source-conflict-submit`, {
      method: "POST", body: JSON.stringify(body) });
    expect(submitted.status).toBe(201);
    const requestId = submitted.body.item.requestId;
    const before = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const requestPath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${requestId}`;
    const result = decision === "reject"
      ? await requestJson<{ item: { status: string } }>(f.route(reviewer), `${requestPath}/review`, {
          method: "POST", body: JSON.stringify({ decision: "reject", note: "Not approved" }) })
      : await requestJson<{ item: { status: string } }>(f.route(), `${requestPath}/withdraw`, { method: "POST" });
    expect(result.status).toBe(200);
    expect(result.body.item.status).toBe(decision === "reject" ? "rejected" : "withdrawn");
    const after = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    expect(after.bindings).toEqual(before.bindings);
    expect(after.values).toEqual(before.values);
    expect(after.pins).toEqual(before.pins);
    expect(after.history).toEqual(before.history);
    expect(after.drafts.some((draft) => draft.id === f.uiDraft.id)).toBe(true);
    expect((await requestJson(f.route(), `${requestPath}/conflict-decision`)).status).toBe(200);
    expect((await requestJson<{ item: { requestId: string; status: string; replayed: boolean } }>(
      f.route(), `${path}/source-conflict-submit`, { method: "POST", body: JSON.stringify(body) })).body.item)
      .toMatchObject({ requestId, status: result.body.item.status, replayed: true });
  }, 120_000);

  it("hides cross-tenant discovery, refuses stale proof and preserves all rows", async () => {
    const f = await fixture("json");
    const path = `/api/v1/projects/${PROJECT}/parameter-file-candidates/${f.candidate.id}`;
    expect((await requestJson(f.route(foreign), `${path}/source-conflicts`)).status).toBe(404);
    expect((await requestJson(f.route(author), `${path}/source-conflicts`)).status).toBe(403);
    const before = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const response = await requestJson(f.route(), `${path}/source-conflict-submit`, {
      method: "POST", body: JSON.stringify({ selectedBindingId: f.bindingId, selectedDraftId: f.uiDraft.id,
        choice: "file", expectedDecisionProofDigest: "0".repeat(64), reason: "stale proof",
        assignedToUserId: REVIEWER }) });
    expect(response.status).toBe(409);
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
  }, 120_000);

  it("keeps a pending request retryable after an unreadable source object", async () => {
    const f = await fixture("json");
    const path = `/api/v1/projects/${PROJECT}/parameter-file-candidates/${f.candidate.id}`;
    const found = await requestJson<{ items: Array<{ choices: { file: { decisionProofDigest: string } } }> }>(
      f.route(), `${path}/source-conflicts`);
    const submitted = await requestJson<{ item: { requestId: string } }>(f.route(), `${path}/source-conflict-submit`, {
      method: "POST", body: JSON.stringify({ selectedBindingId: f.bindingId, selectedDraftId: f.uiDraft.id,
        choice: "file", expectedDecisionProofDigest: found.body.items[0]!.choices.file.decisionProofDigest,
        assignedToUserId: REVIEWER, reason: "Retry source approval" }) });
    expect(submitted.status).toBe(201);
    const requestPath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.requestId}`;
    const sourceKey = (await f.db.query<{ storage_key: string }>(
      "select storage_key from project_parameter_file_candidates where id=$1", [f.candidate.id])).rows[0]!.storage_key;
    const poisoned = { ...f.storage, getBounded: async (key: string, max: number) => key === sourceKey
      ? Buffer.from("poisoned") : f.storage.getBounded!(key, max) };
    const before = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const failed = await requestJson(f.route(reviewer, poisoned), `${requestPath}/review`, {
      method: "POST", body: JSON.stringify({ decision: "approve" }) });
    expect(failed.status).toBe(409);
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    const retried = await requestJson<{ item: { status: string } }>(f.route(reviewer), `${requestPath}/review`, {
      method: "POST", body: JSON.stringify({ decision: "approve" }) });
    expect(retried.status).toBe(200);
    expect(retried.body.item.status).toBe("approved");
  }, 120_000);

  it("hides the assigned review after current project role revocation", async () => {
    const f = await fixture("json");
    const path = `/api/v1/projects/${PROJECT}/parameter-file-candidates/${f.candidate.id}`;
    const found = await requestJson<{ items: Array<{ choices: { file: { decisionProofDigest: string } } }> }>(
      f.route(), `${path}/source-conflicts`);
    const submitted = await requestJson<{ item: { requestId: string } }>(f.route(), `${path}/source-conflict-submit`, {
      method: "POST", body: JSON.stringify({ selectedBindingId: f.bindingId, selectedDraftId: f.uiDraft.id,
        choice: "file", expectedDecisionProofDigest: found.body.items[0]!.choices.file.decisionProofDigest,
        assignedToUserId: REVIEWER, reason: "Review with current role" }) });
    expect(submitted.status).toBe(201);
    const requestPath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.requestId}`;
    await f.db.query("delete from user_role_bindings where user_id=$1 and project_id=$2", [REVIEWER, PROJECT]);
    expect((await requestJson(f.route(reviewer), `${requestPath}/conflict-decision`)).status).toBe(404);
    expect((await requestJson(f.route(reviewer), `${requestPath}/source-diff`)).status).toBe(404);
    const before = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const review = await requestJson(f.route(reviewer), `${requestPath}/review`, {
      method: "POST", body: JSON.stringify({ decision: "approve" }) });
    expect(review.status).toBe(403);
    const after = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    expect({ ...after, audits: before.audits }).toEqual(before);
    expect(after.audits).toEqual(expect.arrayContaining([expect.objectContaining({ action: "deny" })]));
  }, 120_000);

  it("hides a pending decision even if its uploaded candidate link is lost", async () => {
    const f = await fixture("json");
    const path = `/api/v1/projects/${PROJECT}/parameter-file-candidates/${f.candidate.id}`;
    const found = await requestJson<{ items: Array<{ choices: { file: { decisionProofDigest: string } } }> }>(
      f.route(), `${path}/source-conflicts`);
    const submitted = await requestJson<{ item: { requestId: string } }>(f.route(), `${path}/source-conflict-submit`, {
      method: "POST", body: JSON.stringify({ selectedBindingId: f.bindingId, selectedDraftId: f.uiDraft.id,
        choice: "file", expectedDecisionProofDigest: found.body.items[0]!.choices.file.decisionProofDigest,
        assignedToUserId: REVIEWER, reason: "Freeze decision receipt" }) });
    expect(submitted.status).toBe(201);
    await f.db.query("update project_parameter_file_candidates set impact=impact-'canonicalSourceWorkflow' where id=$1",
      [f.candidate.id]);
    const requestPath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.requestId}`;
    expect((await requestJson(f.route(otherReviewer), `${requestPath}/source-diff`)).status).toBe(404);
    expect((await requestJson(f.route(reviewer), `${requestPath}/source-diff`)).status).toBe(409);
    expect((await requestJson(f.route(admin), `${requestPath}/conflict-decision`)).status).toBe(409);
  }, 120_000);

  it("rejects a pending conflict after a separately reviewed cohort source change", async () => {
    const f = await fixture("json");
    const path = `/api/v1/projects/${PROJECT}/parameter-file-candidates/${f.candidate.id}`;
    const found = await requestJson<{ items: Array<{ choices: { file: { decisionProofDigest: string } } }> }>(
      f.route(), `${path}/source-conflicts`);
    const submitted = await requestJson<{ item: { requestId: string } }>(f.route(), `${path}/source-conflict-submit`, {
      method: "POST", body: JSON.stringify({ selectedBindingId: f.bindingId, selectedDraftId: f.uiDraft.id,
        choice: "file", expectedDecisionProofDigest: found.body.items[0]!.choices.file.decisionProofDigest,
        assignedToUserId: REVIEWER, reason: "Review pending selected value" }) });
    expect(submitted.status).toBe(201);
    const current = (await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT }))
      .bindings.find((binding) => binding.id === f.otherBindingId)!;
    const pin = await loadOwnedProjectValueSourcePin(f.db, {
      organizationId: ORG, projectId: PROJECT, bindingId: f.otherBindingId,
      projectValueId: current.currentValueId
    });
    if (!pin) throw new Error("Sibling source pin unavailable");
    const sibling = await createCanonicalValueDraft(f.db, admin, {
      projectId: PROJECT, bindingId: f.otherBindingId,
      sourceTarget: { format: "json", sourceText: "77" }, reason: "Advance sibling source",
      baseRevisionId: pin.configRevisionId, baseCurrentValueId: current.currentValueId
    }, { objectStore: f.storage, invocation: createUserInvocation(admin),
      requestId: "c906-http-sibling-draft", refusalSink: createTrustedRefusalAuditSink(f.db) });
    const siblingRequest = await requestJson<{ item: { id: string } }>(f.route(),
      `/api/v2/projects/${PROJECT}/parameter-value-drafts/${sibling.id}/submit`, {
        method: "POST", body: JSON.stringify({ assignedToUserId: REVIEWER }) });
    expect(siblingRequest.status).toBe(201);
    expect((await requestJson(f.route(reviewer),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${siblingRequest.body.item.id}/review`, {
        method: "POST", body: JSON.stringify({ decision: "approve" }) })).status).toBe(200);
    const before = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const conflictPath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.requestId}`;
    const stale = await requestJson(f.route(reviewer), `${conflictPath}/review`, {
      method: "POST", body: JSON.stringify({ decision: "approve" }) });
    expect(stale.status).toBe(409);
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
  }, 120_000);

  it("marks an old conflict on a canonical file ineligible before bulk arbitration", async () => {
    const database = await createEphemeralTestDatabase("issue906-c-historical-conflict");
    const db = createPostgresDatabase(database.url);
    const directory = await mkdtemp(join(tmpdir(), "wiseeff-906-c-historical-conflict-"));
    const storage = createLocalObjectStore(directory);
    cleanups.push(async () => { await db.close(); await database.drop(); await rm(directory, { recursive: true, force: true }); });
    await seedParameterDashboardFixture(db);
    const organizationId = PARAMETER_DASHBOARD_FIXTURE.organizationId;
    const projectId = PARAMETER_DASHBOARD_FIXTURE.projectIds.aurora;
    const adminId = PARAMETER_DASHBOARD_FIXTURE.activeUserId;
    const legacyAdmin = makeTestAuthContext({ userId: adminId, organizationId,
      permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
      roles: [{ roleId: "admin", projectId: null }] });
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('c906-legacy-admin',$1,$2,null,'admin')",
      [adminId, organizationId]);
    await installConfigurationSourceFixture(db, legacyAdmin, {
      subjectId: "csub_906_c_legacy", schemaId: "wiseeff.906.c.legacy"
    });
    const set = await createConfigSet(db, legacyAdmin, { projectId, name: "Historical conflict" });
    const uploaded = await uploadProjectParameterFile(db, storage, legacyAdmin, {
      projectId, fileName: "settings.json", bytes: Buffer.from('{"settings":{"limit":36.5}}\n')
    });
    await addConfigSetFile(db, legacyAdmin, { configSetId: set.id, fileId: uploaded.file.id, role: "base", sortOrder: 0 });
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Published Catalog fixture unavailable");
    await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, legacyAdmin, catalog, {
      projectId, configSetId: set.id, fileId: uploaded.file.id, fileVersionId: uploaded.version.id,
      configurationSchemaId: "wiseeff.906.c.legacy", rootPointer: "",
      mappings: [{ definitionId: DEF, pointer: "/settings/limit" }],
      invocation: createUserInvocation(legacyAdmin), requestId: "c906-historical-source",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    const uiDraft = (await db.query<{ id: string; project_parameter_value_id: string }>(
      "select id,project_parameter_value_id from parameter_drafts where id='dashboard-fixture-draft-1'"
    )).rows[0]!;
    const legacyValue = (await db.query<{ parameter_definition_id: string }>(
      "select parameter_definition_id from project_parameter_values where id=$1", [uiDraft.project_parameter_value_id]
    )).rows[0]!;
    await seedUser(db, { id: "c906-historical-sync", organizationId });
    await db.query(`insert into parameter_drafts(id,organization_id,project_id,project_parameter_value_id,user_id,
      target_value,reason,origin,origin_file_version_id) values
      ('legacy-file-c906',$1,$2,$3,'c906-historical-sync','50','old sync','file_sync',$4)`,
    [organizationId, projectId, uiDraft.project_parameter_value_id, uploaded.version.id]);
    const conflict = await insertFileSyncConflict(db, {
      id: "legacy-conflict-c906", organizationId, projectId,
      projectParameterValueId: uiDraft.project_parameter_value_id, parameterDefinitionId: legacyValue.parameter_definition_id,
      fileVersionId: uploaded.version.id, fileDraftId: "legacy-file-c906", uiDraftId: uiDraft.id,
      fileValue: "50", uiDraftValue: "200"
    });
    const router = createRouter();
    registerParameterFileRoutes(router, { db, objectStore: storage, getCurrentAuthContext: () => legacyAdmin });
    const server = createHttpServer(router);
    const before = await captureConfigurationSourceState(db, { organizationId, projectId });
    const path = `/api/v1/projects/${projectId}/parameter-file-conflicts`;
    const preview = await requestJson<{ eligible: unknown[]; ineligible: Array<{ reason: string; conflict: { id: string } }> }>(
      server, `${path}/bulk-preview`, {
        method: "POST", body: JSON.stringify({ resolution: "file", conflictIds: [conflict.id] }) });
    expect(preview.status).toBe(200);
    expect(preview.body.eligible).toEqual([]);
    expect(preview.body.ineligible).toMatchObject([{ reason: "canonical_source", conflict: { id: conflict.id } }]);
    const resolve = await requestJson(server, `${path}/bulk-resolve`, {
      method: "POST", body: JSON.stringify({ resolution: "file", conflictIds: [conflict.id] }) });
    expect(resolve.status).toBe(200);
    expect(await captureConfigurationSourceState(db, { organizationId, projectId })).toEqual(before);
    expect((await db.query("select id from parameter_file_sync_conflicts where id=$1", [conflict.id])).rows).toHaveLength(1);
    expect((await db.query("select id from parameter_drafts where id in ('legacy-file-c906','dashboard-fixture-draft-1')")).rows).toHaveLength(2);
  }, 120_000);
});
