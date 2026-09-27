import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { captureConfigurationSourceState, installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { makeTestAuthContext } from "../../testing/authContext";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createLocalObjectStore } from "../logs/objectStore";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createConfigSet, addConfigSetFile } from "./configSetService";
import { uploadProjectParameterFile } from "./service";
import { createCandidate } from "./candidateService";
import { previewCanonicalCandidate, freezeCanonicalCandidateBatchSnapshotInTransaction } from "./canonicalFileWorkflow";
import { withCanonicalSourceAttemptTransaction } from "./canonicalSourceAttemptTransaction";
import { commitCanonicalSourceBatchRevision } from "./canonicalSourceBatchCommit";
import { prepareCanonicalBatchDraftCompositionInTransaction,
  recheckCanonicalBatchDraftCompositionForReviewInTransaction } from "./canonicalBatchDraftComposition";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { parseDtsValue } from "../dts";
import type { ConfigRevisionManifest } from "../parameter-topology/types";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog,
  syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { loadLegacyBindingIdentity } from "../parameter-bindings/binding/migrationAdapter";
import { loadBindingById, loadProjectValueById } from "../parameter-bindings/values/repositories";
import { createCanonicalValueDraft, removeCanonicalValueDraft } from "../parameter-bindings/drafts/service";
import { captureCanonicalBatchDraftImpactInTransaction,
  digestCanonicalBatchDraftCompositionProof, submitCanonicalBatchValueChange,
  approveCanonicalBatchValueChange, getCanonicalBatchValueChangeForReviewer } from "../parameter-bindings/drafts/batchChangeService";

const ORG = "org-906-d-compose";
const PROJECT = "project-906-d-compose";
const ADMIN = "user-906-d-compose-admin";
const REVIEWER = "user-906-d-compose-reviewer";
const AUTHOR = "user-906-d-compose-author";
const JSON_BASE = '{"first":{"limit":10},"second":{"limit":20},"third":{"limit":30}}\n';
const JSON_UPLOAD = '{"first":{"limit":50},"second":{"limit":60},"third":{"limit":30}}\n';
const DTS_BASE = '/dts-v1/;\n/ {\n  first: device@0 { compatible = "acme,power"; iin_max = <10>; };\n  second: device@1 { compatible = "acme,power"; iin_max = <20>; };\n  third: device@2 { compatible = "acme,power"; iin_max = <30>; };\n};\n';
const DTS_UPLOAD = DTS_BASE.replace('iin_max = <10>', 'iin_max = <50>').replace('iin_max = <20>', 'iin_max = <60>');
const admin = makeTestAuthContext({ userId: ADMIN, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });
const reviewer = makeTestAuthContext({ userId: REVIEWER, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: PROJECT }] });
const author = makeTestAuthContext({ userId: AUTHOR, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit"],
  roles: [{ roleId: "software-user", projectId: PROJECT }] });

type Fixture = Awaited<ReturnType<typeof fixture>>;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

async function objectBytes(directory: string) {
  const names = (await readdir(directory, { recursive: true })).sort();
  return Promise.all(names.map(async (name) => {
    const path = join(directory, name);
    return [name, (await stat(path)).isFile() ? (await readFile(path)).toString("base64") : null];
  }));
}

