import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { captureConfigurationSourceState, countLegacyProjectBindings, installConfigurationSourceFixture, seedIncompleteCurrentValueProbe } from "../../testing/parameterCatalog/configurationSource";
import { ParameterDefinitionId } from "../parameter-catalog-contract";
import { requestJson } from "../../test/testClient";
import { createWiseEffServer } from "../../app";
import { createLocalAuthService } from "../auth/localAuth";
import { hashLocalAccountPassword } from "../auth/localAccountCredentials";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createLocalObjectStore } from "../logs/objectStore";
import { createConfigSet, addConfigSetFile } from "../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { registerCanonicalJsonSource } from "../parameter-files/canonicalJsonSource";
import { loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { catalogBindingExportResponseSchema } from "../contracts/dtoSchemas/parameterCatalog";
import type { InitializationSnapshotItemDto } from "./initializationTypes";
import { approveReview } from "./initializationService";

const ORG = "org-init-http";
const SOURCE = "source-init-http";
const TARGET = "target-init-http";
const AUTHOR = "author-init-http";
const REVIEWER = "reviewer-init-http";
const GUEST = "guest-init-http";
const BYTES = '{"limits":{"limit":36.5},"untouched":[1,2]}\n';
let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
let db: ReturnType<typeof createPostgresDatabase>;
let directory: string;
let server: ReturnType<typeof createWiseEffServer>;
const tokens: string[] = [];
let sourceBindingId: string;
let storage: ReturnType<typeof createLocalObjectStore>;

function api<T>(actor: number, path: string, body?: unknown, method = "POST") {
  return requestJson<T>(server, path, {
    headers: { Authorization: `Bearer ${tokens[actor]}` },
    ...(body === undefined ? {} : { method, body: JSON.stringify(body) })
  });
}
async function exportBinding(projectId: string, bindingId: string) {
  const result = await api(0, `/api/v2/projects/${projectId}/parameter-bindings/${bindingId}/export`);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return catalogBindingExportResponseSchema.parse(result.body).item;
}
async function changeValue(projectId: string, bindingId: string, sourceText: string) {
  const before = await exportBinding(projectId, bindingId);
  const draft = await api<{ item: { draftId: string } }>(0,
    `/api/v2/projects/${projectId}/parameter-bindings/${bindingId}/drafts`, {
      baseRevisionId: before.manifest.configRevisionId,
      sourceTarget: { format: "json", sourceText }, reason: "Verify independent initialized source"
    });
  expect(draft.status, JSON.stringify(draft.body)).toBe(201);
  const submitted = await api<{ item: { id: string } }>(0,
    `/api/v2/projects/${projectId}/parameter-value-drafts/${draft.body.item.draftId}/submit`,
    { assignedToUserId: REVIEWER });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  const reviewed = await api<{ item: { status: string } }>(1,
    `/api/v2/projects/${projectId}/parameter-value-change-requests/${submitted.body.item.id}/review`,
    { decision: "approve" });
  expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
  expect(reviewed.body.item.status).toBe("approved");
  return exportBinding(projectId, bindingId);
}

beforeAll(async () => {
  database = await createEphemeralTestDatabase("init902http");
  db = createPostgresDatabase(database.url);
  directory = await mkdtemp(join(tmpdir(), "wiseeff-init902-http-"));
  storage = createLocalObjectStore(directory);
  await db.query("insert into organizations(id,name) values ($1,'Initialization HTTP')", [ORG]);
  const password = randomUUID();
  for (const id of [AUTHOR, REVIEWER, GUEST]) {
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,$1,'Admin',true)", [id, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ($1,$1,$2,null,$3)", [id, ORG, id === GUEST ? "guest" : "admin"]);
    await db.query("insert into user_password_credentials(user_id,username,password_hash) values ($1,$1,$2)", [id, await hashLocalAccountPassword(password)]);
  }
  await db.query("insert into organizations(id,name) values ('org-init-foreign','Foreign')");
  await db.query("insert into projects(id,organization_id,name,code,status) values ('source-init-foreign','org-init-foreign','Foreign','FOREIGN','initialized')");
  const auth = makeTestAuthContext({ userId: AUTHOR, organizationId: ORG, roles: [{ roleId: "admin", projectId: null }] });
  await db.query("insert into projects(id,organization_id,name,code,status,initialization_status) values ($1,$2,'Canonical source','SRC','initialized','initialized')", [SOURCE, ORG]);
  await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('init-http-source-reviewer',$1,$2,$3,'software-committer')", [REVIEWER, ORG, SOURCE]);
  await installConfigurationSourceFixture(db, auth, {
    subjectId: "csub_init_http", schemaId: "wiseeff.init.http",
    additionalDefinitionWithSameName: { definitionId: "pdef_init_http_other", revisionId: "drev_init_http_other_1", propertyKey: "other_limit" }
  });
  const set = await createConfigSet(db, auth, { projectId: SOURCE, name: "default" });
  const file = await uploadProjectParameterFile(db, storage, auth, { projectId: SOURCE, fileName: "settings.json", bytes: Buffer.from(BYTES) });
  await addConfigSetFile(db, auth, { configSetId: set.id, fileId: file.file.id, role: "base", sortOrder: 0 });
  const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
  if (!snapshot) throw new Error("Missing local fixture Catalog");
  const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, auth, snapshot, {
    projectId: SOURCE, configSetId: set.id, fileId: file.file.id, fileVersionId: file.version.id,
    configurationSchemaId: "wiseeff.init.http", rootPointer: "/limits",
    mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/limits/limit" }],
    invocation: createUserInvocation(auth), requestId: "init902-source", refusalSink: createTrustedRefusalAuditSink(db)
  }));
  sourceBindingId = registered.bindings[0]!.id;
  server = createWiseEffServer({ db, objectStore: storage, auth: { mode: "production" }, localAuthService: createLocalAuthService(db) });
  for (const username of [AUTHOR, REVIEWER, GUEST]) {
    const login = await requestJson<{ token: string }>(server, "/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    expect(login.status).toBe(200);
    tokens.push(login.body.token);
  }
}, 60_000);

