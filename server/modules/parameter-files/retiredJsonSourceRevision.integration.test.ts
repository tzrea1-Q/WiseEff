import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { captureConfigurationSourceState, installConfigurationSourceFixture, seedMixedRevisionCohortProbe } from "../../testing/parameterCatalog/configurationSource";
import { setSourceRevisionRegistrationStatus } from "../../testing/parameterCatalog/sourceRevision";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { createLocalObjectStore } from "../logs/objectStore";
import { loadPublishedCatalog, loadRetiredOrganizationSourceRegistrations } from "../parameter-bindings/catalogProjectValueSync";
import { loadOwnedProjectValueSourcePin, loadSourceBindingCohortReadOnly, readOwnedCurrentBinding, readOwnedProjectValueIdentity } from "../parameter-bindings/values";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { createConfigSet, addConfigSetFile } from "./configSetService";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { uploadProjectParameterFile } from "./service";
import { createCandidate } from "./candidateService";
import { previewSourceRevisionCandidate } from "./sourceRevisionService";
import { applySourceRevisionCandidate } from "./sourceRevisionCommit";
import { sourceAdminToolchain } from "./sourceAdministration.testHelpers";

const ORG = "org-retired-json-source", PROJECT = "project-retired-json-source", USER = "user-retired-json-source";
const SUBJECT = "csub_retired_json_source", SCHEMA = "wiseeff.retired-json-source";
const DTS = '/dts-v1/; / { model = "retired JSON companion"; };\n';
const JSON_SOURCE = '{"limit":36,"untouched":[1,2]}\n';
const auth = makeTestAuthContext({ organizationId: ORG, userId: USER, roles: [{ roleId: "admin", projectId: null }] });

