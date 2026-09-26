import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { installConfigurationSourceFixture, captureConfigurationSourceState } from "../../../testing/parameterCatalog/configurationSource";
import { makeTestAuthContext } from "../../../testing/authContext";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { createRouter } from "../../../shared/http/router";
import { createHttpServer } from "../../../shared/http/server";
import { requestJson } from "../../../test/testClient";
import { createLocalObjectStore } from "../../logs/objectStore";
import { createTrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { createConfigSet, addConfigSetFile } from "../../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import { createCandidate } from "../../parameter-files/candidateService";
import { previewCanonicalCandidate } from "../../parameter-files/canonicalFileWorkflow";
import { registerCanonicalJsonSource } from "../../parameter-files/canonicalJsonSource";
import { loadPublishedCatalog } from "../catalogProjectValueSync";
import { loadLegacyBindingIdentity } from "../binding/migrationAdapter";
import { registerCatalogProjectValueConsumerRoutes } from "../catalogProjectValueRoutes";
import { createCanonicalValueDraft } from "./service";
import { catalogBatchValueChangeRequestResponseSchema } from "../../contracts/dtoSchemas/parameterCatalog";

const ORG = "org-906-c-impact-json";
const PROJECT = "project-906-c-impact-json";
const ADMIN = "user-906-c-impact-admin";
const REVIEWER = "user-906-c-impact-reviewer";
const AUTHOR = "user-906-c-impact-author";
const SECOND_AUTHOR = "user-906-c-impact-second-author";
const SOURCE = '{"first":{"limit":10},"second":{"limit":20},"third":{"limit":30}}\n';
const admin = makeTestAuthContext({ userId: ADMIN, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });
const reviewer = makeTestAuthContext({ userId: REVIEWER, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: PROJECT }] });
const author = makeTestAuthContext({ userId: AUTHOR, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit"],
  roles: [{ roleId: "software-user", projectId: PROJECT }] });
const secondAuthor = makeTestAuthContext({ userId: SECOND_AUTHOR, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit"],
  roles: [{ roleId: "software-user", projectId: PROJECT }] });

async function objectBytes(directory: string) {
  const names = (await readdir(directory, { recursive: true })).sort();
  return Promise.all(names.map(async (name) => {
    const path = join(directory, name);
    return [name, (await stat(path)).isFile() ? (await readFile(path)).toString("base64") : null];
  }));
}