async function pendingInitialization(projectId: string) {
  const code = projectId.replace("target-init-", "").toUpperCase();
  const created = await api(0, "/api/v1/parameters/admin/projects", { id: projectId, name: projectId, code });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const path = `/api/v1/parameters/projects/${projectId}/initialization`;
  const preview = await api<{ items: InitializationSnapshotItemDto[] }>(0, `${path}/preview`, {
    primarySourceProjectId: SOURCE, supplementSourceProjectIds: []
  });
  expect(preview.status).toBe(200);
  const saved = await api(0, `${path}/draft`, {
    projectName: projectId, projectCode: code, ownerUserId: AUTHOR,
    sourceProjectIds: [SOURCE], primarySourceProjectId: SOURCE, supplementSourceProjectIds: [],
    selectedModuleIds: [], selectedRisks: [], selectedSourceBindingIds: [sourceBindingId],
    bindingSnapshots: preview.body.items, emptyLibrary: false, notes: "Failure boundary"
  }, "PUT");
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const submitted = await api<{ item: { id: string } }>(0, `${path}/submit`, {});
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  const initialSets = (await db.query("select id from dts_config_set where organization_id=$1 and project_id=$2 order by id", [ORG, projectId])).rows;
  return { reviewId: submitted.body.item.id, initialSets, approvePath: `/api/v1/parameters/admin/initialization-reviews/${submitted.body.item.id}/approve` };
}

async function expectNoMaterializedTarget(projectId: string, pending: Awaited<ReturnType<typeof pendingInitialization>>, queryable: Pick<typeof db, "query"> = db) {
  const counts = await queryable.query(`select
    (select count(*)::int from parameter_catalog.current_project_parameter_bindings where organization_id=$1 and project_id=$2) as bindings,
    (select count(*)::int from project_parameter_files where organization_id=$1 and project_id=$2) as files,
    (select status from project_parameter_initialization_reviews where id=$3) as review,
    (select initialization_status from projects where id=$2 and organization_id=$1) as project`, [ORG, projectId, pending.reviewId]);
  expect(counts.rows[0]).toEqual({ bindings: 0, files: 0, review: "pending", project: "initialization_pending_review" });
  expect((await queryable.query("select id from dts_config_set where organization_id=$1 and project_id=$2 order by id", [ORG, projectId])).rows).toEqual(pending.initialSets);
}