async function fixture(format: "json" | "dts") {
  const lane = await createEphemeralTestDatabase(`d906-compose-${format}`);
  const db = createPostgresDatabase(lane.url);
  const directory = await mkdtemp(join(tmpdir(), `wiseeff-d906-compose-${format}-`));
  const storage = createLocalObjectStore(directory);
  cleanups.push(async () => { await db.close(); await lane.drop(); await rm(directory, { recursive: true, force: true }); });
  await db.query("insert into organizations(id,name) values ($1,'D composition')", [ORG]);
  await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true),($4,$2,'author','Author',true)",
    [ADMIN, ORG, REVIEWER, AUTHOR]);
  await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'D composition','D906','initialized')", [PROJECT, ORG]);
  await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('d906-compose-admin',$1,$2,null,'admin'),('d906-compose-reviewer',$3,$2,$4,'software-committer'),('d906-compose-author',$5,$2,$4,'software-user')",
    [ADMIN, ORG, REVIEWER, PROJECT, AUTHOR]);
  if (format === "json") {
    await installConfigurationSourceFixture(db, admin, { subjectId: "csub_906_compose", schemaId: "wiseeff.906.compose" });
  } else {
    await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power", compatible: "acme,power",
      businessName: "D composition", driverName: "Acme power", idempotencyKey: "d906-compose-driver", reason: "D composition" });
  }
  const set = await createConfigSet(db, admin, { projectId: PROJECT, name: "D composition" });
  const fileName = format === "json" ? "settings.json" : "board.dts";
  const base = format === "json" ? JSON_BASE : DTS_BASE;
  const uploaded = await uploadProjectParameterFile(db, storage, admin, {
    projectId: PROJECT, fileName, bytes: Buffer.from(base)
  });
  await addConfigSetFile(db, admin, { configSetId: set.id, fileId: uploaded.file.id, role: "base", sortOrder: 0 });
  if (format === "json") {
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture unavailable");
    for (const [ordinal, key] of ["first", "second", "third"].entries()) {
      await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
        projectId: PROJECT, configSetId: set.id, fileId: uploaded.file.id,
        fileVersionId: uploaded.version.id, configurationSchemaId: "wiseeff.906.compose",
        rootPointer: `/${key}`, mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: `/${key}/limit` }],
        invocation: createUserInvocation(admin), requestId: `d906-compose-register-${ordinal}`,
        refusalSink: createTrustedRefusalAuditSink(db)
      }));
    }
  } else {
    const manifest: ConfigRevisionManifest = { organizationId: ORG, projectId: PROJECT, configSetId: set.id,
      entryFile: fileName, includeSearchPaths: ["."], overlayOrder: [],
      members: [{ fileId: uploaded.file.id, fileVersionId: uploaded.version.id,
        fileName, sourceName: fileName, role: "base", sortOrder: 0, content: base }] };
    const revision = await ingestConfigRevision(db, manifest, admin, { legacyProjection: "skip" });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture unavailable");
    await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), snapshot,
      { organizationId: ORG, projectId: PROJECT, configSetId: set.id, configRevisionId: revision.id }));
  }
  const bindings = await listCatalogBindingRowsForProject(db, admin, { projectId: PROJECT });
  expect(bindings).toHaveLength(3);
  expect(await Promise.all(bindings.map((binding) => loadLegacyBindingIdentity(getRootPostgresPool(db)!, binding.id))))
    .toEqual([null, null, null]);
  const upload = await createCandidate(db, storage, admin, {
    projectId: PROJECT, fileId: uploaded.file.id, fileName,
    bytes: Buffer.from(format === "json" ? JSON_UPLOAD : DTS_UPLOAD)
  });
  const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: PROJECT, candidateId: upload.id });
  expect(preview.bindings).toHaveLength(2);
  const frozen = await db.transaction((tx) => freezeCanonicalCandidateBatchSnapshotInTransaction(tx, storage, admin, {
    projectId: PROJECT, candidateId: upload.id, expectedProofToken: preview.proofToken!
  }));
  const first = frozen.targets.find((target) => target.targetText === (format === "json" ? "50" : "<50>"));
  expect(first).toBeDefined();
  const draft = await createCanonicalValueDraft(db, author, {
    projectId: PROJECT, bindingId: first!.bindingId,
    ...(format === "json" ? { sourceTarget: { format: "json" as const, sourceText: "88" } }
      : { targetValue: parseDtsValue("iin_max", "<88>").value }),
    reason: "Other author's 88", baseRevisionId: first!.configRevisionId,
    baseCurrentValueId: first!.baseCurrentValueId
  }, { objectStore: storage, invocation: createUserInvocation(author),
    requestId: `d906-compose-draft-${format}`, refusalSink: createTrustedRefusalAuditSink(db) });
  const targetDecisions = frozen.targets.map((target) => target.bindingId === first!.bindingId
    ? { bindingId: target.bindingId, choice: "draft" as const, draftId: draft.id }
    : { bindingId: target.bindingId, choice: "file" as const });
  const impact = await db.transaction((tx) => captureCanonicalBatchDraftImpactInTransaction(
    tx, admin, PROJECT, frozen, targetDecisions));
  return { format, db, storage, directory, upload, preview, draft, first, frozen, targetDecisions, impact,
    fileId: uploaded.file.id };
}

