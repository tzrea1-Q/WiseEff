import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { installConfigurationSourceFixture, captureConfigurationSourceState } from "../../testing/parameterCatalog/configurationSource";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { makeTestAuthContext } from "../../testing/authContext";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { createLocalObjectStore } from "../logs/objectStore";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createUserInvocation } from "../auth/trustedInvocation";
import { parseDtsValue } from "../dts";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../parameter-topology/types";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog,
  syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { loadLegacyBindingIdentity } from "../parameter-bindings/binding/migrationAdapter";
import { loadOwnedProjectValueSourcePin } from "../parameter-bindings/values";
import { loadProjectValueById } from "../parameter-bindings/values/repositories";
import { createCanonicalValueDraft } from "../parameter-bindings/drafts/service";
import { registerCatalogProjectValueConsumerRoutes } from "../parameter-bindings/catalogProjectValueRoutes";
import { createConfigSet, addConfigSetFile } from "./configSetService";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { uploadProjectParameterFile } from "./service";
import { registerParameterFileRoutes } from "./routes";

type Format = "json" | "dts";
const ORG = "org-906-d-approval-fault";
const PROJECT = "project-906-d-approval-fault";
const ADMIN = "user-906-d-approval-admin";
const REVIEWER = "user-906-d-approval-reviewer";
const AUTHOR_A = "user-906-d-approval-author-a";
const AUTHOR_B = "user-906-d-approval-author-b";
const DEF = "pdef_acme_power_iin_max";
const JSON_BASE = '{"first":{"limit":10},"second":{"limit":20},"third":{"limit":30}}\n';
const JSON_UPLOAD = '{"first":{"limit":50},"second":{"limit":60},"third":{"limit":30}}\n';
const DTS_BASE = '/dts-v1/;\n/ {\n  first: device@0 { compatible = "acme,power"; iin_max = <10>; };\n  second: device@1 { compatible = "acme,power"; iin_max = <20>; };\n  third: device@2 { compatible = "acme,power"; iin_max = <30>; };\n};\n';
const DTS_UPLOAD = DTS_BASE.replace("iin_max = <10>", "iin_max = <50>")
  .replace("iin_max = <20>", "iin_max = <60>");
const admin = makeTestAuthContext({ userId: ADMIN, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });
const reviewer = makeTestAuthContext({ userId: REVIEWER, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: PROJECT }] });
const authorA = makeTestAuthContext({ userId: AUTHOR_A, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit"],
  roles: [{ roleId: "software-user", projectId: PROJECT }] });
const authorB = makeTestAuthContext({ userId: AUTHOR_B, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit"],
  roles: [{ roleId: "software-user", projectId: PROJECT }] });
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

async function objectBytes(directory: string) {
  const names = (await readdir(directory, { recursive: true })).sort();
  return Promise.all(names.map(async (name) => {
    const path = join(directory, name);
    return [name, (await stat(path)).isFile() ? (await readFile(path)).toString("base64") : null];
  }));
}