it("rolls back a failed source copy and retries the same approved initialization exactly once", async () => {
  const projectId = "target-init-retry";
  const pending = await pendingInitialization(projectId);
  const sourceBefore = await exportBinding(SOURCE, sourceBindingId);
  const put = vi.spyOn(storage, "put").mockRejectedValueOnce(new Error("injected local object store failure"));
  try {
    expect((await api(1, pending.approvePath, {})).status).toBe(500);
    expect(put).toHaveBeenCalledTimes(1);
    await expectNoMaterializedTarget(projectId, pending);
    expect(await exportBinding(SOURCE, sourceBindingId)).toEqual(sourceBefore);
  } finally {
    put.mockRestore();
  }
  const results = [await api(1, pending.approvePath, {}), await api(1, pending.approvePath, {})];
  expect(results.map((result) => result.status)).toEqual([200, 200]);
  expect(results[0]!.body).toEqual(results[1]!.body);
  expect((await db.query("select count(*)::int as count from parameter_catalog.current_project_parameter_bindings where organization_id=$1 and project_id=$2", [ORG, projectId])).rows[0]!.count).toBe(1);
}, 60_000);

it("refuses source drift after submission without materializing any target state", async () => {
  const projectId = "target-init-drift";
  const pending = await pendingInitialization(projectId);
  await changeValue(SOURCE, sourceBindingId, "73");
  const refused = await api(1, pending.approvePath, {});
  expect(refused.status, JSON.stringify(refused.body)).toBe(409);
  await expectNoMaterializedTarget(projectId, pending);
}, 60_000);