describe("#906 D whole-cohort draft and file composition", () => {
  for (const format of ["json", "dts"] as const) {
    it(`${format} freezes 88/60/30, both objects and the selected draft under one source lock`, async () => {
      const f = await fixture(format);
      const prepared = await withCanonicalSourceAttemptTransaction(f.db, f.storage, (tx, attempt) =>
        prepareCanonicalBatchDraftCompositionInTransaction(tx, attempt.objectStore, admin, {
          projectId: PROJECT, uploadCandidateId: f.upload.id,
          expectedUploadProofToken: f.preview.proofToken!, targetDecisions: f.targetDecisions,
          draftImpactDigest: f.impact.draftImpactDigest, requestId: `d906-compose-${format}`
        }));
      expect(prepared.candidate.targets).toHaveLength(2);
      expect(prepared.candidate.cohort).toHaveLength(3);
      expect(prepared.compositionProof.targetDecisions.map((decision) => decision.choice)).toContain("draft");
      expect(prepared.compositionProof.targetDecisions.map((decision) => decision.choice)).toContain("file");
      const bytes = await f.storage.get(prepared.compositionProof.composedObject.storageKey);
      expect(bytes.toString()).toContain(format === "json" ? '"limit":88' : 'iin_max = <88>');
      expect(bytes.toString()).toContain(format === "json" ? '"limit":60' : 'iin_max = <60>');
      expect(bytes.toString()).toContain(format === "json" ? '"limit":30' : 'iin_max = <30>');
      const compositionProof = { ...prepared.compositionProof,
        decisionProofDigest: digestCanonicalBatchDraftCompositionProof(prepared.compositionProof) };
      const checked = await f.db.transaction((tx) => recheckCanonicalBatchDraftCompositionForReviewInTransaction(
        tx, f.storage, reviewer, { projectId: PROJECT, compositionProof }));
      expect(checked.batchProofDigest).toBe(prepared.candidate.batchProofDigest);
      expect((await objectBytes(f.directory)).length).toBeGreaterThan(0);
    }, 120_000);
  }
});

async function stagedMixed(f: Fixture) {
  const prepared = await withCanonicalSourceAttemptTransaction(f.db, f.storage, (tx, attempt) =>
    prepareCanonicalBatchDraftCompositionInTransaction(tx, attempt.objectStore, admin, {
      projectId: PROJECT, uploadCandidateId: f.upload.id,
      expectedUploadProofToken: f.preview.proofToken!, targetDecisions: f.targetDecisions,
      draftImpactDigest: f.impact.draftImpactDigest, requestId: `d906-mixed-submit-${f.format}`
    }));
  const proof = { ...prepared.compositionProof,
    decisionProofDigest: digestCanonicalBatchDraftCompositionProof(prepared.compositionProof) };
  const requestId = `pvcr_${randomUUID()}`;
  await f.db.transaction(async (tx) => {
    await tx.query(`insert into public.project_parameter_value_change_requests
      (id,organization_id,project_id,request_kind,reason,status,submitter_user_id,assigned_to_user_id,candidate_id,
       candidate_base_digest,candidate_proposed_digest,candidate_diff_digest,candidate_member_manifest,candidate_binding_manifest,
       batch_proof_digest,batch_target_count,batch_source_proof_token,batch_cohort_proof_token,batch_file_id,batch_base_version_id,
       batch_config_set_id,batch_cohort_count,batch_draft_impact,batch_draft_impact_digest,
       batch_upload_candidate_id,batch_composition_proof,batch_decision_proof_digest)
      values ($1,$2,$3,'batch','D isolated mixed source proof','pending',$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,
       $12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22,$23::jsonb,$24)`, [
      requestId, ORG, PROJECT, ADMIN, REVIEWER, prepared.candidate.candidateId,
      prepared.candidate.baseDigest, prepared.candidate.proposedDigest, prepared.candidate.batchProofDigest,
      JSON.stringify(prepared.candidate.members), JSON.stringify(prepared.candidate.cohort),
      prepared.candidate.batchProofDigest, prepared.candidate.targets.length,
      prepared.candidate.proofToken, prepared.candidate.cohortProofToken,
      prepared.candidate.fileId, prepared.candidate.baseVersionId, prepared.candidate.configSetId,
      prepared.candidate.cohort.length, JSON.stringify(f.impact.draftImpact), f.impact.draftImpactDigest,
      f.upload.id, JSON.stringify(proof), proof.decisionProofDigest
    ]);
    for (const [ordinal, target] of prepared.candidate.targets.entries()) {
      const decision = proof.targetDecisions[ordinal]!;
      const cohort = prepared.candidate.cohort.find((entry) => entry.bindingId === target.bindingId)!;
      const base = await loadProjectValueById(asValueClient(tx), target.baseCurrentValueId);
      if (!base) throw new Error("Frozen target base Value unavailable");
      await tx.query(`insert into public.project_parameter_value_change_targets
        (id,request_id,organization_id,project_id,ordinal,draft_id,binding_id,definition_id,definition_revision_id,
         catalog_release_id,base_current_value_id,config_revision_id,source_ref,source_pin_id,action,
         target_value,target_text,base_digest,proposed_digest)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19)`, [
        `pvct_${randomUUID()}`, requestId, ORG, PROJECT, ordinal, decision.draft?.id ?? null,
        target.bindingId, target.definitionId, cohort.effectiveRevisionId, cohort.catalogReleaseId,
        target.baseCurrentValueId, target.configRevisionId, base.source_ref, target.sourcePinId,
        target.action, JSON.stringify(decision.targetValue), target.targetText ?? null,
        prepared.candidate.baseDigest, prepared.candidate.proposedDigest
      ]);
    }
  });
  const visible = await getCanonicalBatchValueChangeForReviewer(f.db, reviewer, { projectId: PROJECT, requestId });
  expect(visible).toMatchObject({ decisionProofDigest: proof.decisionProofDigest,
    draftImpactDigest: f.impact.draftImpactDigest, compositionProof: proof });
  return { requestId, prepared, proof };
}

