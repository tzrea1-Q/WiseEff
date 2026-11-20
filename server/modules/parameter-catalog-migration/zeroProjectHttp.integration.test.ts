import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../testing/labRuntimeLogins";
import { captureCurrentCatalogPin } from "../catalog-publication/runtime";
import { setPublicationFreeze } from "../catalog-publication/runtime/freeze";
import { createUserInvocation } from "../auth/trustedInvocation";
import { getAuthContext } from "../auth/repository";
import { createCatalogInstaller } from "../catalog-kernel/install/installer";
import { runPublicationManagerOnce } from "../catalog-publication/jobs/manager";
import { enablePublicationPolicy } from "../catalog-publication/authorization/testHarness";
import { catalogReplacementPreviewResponseSchema, catalogReplacementResponseSchema } from "../contracts/dtoSchemas/parameterCatalog";
import { createMigrationHarness, integerContent, PREDECESSOR_DEFINITION_ID, PREDECESSOR_PROPERTY_KEY, PREDECESSOR_REVISION_ID, PREDECESSOR_SUBJECT_ID, type MigrationHarness } from "./testing/harness";

const ORG = "org-zero-correction", ADMIN = "zero-platform-admin";
const REVIEWER = "issue1579-reviewer";
const path = "/api/v2/catalog/definition-replacements";

