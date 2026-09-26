import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { createLocalObjectStore } from "../logs/objectStore";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createUserInvocation } from "../auth/trustedInvocation";
import { parseDtsValue } from "../dts";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { asValueClient, loadPublishedCatalog, listCatalogBindingRowsForProject, readCanonicalBindingChangeHistory, syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { loadLegacyBindingIdentity } from "../parameter-bindings/binding/migrationAdapter";
import { loadBindingById, loadHistoryByRevision, loadOwnedProjectValueSourcePin, loadProjectValueById } from "../parameter-bindings/values/repositories";
import { createConfigSet, addConfigSetFile } from "./configSetService";
import { createCandidate } from "./candidateService";
import { freezeCanonicalCandidateBatchSnapshotInTransaction, previewCanonicalCandidate } from "./canonicalFileWorkflow";
import { commitCanonicalSourceBatchRevision } from "./canonicalSourceBatchCommit";
import { uploadProjectParameterFile } from "./service";
import type { ConfigRevisionManifest } from "../parameter-topology/types";

const ORG = "org-906-dts-batch";
const PROJECT = "project-906-dts-batch";
const ADMIN = "user-906-dts-batch-admin";
const REVIEWER = "user-906-dts-batch-reviewer";
const source = `/dts-v1/;\n/ {\n  charger: device@0 { compatible = "acme,power"; iin_max = <36>; };\n  backup: device@1 { compatible = "acme,power"; iin_max = <36>; };\n  spare: device@2 { compatible = "acme,power"; iin_max = <36>; };\n};\n`;
const admin = makeTestAuthContext({ userId: ADMIN, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });
const reviewer = makeTestAuthContext({ userId: REVIEWER, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: PROJECT }] });

