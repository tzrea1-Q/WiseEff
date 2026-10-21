import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../testing/labRuntimeLogins";
import { captureCurrentCatalogPin } from "../catalog-publication/runtime";
import { createUserInvocation } from "../auth/trustedInvocation";
import { getAuthContext } from "../auth/repository";
import { createCatalogInstaller } from "../catalog-kernel/install/installer";
import { runPublicationManagerOnce } from "../catalog-publication/jobs/manager";
import { catalogReplacementPreviewResponseSchema, catalogReplacementResponseSchema } from "../contracts/dtoSchemas/parameterCatalog";
import { createMigrationHarness, integerContent, PREDECESSOR_DEFINITION_ID, PREDECESSOR_PROPERTY_KEY, PREDECESSOR_REVISION_ID, PREDECESSOR_SUBJECT_ID, type MigrationHarness } from "./testing/harness";

const ORG = "org-zero-correction", ADMIN = "zero-platform-admin";
const path = "/api/v2/catalog/definition-replacements";

describe("#1309 zero-project identity correction through the real API role", () => {
  let harness: MigrationHarness, api: ReturnType<typeof createPostgresDatabase>;
  const token = `zero_correction_${randomUUID().slice(0, 8)}`;
  const app = () => createWiseEffServer({ db: api, objectStore: harness.objectStore,
    auth: { mode: "production", verifier: { verify: async () => makeTestAuthContext({ organizationId: ORG,
      userId: ADMIN, roles: [{ roleId: "guest", projectId: null }] }) } } });
  const pin = async () => (await captureCurrentCatalogPin(harness.pool))!;
  const post = async (suffix: string, body: unknown, fingerprint?: string) => requestJson(app(), `${path}${suffix}`, {
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
  const reference = async (definition: { definitionId: string; revisionId: string }, organizationId: string, label: string) => {
    await harness.refreshCatalog();
    await harness.seedOrganization(organizationId);
    await harness.seedProject(organizationId, `zero-project-${label}`, label);
    const registrationId = await harness.registerSubject({ organizationId, subjectId: PREDECESSOR_SUBJECT_ID,
      subjectKind: "driver", moduleId: `zero-module-${label}` });
    return harness.seedBindingValue({ organizationId, projectId: `zero-project-${label}`, logicalNodeId: `zero-node-${label}`,
      registrationId, ...definition, sources: [{ sourceRef: `${label}.dts`, configRevisionId: `zero-revision-${label}` }], values: [5] });
  };

  beforeAll(async () => {
    harness = await createMigrationHarness();
    await harness.seedOrganization(ORG);
    await harness.db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Zero administrator','Admin',true)", [ADMIN, ORG]);
    for (const role of ["admin", "platform-admin"]) await harness.db.query(
      "insert into user_role_bindings(id,user_id,organization_id,role_id) values ($1,$2,$3,$4)", [`zero-${role}`, ADMIN, ORG, role]);
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

  it("rechecks revoked platform authority at activation and does not grant project migration to a platform-only actor", async () => {
    const definition = await unused("zero_authority_source");
    const draft = { oldDefinitionId: definition.definitionId, newSubjectId: PREDECESSOR_SUBJECT_ID,
      newPropertyKey: "zero_authority_corrected", ...integerContent("Authority", 0), projectIds: [], reason: "Use current authority" };
    await harness.db.query("delete from user_role_bindings where id='zero-admin'");
    try {
      const denied = await post("/preview", { ...draft, projectIds: ["a-project-the-platform-actor-does-not-administer"] });
      expect(denied.status, denied.bodyText).toBe(403);
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