it("preserves primary and supplement selections with same-name Definitions and repeated Definition instances", async () => {
  const primary = "source-init-multiple-primary";
  const secondary = "source-init-multiple-secondary";
  const projectId = "target-init-multiple";
  const auth = makeTestAuthContext({ userId: AUTHOR, organizationId: ORG, roles: [{ roleId: "admin", projectId: null }] });
  for (const sourceProjectId of [primary, secondary]) {
    await db.query("insert into projects(id,organization_id,name,code,status,initialization_status) values ($1,$2,$1,$1,'initialized','initialized')", [sourceProjectId, ORG]);
  }
  const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
  if (!snapshot) throw new Error("Missing local fixture Catalog");
  const names = ["pdef_acme_power_iin_max", "pdef_init_http_other"].map((id) => {
    const definition = snapshot.getDefinitionById(ParameterDefinitionId(id));
    if (definition.status !== "found") throw new Error("Missing canonical Definition fixture");
    return definition.definition.selectedRevision.content.displayName;
  });
  expect(names).toHaveLength(2);
  expect(new Set(names).size).toBe(1);
  const sources: Array<{ projectId: string; bindingId: string; definitionId: string; value: number }> = [];
  for (const [sourceProjectId, definitionId, value] of [
    [primary, "pdef_acme_power_iin_max", 11],
    [primary, "pdef_acme_power_iin_max", 22],
    [secondary, "pdef_acme_power_iin_max", 33],
    [secondary, "pdef_init_http_other", 44]
  ] as const) {
    const set = await createConfigSet(db, auth, { projectId: sourceProjectId, name: `instance-${value}` });
    const file = await uploadProjectParameterFile(db, storage, auth, {
      projectId: sourceProjectId, fileName: `instance-${value}.json`, bytes: Buffer.from(`{"limits":{"limit":${value}}}\n`)
    });
    await addConfigSetFile(db, auth, { configSetId: set.id, fileId: file.file.id, role: "base", sortOrder: 0 });
    const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, auth, snapshot, {
      projectId: sourceProjectId, configSetId: set.id, fileId: file.file.id, fileVersionId: file.version.id,
      configurationSchemaId: "wiseeff.init.http", rootPointer: "/limits",
      mappings: [{ definitionId, pointer: "/limits/limit" }], invocation: createUserInvocation(auth),
      requestId: `init-http-instance-${value}`, refusalSink: createTrustedRefusalAuditSink(db)
    }));
    expect(registered.bindings).toHaveLength(1);
    sources.push({ projectId: sourceProjectId, bindingId: registered.bindings[0]!.id, definitionId, value });
  }
  expect(await countLegacyProjectBindings(db, { organizationId: ORG, projectIds: [primary, secondary] })).toBe(0);
  expect((await api(0, "/api/v1/parameters/admin/projects", { id: projectId, name: projectId, code: "MULTIPLE" })).status).toBe(201);
  await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('init-http-multiple-reviewer',$1,$2,$3,'software-committer')", [REVIEWER, ORG, projectId]);
  const path = `/api/v1/parameters/projects/${projectId}/initialization`;
  const selectedSourceBindingIds = sources.map((source) => source.bindingId);
  const preview = await api<{ items: InitializationSnapshotItemDto[] }>(0, `${path}/preview`, {
    primarySourceProjectId: primary, supplementSourceProjectIds: [secondary], selectedSourceBindingIds
  });
  expect(preview.status, JSON.stringify(preview.body)).toBe(200);
  expect(preview.body.items).toHaveLength(4);
  expect(preview.body.items.map((item) => item.sourceProjectParameterBindingId).sort()).toEqual([...selectedSourceBindingIds].sort());
  expect(new Set(preview.body.items.map((item) => item.sourceProjectValueId)).size).toBe(4);
  const sourceExports: Awaited<ReturnType<typeof exportBinding>>[] = [];
  for (const source of sources) sourceExports.push(await exportBinding(source.projectId, source.bindingId));
  for (const [index, source] of sources.entries()) {
    expect(sourceExports[index]!.manifest.definitionId).toBe(source.definitionId);
    expect(preview.body.items.find((item) => item.sourceProjectParameterBindingId === source.bindingId)).toMatchObject({
      sourceProjectId: source.projectId, sourceProjectValueId: sourceExports[index]!.currentValueId,
      effectiveValue: { kind: "json", value: source.value },
      sourceRole: source.projectId === primary ? "primary" : "supplement"
    });
  }
  const saved = await api<{ item: { bindingSnapshots: InitializationSnapshotItemDto[]; selectedSourceBindingIds: string[] } }>(0, `${path}/draft`, {
    projectName: projectId, projectCode: "MULTIPLE", ownerUserId: AUTHOR,
    sourceProjectIds: [primary, secondary], primarySourceProjectId: primary, supplementSourceProjectIds: [secondary],
    selectedModuleIds: [], selectedRisks: [], selectedSourceBindingIds,
    bindingSnapshots: preview.body.items, emptyLibrary: false, notes: "Preserve canonical source instances"
  }, "PUT");
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  expect(saved.body.item.selectedSourceBindingIds.sort()).toEqual([...selectedSourceBindingIds].sort());
  expect(saved.body.item.bindingSnapshots).toHaveLength(4);
  expect(saved.body.item.bindingSnapshots.map((item) => item.sourceProjectValueId).sort()).toEqual(sourceExports.map((item) => item.currentValueId).sort());
  const submitted = await api<{ item: { id: string } }>(0, `${path}/submit`, {});
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  const approved = await api(1, `/api/v1/parameters/admin/initialization-reviews/${submitted.body.item.id}/approve`, {});
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  const targets = (await db.query<{ id: string; definition_id: string; logical_node_id: string | null; source_occurrence_id: string; current_value_id: string }>(
    "select id,definition_id,logical_node_id,source_occurrence_id,current_value_id from parameter_catalog.current_project_parameter_bindings where organization_id=$1 and project_id=$2", [ORG, projectId]
  )).rows;
  expect(targets).toHaveLength(4);
  expect(targets.filter((target) => target.definition_id === "pdef_acme_power_iin_max")).toHaveLength(3);
  expect(targets.map((target) => target.logical_node_id)).toEqual([null, null, null, null]);
  for (const key of ["id", "source_occurrence_id", "current_value_id"] as const) {
    expect(new Set(targets.map((target) => target[key])).size).toBe(4);
  }
  const targetFiles = (await db.query<{ file_name: string; storage_key: string }>(
    `select file.file_name,version.storage_key from project_parameter_files file
      join project_parameter_file_versions version on version.id=file.current_version_id
      where file.organization_id=$1 and file.project_id=$2`, [ORG, projectId]
  )).rows;
  expect(targetFiles).toHaveLength(4);
  for (const file of targetFiles) {
    expect(file.file_name).toMatch(/^initialization-[0-9a-f-]{36}-instance-(11|22|33|44)\.json$/);
    expect(file.storage_key).toContain("canonical-source-attempt-");
  }
  const targetExports: Awaited<ReturnType<typeof exportBinding>>[] = [];
  for (const target of targets) targetExports.push(await exportBinding(projectId, target.id));
  for (const [index, source] of sources.entries()) {
    const sourceExport = sourceExports[index]!;
    const targetExport = targetExports.find((item) => item.files[0]!.content === sourceExport.files[0]!.content);
    expect(targetExport).toBeDefined();
    expect(targetExport!.manifest.definitionId).toBe(source.definitionId);
    expect(targetExport!.manifest.projectId).toBe(projectId);
    expect(targetExport!.currentValueId).not.toBe(sourceExport.currentValueId);
    for (const key of ["bindingId", "configSetId", "configRevisionId", "fileId", "fileVersionId", "sourceOccurrenceId"] as const) {
      expect(targetExport!.manifest[key]).not.toBe(sourceExport.manifest[key]);
      expect(new Set(targetExports.map((item) => item.manifest[key])).size).toBe(4);
    }
  }
  const changed = await changeValue(projectId, targets[0]!.id, "99");
  expect(changed.files[0]!.content).toContain("99");
  for (const [index, target] of targets.entries()) {
    if (index !== 0) expect(await exportBinding(projectId, target.id)).toEqual(targetExports[index]);
  }
  for (const [index, source] of sources.entries()) {
    expect(await exportBinding(source.projectId, source.bindingId)).toEqual(sourceExports[index]);
  }
  expect(await countLegacyProjectBindings(db, { organizationId: ORG, projectIds: [primary, secondary, projectId] })).toBe(0);
}, 60_000);