describe("#906 C whole-cohort JSON draft impact over HTTP", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let storageDirectory: string;
  let fileId: string;
  let bindings: string[];

  beforeEach(async () => {
    lane = await createEphemeralTestDatabase("c906-json-draft-impact");
    db = createPostgresDatabase(lane.url);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-c906-json-impact-"));
    storage = createLocalObjectStore(storageDirectory);
    await db.query("insert into organizations(id,name) values ($1,'JSON impact')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true),($4,$2,'author','User',true),($5,$2,'second','User',true)",
      [ADMIN, ORG, REVIEWER, AUTHOR, SECOND_AUTHOR]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'JSON impact','C906I','initialized')", [PROJECT, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('c906-impact-admin',$1,$2,null,'admin'),('c906-impact-reviewer',$3,$2,$4,'software-committer'),('c906-impact-author',$5,$2,$4,'software-user'),('c906-impact-second',$6,$2,$4,'software-user')",
      [ADMIN, ORG, REVIEWER, PROJECT, AUTHOR, SECOND_AUTHOR]);
    await installConfigurationSourceFixture(db, admin, { subjectId: "csub_906_impact", schemaId: "wiseeff.906.impact" });
    const set = await createConfigSet(db, admin, { projectId: PROJECT, name: "JSON impact" });
    const uploaded = await uploadProjectParameterFile(db, storage, admin, {
      projectId: PROJECT, fileName: "settings.json", bytes: Buffer.from(SOURCE)
    });
    fileId = uploaded.file.id;
    await addConfigSetFile(db, admin, { configSetId: set.id, fileId, role: "base", sortOrder: 0 });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    bindings = [];
    for (const [ordinal, key] of ["first", "second", "third"].entries()) {
      const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
        projectId: PROJECT, configSetId: set.id, fileId, fileVersionId: uploaded.version.id,
        configurationSchemaId: "wiseeff.906.impact", rootPointer: `/${key}`,
        mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: `/${key}/limit` }],
        invocation: createUserInvocation(admin), requestId: `c906-impact-register-${ordinal}`,
        refusalSink: createTrustedRefusalAuditSink(db)
      }));
      bindings.push(registered.bindings[0]!.id);
    }
    expect(await Promise.all(bindings.map((id) => loadLegacyBindingIdentity(getRootPostgresPool(db)!, id))))
      .toEqual([null, null, null]);
  }, 120_000);

  afterEach(async () => {
    await db?.close();
    await lane?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  function route(auth = admin) {
    const router = createRouter();
    registerCatalogProjectValueConsumerRoutes(router, {
      db, objectStore: storage, getCurrentAuthContext: () => auth
    });
    return createHttpServer(router);
  }

  async function draft(bindingId: string, user = author, value = 88) {
    const base = (await db.query<{ current_value_id: string; config_revision_id: string }>(`
      select binding.current_value_id,value.config_revision_id
        from parameter_catalog.project_parameter_bindings binding
        join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
       where binding.id=$1`, [bindingId])).rows[0]!;
    return createCanonicalValueDraft(db, user, {
      projectId: PROJECT, bindingId, sourceTarget: { format: "json", sourceText: String(value) },
      reason: "Other author's competing draft", baseRevisionId: base.config_revision_id,
      baseCurrentValueId: base.current_value_id
    }, { objectStore: storage, invocation: createUserInvocation(user),
      requestId: `c906-impact-draft-${bindingId}-${user.user.id}-${value}`,
      refusalSink: createTrustedRefusalAuditSink(db) });
  }

  async function candidate() {
    const item = await createCandidate(db, storage, admin, {
      projectId: PROJECT, fileId, fileName: "settings.json",
      bytes: Buffer.from('{"first":{"limit":50},"second":{"limit":60},"third":{"limit":30}}\n')
    });
    const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: PROJECT, candidateId: item.id });
    expect(preview.bindings).toHaveLength(2);
    return { item, preview };
  }

  it("hides omission and unsupported draft composition, then approves explicit file values with full impact", async () => {
    const { item, preview } = await candidate();
    const target = preview.bindings![0]!.bindingId;
    const sibling = bindings.find((id) => !preview.bindings!.some((entry) => entry.bindingId === id))!;
    const firstDraft = await draft(target);
    const siblingDraft = await draft(sibling);
    const body = { candidateId: item.id, expectedProofToken: preview.proofToken,
      reason: "One cohort review", assignedToUserId: REVIEWER };
    const submitPath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`;
    const omitted = await requestJson(route(), submitPath, { method: "POST", body: JSON.stringify(body) });
    expect(omitted).toMatchObject({ status: 409, body: { error: {
      details: { reason: "canonical-batch-target-decision-required" } } } });
    const unsupported = await requestJson(route(), submitPath, { method: "POST", body: JSON.stringify({
      ...body, targetDecisions: [{ bindingId: target, choice: "draft", draftId: firstDraft.id }]
    }) });
    expect(unsupported).toMatchObject({ status: 409, body: { error: {
      details: { reason: "canonical-batch-draft-composition-unavailable" } } } });
    expect((await db.query<{ count: number }>(`select count(*)::int as count
      from project_parameter_value_change_requests where candidate_id=$1`, [item.id])).rows[0]!.count).toBe(0);
    const submitted = await requestJson<{ item: { id: string; batchProofDigest: string;
      draftImpactDigest: string; draftImpact: Array<{ bindingId: string; role: string;
        decision: string; drafts: Array<{ draftId: string; expectedEffect: string }> }> } }>(route(), submitPath,
      { method: "POST", body: JSON.stringify({ ...body,
        targetDecisions: [{ bindingId: target, choice: "file" }] }) });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    catalogBatchValueChangeRequestResponseSchema.parse(submitted.body);
    expect(submitted.body.item.draftImpact).toHaveLength(3);
    expect(submitted.body.item.draftImpact.find((entry) => entry.bindingId === target)?.drafts)
      .toEqual([expect.objectContaining({ draftId: firstDraft.id, expectedEffect: "preserved-stale" })]);
    expect(submitted.body.item.draftImpact.find((entry) => entry.bindingId === sibling))
      .toMatchObject({ role: "sibling", decision: "re-pin",
        drafts: [{ draftId: siblingDraft.id, expectedEffect: "preserved-stale" }] });
    const path = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.id}`;
    expect((await requestJson(route(reviewer), `${path}/batch`)).status).toBe(200);
    expect((await requestJson(route(admin), `${path}/batch`)).status).toBe(200);
    expect((await requestJson(route(author), `${path}/batch`)).status).toBe(404);
    const diff = await requestJson<{ item: { bindings: unknown[]; targets: Array<{ ordinal: number }> } }>(
      route(reviewer), `${path}/source-diff`);
    expect(diff.status).toBe(200);
    expect(diff.body.item.bindings).toHaveLength(3);
    expect(diff.body.item.targets.map((entry) => entry.ordinal)).toEqual([0, 1]);
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const draftRowsBefore = (await db.query<{ snapshot: unknown }>(`
      select to_jsonb(draft) as snapshot from project_parameter_value_drafts draft
       where draft.organization_id=$1 and draft.project_id=$2 order by draft.id`, [ORG, PROJECT])).rows;
    const wrong = await requestJson(route(reviewer), `${path}/review`, { method: "POST",
      body: JSON.stringify({ decision: "approve", batchProofDigest: submitted.body.item.batchProofDigest,
        draftImpactDigest: "0".repeat(64) }) });
    expect(wrong.status).toBe(409);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    const approved = await requestJson(route(reviewer), `${path}/review`, { method: "POST",
      body: JSON.stringify({ decision: "approve", batchProofDigest: submitted.body.item.batchProofDigest,
        draftImpactDigest: submitted.body.item.draftImpactDigest }) });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body).toMatchObject({ item: { status: "approved" } });
    const after = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    expect(after.values).toHaveLength(before.values.length + 3);
    expect(after.pins).toHaveLength(before.pins.length + 3);
    expect(after.history).toHaveLength(before.history.length + 3);
    expect(after.versions).toHaveLength(before.versions.length + 1);
    expect(after.revisions).toHaveLength(before.revisions.length + 1);
    expect(after.drafts).toEqual(before.drafts);
    expect((await db.query<{ snapshot: unknown }>(`
      select to_jsonb(draft) as snapshot from project_parameter_value_drafts draft
       where draft.organization_id=$1 and draft.project_id=$2 order by draft.id`, [ORG, PROJECT])).rows)
      .toEqual(draftRowsBefore);
    const replay = await requestJson(route(reviewer), `${path}/review`, { method: "POST",
      body: JSON.stringify({ decision: "approve", batchProofDigest: submitted.body.item.batchProofDigest,
        draftImpactDigest: submitted.body.item.draftImpactDigest }) });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(approved.body);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(after);
    const values = (await db.query<{ id: string; value: unknown }>(`
      select binding.id,value.value from parameter_catalog.project_parameter_bindings binding
        join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
       where binding.organization_id=$1 and binding.project_id=$2 order by binding.id`, [ORG, PROJECT])).rows;
    expect(values).toHaveLength(3);
    expect(values.map((entry) => entry.value).sort((a, b) => Number(a) - Number(b))).toEqual([30, 50, 60]);
    const drafts = (await db.query<{ id: string; target_value: unknown; base_current_value_id: string;
      current_value_id: string }>(`select draft.id,draft.target_value,draft.base_current_value_id,
        binding.current_value_id from project_parameter_value_drafts draft
        join parameter_catalog.project_parameter_bindings binding on binding.id=draft.binding_id
       where draft.organization_id=$1 and draft.project_id=$2 order by draft.id`, [ORG, PROJECT])).rows;
    expect(drafts.map((row) => row.id).sort()).toEqual([firstDraft.id, siblingDraft.id].sort());
    expect(drafts.every((row) => row.base_current_value_id !== row.current_value_id)).toBe(true);
    expect(drafts.every((row) => JSON.stringify(row.target_value).includes("88"))).toBe(true);
  }, 120_000);

  it("rejects a newly inserted sibling draft under source locks without any partial apply", async () => {
    const { item, preview } = await candidate();
    const sibling = bindings.find((id) => !preview.bindings!.some((entry) => entry.bindingId === id))!;
    const first = await draft(sibling);
    const submitPath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`;
    const submitted = await requestJson<{ item: { id: string; batchProofDigest: string;
      draftImpactDigest: string } }>(route(), submitPath, { method: "POST", body: JSON.stringify({
        candidateId: item.id, expectedProofToken: preview.proofToken,
        reason: "Freeze sibling draft", assignedToUserId: REVIEWER
      }) });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    await draft(sibling, secondAuthor, 89);
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objects = await objectBytes(storageDirectory);
    const path = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.id}/review`;
    const review = await requestJson(route(reviewer), path, { method: "POST", body: JSON.stringify({
      decision: "approve", batchProofDigest: submitted.body.item.batchProofDigest,
      draftImpactDigest: submitted.body.item.draftImpactDigest
    }) });
    expect(review).toMatchObject({ status: 409, body: { error: {
      details: { reason: "canonical-batch-draft-impact-stale" } } } });
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    expect(await objectBytes(storageDirectory)).toEqual(objects);
    expect((await db.query<{ id: string }>(`select id from project_parameter_value_drafts
      where id=$1`, [first.id])).rows).toHaveLength(1);
  }, 120_000);

  it("rejects a changed target draft after submission without changing the pending request", async () => {
    const { item, preview } = await candidate();
    const target = preview.bindings![0]!.bindingId;
    const original = await draft(target);
    const submitted = await requestJson<{ item: { id: string; batchProofDigest: string;
      draftImpactDigest: string } }>(route(),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
        method: "POST", body: JSON.stringify({ candidateId: item.id,
          expectedProofToken: preview.proofToken, reason: "Freeze target draft",
          assignedToUserId: REVIEWER, targetDecisions: [{ bindingId: target, choice: "file" }] })
      });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const changed = await draft(target, author, 89);
    expect(changed.id).toBe(original.id);
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objects = await objectBytes(storageDirectory);
    const review = await requestJson(route(reviewer),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.id}/review`, {
        method: "POST", body: JSON.stringify({ decision: "approve",
          batchProofDigest: submitted.body.item.batchProofDigest,
          draftImpactDigest: submitted.body.item.draftImpactDigest })
      });
    expect(review).toMatchObject({ status: 409, body: { error: {
      details: { reason: "canonical-batch-draft-impact-stale" } } } });
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    expect(await objectBytes(storageDirectory)).toEqual(objects);
  }, 120_000);

  it("rolls back three Value and pin writes after a late audit fault, then retries the same request", async () => {
    const { item, preview } = await candidate();
    const target = preview.bindings![0]!.bindingId;
    const sibling = bindings.find((id) => !preview.bindings!.some((entry) => entry.bindingId === id))!;
    const firstDraft = await draft(target);
    const siblingDraft = await draft(sibling);
    const submitted = await requestJson<{ item: { id: string; batchProofDigest: string;
      draftImpactDigest: string } }>(route(),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
        method: "POST", body: JSON.stringify({ candidateId: item.id,
          expectedProofToken: preview.proofToken, reason: "Atomic three Binding review",
          assignedToUserId: REVIEWER,
          targetDecisions: [{ bindingId: target, choice: "file" }] })
      });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const path = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.id}/review`;
    const review = () => requestJson(route(reviewer), path, { method: "POST", body: JSON.stringify({
      decision: "approve", batchProofDigest: submitted.body.item.batchProofDigest,
      draftImpactDigest: submitted.body.item.draftImpactDigest
    }) });
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objects = await objectBytes(storageDirectory);
    await db.query(`create function public.reject_c906_impact_audit() returns trigger language plpgsql as $$
      begin if new.action='value-change-applied'
        then raise exception 'injected late batch audit failure'; end if; return new; end $$`);
    await db.query(`create trigger reject_c906_impact_audit before insert on public.audit_events
      for each row execute function public.reject_c906_impact_audit()`);
    try {
      expect((await review()).status).toBe(500);
    } finally {
      await db.query("drop trigger reject_c906_impact_audit on public.audit_events");
      await db.query("drop function public.reject_c906_impact_audit()");
    }
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    expect(await objectBytes(storageDirectory)).toEqual(objects);
    const retried = await review();
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.body).toMatchObject({ item: { status: "approved" } });
    expect((await db.query<{ id: string }>(`select id from project_parameter_value_drafts
      where id=any($1::text[]) order by id`, [[firstDraft.id, siblingDraft.id]])).rows).toHaveLength(2);
  }, 120_000);

  it("rejects an older three-Binding request after a newer source commit without a second write", async () => {
    const older = await candidate();
    const target = older.preview.bindings![0]!.bindingId;
    const sibling = bindings.find((id) => !older.preview.bindings!.some((entry) => entry.bindingId === id))!;
    await draft(target);
    await draft(sibling);
    const submitPath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`;
    const submit = (candidateId: string, expectedProofToken: string) =>
      requestJson<{ item: { id: string; batchProofDigest: string; draftImpactDigest: string } }>(route(),
        submitPath, { method: "POST", body: JSON.stringify({ candidateId, expectedProofToken,
          reason: "Source drift ordering", assignedToUserId: REVIEWER,
          targetDecisions: [{ bindingId: target, choice: "file" }] }) });
    const first = await submit(older.item.id, older.preview.proofToken!);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const newer = await createCandidate(db, storage, admin, { projectId: PROJECT, fileId,
      fileName: "settings.json",
      bytes: Buffer.from('{"first":{"limit":70},"second":{"limit":80},"third":{"limit":30}}\n') });
    const newerPreview = await previewCanonicalCandidate(db, storage, admin, {
      projectId: PROJECT, candidateId: newer.id
    });
    const second = await submit(newer.id, newerPreview.proofToken!);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    const review = (item: typeof first.body.item) => requestJson(route(reviewer),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${item.id}/review`, {
        method: "POST", body: JSON.stringify({ decision: "approve",
          batchProofDigest: item.batchProofDigest, draftImpactDigest: item.draftImpactDigest })
      });
    expect((await review(second.body.item)).status).toBe(200);
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objects = await objectBytes(storageDirectory);
    expect((await review(first.body.item)).status).toBe(409);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
  }, 120_000);
});