async function applyMixed(f: Fixture, requestId: string, storage = f.storage) {
  const snapshot = await loadPublishedCatalog(getRootPostgresPool(f.db)!);
  if (!snapshot) throw new Error("Published Catalog fixture unavailable");
  return f.db.transaction((tx) => commitCanonicalSourceBatchRevision(tx, storage, reviewer, snapshot, {
    projectId: PROJECT, requestId, invocation: createUserInvocation(reviewer),
    traceId: `d906-approve-${requestId}`, refusalSink: createTrustedRefusalAuditSink(f.db)
  }));
}

describe("#906 D composed batch writer with a frozen C-shaped request", () => {
  for (const format of ["json", "dts"] as const) {
    it(`${format} applies 88/60/30 atomically with sibling re-pin and retry receipt`, async () => {
      const f = await fixture(format);
      const { requestId, prepared } = await stagedMixed(f);
      const before = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
      const objects = await objectBytes(f.directory);
      const applied = await applyMixed(f, requestId);
      expect(applied).toMatchObject({ requestId, status: "approved" });
      const after = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
      expect(after.values).toHaveLength(before.values.length + 3);
      expect(after.pins).toHaveLength(before.pins.length + 3);
      expect(after.history).toHaveLength(before.history.length + 3);
      expect(after.versions).toHaveLength(before.versions.length + 1);
      expect(after.audits).toHaveLength(before.audits.length + 1);
      expect(after.drafts).toEqual(before.drafts);
      const targets = (await f.db.query<{ target_value: unknown; applied_value_id: string; binding_id: string }>(`
        select target_value,applied_value_id,binding_id
          from public.project_parameter_value_change_targets
         where request_id=$1 order by ordinal`, [requestId])).rows;
      expect(targets.map((target) => target.target_value)).toEqual(
        prepared.compositionProof.targetDecisions.map((decision) => decision.targetValue));
      for (const target of targets) {
        const binding = await loadBindingById(asValueClient(f.db), target.binding_id);
        expect(binding?.current_value_id).toBe(target.applied_value_id);
      }
      expect((await f.db.query<{ current_version_id: string }>(
        "select current_version_id from project_parameter_files where id=$1", [f.fileId])).rows[0]!.current_version_id)
        .not.toBe(prepared.candidate.baseVersionId);
      expect(await objectBytes(f.directory)).toEqual(objects);
      expect(await applyMixed(f, requestId)).toEqual(applied);
      expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(after);
    }, 120_000);
  }
});