it.each(["missing-value", "missing-pin"] as const)("refuses approval when the selected source Binding has a %s in PostgreSQL", async (name) => {
  const projectId = `target-init-${name}`;
  const pending = await pendingInitialization(projectId);
  const sourceBefore = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: SOURCE });
  const auth = makeTestAuthContext({ userId: REVIEWER, organizationId: ORG, roles: [{ roleId: "admin", projectId: null }] });
  const catalogSnapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
  if (!catalogSnapshot) throw new Error("Missing local fixture Catalog");
  const valueId = randomUUID();
  const rollback = new Error("Roll back the deliberately incomplete source fixture before COMMIT");
  const put = vi.spyOn(storage, "put");
  try {
    await expect(db.transaction(async (tx) => {
      const probe = await seedIncompleteCurrentValueProbe(tx, {
        organizationId: ORG, projectId: SOURCE, bindingId: sourceBindingId, valueId, kind: name
      });
      if (name === "missing-pin") expect(probe.inserted).toEqual([{ id: valueId }]);
      expect(probe.updated).toEqual([{ id: sourceBindingId }]);
      expect(probe.current).toEqual([{ current_value_id: valueId, value_id: name === "missing-pin" ? valueId : null, pin_id: null }]);
      if (name === "missing-pin") {
        await tx.query(`update project_parameter_initialization_drafts
          set binding_snapshots=jsonb_set(binding_snapshots,'{0,sourceProjectValueId}',to_jsonb($3::text))
          where organization_id=$1 and project_id=$2`, [ORG, projectId, valueId]);
      }
      await expect(approveReview(tx, auth, { reviewId: pending.reviewId }, {
        requestId: `init-http-refuse-${name}`, invocation: createUserInvocation(auth),
        refusalSink: createTrustedRefusalAuditSink(db), objectStore: storage, catalogSnapshot
      })).rejects.toMatchObject({
        code: "CONFLICT",
        ...(name === "missing-pin" ? { message: "Initialization source value has no exact owned source pin." } : {})
      });
      expect(put).not.toHaveBeenCalled();
      await expectNoMaterializedTarget(projectId, pending, tx);
      const target = await captureConfigurationSourceState(tx, { organizationId: ORG, projectId });
      expect(target).toMatchObject({ bindings: [], values: [], pins: [], files: [], versions: [], revisions: [], members: [] });
      throw rollback;
    })).rejects.toBe(rollback);
    await expectNoMaterializedTarget(projectId, pending);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: SOURCE })).toEqual(sourceBefore);
  } finally {
    put.mockRestore();
  }
}, 60_000);