async function fixture(format: Format) {
  const lane = await createEphemeralTestDatabase("d906-approval-fault-" + format);
  const db = createPostgresDatabase(lane.url);
  const directory = await mkdtemp(join(tmpdir(), "wiseeff-d906-approval-" + format + "-"));
  const storage = createLocalObjectStore(directory);
  cleanups.push(async () => { await db.close(); await lane.drop(); await rm(directory, { recursive: true, force: true }); });
  await db.query("insert into organizations(id,name) values ($1,'D approval fault')", [ORG]);
  await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true),($4,$2,'author A','Author',true),($5,$2,'author B','Author',true)",
    [ADMIN, ORG, REVIEWER, AUTHOR_A, AUTHOR_B]);
  await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'D approval fault','D906AF','initialized')",
    [PROJECT, ORG]);
  await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('d906-af-admin',$1,$2,null,'admin'),('d906-af-reviewer',$3,$2,$5,'software-committer'),('d906-af-author-a',$4,$2,$5,'software-user'),('d906-af-author-b',$6,$2,$5,'software-user')",
    [ADMIN, ORG, REVIEWER, AUTHOR_A, PROJECT, AUTHOR_B]);
  if (format === "json") {
    await installConfigurationSourceFixture(db, admin, {
      subjectId: "csub_906_d_approval", schemaId: "wiseeff.906.d-approval"
    });
  } else {
    await installDriverSourceFixture(db, admin, {
      subjectId: "csub_acme_power", compatible: "acme,power", businessName: "D approval fault",
      driverName: "Acme power", idempotencyKey: "d906-approval-driver", reason: "D approval fault"
    });
  }
  const set = await createConfigSet(db, admin, { projectId: PROJECT, name: "D approval fault" });
  const fileName = format === "json" ? "settings.json" : "board.dts";
  const base = format === "json" ? JSON_BASE : DTS_BASE;
  const uploaded = await uploadProjectParameterFile(db, storage, admin, {
    projectId: PROJECT, fileName, bytes: Buffer.from(base)
  });
  await addConfigSetFile(db, admin, { configSetId: set.id, fileId: uploaded.file.id,
    role: "base", sortOrder: 0 });
  const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
  if (!catalog) throw new Error("Published Catalog fixture unavailable");
  if (format === "json") {
    for (const [ordinal, key] of ["first", "second", "third"].entries()) {
      await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, catalog, {
        projectId: PROJECT, configSetId: set.id, fileId: uploaded.file.id,
        fileVersionId: uploaded.version.id, configurationSchemaId: "wiseeff.906.d-approval",
        rootPointer: "/" + key, mappings: [{ definitionId: DEF, pointer: "/" + key + "/limit" }],
        invocation: createUserInvocation(admin), requestId: "d906-af-register-" + ordinal,
        refusalSink: createTrustedRefusalAuditSink(db)
      }));
    }
  } else {
    const manifest: ConfigRevisionManifest = {
      organizationId: ORG, projectId: PROJECT, configSetId: set.id,
      entryFile: fileName, includeSearchPaths: ["."], overlayOrder: [],
      members: [{ fileId: uploaded.file.id, fileVersionId: uploaded.version.id, fileName,
        sourceName: fileName, role: "base", sortOrder: 0, content: base }]
    };
    const revision = await ingestConfigRevision(db, manifest, admin);
    await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog, {
      organizationId: ORG, projectId: PROJECT, configSetId: set.id, configRevisionId: revision.id
    }));
  }
  const bindings = await listCatalogBindingRowsForProject(db, admin, { projectId: PROJECT });
  expect(bindings).toHaveLength(3);
  expect(await Promise.all(bindings.map((binding) =>
    loadLegacyBindingIdentity(getRootPostgresPool(db)!, binding.id)))).toEqual([null, null, null]);
  return { format, db, storage, directory, fileId: uploaded.file.id, bindings };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
function route(f: Fixture, auth = admin) {
  const router = createRouter();
  const options = { db: f.db, objectStore: f.storage, getCurrentAuthContext: () => auth };
  registerParameterFileRoutes(router, options);
  registerCatalogProjectValueConsumerRoutes(router, options);
  return createHttpServer(router);
}

async function draft(f: Fixture, bindingId: string, value: number, auth = authorA) {
  const binding = f.bindings.find((entry) => entry.id === bindingId)!;
  const pin = await loadOwnedProjectValueSourcePin(f.db, { organizationId: ORG, projectId: PROJECT,
    bindingId, projectValueId: binding.currentValueId });
  if (!pin) throw new Error("Canonical sibling pin unavailable");
  return createCanonicalValueDraft(f.db, auth, {
    projectId: PROJECT, bindingId,
    ...(f.format === "json" ? { sourceTarget: { format: "json" as const, sourceText: String(value) } }
      : { targetValue: parseDtsValue("iin_max", "<" + value + ">").value }),
    reason: "Other author's unsubmitted draft", baseRevisionId: pin.configRevisionId,
    baseCurrentValueId: binding.currentValueId
  }, { objectStore: f.storage, invocation: createUserInvocation(auth),
    requestId: "d906-af-draft-" + f.format + "-" + value, refusalSink: createTrustedRefusalAuditSink(f.db) });
}

async function reviewReceipt(f: Fixture, requestId: string) {
  const request = await f.db.query<Record<string, unknown>>(
    "select * from project_parameter_value_change_requests where id=$1 and organization_id=$2 and project_id=$3",
    [requestId, ORG, PROJECT]);
  const targets = await f.db.query<Record<string, unknown>>(
    "select * from project_parameter_value_change_targets where request_id=$1 order by ordinal",
    [requestId]);
  const candidates = await f.db.query<Record<string, unknown>>(
    "select * from project_parameter_file_candidates where organization_id=$1 and project_id=$2 order by id",
    [ORG, PROJECT]);
  return { request: request.rows, targets: targets.rows, candidates: candidates.rows };
}