// The real restricted API database role and deferred provenance constraints are
// exercised here. The compiler stub qualifies database behavior only; the
// existing native-toolchain source revision suites retain their own acceptance.
describe("retired JSON source continuity in whole DTS revisions", { timeout: 120_000 }, () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let api: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let directory: string, configSetId: string, dtsFileId: string, jsonFileId: string, jsonVersionId: string, bindingId: string;
  let initialPinId: string;
  const token = `retired_json_${process.pid}`;
  const scope = { organizationId: ORG, projectId: PROJECT };

  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("retired-json-source");
    db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-retired-json-"));
    storage = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'Retired JSON')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Source admin','Admin',true)", [USER, ORG]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Retired JSON','RJSON','initialized')", [PROJECT, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('retired-json-admin',$1,$2,'admin')", [USER, ORG]);
    await installConfigurationSourceFixture(db, auth, { subjectId: SUBJECT, schemaId: SCHEMA });
    configSetId = (await createConfigSet(db, auth, { projectId: PROJECT, name: "Mixed sources" })).id;
    const dts = await uploadProjectParameterFile(db, storage, auth, { projectId: PROJECT, fileName: "board.dts", bytes: Buffer.from(DTS) });
    const json = await uploadProjectParameterFile(db, storage, auth, { projectId: PROJECT, fileName: "settings.json", bytes: Buffer.from(JSON_SOURCE) });
    dtsFileId = dts.file.id; jsonFileId = json.file.id; jsonVersionId = json.version.id;
    await addConfigSetFile(db, auth, { configSetId, fileId: dtsFileId, role: "base", sortOrder: 0 });
    await addConfigSetFile(db, auth, { configSetId, fileId: jsonFileId, role: "misc", sortOrder: 1 });
    await ingestConfigRevision(db, { ...scope, configSetId, entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [], members: [
      { fileId: dtsFileId, fileVersionId: dts.version.id, fileName: "board.dts", sourceName: "board.dts", format: "dts", role: "base", sortOrder: 0, content: DTS },
      { fileId: jsonFileId, fileVersionId: jsonVersionId, fileName: "settings.json", sourceName: "settings.json", format: "json", role: "misc", sortOrder: 1, content: JSON_SOURCE }
    ] }, auth);
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("JSON Catalog fixture unavailable");
    const registered = await db.transaction(tx => registerCanonicalJsonSource(tx, storage, auth, snapshot, {
      projectId: PROJECT, configSetId, fileId: jsonFileId, fileVersionId: jsonVersionId,
      configurationSchemaId: SCHEMA, rootPointer: "", mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/limit" }],
      invocation: createUserInvocation(auth), requestId: "retired-json-initialize", refusalSink: createTrustedRefusalAuditSink(db)
    }));
    expect(registered.bindings).toHaveLength(1);
    bindingId = registered.bindings[0]!.id;
    const pin = await loadOwnedProjectValueSourcePin(db, { ...scope, bindingId, projectValueId: registered.bindings[0]!.currentValueId });
    if (!pin) throw new Error("Initial JSON source pin unavailable");
    initialPinId = pin.sourcePinId;
    // Synthetic retained state: current Bindings stay readable after retirement.
    await setSourceRevisionRegistrationStatus(db, { organizationId: ORG, registrationId: registered.bindings[0]!.registrationId, status: "retired" });
    const logins = await provisionPublicationRuntimeLogins(lane.url, { mode: "lab", runToken: token });
    api = createPostgresDatabase(logins.apiUrl);
    expect((await api.query<{ owner: boolean }>("select current_user='catalog_migration_owner' as owner")).rows[0]?.owner).toBe(false);
  });

  afterAll(async () => {
    await api?.close();
    if (lane) await dropLabRuntimeLogins(lane.url, token);
    await db?.close(); await lane?.drop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function current() {
    const result = await readOwnedCurrentBinding(api, { ...scope, bindingId });
    if (result.status !== "current") throw new Error("Current JSON Binding unavailable");
    const pin = await loadOwnedProjectValueSourcePin(api, { ...scope, bindingId, projectValueId: result.binding.currentValueId });
    if (!pin) throw new Error("Current JSON pin unavailable");
    return { binding: result.binding, pin };
  }

  async function apply(text: string, key: string) {
    const file = (await api.query<{ current_version_id: string }>("select current_version_id from public.project_parameter_files where id=$1", [dtsFileId])).rows[0]!;
    const { pin } = await current();
    const candidate = await createCandidate(api, storage, auth, { projectId: PROJECT, fileId: dtsFileId, fileName: "board.dts", bytes: Buffer.from(text),
      intent: "source_revision", expectedCurrentVersionId: file.current_version_id, expectedConfigRevisionId: pin.configRevisionId, clientMutationId: key });
    const preview = await previewSourceRevisionCandidate(api, storage, auth, { projectId: PROJECT, candidateId: candidate.id }, { toolchain: sourceAdminToolchain });
    expect(preview).toMatchObject({ canSubmit: true, impact: { parameterChanges: 0 } });
    const input = { projectId: PROJECT, candidateId: candidate.id, expectedCurrentVersionId: file.current_version_id,
      expectedProofToken: preview.proofToken, reason: "Preserve retired JSON source", clientMutationId: `${key}-apply` };
    const security = { invocation: createUserInvocation(auth), requestId: key, refusalSink: createTrustedRefusalAuditSink(db) };
    const receipt = await applySourceRevisionCandidate(api, storage, auth, input, security, { toolchain: sourceAdminToolchain });
    expect(await applySourceRevisionCandidate(api, storage, auth, input, security, { toolchain: sourceAdminToolchain })).toEqual(receipt);
    return receipt;
  }

  it("rejects a retired JSON repin without an exact approved DTS derived receipt", async () => {
    const before = await captureConfigurationSourceState(db, scope);
    const { binding } = await current();
    await expect(db.transaction(tx => seedMixedRevisionCohortProbe(tx, {
      ...scope, bindingId, projectValueId: binding.currentValueId
    }))).rejects.toMatchObject({ code: "23503" });
    expect(await captureConfigurationSourceState(db, scope)).toEqual(before);
    expect((await db.query<{ allowed: boolean }>(
      "select parameter_catalog.retired_json_source_revision_matches($1) as allowed", [initialPinId])).rows[0]?.allowed).toBe(false);
  });

  it("preserves retired JSON identity and values through two saves and immutable historical receipt reads", async () => {
    const original = await current();
    const first = await apply(DTS + "/* first DTS-only edit */\n", "retired-json-first");
    const afterFirst = await current();
    expect(afterFirst.binding.id).toBe(original.binding.id);
    expect(afterFirst.binding.registrationId).toBe(original.binding.registrationId);
    expect(afterFirst.pin.fileVersionId).toBe(jsonVersionId);
    expect(afterFirst.pin.locator).toEqual(original.pin.locator);
    expect(afterFirst.pin.configRevisionId).not.toBe(original.pin.configRevisionId);
    await apply(DTS + "/* second DTS-only edit */\n", "retired-json-second");
    const afterSecond = await current();
    expect(afterSecond.pin.configRevisionId).not.toBe(afterFirst.pin.configRevisionId);
    expect(afterSecond.pin.fileVersionId).toBe(jsonVersionId);
    expect(afterSecond.pin.locator).toEqual(original.pin.locator);
    for (const pinId of [afterFirst.pin.sourcePinId, afterSecond.pin.sourcePinId]) {
      expect((await db.query<{ allowed: boolean }>(
        "select parameter_catalog.retired_json_source_revision_matches($1) as allowed", [pinId])).rows[0]?.allowed).toBe(true);
    }
    const values = await Promise.all([original.binding.currentValueId, afterFirst.binding.currentValueId, afterSecond.binding.currentValueId]
      .map(projectValueId => readOwnedProjectValueIdentity(api, { ...scope, bindingId, projectValueId })));
    expect(values).toHaveLength(3);
    expect(values.every(value => value !== null)).toBe(true);
    expect(new Set(values.map(value => JSON.stringify({ payload: value!.value.payload, digest: value!.value.valueDigest }))).size).toBe(1);
    expect(await loadRetiredOrganizationSourceRegistrations(api, scope))
      .toEqual([{ id: original.binding.registrationId, subjectId: SUBJECT }]);
    expect((await loadSourceBindingCohortReadOnly(api, { ...scope, configSetId })).map(row => row.bindingId))
      .toEqual([bindingId]);
    expect((await api.query("select current_version_id from public.project_parameter_files where id=$1", [jsonFileId])).rows)
      .toEqual([{ current_version_id: jsonVersionId }]);
    expect((await api.query("select status from public.project_parameter_value_change_requests where id=$1", [first.requestId])).rows)
      .toEqual([{ status: "approved" }]);
  });
});