describe("#906 D canonical DTS batch source writer", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let storageDirectory: string;
  let fileId: string;
  let baseVersionId: string;
  let bindingIds: string[];

  beforeEach(async () => {
    lane = await createEphemeralTestDatabase("issue906-dts-batch-writer");
    db = createPostgresDatabase(lane.url);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-906-dts-batch-"));
    storage = createLocalObjectStore(storageDirectory);
    await db.query("insert into organizations(id,name) values ($1,'#906 DTS batch')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true)", [ADMIN, ORG, REVIEWER]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'DTS batch','D906B','initialized')", [PROJECT, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('role-906-dts-batch-admin',$1,$2,null,'admin'),('role-906-dts-batch-reviewer',$3,$2,$4,'software-committer')", [ADMIN, ORG, REVIEWER, PROJECT]);
    await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power", compatible: "acme,power",
      businessName: "#906 DTS batch", driverName: "Acme power", idempotencyKey: "906-dts-batch-fixture", reason: "Issue 906 DTS batch" });
    const set = await createConfigSet(db, admin, { projectId: PROJECT, name: "DTS batch" });
    const uploaded = await uploadProjectParameterFile(db, storage, admin, { projectId: PROJECT, fileName: "board.dts", bytes: Buffer.from(source) });
    fileId = uploaded.file.id;
    baseVersionId = uploaded.version.id;
    await addConfigSetFile(db, admin, { configSetId: set.id, fileId, role: "base", sortOrder: 0 });
    const manifest: ConfigRevisionManifest = { organizationId: ORG, projectId: PROJECT, configSetId: set.id,
      entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [],
      members: [{ fileId, fileVersionId: baseVersionId, fileName: "board.dts", sourceName: "board.dts", role: "base", sortOrder: 0, content: source }] };
    const revision = await ingestConfigRevision(db, manifest, admin, { legacyProjection: "skip" });
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Published Catalog fixture is unavailable");
    await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog,
      { organizationId: ORG, projectId: PROJECT, configSetId: set.id, configRevisionId: revision.id }));
    const bindings = await listCatalogBindingRowsForProject(db, admin, { projectId: PROJECT });
    expect(bindings).toHaveLength(3);
    bindingIds = bindings.map((binding) => binding.id).sort();
    expect(await Promise.all(bindingIds.map((id) => loadLegacyBindingIdentity(getRootPostgresPool(db)!, id))))
      .toEqual([null, null, null]);
  }, 120_000);

  afterEach(async () => {
    await db?.close();
    await lane?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  const candidateBytes = (rawText: string) => {
    const before = rawText.startsWith("/delete-property/") ? "iin_max = <36>;" : "iin_max = <36>";
    const after = rawText.startsWith("/delete-property/") ? rawText : `iin_max = ${rawText}`;
    return Buffer.from(source.replace(before, after).replace(before, after));
  };

  async function freezeRequest(bytes: Buffer, overrideFirstTargetValue?: unknown) {
    const candidate = await createCandidate(db, storage, admin, { projectId: PROJECT, fileId, fileName: "board.dts", bytes });
    const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: PROJECT, candidateId: candidate.id });
    expect(preview).toMatchObject({ kind: "canonical", format: "dts", canSubmit: false });
    const requestId = `pvcr_${randomUUID()}`;
    const proof = await db.transaction(async (tx) => {
      const frozen = await freezeCanonicalCandidateBatchSnapshotInTransaction(tx, storage, admin,
        { projectId: PROJECT, candidateId: candidate.id, expectedProofToken: preview.proofToken! });
      await tx.query(`insert into public.project_parameter_value_change_requests
        (id,organization_id,project_id,request_kind,reason,status,submitter_user_id,assigned_to_user_id,candidate_id,
         candidate_base_digest,candidate_proposed_digest,candidate_diff_digest,candidate_member_manifest,candidate_binding_manifest,
         batch_proof_digest,batch_target_count,batch_source_proof_token,batch_cohort_proof_token,batch_file_id,batch_base_version_id,
         batch_config_set_id,batch_cohort_count)
        values ($1,$2,$3,'batch','review exact DTS source','pending',$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [requestId, ORG, PROJECT, ADMIN, REVIEWER, candidate.id, frozen.baseDigest, frozen.proposedDigest,
        frozen.batchProofDigest, JSON.stringify(frozen.members), JSON.stringify(frozen.cohort), frozen.batchProofDigest,
        frozen.targets.length, frozen.proofToken, frozen.cohortProofToken, frozen.fileId, frozen.baseVersionId,
        frozen.configSetId, frozen.cohort.length]);
      for (const [ordinal, target] of frozen.targets.entries()) {
        const cohort = frozen.cohort.find((entry) => entry.bindingId === target.bindingId)!;
        const base = await loadProjectValueById(asValueClient(tx), target.baseCurrentValueId);
        if (!base) throw new Error("Frozen target has no Catalog base Value");
        const targetValue = ordinal === 0 && overrideFirstTargetValue !== undefined
          ? overrideFirstTargetValue : target.action === "delete" ? "" : parseDtsValue("iin_max", target.targetText!).value;
        await tx.query(`insert into public.project_parameter_value_change_targets
          (id,request_id,organization_id,project_id,ordinal,binding_id,definition_id,definition_revision_id,catalog_release_id,
           base_current_value_id,config_revision_id,source_ref,source_pin_id,action,target_value,target_text,base_digest,proposed_digest)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18)`,
        [`pvct_${randomUUID()}`, requestId, ORG, PROJECT, ordinal, target.bindingId, target.definitionId,
          cohort.effectiveRevisionId, cohort.catalogReleaseId, target.baseCurrentValueId, target.configRevisionId,
          base.source_ref, target.sourcePinId, target.action, JSON.stringify(targetValue), target.targetText ?? null,
          target.baseDigest, target.proposedDigest]);
      }
      return frozen;
    });
    return { requestId, candidate, proof };
  }

  async function state(requestId: string) {
    expect(await Promise.all(bindingIds.map((id) => loadLegacyBindingIdentity(getRootPostgresPool(db)!, id))))
      .toEqual([null, null, null]);
    const file = (await db.query<{ current_version_id: string }>("select current_version_id from project_parameter_files where id=$1", [fileId])).rows[0]!;
    const cohort = await Promise.all(bindingIds.map(async (bindingId) => {
      const binding = await loadBindingById(asValueClient(db), bindingId);
      if (!binding) throw new Error("Canonical Binding disappeared");
      const values = await loadHistoryByRevision(asValueClient(db), bindingId, binding.effective_revision_id);
      const pins = await Promise.all(values.map((value) => loadOwnedProjectValueSourcePin(db, {
        organizationId: ORG, projectId: PROJECT, bindingId, projectValueId: value.id
      })));
      const history = await readCanonicalBindingChangeHistory(getRootPostgresPool(db)!, {
        organizationId: ORG, projectId: PROJECT, bindingId
      });
      if (!history) throw new Error("Canonical Binding history disappeared");
      return { binding, values, pins, history };
    }));
    const counts = {
      versions: (await db.query<{ count: number }>("select count(*)::int as count from project_parameter_file_versions where file_id=$1", [fileId])).rows[0]!.count,
      values: cohort.reduce((count, row) => count + row.values.length, 0),
      pins: cohort.reduce((count, row) => count + row.pins.filter(Boolean).length, 0),
      history: cohort.reduce((count, row) => count + row.history.length, 0),
      revisions: (await db.query<{ count: number }>("select count(*)::int as count from dts_config_revisions where project_id=$1", [PROJECT])).rows[0]!.count,
      audits: (await db.query<{ count: number }>("select count(*)::int as count from audit_events where organization_id=$1 and project_id=$2 and action='value-change-applied'", [ORG, PROJECT])).rows[0]!.count
    };
    const tips = cohort.map(({ binding }) => ({ id: binding.id, current_value_id: binding.current_value_id }));
    const request = (await db.query<{ status: string; applied_source_result: unknown }>(
      "select status,applied_source_result from project_parameter_value_change_requests where id=$1", [requestId])).rows[0]!;
    return { file, counts, tips, cohort, request };
  }

  async function commit(requestId: string, objectStore = storage) {
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Published Catalog fixture is unavailable");
    return db.transaction((tx) => commitCanonicalSourceBatchRevision(tx, objectStore, reviewer, catalog,
      { projectId: PROJECT, requestId, invocation: createUserInvocation(reviewer), traceId: requestId,
        refusalSink: createTrustedRefusalAuditSink(db) }));
  }

  it("approves two DTS sets in one full-cohort source revision and replays the receipt", async () => {
    const { requestId, proof } = await freezeRequest(candidateBytes("<77>"));
    expect(proof.targets).toHaveLength(2);
    const before = await state(requestId);
    const approved = await commit(requestId);
    expect(approved).toMatchObject({ requestId, status: "approved", batchProofDigest: proof.batchProofDigest });
    const after = await state(requestId);
    expect(after.request).toMatchObject({ status: "approved", applied_source_result: { bindings: expect.any(Array) } });
    expect(after.file.current_version_id).not.toBe(baseVersionId);
    expect(after.counts).toMatchObject({ versions: before.counts.versions + 1, values: before.counts.values + 3,
      pins: before.counts.pins + 3, history: before.counts.history + 3, revisions: before.counts.revisions + 1,
      audits: before.counts.audits + 1 });
    expect(after.tips.every((tip, index) => tip.current_value_id !== before.tips[index]!.current_value_id)).toBe(true);
    expect(after.cohort.map(({ binding, values, pins }) => {
      const index = values.findIndex((value) => value.id === binding.current_value_id);
      return { valueState: values[index]!.value_state, format: pins[index]!.format,
        fileVersionId: pins[index]!.fileVersionId };
    })).toEqual(Array.from({ length: 3 }, () =>
      ({ valueState: "present", format: "dts", fileVersionId: after.file.current_version_id })));
    expect(await commit(requestId)).toEqual(approved);
    expect(await state(requestId)).toEqual(after);
  }, 120_000);

  it("approves two exact DTS deletes with tombstone pins and keeps the sibling current", async () => {
    const { requestId } = await freezeRequest(candidateBytes("/delete-property/ iin_max;"));
    const before = await state(requestId);
    await commit(requestId);
    const after = await state(requestId);
    expect(after.counts).toMatchObject({ values: before.counts.values + 3, pins: before.counts.pins + 3,
      history: before.counts.history + 3 });
    const current = after.cohort.map(({ binding, values, pins }) => {
      const index = values.findIndex((value) => value.id === binding.current_value_id);
      return { value: values[index]!, pin: pins[index]! };
    });
    expect(current.filter(({ value }) => value.value_state === "deleted")).toHaveLength(2);
    expect(current.filter(({ value }) => value.value_state === "present")).toHaveLength(1);
    expect(current.filter(({ value }) => value.value_state === "deleted").every(({ pin }) =>
      pin.locator.kind === "dts-delete" && Boolean(pin.baseSourcePinId) && pin.deleteRequestId === requestId)).toBe(true);
    expect(await commit(requestId)).toMatchObject({ requestId, status: "approved" });
  }, 120_000);

  it("applies a DTS set and delete together under one reviewed receipt", async () => {
    const bytes = Buffer.from(source.replace("iin_max = <36>", "iin_max = <77>")
      .replace("iin_max = <36>;", "/delete-property/ iin_max;"));
    const { requestId, proof } = await freezeRequest(bytes);
    expect(proof.targets.map((target) => target.action).sort()).toEqual(["delete", "set"]);
    const before = await state(requestId);
    await commit(requestId);
    const after = await state(requestId);
    expect(after.counts).toMatchObject({ versions: before.counts.versions + 1,
      values: before.counts.values + 3, pins: before.counts.pins + 3,
      history: before.counts.history + 3, audits: before.counts.audits + 1 });
    const states = after.cohort.map(({ binding, values }) =>
      values.find((value) => value.id === binding.current_value_id)!.value_state).sort();
    expect(states).toEqual(["deleted", "present", "present"]);
  }, 120_000);

  it("rejects a JSON target payload on a DTS pin at the deferred database contract", async () => {
    await expect(freezeRequest(candidateBytes("<77>"), { kind: "json-source", value: 77 }))
      .rejects.toMatchObject({ code: "23514" });
    expect((await db.query<{ count: number }>(`select count(*)::int as count
      from public.project_parameter_value_change_requests where project_id=$1`, [PROJECT])).rows[0]!.count).toBe(0);
    expect((await db.query<{ count: number }>(`select count(*)::int as count
      from project_parameter_file_versions where file_id=$1`, [fileId])).rows[0]!.count).toBe(1);
  }, 120_000);

  it("rejects a frozen request after another source revision wins and leaves the new state whole", async () => {
    const winning = await freezeRequest(candidateBytes("<77>"));
    const stale = await freezeRequest(candidateBytes("<88>"));
    await commit(winning.requestId);
    const before = await state(stale.requestId);
    await expect(commit(stale.requestId)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await state(stale.requestId)).toEqual(before);
  }, 120_000);

  it("rolls back after a late audit failure and leaves the request retryable", async () => {
    const { requestId, candidate } = await freezeRequest(candidateBytes("<77>"));
    const before = await state(requestId);
    const objectKey = (await db.query<{ storage_key: string }>(
      "select storage_key from project_parameter_file_candidates where id=$1", [candidate.id])).rows[0]!.storage_key;
    await expect(commit(requestId, { ...storage, getBounded: async (key, limit) => {
      if (key === objectKey) throw new Error("injected DTS candidate object read failure");
      return storage.getBounded!(key, limit);
    } })).rejects.toThrow("injected DTS candidate object read failure");
    expect(await state(requestId)).toEqual(before);
    await db.query(`create function public.t906_dts_batch_fail_audit() returns trigger language plpgsql as $$ begin
      if new.action='value-change-applied' then raise exception 'injected late DTS audit failure'; end if;
      return new;
    end $$`);
    await db.query(`create trigger t906_dts_batch_fail_audit before insert on audit_events
      for each row execute function public.t906_dts_batch_fail_audit()`);
    await expect(commit(requestId)).rejects.toThrow("injected late DTS audit failure");
    expect(await state(requestId)).toEqual(before);
    await db.query("drop trigger t906_dts_batch_fail_audit on audit_events");
    await db.query("drop function public.t906_dts_batch_fail_audit()");
    await expect(commit(requestId)).resolves.toMatchObject({ status: "approved" });
  }, 120_000);

  it("refuses self review and a foreign tenant before any source write", async () => {
    const { requestId } = await freezeRequest(candidateBytes("<77>"));
    const before = await state(requestId);
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Published Catalog fixture is unavailable");
    await expect(db.transaction((tx) => commitCanonicalSourceBatchRevision(tx, storage, admin, catalog,
      { projectId: PROJECT, requestId, invocation: createUserInvocation(admin), traceId: "self-review",
        refusalSink: createTrustedRefusalAuditSink(db) }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.query("insert into organizations(id,name) values ('other-tenant','Other tenant')");
    await db.query("insert into users(id,organization_id,name,title,is_active) values ('other-tenant-reviewer','other-tenant','reviewer','Reviewer',true)");
    const foreign = makeTestAuthContext({ userId: "other-tenant-reviewer", organizationId: "other-tenant",
      permissions: ["parameter:view", "parameter:edit", "parameter:review"],
      roles: [{ roleId: "software-committer", projectId: PROJECT }] });
    await expect(db.transaction((tx) => commitCanonicalSourceBatchRevision(tx, storage, foreign, catalog,
      { projectId: PROJECT, requestId, invocation: createUserInvocation(foreign), traceId: "foreign-review",
        refusalSink: createTrustedRefusalAuditSink(db) }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await state(requestId)).toEqual(before);
  }, 120_000);
});
