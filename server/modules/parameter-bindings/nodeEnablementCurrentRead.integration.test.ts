import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { seedCoreGraph, seedSpecBindingGraph } from "../../testing/fixtures";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../../testing/testDatabase";
import { createLocalObjectStore } from "../logs/objectStore";
import { addConfigSetFile, createConfigSet } from "../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { asValueClient, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "./catalogProjectValueSync";
import type { ChangeRequestDto, ParameterSubmissionRoundDto } from "../parameters/types";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";

const organizationId = "org-1076";
const projectId = "project-1076";
const adminId = "admin-1076";
const authorId = "author-1076";
const reviewerId = "hardware-1077";
const softwareId = "software-1077";
const otherReviewerId = "other-hardware-1077";
const admin = makeTestAuthContext({ userId: adminId, organizationId });
const base = '/dts-v1/;\n/ { charger: charger { compatible = "acme,power"; iin_max = <1000>; status = "okay"; }; };\n';
describe.each([
  { name: "empty overlay", overlay: '/dts-v1/;\n/plugin/;\n' },
  { name: "existing status", overlay: '/dts-v1/;\n/plugin/;\n&charger { status = "okay"; };\n' },
])("#1076 assembled-server node enablement current Binding read ($name)", ({ overlay }) => {
  let lane: EphemeralTestDatabase;
  let db: RootDatabase;
  let directory: string;
  let server: ReturnType<typeof createWiseEffServer>;
  let configSetId: string;
  let revisionId: string;
  let siblingRevisionId: string;

  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("node-enablement-current-read");
    db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-1076-"));
    const storage = createLocalObjectStore(directory);
    await seedCoreGraph(db, {
      organization: { id: organizationId },
      users: [adminId, authorId, reviewerId, softwareId, otherReviewerId].map((id) => ({ id })),
      projects: [{ id: projectId }]
    });
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values
      ('role-admin-1076',$1,$2,null,'admin'), ('role-author-1076',$3,$2,$4,'software-user')`,
    [adminId, organizationId, authorId, projectId]);
    for (const [userId, roleId] of [[reviewerId, "hardware-committer"], [softwareId, "software-committer"], [otherReviewerId, "hardware-committer"]]) {
      await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
        values ($1,$2,$3,$4,$5)`, [`role-${userId}`, userId, organizationId, projectId, roleId]);
    }
    const driver = await installDriverSourceFixture(db, admin, {
      subjectId: "csub_acme_power", compatible: "acme,power", businessName: "Power",
      driverName: "Charger", idempotencyKey: "1076-driver", reason: "Node enablement current read fixture"
    });
    const configSet = await createConfigSet(db, admin, { projectId, name: "default" });
    configSetId = configSet.id;
    const baseFile = await uploadProjectParameterFile(db, storage, admin, { projectId, fileName: "board.dts", bytes: Buffer.from(base) });
    const overlayFile = await uploadProjectParameterFile(db, storage, admin, { projectId, fileName: "overlay.dts", bytes: Buffer.from(overlay) });
    await addConfigSetFile(db, admin, { configSetId, fileId: baseFile.file.id, role: "base", sortOrder: 0 });
    await addConfigSetFile(db, admin, { configSetId, fileId: overlayFile.file.id, role: "overlay", sortOrder: 1 });
    const revision = await ingestConfigRevision(db, {
      organizationId, projectId, configSetId, entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: ["overlay.dts"],
      members: [
        { fileId: baseFile.file.id, fileVersionId: baseFile.version.id, fileName: "board.dts", sourceName: "board.dts", role: "base", sortOrder: 0, content: base },
        { fileId: overlayFile.file.id, fileVersionId: overlayFile.version.id, fileName: "overlay.dts", sourceName: "overlay.dts", role: "overlay", sortOrder: 1, content: overlay }
      ]
    }, admin);
    revisionId = revision.id;
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Canonical fixture requires a published Catalog");
    await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog, {
      organizationId, projectId, configSetId, configRevisionId: revisionId
    }));
    const node = (await db.query<{ logical_node_id: string }>(
      "select logical_node_id from dts_logical_node_revisions where config_revision_id = $1 and name = 'charger'", [revisionId]
    )).rows[0]!;
    await seedSpecBindingGraph(db, {
      organizationId,
      specs: [{ id: "historical-iin-1076", specificationKey: "acme/iin_max", versions: [{ id: "historical-iin-version-1076", displayName: "Historical current limit" }] }],
      bindings: [{ id: "historical-binding-1076", projectId, parameterSpecId: "historical-iin-1076", moduleId: driver.driverModuleId,
        logicalNodeId: node.logical_node_id, revisions: [{ id: "historical-binding-revision-1076", configRevisionId: revisionId,
          parameterSpecVersionId: "historical-iin-version-1076", rawValue: "<1000>" }] }]
    });
    const siblingSet = await createConfigSet(db, admin, { projectId, name: "sibling" });
    const siblingSource = '/dts-v1/;\n/ { sibling: sibling { compatible = "acme,power"; iin_max = <2000>; }; };\n';
    const siblingFile = await uploadProjectParameterFile(db, storage, admin, {
      projectId, fileName: "sibling.dts", bytes: Buffer.from(siblingSource)
    });
    await addConfigSetFile(db, admin, { configSetId: siblingSet.id, fileId: siblingFile.file.id, role: "base", sortOrder: 0 });
    const siblingRevision = await ingestConfigRevision(db, {
      organizationId, projectId, configSetId: siblingSet.id, entryFile: "sibling.dts", includeSearchPaths: ["."], overlayOrder: [],
      members: [{ fileId: siblingFile.file.id, fileVersionId: siblingFile.version.id, fileName: "sibling.dts", sourceName: "sibling.dts", role: "base", sortOrder: 0, content: siblingSource }]
    }, admin);
    siblingRevisionId = siblingRevision.id;
    await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog, {
      organizationId, projectId, configSetId: siblingSet.id, configRevisionId: siblingRevisionId
    }));
    server = createWiseEffServer({ db, objectStore: storage });
    await db.query("alter table parameter_change_requests drop column parameter_definition_id, drop column project_parameter_value_id");
    await db.query("alter table parameter_history_entries drop column parameter_definition_id, drop column project_parameter_value_id");
  });

  afterAll(async () => {
    setParameterIdentityMode(null);
    await db?.close();
    await lane?.drop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  const read = <Body>(path: string, userId = authorId) => requestJson<Body>(server, path, { headers: { "X-WiseEff-User": userId } });

  it("keeps current Bindings and immutable pins while a separate structural draft is staged", async () => {
    const path = `/api/v2/projects/${projectId}/parameter-bindings`;
    const before = await read<{ items: Array<{ id: string; propertyKey: string; currentValueId: string }> }>(`${path}?revisionId=${revisionId}`);
    expect(before.status).toBe(200);
    expect(before.body.items).toHaveLength(1);
    expect(before.body.items[0]?.propertyKey).toBe("iin_max");
    const allBefore = await read<typeof before.body>(path);
    expect(allBefore.body.items).toHaveLength(2);
    const siblingBefore = await read<typeof before.body>(`${path}?revisionId=${siblingRevisionId}`);
    expect(siblingBefore.body.items).toHaveLength(1);
    expect(siblingBefore.body.items[0]?.id).not.toBe(before.body.items[0]?.id);
    const countsBefore = (await db.query(`select
      (select count(*) from parameter_catalog.parameter_definitions) as definitions,
      (select count(*) from parameter_catalog.project_parameter_bindings where project_id = $1) as bindings,
      (select count(*) from parameter_catalog.project_parameter_values value
       join parameter_catalog.project_parameter_bindings binding on binding.id = value.binding_id
       where binding.project_id = $1) as values`, [projectId])).rows;
    const identityBefore = (await db.query(`select b.id, b.definition_id, b.current_value_id, p.*
      from parameter_catalog.current_project_parameter_bindings b
      join parameter_catalog.project_value_source_pins p on p.project_value_id = b.current_value_id
      where b.project_id = $1 order by b.id`, [projectId])).rows;
    const topology = await read<{ item: { nodes: Array<{ name: string; logicalNodeId: string }> } }>(
      `/api/v2/projects/${projectId}/config-sets/${configSetId}/revisions/${revisionId}/topology?view=effective`
    );
    expect(topology.status).toBe(200);
    const node = topology.body.item.nodes.find((item) => item.name === "charger");
    expect(node).toBeDefined();
    const staged = await requestJson<{ item: { draftId: string; candidateRevisionId: string } }>(server,
      `/api/v2/projects/${projectId}/node-enablement-drafts`, {
        method: "POST", headers: { "X-WiseEff-User": authorId },
        body: JSON.stringify({ logicalNodeId: node!.logicalNodeId, baseRevisionId: revisionId, target: "force-disabled", reason: "Keep current parameters visible" })
      });
    expect(staged.status, JSON.stringify(staged.body)).toBe(201);
    expect(staged.body.item.candidateRevisionId).not.toBe(revisionId);
    const after = await read<typeof before.body>(`${path}?revisionId=${staged.body.item.candidateRevisionId}`);
    expect(after.status).toBe(200);
    expect(after.body.items).toEqual(before.body.items);
    expect((await read<typeof before.body>(path)).body.items).toEqual(allBefore.body.items);
    expect((await read<typeof before.body>(`${path}?revisionId=${siblingRevisionId}`)).body.items).toEqual(siblingBefore.body.items);
    expect((await db.query(`select
      (select count(*) from parameter_catalog.parameter_definitions) as definitions,
      (select count(*) from parameter_catalog.project_parameter_bindings where project_id = $1) as bindings,
      (select count(*) from parameter_catalog.project_parameter_values value
       join parameter_catalog.project_parameter_bindings binding on binding.id = value.binding_id
       where binding.project_id = $1) as values`, [projectId])).rows).toEqual(countsBefore);
    expect((await db.query(`select b.id, b.definition_id, b.current_value_id, p.*
      from parameter_catalog.current_project_parameter_bindings b
      join parameter_catalog.project_value_source_pins p on p.project_value_id = b.current_value_id
      where b.project_id = $1 order by b.id`, [projectId])).rows).toEqual(identityBefore);
    const drafts = await read<{ items: Array<{ id: string; editSubjectKind: string; projectParameterBindingId: string | null; parameterSpecId: string | null }> }>(
      `/api/v1/parameter-drafts/mine?projectId=${projectId}`
    );
    expect(drafts.status).toBe(200);
    expect(drafts.body.items).toEqual([expect.objectContaining({
      id: staged.body.item.draftId, editSubjectKind: "node-enablement"
    })]);
    expect(drafts.body.items[0]).not.toHaveProperty("projectParameterBindingId");
    expect(drafts.body.items[0]).not.toHaveProperty("parameterSpecId");
    expect((await db.query(`select edit_subject_kind, project_parameter_binding_id, project_parameter_value_id
      from parameter_drafts where id = $1`, [staged.body.item.draftId])).rows).toEqual([{
      edit_subject_kind: "node-enablement", project_parameter_binding_id: null, project_parameter_value_id: null
    }]);
    expect((await read<{ items: unknown[] }>(`/api/v2/projects/${projectId}/parameter-value-drafts`)).body.items).toEqual([]);
    expect((await read<typeof before.body>(`${path}?revisionId=unknown-revision`)).body.items).toEqual([]);
    expect((await read(path, "unknown-user-1076")).status).toBe(401);
  });

  async function submit() {
    const topology = await read<{ item: { nodes: Array<{ logicalNodeId: string; name: string }> } }>(
      `/api/v2/projects/${projectId}/config-sets/${configSetId}/revisions/${revisionId}/topology?view=effective`
    );
    expect(topology.status, topology.bodyText).toBe(200);
    const logicalNodeId = topology.body.item.nodes.find((node) => node.name === "charger")!.logicalNodeId;
    const drafts = await read<{ items: Array<{ id: string; logicalNodeId: string; reason: string }> }>(`/api/v1/parameter-drafts/mine?projectId=${projectId}`);
    const existingDraft = drafts.body.items.find((draft) => draft.logicalNodeId === logicalNodeId);
    const staged = existingDraft ? { status: 201, bodyText: "persisted node draft", body: { item: { draftId: existingDraft.id } } }
      : await requestJson<{ item: { draftId: string } }>(server,
      `/api/v2/projects/${projectId}/node-enablement-drafts`, {
        method: "POST", headers: { "X-WiseEff-User": authorId },
        body: JSON.stringify({ logicalNodeId, baseRevisionId: revisionId, target: "force-disabled", reason: "Disable charger" })
      });
    expect(staged.status, staged.bodyText).toBe(201);
    const submitted = await requestJson<{ item: ParameterSubmissionRoundDto }>(server, "/api/v1/parameter-submission-rounds", {
      method: "POST", headers: { "X-WiseEff-User": authorId },
      body: JSON.stringify({ projectId, items: [{ draftId: staged.body.item.draftId, editSubjectKind: "node-enablement",
        logicalNodeId, action: "set", targetValue: '"disabled"', reason: existingDraft?.reason ?? "Disable charger" }],
      assignees: { hardwareCommitterId: reviewerId, softwareCommitterId: softwareId, softwareUserId: authorId } })
    });
    expect(submitted.status, submitted.bodyText).toBe(201);
    return { round: submitted.body.item, logicalNodeId };
  }

  async function sourceState() {
    return (await db.query(`select file.id, file.current_version_id, version.checksum
      from project_parameter_files file join project_parameter_file_versions version on version.id = file.current_version_id
      where file.config_set_id = $1 order by file.id`, [configSetId])).rows;
  }

  it("lists an active node-only submission and its assigned review queue without parameter identity", async () => {
    setParameterIdentityMode("semantic");
    const { round, logicalNodeId } = await submit();
    const sourceBefore = await sourceState();
    expect(round.status).toBe("hardware_review");
    const submissions = await read<{ items: ParameterSubmissionRoundDto[] }>(`/api/v1/parameter-submission-rounds?projectId=${projectId}&mine=true`);
    expect(submissions.status, submissions.bodyText).toBe(200);
    expect(submissions.body.items).toEqual([expect.objectContaining({ id: round.id, status: "hardware_review",
      items: [expect.objectContaining({ editSubjectKind: "node-enablement", logicalNodeId, name: "charger",
        currentValue: '"okay"', targetValue: '"disabled"' })] })]);
    const reviews = await read<{ items: ChangeRequestDto[] }>(`/api/v1/parameter-change-requests?projectId=${projectId}&assignedTo=${reviewerId}`, reviewerId);
    expect(reviews.status, reviews.bodyText).toBe(200);
    expect(reviews.body.items).toEqual([expect.objectContaining({ id: round.items[0]!.requestId,
      editSubjectKind: "node-enablement", logicalNodeId, title: "charger", assignedTo: reviewerId, status: "hardware_review" })]);
    expect(reviews.body.items[0]).not.toHaveProperty("baseVersion");
    const unrelated = await read<{ items: ChangeRequestDto[] }>(`/api/v1/parameter-change-requests?projectId=${projectId}`, otherReviewerId);
    expect(unrelated.status).toBe(200);
    expect(unrelated.body.items).toEqual([]);
    expect((await db.query(`select project_parameter_binding_id, parameter_spec_id from parameter_change_requests where id = $1`,
      [round.items[0]!.requestId])).rows).toEqual([{ project_parameter_binding_id: null, parameter_spec_id: null }]);
    const pinsBefore = (await db.query(`select pin.* from parameter_catalog.project_value_source_pins pin
      join parameter_catalog.project_parameter_values value on value.id = pin.project_value_id
      join parameter_catalog.project_parameter_bindings binding on binding.id = value.binding_id
      where binding.project_id = $1 order by pin.project_value_id`, [projectId])).rows;
    const requestId = round.items[0]!.requestId;
    const review = (userId: string, decision: "advance" | "reject", correlation: string) => requestJson<{ item: ChangeRequestDto }>(server,
      `/api/v1/parameter-change-requests/${requestId}/review`, { method: "POST",
        headers: { "X-WiseEff-User": userId, "X-Request-Id": correlation },
        body: JSON.stringify({ decision, note: "Human node review", initiatorType: "system", reviewerUserId: adminId }) });
    const refused = await review(authorId, "advance", "1077-refused");
    expect(refused.status, refused.bodyText).toBe(403);
    const approved = await review(reviewerId, "advance", "1077-approved");
    expect(approved.status, approved.bodyText).toBe(200);
    expect(approved.body.item).toMatchObject({ status: "software_review", assignedTo: softwareId, editSubjectKind: "node-enablement" });
    const nextQueue = await read<{ items: ChangeRequestDto[] }>(`/api/v1/parameter-change-requests?projectId=${projectId}`, softwareId);
    expect(nextQueue.body.items).toEqual([expect.objectContaining({ id: requestId, title: "charger", assignedTo: softwareId })]);
    const rejected = await review(softwareId, "reject", "1077-rejected");
    expect(rejected.status, rejected.bodyText).toBe(200);
    expect(rejected.body.item.status).toBe("rejected");
    expect(await sourceState()).toEqual(sourceBefore);
    expect((await db.query(`select reviewer_user_id, decision, from_status, to_status, initiator_type
      from parameter_review_decisions where request_id = $1 and from_status <> 'submitted' order by created_at`, [requestId])).rows).toEqual([
      { reviewer_user_id: reviewerId, decision: "advance", from_status: "hardware_review", to_status: "software_review", initiator_type: "user" },
      { reviewer_user_id: softwareId, decision: "reject", from_status: "software_review", to_status: "rejected", initiator_type: "user" }
    ]);
    expect((await db.query(`select kind, action, actor_type, actor_user_id, trace_id from audit_events
      where target_id = $1 and kind in ('parameter-review-advance', 'parameter-review-reject') order by created_at`, [requestId])).rows).toEqual([
      { kind: "parameter-review-advance", action: "advance", actor_type: "user", actor_user_id: reviewerId, trace_id: "1077-approved" },
      { kind: "parameter-review-reject", action: "reject", actor_type: "user", actor_user_id: softwareId, trace_id: "1077-rejected" }
    ]);
    expect((await db.query(`select pin.* from parameter_catalog.project_value_source_pins pin
      join parameter_catalog.project_parameter_values value on value.id = pin.project_value_id
      join parameter_catalog.project_parameter_bindings binding on binding.id = value.binding_id
      where binding.project_id = $1 order by pin.project_value_id`, [projectId])).rows).toEqual(pinsBefore);
    const completed = await read<{ items: ParameterSubmissionRoundDto[] }>(`/api/v1/parameter-submission-rounds?projectId=${projectId}&mine=true`);
    expect(completed.body.items).toEqual([expect.objectContaining({ id: round.id, status: "rejected", items: [expect.objectContaining({ logicalNodeId })] })]);
  });

  it("#1078 applies approved structural enablement while retaining canonical values, pins and the legacy fence", async () => {
    setParameterIdentityMode("semantic");
    const before = await read<{ items: Array<Record<string, unknown>> }>(`/api/v2/projects/${projectId}/parameter-bindings`);
    const canonicalState = async () => (await db.query(`select to_jsonb(binding) as binding,
      (select jsonb_agg(to_jsonb(value) order by value.id) from parameter_catalog.project_parameter_values value where value.binding_id = binding.id) as values,
      (select jsonb_agg(to_jsonb(pin) order by pin.id) from parameter_catalog.project_value_source_pins pin
       join parameter_catalog.project_parameter_values value on value.id = pin.project_value_id where value.binding_id = binding.id) as pins
      from parameter_catalog.project_parameter_bindings binding where binding.project_id = $1 order by binding.id`, [projectId])).rows;
    const retained = await canonicalState();
    const originalSource = await sourceState();
    const { round, logicalNodeId } = await submit();
    const requestId = round.items[0]!.requestId;
    for (const [userId, status] of [[reviewerId, "software_review"], [softwareId, "software_merge"], [authorId, "merged"]]) {
      if (status === "merged") {
        const blocker = await getRootPostgresPool(db)!.connect();
        let pendingReview: ReturnType<typeof requestJson> | undefined;
        let earlyResponse: Awaited<ReturnType<typeof requestJson>> | null = null;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await blocker.query("begin");
          await blocker.query("select id from dts_config_set where id=$1 for update", [configSetId]);
          await blocker.query("select id from parameter_change_requests where id=$1 for update", [requestId]);
          pendingReview = requestJson(server, `/api/v1/parameter-change-requests/${requestId}/review`, {
            method: "POST", headers: { "X-WiseEff-User": authorId },
            body: JSON.stringify({ decision: "advance", note: "https://example.test/review/1078" })
          });
          earlyResponse = await Promise.race([pendingReview, new Promise<null>((resolve) => { timeout = setTimeout(() => resolve(null), 1000); })]);
        } finally {
          if (timeout) clearTimeout(timeout);
          await blocker.query("rollback");
          blocker.release();
          if (pendingReview) await pendingReview;
        }
        expect(earlyResponse, "busy source must refuse without waiting on the workflow lock").not.toBeNull();
        expect(earlyResponse!.status).toBe(409);
        expect(earlyResponse!.body).toMatchObject({ error: { details: { reason: "source-proof-busy" } } });
        expect(await sourceState()).toEqual(originalSource);
        expect(await canonicalState()).toEqual(retained);
        expect((await db.query("select status from parameter_change_requests where id=$1", [requestId])).rows).toEqual([{ status: "software_merge" }]);
        expect((await db.query("select id from parameter_history_entries where request_id=$1", [requestId])).rows).toEqual([]);
      }
      const reviewed = await requestJson<{ item: ChangeRequestDto }>(server, `/api/v1/parameter-change-requests/${requestId}/review`, {
        method: "POST", headers: { "X-WiseEff-User": userId!, "X-Request-Id": `1078-${status}` },
        body: JSON.stringify({ decision: "advance", note: "https://example.test/review/1078", initiatorType: "system" })
      });
      expect(reviewed.status, reviewed.bodyText).toBe(200);
      expect(reviewed.body.item.status).toBe(status);
    }
    const current = await sourceState();
    expect(current).not.toEqual(originalSource);
    const structuralState = await canonicalState();
    for (const original of retained) {
      const successor = structuralState.find((row) => row.binding.id === original.binding.id)!;
      expect({ ...successor.binding, current_value_id: original.binding.current_value_id, updated_at: original.binding.updated_at }).toEqual(original.binding);
      expect(successor.values).toEqual(expect.arrayContaining(original.values));
      expect(successor.pins).toEqual(expect.arrayContaining(original.pins));
      const added = successor.binding.current_value_id === original.binding.current_value_id ? 0 : 1;
      expect(successor.values).toHaveLength(original.values.length + added);
      expect(successor.pins).toHaveLength(original.pins.length + added);
    }
    const bindings = await read<typeof before.body>(`/api/v2/projects/${projectId}/parameter-bindings`);
    expect(bindings.body.items.map((binding) => ({ ...binding, currentValueId: "" })))
      .toEqual(before.body.items.map((binding) => ({ ...binding, currentValueId: "" })));
    const applied = (await db.query(`select member.file_version_id, revision.id from dts_config_revisions revision
      join dts_config_revision_members member on member.config_revision_id = revision.id
      join project_parameter_files file on file.id = member.file_id and file.current_version_id = member.file_version_id
      where revision.config_set_id = $1 and member.role = 'overlay' order by revision.revision_number desc limit 1`, [configSetId])).rows[0]!;
    const topology = await read<{ item: { nodes: Array<{ logicalNodeId: string; enablement: { selfEnabled: boolean } }> } }>(
      `/api/v2/projects/${projectId}/config-sets/${configSetId}/revisions/${applied.id}/topology?view=effective`);
    expect(topology.body.item.nodes.find((node) => node.logicalNodeId === logicalNodeId)?.enablement.selfEnabled).toBe(false);
    expect((await db.query(`select kind, actor_type, actor_user_id, trace_id from audit_events
      where kind = 'parameter-writeback-to-file' and trace_id = '1078-merged'`)).rows).toEqual([
      { kind: "parameter-writeback-to-file", actor_type: "user", actor_user_id: authorId, trace_id: "1078-merged" }
    ]);
    expect((await db.query(`select logical_node_id, project_parameter_binding_id, value, changed_by_user_id, initiator_type
      from parameter_history_entries where request_id=$1`, [requestId])).rows).toEqual([
      { logical_node_id: logicalNodeId, project_parameter_binding_id: null, value: '"disabled"', changed_by_user_id: authorId, initiator_type: "user" }
    ]);
    const fileId = (await db.query(`select id from project_parameter_files where config_set_id = $1 and config_set_role = 'overlay'`, [configSetId])).rows[0]!.id;
    const originalVersion = originalSource.find((file) => file.id === fileId)!.current_version_id;
    const currentVersion = current.find((file) => file.id === fileId)!.current_version_id;
    expect((await read(`/api/v1/projects/${projectId}/parameter-files/${fileId}/versions/${originalVersion}/content`)).bodyText).toBe(overlay);
    expect((await read(`/api/v1/projects/${projectId}/parameter-files/${fileId}/versions/${currentVersion}/content`)).bodyText).toContain('status = "disabled"');
    const legacy = await requestJson(server, `/api/v1/projects/${projectId}/parameter-files/${fileId}/versions`, {
      method: "POST", headers: { "X-WiseEff-User": adminId }, body: JSON.stringify({ contentBase64: Buffer.from(overlay).toString("base64") })
    });
    expect(legacy.status, legacy.bodyText).toBe(409);
    expect(legacy.body).toMatchObject({ error: { details: { reason: "canonical-source-transaction-required" } } });
    expect(await sourceState()).toEqual(current);
    const replay = await requestJson(server, `/api/v1/parameter-change-requests/${requestId}/review`, {
      method: "POST", headers: { "X-WiseEff-User": authorId }, body: JSON.stringify({ decision: "advance", note: "https://example.test/review/1078" })
    });
    expect(replay.status).toBe(409);
    expect(await sourceState()).toEqual(current);
    expect(await canonicalState()).toEqual(structuralState);

    const binding = (await db.query<{ id: string }>(`select binding.id from parameter_catalog.current_project_parameter_bindings binding
      join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
      where binding.project_id=$1 and occurrence.config_set_id=$2`, [projectId, configSetId])).rows[0]!;
    const draft = await requestJson<{ item: { draftId: string } }>(server,
      `/api/v2/projects/${projectId}/parameter-bindings/${binding.id}/drafts`, {
        method: "POST", headers: { "X-WiseEff-User": authorId },
        body: JSON.stringify({ baseRevisionId: applied.id, targetValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "1100", value: "1100" }]] }, reason: "Value edit after structural approval" })
      });
    expect(draft.status, draft.bodyText).toBe(201);
    const valueRequest = await requestJson<{ item: { id: string } }>(server,
      `/api/v2/projects/${projectId}/parameter-value-drafts/${draft.body.item.draftId}/submit`, {
        method: "POST", headers: { "X-WiseEff-User": authorId }, body: JSON.stringify({ assignedToUserId: softwareId })
      });
    expect(valueRequest.status, valueRequest.bodyText).toBe(201);
    const valueReview = await requestJson<{ item: { status: string } }>(server,
      `/api/v2/projects/${projectId}/parameter-value-change-requests/${valueRequest.body.item.id}/review`, {
        method: "POST", headers: { "X-WiseEff-User": softwareId }, body: JSON.stringify({ decision: "approve" })
      });
    expect(valueReview.status, valueReview.bodyText).toBe(200);
    expect(valueReview.body.item.status).toBe("approved");
    expect((await db.query(`select value.value from parameter_catalog.current_project_parameter_bindings binding
      join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id where binding.id=$1`, [binding.id])).rows)
      .toEqual([{ value: 1100 }]);
    expect((await db.query(`select id from parameter_catalog.binding_history_events
      where binding_id=$1 and applied_request_id=$2`, [binding.id, valueRequest.body.item.id])).rows).toHaveLength(1);
    expect((await db.query(`select id from parameter_history_entries where request_id=$1`, [requestId])).rows).toHaveLength(1);
    const afterValueEdit = await canonicalState();
    for (const original of structuralState) {
      const currentBinding = afterValueEdit.find((row) => row.binding.id === original.binding.id)!;
      expect(currentBinding.values).toEqual(expect.arrayContaining(original.values));
      expect(currentBinding.pins).toEqual(expect.arrayContaining(original.pins));
    }
  });
});