afterAll(async () => {
  await db?.close();
  await database?.drop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("keeps canonical source pins inaccessible to the governance runtime role", async () => {
  await expect(db.transaction(async (tx) => {
    await tx.query("set local role parameter_governance_writer_role");
    await tx.query("select id from parameter_catalog.project_value_source_pins limit 1");
  })).rejects.toMatchObject({ code: "42501" });
});

it("initializes from canonical-only JSON over authenticated HTTP, then independently reviews both sources", async () => {
  expect((await db.query("select count(*)::int as count from public.project_parameter_bindings where organization_id=$1", [ORG])).rows[0]!.count).toBe(0);
  const created = await api(0, "/api/v1/parameters/admin/projects", { id: TARGET, name: "Independent target", code: "TARGET" });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('init-http-target-reviewer',$1,$2,$3,'software-committer')", [REVIEWER, ORG, TARGET]);
  const initPath = `/api/v1/parameters/projects/${TARGET}/initialization`;
  expect((await api(0, `${initPath}/preview`, { primarySourceProjectId: "source-init-foreign", supplementSourceProjectIds: [] })).status).toBe(403);
  const preview = await api<{ items: InitializationSnapshotItemDto[] }>(0, `${initPath}/preview`, { primarySourceProjectId: SOURCE, supplementSourceProjectIds: [] });
  expect(preview.status, JSON.stringify(preview.body)).toBe(200);
  expect(preview.body.items).toHaveLength(1);
  const sourceBefore = await exportBinding(SOURCE, sourceBindingId);
  expect(preview.body.items[0]!.sourceProjectValueId).toBe(sourceBefore.currentValueId);
  const input = {
    projectName: "Independent target", projectCode: "TARGET", ownerUserId: AUTHOR,
    sourceProjectIds: [SOURCE], primarySourceProjectId: SOURCE, supplementSourceProjectIds: [],
    selectedModuleIds: [], selectedRisks: [], selectedSourceBindingIds: [sourceBindingId],
    bindingSnapshots: preview.body.items, emptyLibrary: false, notes: "Canonical-only inheritance"
  };
  const missingPin = { ...input, bindingSnapshots: input.bindingSnapshots.map(({ sourceProjectValueId: _pin, ...rest }) => rest) };
  expect((await api(0, `${initPath}/draft`, missingPin, "PUT")).status).toBe(400);
  const saved = await api<{ item: { bindingSnapshots: InitializationSnapshotItemDto[] } }>(0, `${initPath}/draft`, {
    ...input, bindingSnapshots: input.bindingSnapshots.map((item) => ({ ...item, rawValue: "999", effectiveValue: 999 }))
  }, "PUT");
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  expect(saved.body.item.bindingSnapshots[0]!.rawValue).toBe(preview.body.items[0]!.rawValue);
  expect(saved.body.item.bindingSnapshots[0]!.effectiveValue).toEqual(preview.body.items[0]!.effectiveValue);
  const submitted = await api<{ item: { id: string } }>(0, `${initPath}/submit`, {});
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  const approvePath = `/api/v1/parameters/admin/initialization-reviews/${submitted.body.item.id}/approve`;
  expect((await api(2, approvePath, {})).status).toBe(403);
  expect((await db.query("select count(*)::int as count from parameter_catalog.current_project_parameter_bindings where organization_id=$1 and project_id=$2", [ORG, TARGET])).rows[0]!.count).toBe(0);
  const approved = await api<{ item: { status: string } }>(1, approvePath, {});
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  expect(approved.body.item.status).toBe("approved");
  const replay = await api(1, approvePath, {});
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(approved.body);
  const targets = (await db.query<{ id: string }>("select id from parameter_catalog.current_project_parameter_bindings where organization_id=$1 and project_id=$2", [ORG, TARGET])).rows;
  expect(targets).toHaveLength(1);
  const targetId = targets[0]!.id;
  const targetBefore = await exportBinding(TARGET, targetId);
  expect(targetBefore.files[0]!.content).toBe(sourceBefore.files[0]!.content);
  expect(targetBefore.manifest.projectId).toBe(TARGET);
  for (const key of ["configSetId", "configRevisionId", "fileId", "fileVersionId", "sourceOccurrenceId"] as const) {
    expect(targetBefore.manifest[key]).not.toBe(sourceBefore.manifest[key]);
  }
  const changedTarget = await changeValue(TARGET, targetId, "91.25");
  expect(changedTarget.files[0]!.content).toContain("91.25");
  expect(await exportBinding(SOURCE, sourceBindingId)).toEqual(sourceBefore);
  const changedSource = await changeValue(SOURCE, sourceBindingId, "72");
  expect(changedSource.files[0]!.content).toContain("72");
  expect(await exportBinding(TARGET, targetId)).toEqual(changedTarget);
  expect((await db.query("select count(*)::int as count from public.project_parameter_bindings where organization_id=$1", [ORG])).rows[0]!.count).toBe(0);
}, 60_000);