describe("#1309 zero-project identity correction through the real API role", () => {
  let harness: MigrationHarness, api: ReturnType<typeof createPostgresDatabase>;
  const token = `zero_correction_${randomUUID().slice(0, 8)}`;
  const app = (principalId = ADMIN) => createWiseEffServer({ db: api, objectStore: harness.objectStore,
    auth: { mode: "production", verifier: { verify: async () => makeTestAuthContext({ organizationId: ORG,
      userId: principalId, roles: [{ roleId: "guest", projectId: null }] }) } } });
  const pin = async () => (await captureCurrentCatalogPin(harness.pool))!;
  const post = async (suffix: string, body: unknown, fingerprint?: string, organizationId?: string) => requestJson(app(),
    `${path}${suffix}${organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ""}`, {
    method: "POST", headers: { authorization: "Bearer administrator", "X-WiseEff-Catalog-Release": (await pin()).id,
      "Idempotency-Key": `http:${randomUUID()}`, ...(fingerprint ? { "If-Match": fingerprint } : {}) }, body: JSON.stringify(body) });
  const activate = () => runPublicationManagerOnce({ db: harness.db, pool: harness.pool, installer: createCatalogInstaller(harness.pool),
    resolvePublisherActor: async principalId => createUserInvocation(await getAuthContext(harness.db, principalId)), ownerId: "zero-correction-manager" });
  const unused = async (key: string) => {
    const release = await harness.publishChange([{ op: "create-definition", subjectId: PREDECESSOR_SUBJECT_ID,
      propertyKey: key, content: { displayName: key, documentation: key, valueSchema: { type: "integer", minimum: 0 } } }], key);
    const definition = await harness.allocatedDefinition(release.id, key);
    if (!definition) throw new Error("Missing unused Definition fixture");
    return definition;
  };
  const reference = async (definition: { definitionId: string; revisionId: string }, organizationId: string, label: string, newPropertyKey?: string) => {
    await harness.refreshCatalog();
    await harness.seedOrganization(organizationId);
    await harness.seedProject(organizationId, `zero-project-${label}`, label);
    const registrationId = await harness.registerSubject({ organizationId, subjectId: PREDECESSOR_SUBJECT_ID,
      subjectKind: "driver", moduleId: `zero-module-${label}` });
    return harness.seedBindingValue({ organizationId, projectId: `zero-project-${label}`, logicalNodeId: `zero-node-${label}`,
      registrationId, ...definition, ...(newPropertyKey ? { propertyKeys: [newPropertyKey] } : {}),
      sources: [{ sourceRef: `${label}.dts`, configRevisionId: `zero-revision-${label}` }], values: [5] });
  };

  beforeAll(async () => {
    harness = await createMigrationHarness();
    await harness.seedOrganization(ORG);
    await harness.db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Zero administrator','Admin',true)", [ADMIN, ORG]);
    for (const role of ["admin", "platform-admin"]) await harness.db.query(
      "insert into user_role_bindings(id,user_id,organization_id,role_id) values ($1,$2,$3,$4)", [`zero-${role}`, ADMIN, ORG, role]);
    await harness.db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Reviewer','Admin',true)", [REVIEWER, ORG]);
    await harness.db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ($1,$1,$2,'platform-admin')", [REVIEWER, ORG]);
    const runtime = await provisionPublicationRuntimeLogins(harness.database.url, { mode: "lab", runToken: token });
    api = createPostgresDatabase(runtime.apiUrl);
  }, 120_000);
  afterAll(async () => {
    await api?.close();
    if (harness) { await dropLabRuntimeLogins(harness.database.url, token); await harness.close(); }
  }, 120_000);

  it("previews, publishes and completes without a project while preserving the old identity and history", async () => {
    const before = await pin();
    const preview = await post("/preview", { oldDefinitionId: PREDECESSOR_DEFINITION_ID,
      newSubjectId: PREDECESSOR_SUBJECT_ID, newPropertyKey: "iin_corrected_unused", ...integerContent("Corrected unused current", 0),
      projectIds: [], reason: "Correct an unused permanent identity" });
    expect(preview.status, preview.bodyText).toBe(201);
    const frozen = catalogReplacementPreviewResponseSchema.parse(preview.body).item;
    expect(frozen.impact).toMatchObject({ selectedProjectCount: 0, oldDefinitionCurrentReferenceCount: 0, targetRegistrationRequired: false });
    expect(frozen.blockers).toEqual([]);
    const command = { previewId: frozen.previewId, previewFingerprint: frozen.previewFingerprint, idempotencyKey: "zero-correction-execute" };
    expect((await post("", command, frozen.previewFingerprint)).status).toBe(503);
    expect(await activate()).toBe("claimed");
    const executed = await post("", command, frozen.previewFingerprint);
    expect(executed.status, executed.bodyText).toBe(202);
    const result = catalogReplacementResponseSchema.parse(executed.body).item;
    expect(result).toMatchObject({ status: "completed", projects: [], oldIdentity: {
      definitionId: PREDECESSOR_DEFINITION_ID, propertyKey: PREDECESSOR_PROPERTY_KEY, revisionId: PREDECESSOR_REVISION_ID } });
    expect(result.newIdentity.definitionId).not.toBe(PREDECESSOR_DEFINITION_ID);
    expect((await post("", command, frozen.previewFingerprint)).body).toEqual(executed.body);
    await harness.db.query("delete from user_role_bindings where id='zero-admin'");
    try {
      const continued = await post(`/${result.id}/continue`, { idempotencyKey: "zero-platform-only-continue" }, result.etag);
      expect(continued.status, continued.bodyText).toBe(202);
    } finally { await harness.db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('zero-admin',$1,$2,'admin')", [ADMIN, ORG]); }
    expect((await pin()).id).not.toBe(before.id);
    const old = await requestJson(app(), `/api/v2/catalog/definitions/${PREDECESSOR_DEFINITION_ID}`, { headers: { authorization: "Bearer administrator" } });
    expect(old.status, old.bodyText).toBe(200);
    expect(old.body).toMatchObject({ item: { id: PREDECESSOR_DEFINITION_ID, propertyKey: PREDECESSOR_PROPERTY_KEY, lifecycle: "active" } });
    const history = await requestJson(app(), `/api/v2/catalog/definitions/${PREDECESSOR_DEFINITION_ID}/revisions/${PREDECESSOR_REVISION_ID}`, { headers: { authorization: "Bearer administrator" } });
    expect(history.status, history.bodyText).toBe(200);
    expect(history.body).toMatchObject({ item: { id: PREDECESSOR_REVISION_ID } });
  }, 120_000);

  it("rejects the shortcut when an actual current reference belongs to another organization", async () => {
    const definition = await unused("zero_cross_organization");
    await reference(definition, "org-zero-foreign", "foreign");
    const result = await post("/preview", { oldDefinitionId: definition.definitionId, newSubjectId: PREDECESSOR_SUBJECT_ID,
      newPropertyKey: "zero_cross_corrected", ...integerContent("Cross organization correction", 0), projectIds: [], reason: "Global absence is required" });
    expect(result.status, result.bodyText).toBe(409);
    expect(result.body).toMatchObject({ error: { details: { replacement: "current-project-references", currentReferenceCount: 1 } } });
    expect(JSON.stringify(result.body)).not.toContain("zero-project-foreign");
  }, 120_000);

  it("refuses a reference added after preview and atomically rolls back activation if it arrives after enqueue", async () => {
    const definition = await unused("zero_publication_race");
    const draft = { oldDefinitionId: definition.definitionId, newSubjectId: PREDECESSOR_SUBJECT_ID,
      newPropertyKey: "zero_publication_corrected", ...integerContent("Concurrent reference", 0), projectIds: [], reason: "Check absence at actual activation" };
    const response = await post("/preview", draft);
    expect(response.status, response.bodyText).toBe(201);
    const frozen = catalogReplacementPreviewResponseSchema.parse(response.body).item;
    const command = { previewId: frozen.previewId, previewFingerprint: frozen.previewFingerprint, idempotencyKey: "zero-publication-race" };
    expect((await post("", command, frozen.previewFingerprint)).status).toBe(503);
    const before = await pin();
    await reference(definition, "org-zero-race", "race");
    const retry = await post("", command, frozen.previewFingerprint);
    expect(retry.status, retry.bodyText).toBe(409);
    expect(retry.body).toMatchObject({ error: { details: { replacement: "current-project-references" } } });
    expect(await activate()).toBe("claimed");
    expect(await pin()).toEqual(before);
    const rows = await harness.db.query<{ definitions: string; receipts: string; status: string }>(
      `select (select count(*)::text from parameter_catalog.parameter_definitions where id=$1) as definitions,
        (select count(*)::text from parameter_catalog.catalog_activation_receipts where candidate_id=$2) as receipts,
        (select status from catalog_publication.publication_jobs where candidate_id=$2) as status`,
      [frozen.newIdentity.definitionId, (await harness.db.query<{ candidate_id: string }>(
        "select candidate_id from parameter_catalog.definition_replacement_previews where id=$1", [frozen.previewId])).rows[0]!.candidate_id]);
    expect(rows.rows[0]).toMatchObject({ definitions: "0", receipts: "0", status: "blocked" });
    expect((await post("", command, frozen.previewFingerprint)).status).toBe(409);
  }, 120_000);

  it("finalizes its proven activation after a later reference and refuses independent retirement against fresh global evidence", async () => {
    const definition = await unused("zero_after_activation");
    const preview = await post("/preview", { oldDefinitionId: definition.definitionId, newSubjectId: PREDECESSOR_SUBJECT_ID,
      newPropertyKey: "zero_after_corrected", ...integerContent("After activation", 0), projectIds: [], reason: "Linearize absence at activation" });
    expect(preview.status, preview.bodyText).toBe(201);
    const frozen = catalogReplacementPreviewResponseSchema.parse(preview.body).item;
    const command = { previewId: frozen.previewId, previewFingerprint: frozen.previewFingerprint, idempotencyKey: "zero-after-activation" };
    expect((await post("", command, frozen.previewFingerprint)).status).toBe(503);
    expect(await activate()).toBe("claimed");
    await reference(definition, "org-zero-after", "after");
    const completed = await post("", command, frozen.previewFingerprint);
    expect(completed.status, completed.bodyText).toBe(202);
    expect(completed.body).toMatchObject({ item: { status: "completed", projects: [], retirementEvidence: {
      scope: "platform", authoritative: true, remainingCurrentReferenceCount: 1 } } });
    const predecessor = await pin();
    const candidate = await requestJson<{ item: { id: string } }>(app(), "/api/v2/catalog/publication-candidates", {
      method: "POST", headers: { authorization: "Bearer administrator", "X-WiseEff-Catalog-Release": predecessor.id },
      body: JSON.stringify({ changeSet: [{ op: "retire-definition", definitionId: definition.definitionId, class: "semantic",
        reason: "Independent retirement must recheck references", content: integerContent("After activation", 0) }] }) });
    expect(candidate.status, candidate.bodyText).toBe(201);
    const queued = await requestJson(app(), `/api/v2/catalog/publication-candidates/${candidate.body.item.id}/publish`, {
      method: "POST", headers: { authorization: "Bearer administrator", "X-WiseEff-Catalog-Release": predecessor.id },
      body: JSON.stringify({ idempotencyKey: "retire-after-reference" }) });
    expect(queued.status, queued.bodyText).toBe(201);
    expect(await activate()).toBe("claimed");
    expect(await pin()).toEqual(predecessor);
    const current = await requestJson(app(), `/api/v2/catalog/definitions/${definition.definitionId}`, { headers: { authorization: "Bearer administrator" } });
    expect(current.body).toMatchObject({ item: { lifecycle: "active" } });
  }, 120_000);

  it("locates an existing permanent target identity without creating a replacement", async () => {
    const definition = await unused("zero_collision_source");
    const result = await post("/preview", { oldDefinitionId: definition.definitionId, newSubjectId: PREDECESSOR_SUBJECT_ID,
      newPropertyKey: PREDECESSOR_PROPERTY_KEY, ...integerContent("Collision", 0), projectIds: [], reason: "Locate an existing target" });
    expect(result.status, result.bodyText).toBe(409);
    expect(result.body).toMatchObject({ error: { details: { replacement: "target-identity-conflict",
      existingDefinitionId: PREDECESSOR_DEFINITION_ID, subjectId: PREDECESSOR_SUBJECT_ID } } });
  }, 120_000);

  it("diagnoses invalid deprecation successors through the publication preview", async () => {
    const source = await unused("deprecated_source");
    for (const [successorDefinitionId, diagnostic] of [
      ["pdef_missing", "definition-successor-missing"],
      [source.definitionId, "definition-successor-invalid"],
    ]) {
      const response = await requestJson(app(), "/api/v2/catalog/publication-candidates", {
        method: "POST", headers: { authorization: "Bearer administrator", "X-WiseEff-Catalog-Release": (await pin()).id },
        body: JSON.stringify({ changeSet: [{ op: "revise-definition", definitionId: source.definitionId,
          class: "semantic", successorDefinitionId }] }) });
      expect(response.status, response.bodyText).toBe(400);
      expect(response.body).toMatchObject({ error: { details: { field: diagnostic } } });
    }
  }, 120_000);

  it("publishes, redirects and withdraws deprecation with a distinct reviewer while preserving pinned project values", async () => {
    const source = await unused("lifecycle_source");
    const target = await unused("lifecycle_target");
    const terminal = await unused("lifecycle_terminal");
    const originalBinding = await reference(source, "org-lifecycle-project", "lifecycle");
    const definitionPath = `/api/v2/catalog/definitions/${source.definitionId}`;
    const projectPath = "/api/v2/projects/zero-project-lifecycle/parameter-bindings?organizationId=org-lifecycle-project";
    const read = (path: string) => requestJson(app(), path, { headers: { authorization: "Bearer administrator" } });
    const lifecycleCandidate = async (definitionId: string, successorDefinitionId: string | null) => requestJson<{ item: { id: string } }>(
      app(), "/api/v2/catalog/publication-candidates", {
        method: "POST", headers: { authorization: "Bearer administrator", "X-WiseEff-Catalog-Release": (await pin()).id },
        body: JSON.stringify({ changeSet: [{ op: "revise-definition", definitionId, class: "semantic", successorDefinitionId,
          reason: "Publish issue 1579 lifecycle revision" }] }) },
    );
    const applyLifecycle = async (definitionId: string, successorId: string | null, checkSeparation = false) => {
      const candidate = await lifecycleCandidate(definitionId, successorId);
      expect(candidate.status, candidate.bodyText).toBe(201);
      expect(candidate.body).toMatchObject({ item: { riskClass: "high", impactSummary: {
        definitionSuccessorChange: { definitionId, successorDefinitionId: successorId },
      } } });
      const publish = async (actor: string) => requestJson(app(actor), `/api/v2/catalog/publication-candidates/${candidate.body.item.id}/publish`, {
        method: "POST", headers: { authorization: "Bearer administrator", "X-WiseEff-Catalog-Release": (await pin()).id },
        body: JSON.stringify({ idempotencyKey: randomUUID() }) });
      if (checkSeparation) {
        const refused = await publish(ADMIN);
        expect(refused.status, refused.bodyText).toBe(403);
        expect(refused.body).toMatchObject({ error: { details: { reason: "publication-self-approval-forbidden" } } });
      }
      const queued = await publish(REVIEWER);
      expect(queued.status, queued.bodyText).toBe(201);
      expect(await activate()).toBe("claimed");
    };
    await harness.db.query("delete from user_role_bindings where id='zero-admin'");
    try {
      await applyLifecycle(source.definitionId, target.definitionId, true);
      const first = await read(definitionPath);
      expect(first.body).toMatchObject({ item: { lifecycle: "deprecated", currentRevision: { successorDefinitionId: target.definitionId },
        recommendedDefinition: { id: target.definitionId, propertyKey: "lifecycle_target" } } });
      expect((await read(projectPath)).body).toMatchObject({ items: [{ definitionId: source.definitionId,
        effectiveRevisionId: source.revisionId, currentValueId: originalBinding.valueId,
        effectiveValue: { groups: [[{ value: "5" }]] } }] });
      const cycle = await lifecycleCandidate(target.definitionId, source.definitionId);
      expect(cycle.body).toMatchObject({ error: { details: { field: "definition-successor-cycle" } } });
      await applyLifecycle(target.definitionId, terminal.definitionId);
      expect((await read(definitionPath)).body).toMatchObject({ item: { recommendedDefinition: { id: terminal.definitionId } } });
      await applyLifecycle(source.definitionId, terminal.definitionId);
      expect((await read(definitionPath)).body).toMatchObject({ item: { currentRevision: { successorDefinitionId: terminal.definitionId } } });
      await applyLifecycle(source.definitionId, null);
      expect((await read(definitionPath)).body).toMatchObject({ item: { lifecycle: "active" } });
      const original = await read(`${definitionPath}/revisions/${source.revisionId}`);
      expect(original.body).toMatchObject({ item: { id: source.revisionId, displayName: "lifecycle_source" } });
      expect(original.body).not.toMatchObject({ item: { successorDefinitionId: expect.anything() } });
    } finally { await harness.db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('zero-admin',$1,$2,'admin')", [ADMIN, ORG]); }
  }, 120_000);

  it("merges into an existing definition only after explicit resolution of both pinned values", async () => {
    const source = await unused("merge_source");
    const target = await unused("merge_target");
    const projectId = "merge-project";
    const organizationId = "org-merge-values";
    await harness.seedOrganization(organizationId);
    await harness.seedProject(organizationId, projectId, "Merge project");
    const remainingProjectId = "merge-remaining-project";
    await harness.seedProject(organizationId, remainingProjectId, "Remaining project");
    const registrationId = await harness.registerSubject({ organizationId, subjectId: PREDECESSOR_SUBJECT_ID,
      subjectKind: "driver", moduleId: "merge-module" });
    const fixture = { organizationId, projectId, registrationId, logicalNodeId: "merge-node",
      sources: [{ sourceRef: "merge.dts", configRevisionId: "merge-revision" }] };
    const oldBinding = await harness.seedBindingValue({ ...fixture, ...source, propertyKeys: ["merge_target"], values: [5] });
    const targetBinding = await harness.seedBindingValue({ ...fixture, ...target, values: [7] });
    await harness.seedBindingValue({ ...fixture, ...source, projectId: remainingProjectId, logicalNodeId: "merge-remaining-node",
      sources: [{ sourceRef: "merge-remaining.dts", configRevisionId: "merge-remaining-revision" }], propertyKeys: ["merge_target"], values: [5] });
    const draft = { oldDefinitionId: source.definitionId, newSubjectId: PREDECESSOR_SUBJECT_ID,
      newPropertyKey: "merge_target", mergeIntoDefinitionId: target.definitionId,
      ...integerContent("Unused proposed content", 0), projectIds: [projectId], reason: "Resolve duplicate definitions" };
    const preview = await post("/preview", draft, undefined, organizationId);
    expect(preview.status, preview.bodyText).toBe(201);
    const frozen = catalogReplacementPreviewResponseSchema.parse(preview.body).item;
    expect(frozen.remainingProjects).toEqual([{ id: remainingProjectId, name: "Remaining project" }]);
    expect(frozen.projects).toMatchObject([{ projectId, blockerReason: "merge-choice-required",
      oldBindingId: oldBinding.bindingId, mergeConflict: { sourceValue: 5, targetValue: 7, targetBindingId: targetBinding.bindingId } }]);
    const command = { previewId: frozen.previewId, previewFingerprint: frozen.previewFingerprint, idempotencyKey: "unresolved-merge" };
    expect((await post("", command, frozen.previewFingerprint, organizationId)).status).toBe(400);
    const approved = await post("/preview", { ...draft, mergeChoices: { [projectId]: "target" } }, undefined, organizationId);
    expect(approved.status, approved.bodyText).toBe(201);
    const resolved = catalogReplacementPreviewResponseSchema.parse(approved.body).item;
    const competingPreview = await post("/preview", { ...draft, mergeChoices: { [projectId]: "target" } }, undefined, organizationId);
    const competing = catalogReplacementPreviewResponseSchema.parse(competingPreview.body).item;
    const before = await pin();
    const apply = () => post("", { previewId: resolved.previewId, previewFingerprint: resolved.previewFingerprint,
      idempotencyKey: "resolved-merge" }, resolved.previewFingerprint, organizationId);
    expect((await setPublicationFreeze(harness.db, { frozen: true, actorPrincipalId: ADMIN })).ok).toBe(true);
    try {
      const frozen = await apply();
      expect(frozen.body).toMatchObject({ error: { details: { reason: "publication-frozen" } } });
    } finally {
      expect((await setPublicationFreeze(harness.db, { frozen: false, actorPrincipalId: ADMIN })).ok).toBe(true);
    }
    const applied = await apply();
    expect(applied.status, applied.bodyText).toBe(202);
    expect(applied.body).toMatchObject({ item: { status: "completed", candidateId: null, projects: [
      { projectId, status: "completed", oldBindingId: oldBinding.bindingId, newBindingId: targetBinding.bindingId },
    ] } });
    expect((await apply()).body).toEqual(applied.body);
    const bindingPath = `/api/v2/projects/${projectId}/parameter-bindings?organizationId=${organizationId}`;
    const current = await requestJson(app(), bindingPath, { headers: { authorization: "Bearer administrator" } });
    expect(current.body).toMatchObject({ items: [{ id: targetBinding.bindingId, currentValueId: targetBinding.valueId,
      effectiveValue: { groups: [[{ value: "7" }]] } }] });
    const historyPath = `/api/v2/projects/${projectId}/parameter-bindings/${oldBinding.bindingId}/export`;
    const historical = await requestJson(app(), `${historyPath}?organizationId=${organizationId}&projectValueId=${oldBinding.valueId}`,
      { headers: { authorization: "Bearer administrator" } });
    expect(historical.status, historical.bodyText).toBe(200);
    expect(historical.body).toMatchObject({ item: { bindingId: oldBinding.bindingId, currentValueId: oldBinding.valueId,
      definitionId: source.definitionId, definitionRevisionId: source.revisionId, configRevisionId: "merge-revision",
      files: [expect.objectContaining({ content: expect.stringContaining("merge_source = <5>;") })] } });
    const stale = await post("", { previewId: competing.previewId, previewFingerprint: competing.previewFingerprint,
      idempotencyKey: "competing-merge" }, competing.previewFingerprint, organizationId);
    expect(stale.status, stale.bodyText).toBe(202);
    expect(stale.body).toMatchObject({ item: { status: "blocked", projects: [{ projectId, blockerReason: "stale-preview" }] } });
    const subsequent = await post("/preview", { ...draft, projectIds: [remainingProjectId] }, undefined, organizationId);
    const remaining = catalogReplacementPreviewResponseSchema.parse(subsequent.body).item;
    expect(remaining.remainingProjects).toEqual([]);
    const completed = await post("", { previewId: remaining.previewId, previewFingerprint: remaining.previewFingerprint,
      idempotencyKey: "remaining-merge" }, remaining.previewFingerprint, organizationId);
    expect(completed.status, completed.bodyText).toBe(202);
    expect(completed.body).toMatchObject({ item: { status: "completed", projects: [{ projectId: remainingProjectId, status: "completed" }] } });
    expect(await pin()).toEqual(before);
  }, 120_000);

  it("keeps the real selected-project migration available to a dual-role administrator", async () => {
    const definition = await unused("zero_selected_source"), projectId = "zero-selected-project";
    await harness.seedProject(ORG, projectId, "Actual selected project");
    const registrationId = await harness.registerSubject({ organizationId: ORG, subjectId: PREDECESSOR_SUBJECT_ID,
      subjectKind: "driver", moduleId: "zero-selected-module" });
    const original = await harness.seedBindingValue({ organizationId: ORG, projectId, logicalNodeId: "zero-selected-node",
      registrationId, ...definition, propertyKeys: ["zero_selected_corrected"],
      sources: [{ sourceRef: "selected.dts", configRevisionId: "zero-selected-revision" }], values: [5] });
    const preview = await post("/preview", { oldDefinitionId: definition.definitionId, newSubjectId: PREDECESSOR_SUBJECT_ID,
      newPropertyKey: "zero_selected_corrected", ...integerContent("Selected project", 0), projectIds: [projectId], reason: "Use the actual migration" });
    expect(preview.status, preview.bodyText).toBe(201);
    const frozen = catalogReplacementPreviewResponseSchema.parse(preview.body).item;
    expect(frozen.blockers).toEqual([]);
    const command = { previewId: frozen.previewId, previewFingerprint: frozen.previewFingerprint, idempotencyKey: "zero-selected-execute" };
    expect((await post("", command, frozen.previewFingerprint)).status).toBe(503);
    expect(await activate()).toBe("claimed");
    const migrated = await post("", command, frozen.previewFingerprint);
    expect(migrated.status, migrated.bodyText).toBe(202);
    expect(migrated.body).toMatchObject({ item: { status: "completed", projects: [{ projectId, status: "completed", oldBindingId: original.bindingId }] } });
    const item = catalogReplacementResponseSchema.parse(migrated.body).item;
    const continued = await post(`/${item.id}/continue`, { idempotencyKey: "zero-selected-continue" }, item.etag);
    expect(continued.status, continued.bodyText).toBe(202);
  }, 120_000);

  it("allows a pure platform administrator to migrate within an explicitly selected organization", async () => {
    const definition = await unused("platform_selected_source");
    const targetOrganization = "org-platform-selected";
    await reference(definition, targetOrganization, "platform-selected", "platform_selected_corrected");
    await reference(definition, "org-platform-other", "platform-other");
    const draft = { oldDefinitionId: definition.definitionId, newSubjectId: PREDECESSOR_SUBJECT_ID,
      newPropertyKey: "platform_selected_corrected", ...integerContent("Selected project", 0),
      projectIds: ["zero-project-platform-selected"], reason: "Correct the selected organization's project" };
    const scopedPost = (suffix: string, body: unknown, fingerprint?: string) => post(suffix, body, fingerprint, targetOrganization);
    await harness.db.query("delete from user_role_bindings where id='zero-admin'");
    try {
      const foreign = await scopedPost("/preview", { ...draft, projectIds: ["zero-project-platform-other"] });
      expect(foreign.status, foreign.bodyText).toBe(400);
      expect(foreign.body).toMatchObject({ error: { details: { field: "cross-organization-project" } } });
      const preview = await scopedPost("/preview", draft);
      expect(preview.status, preview.bodyText).toBe(201);
      const frozen = catalogReplacementPreviewResponseSchema.parse(preview.body).item;
      expect(frozen.organizationId).toBe(targetOrganization);
      expect(frozen.projects.map(project => project.projectId)).toEqual(draft.projectIds);
      const command = { previewId: frozen.previewId, previewFingerprint: frozen.previewFingerprint, idempotencyKey: "platform-selected-execute" };
      expect((await post("", command, frozen.previewFingerprint)).status).toBe(404);
      expect((await scopedPost("", command, frozen.previewFingerprint)).status).toBe(503);
      expect(await activate()).toBe("claimed");
      const migrated = await scopedPost("", command, frozen.previewFingerprint);
      expect(migrated.status, migrated.bodyText).toBe(202);
      expect(migrated.body).toMatchObject({ item: { organizationId: targetOrganization,
        projects: [{ projectId: draft.projectIds[0], status: "completed" }] } });
    } finally { await harness.db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('zero-admin',$1,$2,'admin')", [ADMIN, ORG]); }
  }, 120_000);

  it("finalizes a selected-project replacement after the shared Candidate is published by its independent reviewer", async () => {
    const definition = await unused("independent_project_source");
    const targetOrganization = "org-independent-project";
    await reference(definition, targetOrganization, "independent-project", "independent_project_target");
    const client = await harness.pool.connect();
    await harness.db.query("delete from user_role_bindings where id='zero-admin'");
    try {
      await enablePublicationPolicy(client as unknown as import("pg").Client, { publicationEnabled: true, lowRiskSingleActorPublish: false });
      const preview = await post("/preview", {
        oldDefinitionId: definition.definitionId, newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "independent_project_target", ...integerContent("Independently reviewed", 0),
        projectIds: ["zero-project-independent-project"], reason: "Review before migrating one project",
      }, undefined, targetOrganization);
      expect(preview.status, preview.bodyText).toBe(201);
      const frozen = catalogReplacementPreviewResponseSchema.parse(preview.body).item;
      expect(frozen.publicationCandidateId).toBeTruthy();
      const command = { previewId: frozen.previewId, previewFingerprint: frozen.previewFingerprint, idempotencyKey: "independent-project-execute" };
      const refused = await post("", command, frozen.previewFingerprint, targetOrganization);
      expect(refused.status, refused.bodyText).toBe(403);
      expect(refused.body).toMatchObject({ error: { details: { reason: "publication-self-approval-forbidden" } } });
      const candidatePath = `/api/v2/catalog/publication-candidates/${frozen.publicationCandidateId}`;
      const reviewed = await requestJson(app(REVIEWER), candidatePath, { headers: { authorization: "Bearer reviewer" } });
      expect(reviewed.body).toMatchObject({ item: { impactSummary: { definitionReplacement: {
        definitionId: definition.definitionId, propertyKey: "independent_project_target",
      } } } });
      const published = await requestJson(app(REVIEWER), `${candidatePath}/publish`, {
        method: "POST", headers: { authorization: "Bearer reviewer", "X-WiseEff-Catalog-Release": (await pin()).id },
        body: JSON.stringify({ idempotencyKey: "independent-project-publish" }),
      });
      expect(published.status, published.bodyText).toBe(201);
      expect(await activate()).toBe("claimed");
      const completed = await post("", command, frozen.previewFingerprint, targetOrganization);
      expect(completed.status, completed.bodyText).toBe(202);
      expect(completed.body).toMatchObject({ item: { status: "completed", organizationId: targetOrganization,
        projects: [{ projectId: "zero-project-independent-project", status: "completed" }] } });
    } finally {
      await enablePublicationPolicy(client as unknown as import("pg").Client, { publicationEnabled: true, lowRiskSingleActorPublish: true });
      client.release();
      await harness.db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('zero-admin',$1,$2,'admin')", [ADMIN, ORG]);
    }
  }, 120_000);

  it("rechecks revoked platform authority at activation and refuses a project outside the selected organization", async () => {
    const definition = await unused("zero_authority_source");
    const draft = { oldDefinitionId: definition.definitionId, newSubjectId: PREDECESSOR_SUBJECT_ID,
      newPropertyKey: "zero_authority_corrected", ...integerContent("Authority", 0), projectIds: [], reason: "Use current authority" };
    await harness.db.query("delete from user_role_bindings where id='zero-admin'");
    try {
      const denied = await post("/preview", { ...draft, projectIds: ["a-project-the-platform-actor-does-not-administer"] });
      expect(denied.status, denied.bodyText).toBe(400);
    } finally { await harness.db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('zero-admin',$1,$2,'admin')", [ADMIN, ORG]); }
    const preview = await post("/preview", draft);
    expect(preview.status, preview.bodyText).toBe(201);
    const frozen = catalogReplacementPreviewResponseSchema.parse(preview.body).item;
    const command = { previewId: frozen.previewId, previewFingerprint: frozen.previewFingerprint, idempotencyKey: "zero-revoked-authority" };
    expect((await post("", command, frozen.previewFingerprint)).status).toBe(503);
    const before = await pin();
    await harness.db.query("delete from user_role_bindings where id='zero-platform-admin'");
    try {
      // The same key also pins the original actor kind; a new attempt must
      // independently fail the live platform-administrator authorization.
      expect((await post("", command, frozen.previewFingerprint)).status).toBe(409);
      expect((await post("", { ...command, idempotencyKey: "zero-revoked-new-attempt" }, frozen.previewFingerprint)).status).toBe(403);
      expect(await activate()).toBe("claimed");
      expect(await pin()).toEqual(before);
    } finally { await harness.db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('zero-platform-admin',$1,$2,'platform-admin')", [ADMIN, ORG]); }
  }, 120_000);

  it("finalizes concurrent retries as one replacement after activation", async () => {
    const definition = await unused("zero_concurrent_retry");
    const preview = await post("/preview", { oldDefinitionId: definition.definitionId, newSubjectId: PREDECESSOR_SUBJECT_ID,
      newPropertyKey: "zero_concurrent_corrected", ...integerContent("Concurrent retry", 0), projectIds: [], reason: "One approved replacement" });
    expect(preview.status, preview.bodyText).toBe(201);
    const frozen = catalogReplacementPreviewResponseSchema.parse(preview.body).item;
    const command = { previewId: frozen.previewId, previewFingerprint: frozen.previewFingerprint, idempotencyKey: "zero-concurrent-retry" };
    expect((await post("", command, frozen.previewFingerprint)).status).toBe(503);
    expect(await activate()).toBe("claimed");
    const retries = await Promise.all(Array.from({ length: 3 }, () => post("", command, frozen.previewFingerprint)));
    expect(retries.map(result => result.status), retries.map(result => result.bodyText).join("\n")).toEqual([202, 202, 202]);
    expect(new Set(retries.map(result => catalogReplacementResponseSchema.parse(result.body).item.id)).size).toBe(1);
  }, 120_000);

  it("does not let a concurrent replay read block finalization of the same replacement", async () => {
    const definition = await unused("zero_replay_lock");
    const preview = await post("/preview", { oldDefinitionId: definition.definitionId, newSubjectId: PREDECESSOR_SUBJECT_ID,
      newPropertyKey: "zero_replay_lock_corrected", ...integerContent("Concurrent replay", 0), projectIds: [], reason: "One approved replacement" });
    expect(preview.status, preview.bodyText).toBe(201);
    const frozen = catalogReplacementPreviewResponseSchema.parse(preview.body).item;
    const command = { previewId: frozen.previewId, previewFingerprint: frozen.previewFingerprint, idempotencyKey: "zero-replay-lock" };
    expect((await post("", command, frozen.previewFingerprint)).status).toBe(503);
    expect(await activate()).toBe("claimed");

    const pool = getRootPostgresPool(api)!;
    const originalQuery = pool.query;
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => { resolve = done; });
      return { promise, resolve };
    };
    const creatorRead = deferred(), resumeCreator = deferred(), replayRead = deferred(), releaseReplay = deferred();
    let reads = 0;
    // Hold the replay's actual SELECT transaction while the creator advances.
    pool.query = (async (...args: unknown[]) => {
      const sql = args[0];
      if (typeof sql !== "string" || !sql.includes("from parameter_catalog.definition_replacements") ||
          !sql.includes("where id = $1 and organization_id = $2") || reads >= 2) {
        return Reflect.apply(originalQuery, pool, args);
      }
      if (reads++ === 0) {
        const result = await Reflect.apply(originalQuery, pool, args);
        creatorRead.resolve();
        await resumeCreator.promise;
        return result;
      }
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await client.query(sql, args[1] as unknown[]);
        replayRead.resolve();
        await releaseReplay.promise;
        return result;
      } finally {
        await client.query("rollback").catch(() => undefined);
        client.release();
      }
    }) as typeof pool.query;
    try {
      const creator = post("", command, frozen.previewFingerprint);
      await creatorRead.promise;
      const replay = post("", command, frozen.previewFingerprint);
      await replayRead.promise;
      resumeCreator.resolve();
      const created = await creator;
      releaseReplay.resolve();
      const replayed = await replay;
      expect([created.status, replayed.status], `${created.bodyText}\n${replayed.bodyText}`).toEqual([202, 202]);
      const item = catalogReplacementResponseSchema.parse(created.body).item;
      expect(item.status).toBe("completed");
      expect(item.id).toBe(catalogReplacementResponseSchema.parse(replayed.body).item.id);
    } finally {
      resumeCreator.resolve();
      releaseReplay.resolve();
      pool.query = originalQuery;
    }
  }, 120_000);

  it("refuses an unpublished zero-project preview after real Catalog drift", async () => {
    const definition = await unused("zero_stale_source");
    const response = await post("/preview", { oldDefinitionId: definition.definitionId, newSubjectId: PREDECESSOR_SUBJECT_ID,
      newPropertyKey: "zero_stale_corrected", ...integerContent("Stale preview", 0), projectIds: [], reason: "Keep the Catalog pin exact" });
    expect(response.status, response.bodyText).toBe(201);
    const frozen = catalogReplacementPreviewResponseSchema.parse(response.body).item;
    await unused("zero_unrelated_catalog_change");
    const current = await pin();
    const rejected = await post("", { previewId: frozen.previewId, previewFingerprint: frozen.previewFingerprint,
      idempotencyKey: "zero-stale-command" }, frozen.previewFingerprint);
    expect(rejected.status, rejected.bodyText).toBe(409);
    expect(rejected.body).toMatchObject({ error: { details: { reason: "release-drift" } } });
    expect(await pin()).toEqual(current);
  }, 120_000);

  it("finishes a proven historical activation after an unrelated release advances without resetting the current Catalog", async () => {
    const definition = await unused("zero_historical_source");
    const response = await post("/preview", { oldDefinitionId: definition.definitionId, newSubjectId: PREDECESSOR_SUBJECT_ID,
      newPropertyKey: "zero_historical_corrected", ...integerContent("Historical activation", 0), projectIds: [], reason: "Finish the actual successful activation" });
    expect(response.status, response.bodyText).toBe(201);
    const frozen = catalogReplacementPreviewResponseSchema.parse(response.body).item;
    const command = { previewId: frozen.previewId, previewFingerprint: frozen.previewFingerprint, idempotencyKey: "zero-historical-command" };
    expect((await post("", command, frozen.previewFingerprint)).status).toBe(503);
    expect(await activate()).toBe("claimed");
    const activated = await pin();
    await unused("zero_later_release");
    const later = await pin();
    expect(later.id).not.toBe(activated.id);
    const completed = await post("", command, frozen.previewFingerprint);
    expect(completed.status, completed.bodyText).toBe(202);
    expect(completed.body).toMatchObject({ item: { status: "completed", catalogReleaseId: activated.id,
      newIdentity: frozen.newIdentity, projects: [] } });
    expect(await pin()).toEqual(later);
  }, 120_000);
});