describe("#906 D mixed approval audit recovery over HTTP", () => {
  it.each(["json", "dts"] as const)("%s keeps the full cohort pending after a late audit fault and replays one approval", async (format) => {
    const f = await fixture(format);
    const workflow = await requestJson<{ item: { proofToken: string } }>(route(f),
      "/api/v1/projects/" + PROJECT + "/parameter-files/" + f.fileId + "/source-workflow");
    expect(workflow.status).toBe(200);
    const currentVersionId = (await f.db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [f.fileId])).rows[0]!.current_version_id;
    const prepared = await requestJson<{ item: { candidateId: string; proofToken: string;
      targets: Array<{ bindingId: string; targetText: string }> } }>(route(f),
      "/api/v1/projects/" + PROJECT + "/parameter-files/" + f.fileId + "/source-manual-sync/prepare", {
        method: "POST", headers: { "X-Request-Id": "d906-af-prepare-" + format },
        body: JSON.stringify({ contentBase64: Buffer.from(format === "json" ? JSON_UPLOAD : DTS_UPLOAD).toString("base64"),
          expectedCurrentVersionId: currentVersionId, expectedWorkflowProofToken: workflow.body.item.proofToken })
      });
    expect(prepared.status, JSON.stringify(prepared.body)).toBe(201);
    expect(prepared.body.item.targets).toHaveLength(2);
    const [first, second] = [format === "json" ? "50" : "<50>", format === "json" ? "60" : "<60>"]
      .map((text) => prepared.body.item.targets.find((target) => target.targetText === text)!);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const sibling = f.bindings.find((binding) =>
      !prepared.body.item.targets.some((target) => target.bindingId === binding.id))!;
    const selected = await draft(f, first.bindingId, 88);
    const declined = await draft(f, second.bindingId, 77, authorB);
    const siblingDraft = await draft(f, sibling.id, 99, authorB);
    expect((await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).requests)
      .toEqual([]);
    const conflictPath = "/api/v1/projects/" + PROJECT + "/parameter-file-candidates/"
      + prepared.body.item.candidateId + "/source-conflicts";
    const conflicts = await requestJson<{ items: Array<{ selectedBindingId: string; selectedDraftId: string;
      choices: { file: { decisionProofDigest: string }; draft: { decisionProofDigest: string } } }>;
      ineligible: unknown[] }>(route(f), conflictPath);
    expect(conflicts.status, JSON.stringify(conflicts.body)).toBe(200);
    expect(conflicts.body.ineligible).toEqual([]);
    expect(conflicts.body.items.map((entry) => entry.selectedDraftId).sort())
      .toEqual([selected.id, declined.id].sort());
    const decisions = prepared.body.item.targets.map((target) => {
      const useDraft = target.bindingId === first.bindingId;
      return { bindingId: target.bindingId, choice: useDraft ? "draft" : "file",
        ...(useDraft ? { draftId: selected.id } : {}),
        expectedConflictProofs: conflicts.body.items.filter((entry) =>
          entry.selectedBindingId === target.bindingId).map((entry) => ({
          draftId: entry.selectedDraftId,
          decisionProofDigest: entry.choices[useDraft && entry.selectedDraftId === selected.id
            ? "draft" : "file"].decisionProofDigest
        })) };
    });
    const submitted = await requestJson<{ item: { id: string; status: string; batchProofDigest: string;
      draftImpactDigest: string; decisionProofDigest: string;
      draftImpact: Array<{ bindingId: string; role: string; decision: string;
        drafts: Array<{ draftId: string }> }> } }>(route(f),
      "/api/v2/projects/" + PROJECT + "/parameter-value-change-requests/batches", {
        method: "POST", headers: { "X-Request-Id": "d906-af-submit-" + format },
        body: JSON.stringify({ candidateId: prepared.body.item.candidateId,
          expectedProofToken: prepared.body.item.proofToken, assignedToUserId: REVIEWER,
          reason: "Review mixed source with sibling draft", targetDecisions: decisions })
      });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const request = submitted.body.item;
    expect(request.status).toBe("pending");
    expect(request.draftImpact).toHaveLength(3);
    expect(request.draftImpact.find((entry) => entry.bindingId === sibling.id))
      .toMatchObject({ role: "sibling", decision: "re-pin", drafts: [{ draftId: siblingDraft.id }] });
    expect(request.draftImpact.some((entry) =>
      entry.drafts.some((item) => item.draftId === declined.id))).toBe(true);
    const requestRows = await f.db.query<{ request_kind: string; status: string }>(
      "select request_kind,status from project_parameter_value_change_requests where organization_id=$1 and project_id=$2",
      [ORG, PROJECT]);
    expect(requestRows.rows).toEqual([{ request_kind: "batch", status: "pending" }]);
    const reviewPath = "/api/v2/projects/" + PROJECT + "/parameter-value-change-requests/" + request.id + "/review";
    const reviewBody = { decision: "approve", batchProofDigest: request.batchProofDigest,
      draftImpactDigest: request.draftImpactDigest, decisionProofDigest: request.decisionProofDigest };
    await f.db.query("create function public.d906_af_fail_audit() returns trigger language plpgsql as $$ begin if new.action='value-change-applied' then raise exception 'injected D approval audit failure'; end if; return new; end $$");
    await f.db.query("create constraint trigger d906_af_fail_audit after insert on audit_events deferrable initially deferred for each row execute function public.d906_af_fail_audit()");
    const before = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const receiptBefore = await reviewReceipt(f, request.id);
    const objectsBefore = await objectBytes(f.directory);
    expect(before.drafts.map((item) => item.id).sort()).toEqual([selected.id, declined.id, siblingDraft.id].sort());
    const failed = await requestJson(route(f, reviewer), reviewPath, {
      method: "POST", body: JSON.stringify(reviewBody)
    });
    expect(failed.status, JSON.stringify(failed.body)).toBe(500);
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    expect(await reviewReceipt(f, request.id)).toEqual(receiptBefore);
    expect(await objectBytes(f.directory)).toEqual(objectsBefore);
    expect(receiptBefore.request).toMatchObject([{ status: "pending", applied_audit_ref: null }]);
    expect(receiptBefore.targets).toHaveLength(2);
    expect(receiptBefore.targets.every((target) => target.applied_value_id === null
      && target.applied_source_pin_id === null && target.applied_history_event_id === null
      && target.applied_file_version_id === null)).toBe(true);
    await f.db.query("drop trigger d906_af_fail_audit on audit_events");
    await f.db.query("drop function public.d906_af_fail_audit()");
    const approved = await requestJson<{ item: { status: string } }>(route(f, reviewer), reviewPath, {
      method: "POST", body: JSON.stringify(reviewBody)
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.item.status).toBe("approved");
    const after = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const receiptAfter = await reviewReceipt(f, request.id);
    expect(after.values).toHaveLength(before.values.length + 3);
    expect(after.pins).toHaveLength(before.pins.length + 3);
    expect(after.history).toHaveLength(before.history.length + 3);
    expect(after.versions).toHaveLength(before.versions.length + 1);
    expect(after.audits).toHaveLength(before.audits.length + 1);
    expect(after.drafts).toEqual(before.drafts);
    expect(receiptAfter.request).toMatchObject([{ status: "approved" }]);
    expect(receiptAfter.targets).toHaveLength(2);
    expect(receiptAfter.targets.map((target) => ({ ordinal: target.ordinal,
      bindingId: target.binding_id }))).toEqual(prepared.body.item.targets.map((target, ordinal) => ({
      ordinal, bindingId: target.bindingId })));
    expect(receiptAfter.targets.every((target) => target.applied_value_id
      && target.applied_source_pin_id && target.applied_history_event_id
      && target.applied_file_version_id)).toBe(true);
    const versionId = after.files.find((file) => file.id === f.fileId)!.currentVersionId!;
    expect(versionId).not.toBe(currentVersionId);
    const pins = await Promise.all(after.bindings.map((binding) =>
      loadOwnedProjectValueSourcePin(f.db, { organizationId: ORG, projectId: PROJECT,
        bindingId: binding.id, projectValueId: binding.currentValueId })));
    expect(pins.every((pin) => pin?.fileVersionId === versionId)).toBe(true);
    expect(new Set(pins.map((pin) => pin?.configRevisionId)).size).toBe(1);
    const currentValues = await Promise.all(after.bindings.map(async (binding) => {
      const value = await loadProjectValueById(asValueClient(f.db), binding.currentValueId);
      return [binding.id, value?.value] as const;
    }));
    expect(new Map(currentValues)).toEqual(new Map([
      [first.bindingId, 88], [second.bindingId, 60], [sibling.id, 30]
    ]));
    const version = (await f.db.query<{ storage_key: string }>(
      "select storage_key from project_parameter_file_versions where id=$1", [versionId])).rows[0]!;
    const source = (await f.storage.get(version.storage_key)).toString();
    if (format === "json") {
      const parsed = JSON.parse(source) as { first: { limit: number }; second: { limit: number };
        third: { limit: number } };
      expect([parsed.first.limit, parsed.second.limit, parsed.third.limit]).toEqual([88, 60, 30]);
    } else {
      expect(source).toMatch(/first: device@0 \{[^}]*iin_max = <88>;/);
      expect(source).toMatch(/second: device@1 \{[^}]*iin_max = <60>;/);
      expect(source).toMatch(/third: device@2 \{[^}]*iin_max = <30>;/);
    }
    expect(await objectBytes(f.directory)).toEqual(objectsBefore);
    const replay = await requestJson(route(f, reviewer), reviewPath, {
      method: "POST", body: JSON.stringify(reviewBody)
    });
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(after);
    expect(await reviewReceipt(f, request.id)).toEqual(receiptAfter);
    expect(await objectBytes(f.directory)).toEqual(objectsBefore);
  }, 120_000);
});
