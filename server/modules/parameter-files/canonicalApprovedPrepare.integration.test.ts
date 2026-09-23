import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createAgentInvocation, createSystemInvocation, createUserInvocation } from "../auth/trustedInvocation";
import { createAgentApproval, createAgentSession, createAgentToolCall, markAgentApprovalApproved } from "../agent/repository";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { validCatalogReleaseBundle } from "../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { compileCatalogRelease } from "../catalog-kernel/compiler";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { writeGuardedRegistration } from "../parameter-governance/registration/internalGuardedRegistrationWriter";
import { CatalogSubjectId } from "../parameter-catalog-contract";
import type { RegisterSubjectCommand } from "../parameter-governance/registration/command";
import { createParameterModuleForAuth } from "../parameters/service";
import { installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { loadPublishedCatalog, listCatalogBindingRowsForProject, syncPublishedCatalogProjectValues } from "../parameter-bindings/catalogProjectValueSync";
import { loadCanonicalBindingPins } from "../parameter-bindings/drafts/repository";
import { loadOwnedProjectValueSourcePin } from "../parameter-bindings/values";
import { createConfigSet, addConfigSetFile } from "./configSetService";
import { uploadProjectParameterFile } from "./service";
import { createLocalObjectStore } from "../logs/objectStore";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { commitCanonicalSourceRevision } from "./canonicalSourceCommit";
import { loadCanonicalSourceSnapshot, loadPinnedDtsProperty, preparePinnedSourceChange } from "./canonicalSource";
import type { ConfigRevisionManifest } from "../parameter-topology/types";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error("approved canonical source preparation requires a reachable real PostgreSQL server; skipping is forbidden");
}

const ORG = "org-agent-source-prepare";
const PROJECT = "project-agent-source-prepare";
const USER = "user-agent-source-prepare";
const REVIEWER = "reviewer-agent-source-prepare";
const DRIVER_SUBJECT = "csub_acme_power";
const ATTR = "attr-agent-source-prepare";
const MODULE = "pmod-agent-source-prepare";
const SCHEMA = "wiseeff.agent.source.prepare";
const DEFINITION = "pdef_acme_power_iin_max";
const DTS = `/dts-v1/;
/ {
\tcharger {
\t\tcompatible = "acme,power";
\t\tiin_max = <1000>;
\t};
};
`;
const JSON_SOURCE = '{ "limit": 36.5, "untouched": true }\n';