describe("#906 D composition refusal and recovery", () => {
  for (const format of ["json", "dts"] as const) {
    it(`${format} removes attempt objects after a known rollback and rejects the same request identity`, async () => {
      const f = await fixture(format);
      const input = { projectId: PROJECT, uploadCandidateId: f.upload.id,
        expectedUploadProofToken: f.preview.proofToken!, targetDecisions: f.targetDecisions,
        draftImpactDigest: f.impact.draftImpactDigest, requestId: `d906-rollback-${format}` };
      const before = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
      const objects = await objectBytes(f.directory);
      await expect(withCanonicalSourceAttemptTransaction(f.db, f.storage, async (tx, attempt) => {
        await prepareCanonicalBatchDraftCompositionInTransaction(tx, attempt.objectStore, admin, input);
        throw new Error("injected late request insert failure");
      })).rejects.toThrow("injected late request insert failure");
      expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
      expect(await objectBytes(f.directory)).toEqual(objects);
      await withCanonicalSourceAttemptTransaction(f.db, f.storage, (tx, attempt) =>
        prepareCanonicalBatchDraftCompositionInTransaction(tx, attempt.objectStore, admin, input));
      const staged = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
      const stagedObjects = await objectBytes(f.directory);
      await expect(withCanonicalSourceAttemptTransaction(f.db, f.storage, (tx, attempt) =>
        prepareCanonicalBatchDraftCompositionInTransaction(tx, attempt.objectStore, admin, input)))
        .rejects.toMatchObject({ code: "CONFLICT", details: { reason: "canonical-batch-composition-request-replayed" } });
      expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(staged);
      expect(await objectBytes(f.directory)).toEqual(stagedObjects);
    }, 120_000);

    it(`${format} rejects selected draft drift, object faults and late audit failure without a partial commit`, async () => {
      const f = await fixture(format);
      const { requestId, proof } = await stagedMixed(f);
      const before = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
      const objects = await objectBytes(f.directory);
      const draftKey = proof.targetDecisions.find((decision) => decision.draft)?.draft?.candidateStorageKey;
      expect(draftKey).toBeTruthy();
      for (const [name, faultKey] of [["upload", proof.uploadObject.storageKey],
        ["draft", draftKey!], ["composed", proof.composedObject.storageKey]] as const) {
        await expect(applyMixed(f, requestId, { ...f.storage, getBounded: async (key, limit) => {
          if (key === faultKey) throw new Error(`injected ${name} object read failure`);
          return f.storage.getBounded!(key, limit);
        } })).rejects.toThrow(`injected ${name} object read failure`);
        expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
        expect(await objectBytes(f.directory)).toEqual(objects);
        await expect(applyMixed(f, requestId, { ...f.storage, getBounded: async (key, limit) => {
          const bytes = await f.storage.getBounded!(key, limit);
          if (key !== faultKey) return bytes;
          const tampered = Buffer.from(bytes);
          tampered[0] = tampered[0]! ^ 1;
          return tampered;
        } })).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
        expect(await objectBytes(f.directory)).toEqual(objects);
      }
      await f.db.query(`create function public.d906_compose_fail_audit() returns trigger language plpgsql as $$ begin
        if new.action='value-change-applied' then raise exception 'injected mixed audit failure'; end if;
        return new; end $$`);
      await f.db.query(`create trigger d906_compose_fail_audit before insert on audit_events
        for each row execute function public.d906_compose_fail_audit()`);
      await expect(applyMixed(f, requestId)).rejects.toThrow("injected mixed audit failure");
      expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
      expect(await objectBytes(f.directory)).toEqual(objects);
      await f.db.query("drop trigger d906_compose_fail_audit on audit_events");
      await f.db.query("drop function public.d906_compose_fail_audit()");
      await removeCanonicalValueDraft(f.db, author, { projectId: PROJECT, draftId: f.draft.id });
      const afterDraftRemoval = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
      await expect(applyMixed(f, requestId)).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT }))
        .toEqual(afterDraftRemoval);
      expect(await objectBytes(f.directory)).toEqual(objects);
    }, 120_000);

    it(`${format} refuses lost review authority and a foreign tenant before source writes`, async () => {
      const f = await fixture(format);
      const { requestId } = await stagedMixed(f);
      const before = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
      const objects = await objectBytes(f.directory);
      const unprivileged = makeTestAuthContext({ userId: REVIEWER, organizationId: ORG,
        permissions: ["parameter:view"], roles: [{ roleId: "software-committer", projectId: PROJECT }] });
      const snapshot = await loadPublishedCatalog(getRootPostgresPool(f.db)!);
      if (!snapshot) throw new Error("Published Catalog fixture unavailable");
      await expect(withCanonicalSourceAttemptTransaction(f.db, f.storage, (tx, attempt) =>
        prepareCanonicalBatchDraftCompositionInTransaction(tx, attempt.objectStore, unprivileged, {
          projectId: PROJECT, uploadCandidateId: f.upload.id,
          expectedUploadProofToken: f.preview.proofToken!, targetDecisions: f.targetDecisions,
          draftImpactDigest: f.impact.draftImpactDigest, requestId: `d906-no-admin-${format}`
        }))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(f.db.transaction((tx) => commitCanonicalSourceBatchRevision(tx, f.storage, unprivileged, snapshot, {
        projectId: PROJECT, requestId, invocation: createUserInvocation(unprivileged),
        traceId: `d906-no-role-${format}`, refusalSink: createTrustedRefusalAuditSink(f.db)
      }))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await f.db.query("insert into organizations(id,name) values ('foreign-d906-compose','Other')");
      await f.db.query("insert into users(id,organization_id,name,title,is_active) values ('foreign-d906-user','foreign-d906-compose','Other','Reviewer',true)");
      const foreign = makeTestAuthContext({ userId: "foreign-d906-user", organizationId: "foreign-d906-compose",
        permissions: ["parameter:view", "parameter:edit", "parameter:review"],
        roles: [{ roleId: "software-committer", projectId: PROJECT }] });
      await expect(f.db.transaction((tx) => commitCanonicalSourceBatchRevision(tx, f.storage, foreign, snapshot, {
        projectId: PROJECT, requestId, invocation: createUserInvocation(foreign),
        traceId: `d906-foreign-${format}`, refusalSink: createTrustedRefusalAuditSink(f.db)
      }))).rejects.toMatchObject({ code: "FORBIDDEN" });
      const after = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
      expect({ ...after, audits: before.audits }).toEqual(before);
      expect(after.audits).toContainEqual(expect.objectContaining({ action: "deny", trace: `d906-no-role-${format}` }));
      expect(await objectBytes(f.directory)).toEqual(objects);
    }, 120_000);

    it(`${format} rejects a composed request after a different reviewed source revision wins`, async () => {
      const f = await fixture(format);
      const { requestId } = await stagedMixed(f);
      const winner = await submitCanonicalBatchValueChange(f.db, f.storage, admin, {
        projectId: PROJECT, candidateId: f.upload.id, expectedProofToken: f.preview.proofToken!,
        reason: "Winning file source", assignedToUserId: REVIEWER,
        targetDecisions: f.frozen.targets.map((target) => ({ bindingId: target.bindingId, choice: "file" })),
        invocation: createUserInvocation(admin), requestId: `d906-winner-${format}`,
        refusalSink: createTrustedRefusalAuditSink(f.db)
      });
      const snapshot = await loadPublishedCatalog(getRootPostgresPool(f.db)!);
      if (!snapshot) throw new Error("Published Catalog fixture unavailable");
      await f.db.transaction((tx) => approveCanonicalBatchValueChange(tx, f.storage, reviewer, snapshot, {
        projectId: PROJECT, requestId: winner.id, batchProofDigest: winner.batchProofDigest,
        draftImpactDigest: winner.draftImpactDigest!, invocation: createUserInvocation(reviewer),
        traceId: `d906-winner-approve-${format}`, refusalSink: createTrustedRefusalAuditSink(f.db)
      }));
      const afterWinner = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
      const objects = await objectBytes(f.directory);
      await expect(applyMixed(f, requestId)).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(afterWinner);
      expect(await objectBytes(f.directory)).toEqual(objects);
    }, 120_000);
  }
});