describe("approved Agent canonical source preparation", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storageDirectory: string;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let refusalSink: ReturnType<typeof createTrustedRefusalAuditSink>;
  let snapshot: Awaited<ReturnType<typeof loadPublishedCatalog>>;
  let dtsBinding: Awaited<ReturnType<typeof listCatalogBindingRowsForProject>>[number];
  let jsonDatabase: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let jsonDb: ReturnType<typeof createPostgresDatabase>;
  let jsonStorageDirectory: string;
  let jsonStorage: ReturnType<typeof createLocalObjectStore>;
  let jsonRefusalSink: ReturnType<typeof createTrustedRefusalAuditSink>;
  let jsonSnapshot: Awaited<ReturnType<typeof loadPublishedCatalog>>;
  let jsonBinding: Awaited<ReturnType<typeof listCatalogBindingRowsForProject>>[number];
  const auth = makeTestAuthContext({
    userId: USER,
    organizationId: ORG,
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  });

  async function seedApprovedAgent(
    database: ReturnType<typeof createPostgresDatabase>,
    binding: typeof dtsBinding,
    target: { format: "dts" | "json"; sourceText: string },
  ) {
    const pins = await loadCanonicalBindingPins(database, { organizationId: ORG, projectId: PROJECT, bindingId: binding.id });
    const source = await loadOwnedProjectValueSourcePin(database, {
      organizationId: ORG,
      projectId: PROJECT,
      bindingId: binding.id,
      projectValueId: binding.currentValueId,
    });
    if (!pins || !source) throw new Error("approved Agent fixture requires exact canonical pins");
    const sessionId = `agent-session-${randomUUID()}`;
    const toolCallId = `agent-tool-${randomUUID()}`;
    const approvalId = `agent-approval-${randomUUID()}`;
    await createAgentSession(database, {
      id: sessionId,
      organizationId: ORG,
      projectId: PROJECT,
      actorUserId: USER,
      pageKey: "parameters",
      context: {},
      title: "Approved canonical source test",
    });
    await createAgentToolCall(database, {
      id: toolCallId,
      sessionId,
      organizationId: ORG,
      projectId: PROJECT,
      name: "action.submitParameterChange",
      label: "Submit parameter change",
      requiresApproval: true,
      status: "running",
      payload: {
        projectId: PROJECT,
        parameterId: binding.id,
        targetValue: target.sourceText,
        approvedParameter: {
          projectId: PROJECT,
          bindingId: binding.id,
          expectedValueId: binding.currentValueId,
          definitionId: pins.definitionId,
          definitionRevisionId: pins.definitionRevisionId,
          catalogReleaseId: pins.catalogReleaseId,
          configRevisionId: pins.configRevisionId,
          sourceRef: pins.sourceRef,
          sourcePinId: source.sourcePinId,
          sourceFormat: target.format,
          target,
        },
      },
    });
    await createAgentApproval(database, {
      id: approvalId,
      sessionId,
      toolCallId,
      organizationId: ORG,
      projectId: PROJECT,
      status: "pending",
      title: "Approve canonical source prepare",
      message: "Approve canonical source prepare",
      requestedByUserId: USER,
    });
    if (!await markAgentApprovalApproved(database, ORG, approvalId, USER)) {
      throw new Error("approved Agent fixture could not record the approval decision");
    }
    return {
      invocation: createAgentInvocation(auth, {
        sessionId,
        toolCallId,
        approval: { required: true, approvalId },
      }),
      pins,
      source,
    };
  }

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("agent-source-prepare");
    db = createPostgresDatabase(database.url);
    refusalSink = createTrustedRefusalAuditSink(db);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-agent-source-prepare-"));
    storage = createLocalObjectStore(storageDirectory);
    await db.query(`insert into organizations(id,name) values ($1,'Agent source prepare')`, [ORG]);
    await db.query(
      `insert into users(id,organization_id,name,title,is_active) values
        ($1,$3,'Agent source author','Admin',true),
        ($2,$3,'Agent source reviewer','Admin',true)`,
      [USER, REVIEWER, ORG],
    );
    await db.query(`insert into projects(id,organization_id,name,code,status) values ($1,$2,'Agent source prepare','ASP','initialized')`, [PROJECT, ORG]);
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values
      ('agent-source-admin-role',$1,$2,null,'admin'),
      ('agent-source-reviewer-role',$3,$2,$4,'software-committer')`, [USER, ORG, REVIEWER, PROJECT]);
    const full = validCatalogReleaseBundle();
    const first = structuredClone(full.releases[0]!);
    const bundle = {
      schemaVersion: full.schemaVersion,
      targetReleaseId: first.manifest.release.id,
      releases: [first],
    };
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    const installed = await installPublishedRelease(getRootPostgresPool(db)!, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.value.aggregateDigest,
    });
    if (!installed.ok) throw new Error(JSON.stringify(installed.error));
    await db.query(
      `insert into attribution_subjects(id,organization_id,subject_kind,display_name,source_key)
       values ($1,$2,'driver-registration','Acme power','compatible:acme,power')`,
      [ATTR, ORG],
    );
    await db.query(
      `insert into driver_registrations(attribution_subject_id,driver_nature,instance_cardinality)
       values ($1,'physical-device','multiple')`,
      [ATTR],
    );
    await db.query(
      `insert into parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id)
       values ($1,$2,'Driver',$1,1,'driver-group','curated',$3)`,
      [MODULE, ORG, ATTR],
    );
    const releasePin = { id: first.manifest.release.id, digest: first.manifest.release.digest };
    const registrationCommand: RegisterSubjectCommand = {
      kind: "register",
      organizationId: ORG,
      subjectId: CatalogSubjectId(DRIVER_SUBJECT),
      subjectKind: "driver",
      expectedRelease: releasePin,
      placement: { mode: "use-default" },
      destinationModuleId: MODULE,
      method: "explicit",
      proof: { reason: "approved Agent source prepare" },
      idempotencyKey: `agent-source-registration:${randomUUID()}`,
      context: { actorKind: "org-admin", principalId: USER },
    };
    await db.transaction(async (tx) => {
      await tx.query("set constraints all deferred");
      const result = await writeGuardedRegistration(tx, registrationCommand);
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      await tx.query("set constraints all immediate");
      return result.value;
    });
    snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published fixture is unavailable");

    const dtsSet = await createConfigSet(db, auth, { projectId: PROJECT, name: "Agent DTS source" });
    const dtsFile = await uploadProjectParameterFile(db, storage, auth, {
      projectId: PROJECT,
      fileName: "charger.dts",
      bytes: Buffer.from(DTS),
    });
    await addConfigSetFile(db, auth, { configSetId: dtsSet.id, fileId: dtsFile.file.id, role: "base", sortOrder: 0 });
    const dtsManifest: ConfigRevisionManifest = {
      organizationId: ORG,
      projectId: PROJECT,
      configSetId: dtsSet.id,
      entryFile: "charger.dts",
      includeSearchPaths: ["."],
      overlayOrder: [],
      members: [{ fileId: dtsFile.file.id, fileVersionId: dtsFile.version.id, fileName: "charger.dts", role: "base", sortOrder: 0, content: DTS }],
    };
    const dtsRevision = await ingestConfigRevision(db, dtsManifest, auth);
    await syncPublishedCatalogProjectValues(getRootPostgresPool(db)!, {
      organizationId: ORG,
      projectId: PROJECT,
      configSetId: dtsSet.id,
      configRevisionId: dtsRevision.id,
    });
    dtsBinding = (await listCatalogBindingRowsForProject(db, auth, { projectId: PROJECT, revisionId: dtsRevision.id }))[0]!;
    if (!dtsBinding) {
      throw new Error("DTS binding fixture is unavailable");
    }
  }, 120_000);

  beforeAll(async () => {
    jsonDatabase = await createEphemeralTestDatabase("agent-json-source-prepare");
    jsonDb = createPostgresDatabase(jsonDatabase.url);
    jsonRefusalSink = createTrustedRefusalAuditSink(jsonDb);
    jsonStorageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-agent-json-source-prepare-"));
    jsonStorage = createLocalObjectStore(jsonStorageDirectory);
    await jsonDb.query(`insert into organizations(id,name) values ($1,'Agent JSON source prepare')`, [ORG]);
    await jsonDb.query(
      `insert into users(id,organization_id,name,title,is_active) values
        ($1,$3,'Agent source author','Admin',true),
        ($2,$3,'Agent source reviewer','Admin',true)`,
      [USER, REVIEWER, ORG],
    );
    await jsonDb.query(`insert into projects(id,organization_id,name,code,status) values ($1,$2,'Agent JSON source prepare','AJP','initialized')`, [PROJECT, ORG]);
    await jsonDb.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values
      ('agent-json-admin-role',$1,$2,null,'admin'),
      ('agent-json-reviewer-role',$3,$2,$4,'software-committer')`, [USER, ORG, REVIEWER, PROJECT]);
    await installConfigurationSourceFixture(jsonDb, auth, { subjectId: `csub_agent_json_source_prepare`, schemaId: SCHEMA });
    jsonSnapshot = await loadPublishedCatalog(getRootPostgresPool(jsonDb)!);
    if (!jsonSnapshot) throw new Error("Published JSON fixture is unavailable");
    const jsonSet = await createConfigSet(jsonDb, auth, { projectId: PROJECT, name: "Agent JSON source" });
    const jsonFile = await uploadProjectParameterFile(jsonDb, jsonStorage, auth, {
      projectId: PROJECT,
      fileName: "settings.json",
      bytes: Buffer.from(JSON_SOURCE),
    });
    await addConfigSetFile(jsonDb, auth, { configSetId: jsonSet.id, fileId: jsonFile.file.id, role: "base", sortOrder: 0 });
    const registered = await jsonDb.transaction((tx) => registerCanonicalJsonSource(tx, jsonStorage, auth, jsonSnapshot!, {
      projectId: PROJECT,
      configSetId: jsonSet.id,
      fileId: jsonFile.file.id,
      fileVersionId: jsonFile.version.id,
      configurationSchemaId: SCHEMA,
      rootPointer: "",
      mappings: [{ definitionId: DEFINITION, pointer: "/limit" }],
      invocation: createUserInvocation(auth),
      requestId: "agent-source-json-register",
      refusalSink: jsonRefusalSink,
    }));
    jsonBinding = (await listCatalogBindingRowsForProject(jsonDb, auth, { projectId: PROJECT })).find(
      (binding) => registered.bindings.some((candidate) => candidate.id === binding.id),
    )!;
    if (!jsonBinding) throw new Error("JSON binding fixture is unavailable");
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
    await jsonDb?.close();
    await jsonDatabase?.drop();
    if (jsonStorageDirectory) await rm(jsonStorageDirectory, { recursive: true, force: true });
  });

  it("prepares an approved DTS Agent target while preserving Agent provenance", async () => {
    const before = (await db.query<{ current_value_id: string }>(
      `select current_value_id from parameter_catalog.current_project_parameter_bindings where id=$1`,
      [dtsBinding.id],
    )).rows[0]?.current_value_id;
    const dtsAgent = await seedApprovedAgent(db, dtsBinding, { format: "dts", sourceText: "<2000>" });
    const dtsPrepared = await db.transaction((tx) => preparePinnedSourceChange(tx, storage, auth, {
      projectId: PROJECT,
      bindingId: dtsBinding.id,
      expectedValueId: dtsBinding.currentValueId,
      target: { format: "dts", sourceText: "<2000>" },
      invocation: dtsAgent.invocation,
      requestId: "agent-source-dts-prepare",
      refusalSink,
    }));
    expect(dtsPrepared.diff.after).toBe(DTS.replace("<1000>", "<2000>"));
    expect((await db.query(`select initiator_type,initiator_session_id,initiator_tool_call_id,initiator_approval_id from project_parameter_file_candidates where id=$1`, [dtsPrepared.candidateId])).rows[0]).toMatchObject({
      initiator_type: "agent",
      initiator_session_id: dtsAgent.invocation.sessionId,
      initiator_tool_call_id: dtsAgent.invocation.toolCallId,
      initiator_approval_id: dtsAgent.invocation.approvalId,
    });
    expect((await db.query<{ current_value_id: string }>(
      `select current_value_id from parameter_catalog.current_project_parameter_bindings where id=$1`,
      [dtsBinding.id],
    )).rows[0]?.current_value_id).toBe(before);
  });

  it("prepares an approved JSON Agent target while preserving Agent provenance", async () => {
    const before = (await jsonDb.query<{ current_value_id: string }>(
      `select current_value_id from parameter_catalog.current_project_parameter_bindings where id=$1`,
      [jsonBinding.id],
    )).rows[0]?.current_value_id;
    const jsonAgent = await seedApprovedAgent(jsonDb, jsonBinding, { format: "json", sourceText: "85.25" });
    const jsonPrepared = await jsonDb.transaction((tx) => preparePinnedSourceChange(tx, jsonStorage, auth, {
      projectId: PROJECT,
      bindingId: jsonBinding.id,
      expectedValueId: jsonBinding.currentValueId,
      target: { format: "json", sourceText: "85.25" },
      invocation: jsonAgent.invocation,
      requestId: "agent-source-json-prepare",
      refusalSink: jsonRefusalSink,
    }));
    expect(jsonPrepared.diff.after).toBe(JSON_SOURCE.replace("36.5", "85.25"));
    expect((await jsonDb.query(`select initiator_type from project_parameter_file_candidates where id=$1`, [jsonPrepared.candidateId])).rows[0]?.initiator_type).toBe("agent");
    expect((await jsonDb.query<{ current_value_id: string }>(
      `select current_value_id from parameter_catalog.current_project_parameter_bindings where id=$1`,
      [jsonBinding.id],
    )).rows[0]?.current_value_id).toBe(before);
  });

  it("refuses missing or mismatched durable approval, deletion, tenant, and base proofs without candidates", async () => {
    const agent = await seedApprovedAgent(db, dtsBinding, { format: "dts", sourceText: "<3000>" });
    const before = (await db.query<{ count: number }>(`select count(*)::int as count from project_parameter_file_candidates where project_id=$1`, [PROJECT])).rows[0]!.count;
    const attempts = [
      { invocation: createAgentInvocation(auth, { sessionId: agent.invocation.sessionId, toolCallId: agent.invocation.toolCallId, approval: { required: true, approvalId: "missing-approval" } }), projectId: PROJECT, expectedValueId: dtsBinding.currentValueId, target: { format: "dts" as const, sourceText: "<3000>" } },
      { invocation: agent.invocation, projectId: PROJECT, expectedValueId: dtsBinding.currentValueId, target: { format: "dts" as const, sourceText: "<3001>" } },
      { invocation: agent.invocation, projectId: PROJECT, expectedValueId: "wrong-base", target: { format: "dts" as const, sourceText: "<3000>" } },
      { invocation: agent.invocation, projectId: "foreign-project", expectedValueId: dtsBinding.currentValueId, target: { format: "dts" as const, sourceText: "<3000>" } },
    ];
    for (const [index, attempt] of attempts.entries()) {
      await expect(db.transaction((tx) => preparePinnedSourceChange(tx, storage, auth, {
        ...attempt,
        bindingId: dtsBinding.id,
        requestId: `agent-source-negative-${index}`,
        refusalSink,
      }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(db.transaction((tx) => preparePinnedSourceChange(tx, storage, auth, {
      projectId: PROJECT,
      bindingId: dtsBinding.id,
      expectedValueId: dtsBinding.currentValueId,
      target: { format: "dts", sourceText: "<3000>" },
      invocation: agent.invocation,
      requestId: " ",
      refusalSink,
    }))).rejects.toMatchObject({ code: "INVALID_TRUSTED_INVOCATION_CONTEXT" });
    await expect(db.transaction((tx) => preparePinnedSourceChange(tx, storage, auth, {
      projectId: PROJECT,
      bindingId: dtsBinding.id,
      expectedValueId: dtsBinding.currentValueId,
      target: { format: "dts", sourceText: "<3000>" },
      invocation: agent.invocation,
      requestId: "agent-source-negative-bad-sink",
      refusalSink: {} as never,
    }))).rejects.toMatchObject({ code: "INVALID_TRUSTED_INVOCATION_CONTEXT" });
    await expect(db.transaction((tx) => preparePinnedSourceChange(tx, storage, auth, {
      projectId: PROJECT,
      bindingId: dtsBinding.id,
      expectedValueId: dtsBinding.currentValueId,
      target: { format: "dts", sourceText: "<3000>" },
      action: "delete",
      invocation: agent.invocation,
      requestId: "agent-source-negative-delete",
      refusalSink,
    }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.query<{ count: number }>(`select count(*)::int as count from project_parameter_file_candidates where project_id=$1`, [PROJECT])).rows[0]!.count).toBe(before);
  });

  it("keeps critical Agent writes and source commit user-only while User prepare remains valid", async () => {
    const source = await loadCanonicalSourceSnapshot(db, storage, {
      organizationId: ORG,
      projectId: PROJECT,
      bindingId: dtsBinding.id,
      projectValueId: dtsBinding.currentValueId,
    });
    const property = await loadPinnedDtsProperty(db, source.manifest);
    await db.query(
      `insert into dts_sensitive_node_rules(id,organization_id,project_id,match_type,pattern,risk_tier,required_capability,enabled)
       values ($1,$2,$3,'path',$4,'critical','parameter:edit-critical',true)`,
      [`agent-source-critical-${randomUUID()}`, ORG, PROJECT, property.node_locator],
    );
    const agent = await seedApprovedAgent(db, dtsBinding, { format: "dts", sourceText: "<4000>" });
    const before = (await db.query<{ count: number; current_value_id: string }>(
      `select (select count(*)::int from project_parameter_file_candidates where project_id=$1) as count,
              (select current_value_id from parameter_catalog.current_project_parameter_bindings where id=$2) as current_value_id`,
      [PROJECT, dtsBinding.id],
    )).rows[0]!;
    await expect(db.transaction((tx) => preparePinnedSourceChange(tx, storage, auth, {
      projectId: PROJECT,
      bindingId: dtsBinding.id,
      expectedValueId: dtsBinding.currentValueId,
      target: { format: "dts", sourceText: "<4000>" },
      invocation: agent.invocation,
      requestId: "agent-source-critical",
      refusalSink,
    }))).rejects.toMatchObject({ code: "FORBIDDEN", details: { initiator: "agent", requireHuman: true } });
    const capableUserAuth = makeTestAuthContext({
      userId: USER,
      organizationId: ORG,
      permissions: ["parameter:view", "parameter:edit", "parameter:edit-critical", "parameter:review", "admin:access"],
    });
    const userPrepared = await db.transaction((tx) => preparePinnedSourceChange(tx, storage, capableUserAuth, {
      projectId: PROJECT,
      bindingId: dtsBinding.id,
      expectedValueId: dtsBinding.currentValueId,
      target: { format: "dts", sourceText: "<4100>" },
      invocation: createUserInvocation(capableUserAuth),
      requestId: "user-source-critical",
      refusalSink,
    }));
    expect(userPrepared.diff.after).toBe(DTS.replace("<1000>", "<4100>"));
    expect((await db.query<{ count: number; current_value_id: string }>(
      `select (select count(*)::int from project_parameter_file_candidates where project_id=$1) as count,
              (select current_value_id from parameter_catalog.current_project_parameter_bindings where id=$2) as current_value_id`,
      [PROJECT, dtsBinding.id],
    )).rows[0]).toMatchObject({ count: before.count + 1, current_value_id: before.current_value_id });

    await expect(db.transaction((tx) => commitCanonicalSourceRevision(tx, storage, auth, snapshot!, {
      projectId: PROJECT,
      requestId: "agent-source-no-commit",
      invocation: agent.invocation,
      traceId: "agent-source-no-commit",
      refusalSink,
    }))).rejects.toMatchObject({ code: "FORBIDDEN", details: { initiator: "agent" } });
  });

  it("refuses System preparation through the existing human-required audit path", async () => {
    const before = (await db.query<{ count: number }>(`select count(*)::int as count from project_parameter_file_candidates where project_id=$1`, [PROJECT])).rows[0]!.count;
    await expect(db.transaction((tx) => preparePinnedSourceChange(tx, storage, auth, {
      projectId: PROJECT,
      bindingId: dtsBinding.id,
      expectedValueId: dtsBinding.currentValueId,
      target: { format: "dts", sourceText: "<5000>" },
      invocation: createSystemInvocation({ kind: "job", name: "approved-source-test" }),
      requestId: "system-source-prepare",
      refusalSink,
    }))).rejects.toMatchObject({ code: "FORBIDDEN", details: { initiator: "system", requireHuman: true } });
    expect((await db.query<{ count: number }>(`select count(*)::int as count from project_parameter_file_candidates where project_id=$1`, [PROJECT])).rows[0]!.count).toBe(before);
  });
});
