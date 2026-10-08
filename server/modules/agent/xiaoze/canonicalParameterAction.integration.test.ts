import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { EventType } from "@ag-ui/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../../../shared/http/errors";
import {
  createPostgresDatabase,
  getRootPostgresPool,
  type Database,
  type RootDatabase,
} from "../../../shared/database/client";
import type { AuthContext } from "../../auth/types";
import {
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "../../../testing/parameterCatalog";
import { createTrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import { resolveParameterIdentityMode, setParameterIdentityMode } from "../../parameter-kernel/parameterIdentityMode";
import { createAgentOrchestrator } from "../orchestrator";
import {
  getAgentApproval,
  getAgentSession,
  getAgentToolCall,
  listAgentApprovals,
  listAgentToolCalls,
} from "../repository";
import { createAgentToolRegistry } from "../toolRegistry";
import {
  createUserInvocation,
  createAgentInvocation,
} from "../../auth/trustedInvocation";
import {
  listCanonicalValueChangesForAuth,
  createCanonicalValueDraft,
  loadCanonicalBindingPins,
  removeCanonicalValueDraft,
  reviewCanonicalValueChange,
  withdrawCanonicalValueChange,
  submitCanonicalValueChange,
} from "../../parameter-bindings/drafts";
import { loadPublishedCatalog } from "../../parameter-bindings/catalogProjectValueSync";
import { stabilizeCanonicalBinding } from "../../parameter-bindings/binding";
import { loadCanonicalSourceSnapshot } from "../../parameter-files/canonicalSource";
import { compileOrThrow, firstReleaseBundle } from "../../catalog-kernel/runtime/catalogChain.fixture";
import { refreshAuthoritativeSource } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { DefinitionRevisionId } from "../../parameter-catalog-contract";
import { parseDtsValue } from "../../dts/valueAst";
import type { AgentToolResult } from "../types";
import { appendSourceCommittedValue } from "../../parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import {
  createLocalObjectStore,
  type ObjectStore,
} from "../../logs/objectStore";
import {
  closeSharedPostgresCheckpointerSaversForTests,
  createPostgresCheckpointerSaver,
  resetSharedPostgresCheckpointerSaverForTests,
  setupXiaozeCheckpointerTables,
  waitForInterruptCheckpointDurable,
  type PostgresCheckpointerHandle,
} from "./durableCheckpointer";
import { createXiaozeCheckpointer } from "./checkpointer";
import {
  createXiaozeAgUiHandler,
  createXiaozeAgentFactory,
} from "./agUiEndpoint";
import { fakeModelSequence, toolCall } from "./testing/fakeModel";
import {
  seedCanonicalParameterFixture,
  type CanonicalParameterFixture,
} from "../testing/canonicalParameterFixture";

const databaseAvailable = Boolean(
  (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL)?.trim(),
);

type XiaozeInstance = {
  readonly db: RootDatabase;
  readonly saver: PostgresCheckpointerHandle["saver"];
  readonly handler: ReturnType<typeof createXiaozeAgUiHandler>;
};

type SseEvent = { event: string; data: unknown };

type ParameterActionInterceptor = (
  db: Database,
  run: () => Promise<AgentToolResult>,
) => Promise<AgentToolResult>;

function testEnv(connectionString: string) {
  return {
    XIAOZE_CHECKPOINTER: "postgres" as const,
    DATABASE_URL: connectionString,
    XIAOZE_REASONING_FALLBACK_HEURISTIC: false,
    XIAOZE_LLM_CONFIG: {
      source: "canonical" as const,
      config: { model: "issue-905-deterministic" },
      diagnostics: [],
    },
  };
}

async function collectSse(
  response: Awaited<ReturnType<ReturnType<typeof createXiaozeAgUiHandler>>>,
) {
  if (!("sse" in response)) throw new Error("Expected an AG-UI SSE response.");
  const events: SseEvent[] = [];
  for await (const event of response.sse as AsyncIterable<SseEvent>)
    events.push(event);
  return events;
}

async function createInstance(input: {
  db: RootDatabase;
  connectionString: string;
  auth: AuthContext;
  objectStore: ObjectStore;
  model: ReturnType<typeof fakeModelSequence>;
  parameterAction?: ParameterActionInterceptor;
}): Promise<XiaozeInstance> {
  const saverHandle = createPostgresCheckpointerSaver({
    connectionString: input.connectionString,
  });
  await saverHandle.ensureSetup();
  const checkpointer = createXiaozeCheckpointer({
    mode: "postgres",
    connectionString: input.connectionString,
    saver: saverHandle.saver,
    withNamespaceLease: saverHandle.withNamespaceLease,
    ensureReady: saverHandle.ensureSetup,
  });
  const toolRegistry = createAgentToolRegistry({
    db: input.db,
    objectStore: input.objectStore,
  });
  if (input.parameterAction) {
    const forDatabase = toolRegistry.forDatabase!;
    toolRegistry.forDatabase = (db, objectStore) => {
      const registry = forDatabase(db, objectStore);
      return {
        ...registry,
        run: (name, context, payload, authorization) =>
          name === "action.submitParameterChange"
            ? input.parameterAction!(db, () => registry.run(name, context, payload, authorization))
            : registry.run(name, context, payload, authorization),
      };
    };
  }
  const orchestrator = createAgentOrchestrator({ db: input.db, toolRegistry });
  const factory = createXiaozeAgentFactory({
    db: input.db,
    env: testEnv(input.connectionString),
    modelFactory: () => input.model,
    checkpointer,
    toolRegistry,
    orchestrator,
    objectStore: input.objectStore,
  });
  const handler = createXiaozeAgUiHandler({
    resolveAuth: async () => input.auth,
    createAgent: factory,
    approvalChain: orchestrator,
    assertThreadAccess: async ({ auth, threadId }) => {
      const session = await getAgentSession(
        input.db,
        auth.organization.id,
        threadId,
      );
      if (session && session.actorUserId !== auth.user.id) {
        throw new ApiError(
          "FORBIDDEN",
          "This Xiaoze thread belongs to another user.",
          { threadId },
        );
      }
    },
  });
  return { db: input.db, saver: saverHandle.saver, handler };
}

async function closeInstance(instance: XiaozeInstance, closeDatabase: boolean) {
  await instance.saver.end();
  if (closeDatabase) await instance.db.close();
}

async function post(
  handler: ReturnType<typeof createXiaozeAgUiHandler>,
  input: {
    threadId: string;
    requestId: string;
    projectId?: string;
    message?: string;
    approvalId?: string;
    decision?: "approve" | "reject";
    editedArgs?: Record<string, unknown>;
  },
) {
  const body: Record<string, unknown> = input.approvalId
    ? {
        threadId: input.threadId,
        runId: `run-${input.requestId}`,
        messages: [],
        resume: [
          {
            interruptId: input.approvalId,
            status: "resolved",
            payload: {
              approvalId: input.approvalId,
              decision: input.decision ?? "approve",
              ...(input.editedArgs ? { editedArgs: input.editedArgs } : {}),
            },
          },
        ],
      }
    : {
        threadId: input.threadId,
        runId: `run-${input.requestId}`,
        messages: [
          {
            id: `message-${input.requestId}`,
            role: "user",
            content: input.message ?? "Set the canonical parameter.",
          },
        ],
        context: [
          {
            description: "wiseeff.page",
            value: {
              pageKey: "parameters",
              projectId: input.projectId,
              path: "/parameters",
            },
          },
        ],
      };
  const response = await handler({
    headers: { authorization: "Bearer issue-905-test" },
    body,
    requestId: input.requestId,
  });
  return collectSse(response);
}

async function startAction(input: {
  root: RootDatabase;
  connectionString: string;
  objectStore: ObjectStore;
  auth: AuthContext;
  projectId: string;
  parameterId: string;
  targetValue: string;
  reason?: string;
}) {
  const threadId = `issue-905-${randomUUID()}`;
  const instance = await createInstance({
    db: input.root,
    connectionString: input.connectionString,
    auth: input.auth,
    objectStore: input.objectStore,
    model: fakeModelSequence([
      {
        toolCalls: [
          toolCall("action.submitParameterChange", {
            projectId: input.projectId,
            parameterId: input.parameterId,
            targetValue: input.targetValue,
            reason: input.reason ?? "Issue 905 canonical acceptance",
          }),
        ],
      },
    ]),
  });
  try {
    const events = await post(instance.handler, {
      threadId,
      requestId: `request-${threadId}`,
      projectId: input.projectId,
      message: "Please prepare this canonical parameter change.",
    });
    const calls = await listAgentToolCalls(
      input.root,
      input.auth.organization.id,
      threadId,
    );
    const approvals = await listAgentApprovals(
      input.root,
      input.auth.organization.id,
      threadId,
    );
    const call = calls[0];
    const approval = approvals[0];
    if (!call || !approval) {
      throw new Error(
        `Expected a durable Agent approval: ${JSON.stringify({ events, calls, approvals })}`,
      );
    }
    await waitForInterruptCheckpointDurable({
      threadId: `${input.auth.organization.id}:${input.auth.user.id}:${threadId}`,
      saver: instance.saver,
      connectionString: input.connectionString,
      timeoutMs: 10_000,
    });
    return {
      events,
      threadId,
      toolCallId: call.id,
      approvalId: approval.id,
      call,
      approval,
    };
  } finally {
    await closeInstance(instance, false);
  }
}

async function resumeAction(input: {
  root: RootDatabase;
  connectionString: string;
  objectStore: ObjectStore;
  auth: AuthContext;
  threadId: string;
  approvalId: string;
  decision?: "approve" | "reject";
  editedArgs?: Record<string, unknown>;
  parameterAction?: ParameterActionInterceptor;
}) {
  const resumedRoot = createPostgresDatabase(input.connectionString);
  const instance = await createInstance({
    db: resumedRoot,
    connectionString: input.connectionString,
    auth: input.auth,
    objectStore: input.objectStore,
    parameterAction: input.parameterAction,
    model: fakeModelSequence([
      { content: "The canonical request has been recorded." },
    ]),
  });
  try {
    return await post(instance.handler, {
      threadId: input.threadId,
      requestId: `resume-${input.threadId}`,
      approvalId: input.approvalId,
      decision: input.decision,
      editedArgs: input.editedArgs,
    });
  } finally {
    await closeInstance(instance, true);
  }
}

async function canonicalState(
  root: RootDatabase,
  fixture: CanonicalParameterFixture,
) {
  const pool = getRootPostgresPool(root);
  if (!pool) throw new Error("Issue 905 requires the root PostgreSQL pool.");
  const binding = await pool.query<{
    current_value_id: string;
    effective_revision_id: string;
    catalog_release_id: string;
  }>(
    `select current_value_id,effective_revision_id,catalog_release_id
       from parameter_catalog.project_parameter_bindings
      where organization_id=$1 and project_id=$2 and id=$3`,
    [fixture.organizationId, fixture.projectId, fixture.bindingId],
  );
  const current = await pool.query<{
    value: unknown;
    source_ref: string;
    config_revision_id: string;
  }>(
    `select value,source_ref,config_revision_id
       from parameter_catalog.project_parameter_values
      where id=$1`,
    [binding.rows[0]?.current_value_id],
  );
  const drafts = await pool.query<{
    id: string;
    base_current_value_id: string;
    target_value: unknown;
  }>(
    `select id,base_current_value_id,target_value
       from project_parameter_value_drafts
      where organization_id=$1 and project_id=$2
      order by created_at,id`,
    [fixture.organizationId, fixture.projectId],
  );
  const requests = await pool.query<{
    id: string;
    status: string;
    target_value: unknown;
    base_current_value_id: string;
    submitter_user_id: string | null;
    reason: string;
  }>(
    `select id,status,target_value,base_current_value_id,submitter_user_id,reason
       from project_parameter_value_change_requests
      where organization_id=$1 and project_id=$2
      order by created_at,id`,
    [fixture.organizationId, fixture.projectId],
  );
  const history = await pool.query<{ count: number }>(
    `select count(*)::int as count
       from parameter_catalog.binding_history_events
      where binding_id=$1`,
    [fixture.bindingId],
  );
  const candidates = await pool.query<{ count: number; ids: string[] }>(
    `select count(*)::int as count, coalesce(array_agg(id order by id), '{}') as ids
       from project_parameter_file_candidates
      where organization_id=$1 and project_id=$2`,
    [fixture.organizationId, fixture.projectId],
  );
  const file = await pool.query<{ storage_key: string; checksum: string }>(
    `select version.storage_key,version.checksum
       from project_parameter_files file
       join project_parameter_file_versions version on version.id=file.current_version_id
      where file.organization_id=$1 and file.project_id=$2
      order by file.id
      limit 1`,
    [fixture.organizationId, fixture.projectId],
  );
  return {
    binding: binding.rows[0],
    current: current.rows[0],
    drafts: drafts.rows,
    requests: requests.rows,
    historyCount: history.rows[0]?.count ?? 0,
    candidateCount: candidates.rows[0]?.count ?? 0,
    candidateIds: candidates.rows[0]?.ids ?? [],
    file: file.rows[0],
  };
}

async function oldSemanticCounts(root: RootDatabase, organizationId: string) {
  const pool = getRootPostgresPool(root);
  if (!pool) throw new Error("Issue 905 requires the root PostgreSQL pool.");
  const result = await pool.query<{
    parameter_drafts: number;
    parameter_submission_rounds: number;
    parameter_submission_items: number;
    parameter_change_requests: number;
    parameter_specs: number;
    dts_property_specs: number;
  }>(
    `select
       (select count(*)::int from parameter_drafts where organization_id=$1) as parameter_drafts,
       (select count(*)::int from parameter_submission_rounds where organization_id=$1) as parameter_submission_rounds,
       (select count(*)::int from parameter_submission_items where organization_id=$1) as parameter_submission_items,
       (select count(*)::int from parameter_change_requests where organization_id=$1) as parameter_change_requests,
       (select count(*)::int from parameter_specs where organization_id=$1) as parameter_specs,
       (select count(*)::int from dts_property_specs) as dts_property_specs`,
    [organizationId],
  );
  return result.rows[0]!;
}

async function sourceBytes(
  root: RootDatabase,
  objectStore: ObjectStore,
  fixture: CanonicalParameterFixture,
) {
  const state = await canonicalState(root, fixture);
  if (!state.file)
    throw new Error("Issue 905 source-backed fixture has no current file.");
  return objectStore.get(state.file.storage_key);
}

async function setupParameterActionFixture(
  sourceFormat: "dts" | "json",
  objectStoreWriteKeys: Set<string>,
) {
  const configuredUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  const postgres = configuredUrl ? new URL(configuredUrl) : null;
  const localLane = postgres?.port === "55438";
  const ciBackend = process.env.GITHUB_ACTIONS === "true" &&
    postgres?.hostname === "127.0.0.1" && postgres.port === "5432" &&
    postgres.pathname === "/wiseeff_l1_server";
  if (!localLane && !ciBackend) {
    throw new Error(
      "Issue 905 acceptance requires lane905 or the isolated CI backend PostgreSQL service.",
    );
  }
  resetSharedPostgresCheckpointerSaverForTests();
  const database = await createDisposableParameterCatalogDatabase("905agent");
  const root = createPostgresDatabase(database.url);
  const catalogLease = await getRootPostgresPool(root)!.connect();
  await setupXiaozeCheckpointerTables({ mode: "postgres", connectionString: database.url });
  const storageRoot = await mkdtemp(`${tmpdir()}/wiseeff-905-agent-`);
  const localObjectStore = createLocalObjectStore(storageRoot);
  const objectStore: ObjectStore = {
    ...localObjectStore,
    put: async (input) => {
      const stored = await localObjectStore.put(input);
      objectStoreWriteKeys.add(stored.storageKey);
      return stored;
    },
  };
  const fixture = await seedCanonicalParameterFixture(root, objectStore, { sourceFormat });
  objectStoreWriteKeys.clear();
  await root.query(`insert into parameter_identity_migration_runs (
      id, mode, status, report, db_snapshot_id, object_snapshot_id, write_lock_confirmed, completed_at
    ) values ('migration-905-agent-post-cutover', 'apply', 'completed', '{}'::jsonb,
      'issue-905-agent-fixture', 'issue-905-agent-fixture', true, now())`);
  await root.query(`insert into parameter_identity_cutovers (id, migration_run_id)
    values ('cutover-905-agent-post-cutover', 'migration-905-agent-post-cutover')`);
  return { database, root, catalogLease, storageRoot, objectStore, fixture };
}

async function driftDefinitionRevision(root: RootDatabase, fixture: CanonicalParameterFixture) {
  const pool = getRootPostgresPool(root)!;
  const current = await loadPublishedCatalog(pool);
  if (!current) throw new Error("Issue 905 published snapshot is unavailable.");
  const bundle = firstReleaseBundle();
  const first = structuredClone(bundle.releases[0]!) as Parameters<typeof refreshAuthoritativeSource>[0];
  if (fixture.sourceFormat === "json") {
    for (const document of first.documents) {
      if (document.kind === "subject") {
        document.content = {
          id: fixture.subjectId, kind: "configuration-schema", canonicalKey: "wiseeff.issue905.parameters",
          lifecycle: "active", selector: {
            kind: "configuration-schema-id", value: "wiseeff.issue905.parameters", provenance: { source: "issue-849" },
          }, subtype: {}, tombstone: null,
        };
      } else if (document.kind === "alias") {
        document.content.subjectId = fixture.subjectId;
        document.content.selectorKind = "configuration-schema-id";
        document.content.normalizedSelector = "wiseeff.issue905.parameters.v1";
      } else {
        document.content.subjectId = fixture.subjectId;
        document.content.revision.matching.selectorKind = "configuration-schema-id";
        document.content.revision.valueSchema = { type: "number", minimum: 0 };
      }
    }
    refreshAuthoritativeSource(first);
  }
  expect(first.manifest.release.digest).toBe(current.release.digest);
  const next = structuredClone(first);
  next.manifest.release = {
    ...first.manifest.release,
    id: "crel_issue905_definition_drift", version: "1.1.0", sequence: 2,
    publishedAt: "2026-09-02T00:00:00Z",
    predecessor: { id: current.release.id, digest: current.release.digest },
  };
  const definition = next.documents.find((document) => document.kind === "definition" && document.content.id === fixture.definitionId);
  if (!definition || definition.kind !== "definition") throw new Error("Issue 905 Definition fixture is unavailable.");
  definition.content.revision.id = "drev_issue905_definition_drift";
  definition.content.revision.number += 1;
  definition.content.revision.documentation = "Issue 905 approved Definition revision drift.";
  refreshAuthoritativeSource(next);
  const successor = { ...bundle, targetReleaseId: next.manifest.release.id, releases: [first, next] };
  const compiled = compileOrThrow(successor);
  const installed = await installPublishedRelease(pool, {
    mode: "advance", source: jsonCatalogReleaseSource(successor),
    expectedCurrent: current.release, expectedTargetDigest: compiled.aggregateDigest,
  });
  expect(installed.ok).toBe(true);
  const snapshot = await loadPublishedCatalog(pool);
  if (!snapshot) throw new Error("Issue 905 successor snapshot is unavailable.");
  const advanced = await stabilizeCanonicalBinding(pool, {
    snapshot, organizationId: fixture.organizationId, projectId: fixture.projectId,
    logicalNodeId: fixture.binding.logicalNodeId, sourceOccurrenceId: fixture.binding.sourceOccurrenceId,
    registrationId: fixture.binding.registrationId, definitionId: fixture.binding.definitionId,
    effectiveRevisionId: DefinitionRevisionId(definition.content.revision.id),
    expectedEffectiveRevisionId: fixture.binding.effectiveRevisionId,
  });
  expect(advanced).toMatchObject({ ok: true, value: { outcome: "committed", binding: { id: fixture.bindingId } } });
}

describe.skipIf(!databaseAvailable)(
  "Issue 905 canonical Agent parameter action",
  () => {
    let database: ParameterCatalogDatabase;
    let root: RootDatabase;
    let fixture: CanonicalParameterFixture;
    let objectStore: ObjectStore;
    let storageRoot: string;
    const objectStoreWriteKeys = new Set<string>();
    let catalogLease: { release: () => void } | undefined;

    beforeAll(async () => {
      ({ database, root, catalogLease, storageRoot, objectStore, fixture } =
        await setupParameterActionFixture("dts", objectStoreWriteKeys));
    }, 120_000);

    beforeEach(async () => {
      expect(await resolveParameterIdentityMode(root)).toBe("semantic");
    });

    afterAll(async () => {
      setParameterIdentityMode(null);
      await closeSharedPostgresCheckpointerSaversForTests();
      catalogLease?.release();
      await root?.close();
      await database?.close();
      if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
    });

    it("searches the canonical binding, pauses for approval, resumes on a fresh instance, and applies only through User review", async () => {
      const initial = await canonicalState(root, fixture);
      expect(initial.current?.value).toBe(5);
      expect(await oldSemanticCounts(root, fixture.organizationId)).toEqual({
        parameter_drafts: 0,
        parameter_submission_rounds: 0,
        parameter_submission_items: 0,
        parameter_change_requests: 0,
        parameter_specs: 0,
        dts_property_specs: 0,
      });

      const searchThreadId = `issue-905-search-${randomUUID()}`;
      const searchInstance = await createInstance({
        db: root,
        connectionString: database.url,
        auth: fixture.editorAuth,
        objectStore,
        model: fakeModelSequence([
          {
            toolCalls: [
              toolCall("perception.searchParameters", {
                projectId: fixture.projectId,
                query: "iin_max",
              }),
            ],
          },
          { content: "Found the canonical iin_max parameter." },
        ]),
      });
      const searchEvents = await post(searchInstance.handler, {
        threadId: searchThreadId,
        requestId: `search-${searchThreadId}`,
        projectId: fixture.projectId,
        message: "Search for iin_max.",
      });
      await closeInstance(searchInstance, false);
      expect(
        searchEvents.some((event) => event.event === EventType.RUN_ERROR),
      ).toBe(false);
      const searchCall = (
        await listAgentToolCalls(root, fixture.organizationId, searchThreadId)
      )[0];
      expect(searchCall).toMatchObject({
        name: "perception.searchParameters",
        status: "succeeded",
      });
      expect(searchCall?.result?.data).toMatchObject({
        parameters: [
          expect.objectContaining({
            id: fixture.bindingId,
            pin_status: "canonical-pin",
            current_value: "5",
          }),
        ],
      });

      const pending = await startAction({
        root,
        connectionString: database.url,
        objectStore,
        auth: fixture.editorAuth,
        projectId: fixture.projectId,
        parameterId: fixture.bindingId,
        targetValue: "<2100>",
      });
      expect(
        pending.events.some((event) => event.event === EventType.RUN_ERROR),
      ).toBe(false);
      expect(pending.call).toMatchObject({
        name: "action.submitParameterChange",
        status: "pending_approval",
      });
      expect(pending.approval.status).toBe("pending");
      expect(pending.call.payload).toMatchObject({
        projectId: fixture.projectId,
        parameterId: fixture.bindingId,
        approvedParameter: {
          projectId: fixture.projectId,
          bindingId: fixture.bindingId,
          expectedValueId: initial.binding?.current_value_id,
          sourceFormat: "dts",
          target: { format: "dts", sourceText: "<2100>" },
        },
      });
      expect((await canonicalState(root, fixture)).drafts).toHaveLength(0);
      expect((await canonicalState(root, fixture)).requests).toHaveLength(0);
      expect(
        (await canonicalState(root, fixture)).binding?.current_value_id,
      ).toBe(initial.binding?.current_value_id);

      const resumedEvents = await resumeAction({
        root,
        connectionString: database.url,
        objectStore,
        auth: fixture.editorAuth,
        threadId: pending.threadId,
        approvalId: pending.approvalId,
      });
      expect(
        resumedEvents.some((event) => event.event === EventType.RUN_ERROR),
      ).toBe(false);
      let afterSubmit = await canonicalState(root, fixture);
      expect(
        afterSubmit.drafts,
        JSON.stringify({ resumedEvents, afterSubmit }),
      ).toHaveLength(1);
      expect(
        afterSubmit.requests,
        JSON.stringify({ resumedEvents, afterSubmit }),
      ).toHaveLength(1);
      expect(afterSubmit.requests[0]).toMatchObject({
        status: "pending",
        submitter_user_id: fixture.editorAuth.user.id,
      });
      expect(JSON.stringify(afterSubmit.requests[0]?.target_value)).toContain(
        "2100",
      );
      expect(afterSubmit.binding?.current_value_id).toBe(
        initial.binding?.current_value_id,
      );
      expect(
        (await oldSemanticCounts(root, fixture.organizationId))
          .parameter_change_requests,
      ).toBe(0);

      const agentCall = await getAgentToolCall(
        root,
        fixture.organizationId,
        pending.toolCallId,
      );
      const agentApproval = await getAgentApproval(
        root,
        fixture.organizationId,
        pending.approvalId,
      );
      expect(agentCall).toMatchObject({ status: "succeeded" });
      expect(agentApproval).toMatchObject({
        status: "approved",
        decidedByUserId: fixture.editorAuth.user.id,
      });
      const agentAudits = await getRootPostgresPool(root)!.query<{
        actor_type: string;
        actor_user_id: string;
        action: string;
      }>(
        `select actor_type,actor_user_id,action from audit_events
        where organization_id=$1 and kind='agent-tool' and target_id=$2
        order by created_at, id`,
        [fixture.organizationId, pending.toolCallId],
      );
      expect(agentAudits.rows).toEqual(
        expect.arrayContaining([
          {
            actor_type: "agent",
            actor_user_id: fixture.editorAuth.user.id,
            action: "approval-requested",
          },
          {
            actor_type: "agent",
            actor_user_id: fixture.editorAuth.user.id,
            action: "approval-executed",
          },
        ]),
      );

      const requestId = afterSubmit.requests[0]!.id;
      const refusalSink = createTrustedRefusalAuditSink(root);
      const snapshot = await loadPublishedCatalog(getRootPostgresPool(root)!);
      if (!snapshot)
        throw new Error("Issue 905 published snapshot is unavailable.");
      await expect(
        reviewCanonicalValueChange(
          root,
          fixture.editorAuth,
          {
            projectId: fixture.projectId,
            requestId,
            decision: "approve",
          },
          {
            objectStore,
            snapshot,
            invocation: createAgentInvocation(fixture.editorAuth, {
              sessionId: pending.threadId,
              toolCallId: pending.toolCallId,
              approval: { required: true, approvalId: pending.approvalId },
            }),
            traceId: `agent-direct-apply-${randomUUID()}`,
            refusalSink,
          },
        ),
      ).rejects.toThrow();
      const refusal = await getRootPostgresPool(root)!.query<{
        actor_type: string;
        actor_user_id: string;
        action: string;
      }>(
        `select actor_type,actor_user_id,action from audit_events
        where organization_id=$1 and action='deny' and target_id=$2`,
        [fixture.organizationId, requestId],
      );
      expect(refusal.rows).toEqual(
        expect.arrayContaining([
          {
            actor_type: "agent",
            actor_user_id: fixture.editorAuth.user.id,
            action: "deny",
          },
        ]),
      );

      const beforeReview = afterSubmit;
      const reviewed = await reviewCanonicalValueChange(
        root,
        fixture.reviewerAuth,
        {
          projectId: fixture.projectId,
          requestId,
          decision: "approve",
          note: "Issue 905 product review",
        },
        {
          objectStore,
          snapshot,
          invocation: createUserInvocation(fixture.reviewerAuth),
          traceId: `user-review-${randomUUID()}`,
          refusalSink,
        },
      );
      expect(reviewed).toMatchObject({
        id: requestId,
        status: "approved",
        targetValue: "<2100>",
        applyOutcome: "committed",
      });
      afterSubmit = await canonicalState(root, fixture);
      expect(afterSubmit.binding?.current_value_id).not.toBe(
        beforeReview.binding?.current_value_id,
      );
      expect(afterSubmit.current?.value).toBe(2100);
      expect(afterSubmit.historyCount).toBe(beforeReview.historyCount + 1);
      expect(afterSubmit.drafts).toHaveLength(0);
      expect(afterSubmit.requests).toEqual([
        expect.objectContaining({ id: requestId, status: "approved" }),
      ]);
      expect(
        (await sourceBytes(root, objectStore, fixture)).toString("utf8"),
      ).toContain("<2100>");

      const replay = await reviewCanonicalValueChange(
        root,
        fixture.reviewerAuth,
        {
          projectId: fixture.projectId,
          requestId,
          decision: "approve",
        },
        {
          objectStore,
          snapshot,
          invocation: createUserInvocation(fixture.reviewerAuth),
          traceId: `user-review-replay-${randomUUID()}`,
          refusalSink,
        },
      );
      expect(replay).toMatchObject({
        id: requestId,
        status: "approved",
        applyOutcome: "committed",
      });
      const afterReviewReplay = await canonicalState(root, fixture);
      expect(afterReviewReplay.binding?.current_value_id).toBe(
        afterSubmit.binding?.current_value_id,
      );
      expect(afterReviewReplay.historyCount).toBe(afterSubmit.historyCount);

      const repeatedResumeEvents = await resumeAction({
        root,
        connectionString: database.url,
        objectStore,
        auth: fixture.editorAuth,
        threadId: pending.threadId,
        approvalId: pending.approvalId,
      });
      expect(
        repeatedResumeEvents.some(
          (event) => event.event === EventType.RUN_ERROR,
        ),
      ).toBe(false);
      const afterRepeatedResume = await canonicalState(root, fixture);
      expect(afterRepeatedResume.binding?.current_value_id).toBe(
        afterSubmit.binding?.current_value_id,
      );
      expect(afterRepeatedResume.requests).toEqual(afterSubmit.requests);
    });

    it("keeps edited targets pinned, cancels before any canonical write, and leaves legacy semantic tables empty", async () => {
      const before = await canonicalState(root, fixture);
      const edited = await startAction({
        root,
        connectionString: database.url,
        objectStore,
        auth: fixture.editorAuth,
        projectId: fixture.projectId,
        parameterId: fixture.bindingId,
        targetValue: "<2000>",
      });
      const editedEvents = await resumeAction({
        root,
        connectionString: database.url,
        objectStore,
        auth: fixture.editorAuth,
        threadId: edited.threadId,
        approvalId: edited.approvalId,
        editedArgs: {
          projectId: fixture.projectId,
          parameterId: fixture.bindingId,
          targetValue: "<2150>",
          reason: "Issue 905 edited approval target",
        },
      });
      expect(
        editedEvents.some((event) => event.event === EventType.RUN_ERROR),
      ).toBe(false);
      let state = await canonicalState(root, fixture);
      expect(state.binding?.current_value_id).toBe(
        before.binding?.current_value_id,
      );
      expect(
        state.requests.filter((request) => request.status === "pending"),
      ).toHaveLength(1);
      expect(
        JSON.stringify(
          state.requests.find((request) => request.status === "pending")
            ?.target_value,
        ),
      ).toContain("2150");
      expect(state.drafts).toHaveLength(1);

      const refusalSink = createTrustedRefusalAuditSink(root);
      const editedRequest = state.requests.find(
        (request) => request.status === "pending",
      );
      const editedDraft = state.drafts[0];
      if (!editedRequest || !editedDraft)
        throw new Error("Edited approval did not create canonical rows.");
      await withdrawCanonicalValueChange(root, fixture.editorAuth, {
        projectId: fixture.projectId,
        requestId: editedRequest.id,
        note: "Editor cancelled the pending canonical request",
        invocation: createUserInvocation(fixture.editorAuth),
        refusalSink,
        traceId: `withdraw-${randomUUID()}`,
      });
      await removeCanonicalValueDraft(
        root,
        fixture.editorAuth,
        { projectId: fixture.projectId, draftId: editedDraft.id },
        {
          invocation: createUserInvocation(fixture.editorAuth),
          requestId: `remove-${randomUUID()}`,
        },
      );
      state = await canonicalState(root, fixture);
      expect(state.drafts).toHaveLength(0);
      expect(state.requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: editedRequest.id,
            status: "withdrawn",
          }),
        ]),
      );
      expect(state.binding?.current_value_id).toBe(
        before.binding?.current_value_id,
      );

      const canceled = await startAction({
        root,
        connectionString: database.url,
        objectStore,
        auth: fixture.editorAuth,
        projectId: fixture.projectId,
        parameterId: fixture.bindingId,
        targetValue: "<2200>",
      });
      const canceledEvents = await resumeAction({
        root,
        connectionString: database.url,
        objectStore,
        auth: fixture.editorAuth,
        threadId: canceled.threadId,
        approvalId: canceled.approvalId,
        decision: "reject",
      });
      expect(
        canceledEvents.some((event) => event.event === EventType.RUN_ERROR),
      ).toBe(false);
      const canceledCall = await getAgentToolCall(
        root,
        fixture.organizationId,
        canceled.toolCallId,
      );
      const canceledApproval = await getAgentApproval(
        root,
        fixture.organizationId,
        canceled.approvalId,
      );
      expect(canceledCall).toMatchObject({ status: "rejected" });
      expect(canceledApproval).toMatchObject({
        status: "rejected",
        decidedByUserId: fixture.editorAuth.user.id,
      });
      state = await canonicalState(root, fixture);
      expect(state.drafts).toHaveLength(0);
      expect(state.requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: editedRequest.id,
            status: "withdrawn",
          }),
        ]),
      );
      expect(state.binding?.current_value_id).toBe(
        before.binding?.current_value_id,
      );
      expect(
        await listCanonicalValueChangesForAuth(root, fixture.reviewerAuth, {
          projectId: fixture.projectId,
        }),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: editedRequest.id,
            status: "withdrawn",
            targetValue: "<2150>",
          }),
        ]),
      );
      expect(await oldSemanticCounts(root, fixture.organizationId)).toEqual({
        parameter_drafts: 0,
        parameter_submission_rounds: 0,
        parameter_submission_items: 0,
        parameter_change_requests: 0,
        parameter_specs: 0,
        dts_property_specs: 0,
      });
    });

    it("rejects approval when the pinned current value drifts before review", async () => {
      const before = await canonicalState(root, fixture);
      const pending = await startAction({
        root,
        connectionString: database.url,
        objectStore,
        auth: fixture.editorAuth,
        projectId: fixture.projectId,
        parameterId: fixture.bindingId,
        targetValue: "<2300>",
      });
      const submitted = await resumeAction({
        root,
        connectionString: database.url,
        objectStore,
        auth: fixture.editorAuth,
        threadId: pending.threadId,
        approvalId: pending.approvalId,
      });
      expect(
        submitted.some((event) => event.event === EventType.RUN_ERROR),
      ).toBe(false);
      const prepared = await canonicalState(root, fixture);
      expect(
        prepared.requests.filter((request) => request.status === "pending"),
      ).toHaveLength(1);
      const preparedRequest = prepared.requests.find(
        (request) => request.status === "pending",
      );
      const preparedDraft = prepared.drafts[0];
      if (
        !preparedRequest ||
        !preparedDraft ||
        !prepared.binding ||
        !prepared.current
      ) {
        throw new Error("Expected a pending canonical request.");
      }

      const pool = getRootPostgresPool(root)!;
      const snapshot = await loadPublishedCatalog(pool);
      if (!snapshot)
        throw new Error("Issue 905 published snapshot is unavailable.");
      const driftedBinding = {
        ...fixture.binding,
        currentValueId: prepared.binding
          .current_value_id as typeof fixture.binding.currentValueId,
      };
      const drift = await appendSourceCommittedValue(pool, {
        snapshot,
        binding: driftedBinding,
        definitionRevisionId: fixture.binding.effectiveRevisionId,
        source: {
          sourceRef: prepared.current.source_ref,
          configRevisionId: prepared.current.config_revision_id,
        },
        payload: { kind: "number", value: Number(prepared.current.value) },
        expectedTip: prepared.binding
          .current_value_id as typeof fixture.binding.currentValueId,
      });
      expect(drift.ok).toBe(true);
      const drifted = await canonicalState(root, fixture);
      expect(drifted.binding?.current_value_id).not.toBe(
        before.binding?.current_value_id,
      );
      const fixtureRequest = drifted.requests.find(
        (request) =>
          request.status === "pending" && request.id !== preparedRequest.id,
      );
      if (!fixtureRequest) {
        throw new Error(
          "Source drift did not create its pending fixture request.",
        );
      }

      const refusalSink = createTrustedRefusalAuditSink(root);
      await expect(
        reviewCanonicalValueChange(
          root,
          fixture.reviewerAuth,
          {
            projectId: fixture.projectId,
            requestId: preparedRequest.id,
            decision: "approve",
          },
          {
            objectStore,
            snapshot,
            invocation: createUserInvocation(fixture.reviewerAuth),
            traceId: `drift-review-${randomUUID()}`,
            refusalSink,
          },
        ),
      ).rejects.toThrow();
      const afterConflict = await canonicalState(root, fixture);
      expect(afterConflict.binding?.current_value_id).toBe(
        drifted.binding?.current_value_id,
      );
      expect(afterConflict.requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: preparedRequest.id,
            status: "pending",
          }),
        ]),
      );

      await reviewCanonicalValueChange(
        root,
        fixture.reviewerAuth,
        {
          projectId: fixture.projectId,
          requestId: preparedRequest.id,
          decision: "reject",
          note: "The exact canonical current value drifted before review.",
        },
        {
          invocation: createUserInvocation(fixture.reviewerAuth),
          traceId: `drift-reject-${randomUUID()}`,
          refusalSink,
        },
      );
      await removeCanonicalValueDraft(
        root,
        fixture.editorAuth,
        {
          projectId: fixture.projectId,
          draftId: preparedDraft.id,
        },
        {
          invocation: createUserInvocation(fixture.editorAuth),
          requestId: `drift-remove-${randomUUID()}`,
        },
      );
      await reviewCanonicalValueChange(
        root,
        fixture.reviewerAuth,
        {
          projectId: fixture.projectId,
          requestId: fixtureRequest.id,
          decision: "reject",
          note: "Clean up the source drift fixture request.",
        },
        {
          invocation: createUserInvocation(fixture.reviewerAuth),
          traceId: `drift-fixture-reject-${randomUUID()}`,
          refusalSink,
        },
      );
      const cleaned = await canonicalState(root, fixture);
      expect(cleaned.drafts).toHaveLength(0);
      expect(
        cleaned.requests.filter((request) => request.status === "pending"),
      ).toHaveLength(0);
      expect(await oldSemanticCounts(root, fixture.organizationId)).toEqual({
        parameter_drafts: 0,
        parameter_submission_rounds: 0,
        parameter_submission_items: 0,
        parameter_change_requests: 0,
        parameter_specs: 0,
        dts_property_specs: 0,
      });
    });

    it("keeps canonical actions scoped to the project, tenant, and editor role", async () => {
      const before = await canonicalState(root, fixture);
      await expect(
        startAction({
          root,
          connectionString: database.url,
          objectStore,
          auth: fixture.editorAuth,
          projectId: fixture.otherProjectId,
          parameterId: fixture.bindingId,
          targetValue: "<2400>",
        }),
      ).rejects.toThrow();
      await expect(
        startAction({
          root,
          connectionString: database.url,
          objectStore,
          auth: fixture.otherAuth,
          projectId: fixture.projectId,
          parameterId: fixture.bindingId,
          targetValue: "<2400>",
        }),
      ).rejects.toThrow();
      await expect(
        startAction({
          root,
          connectionString: database.url,
          objectStore,
          auth: fixture.guestAuth,
          projectId: fixture.projectId,
          parameterId: fixture.bindingId,
          targetValue: "<2400>",
        }),
      ).rejects.toThrow();
      const after = await canonicalState(root, fixture);
      expect(after.binding?.current_value_id).toBe(
        before.binding?.current_value_id,
      );
      expect(after.drafts).toHaveLength(0);
      expect(
        after.requests.filter((request) => request.status === "pending"),
      ).toHaveLength(0);
      expect(await oldSemanticCounts(root, fixture.organizationId)).toEqual({
        parameter_drafts: 0,
        parameter_submission_rounds: 0,
        parameter_submission_items: 0,
        parameter_change_requests: 0,
        parameter_specs: 0,
        dts_property_specs: 0,
      });
    });

    it("allows an authorized Agent high-risk action to remain pending for User review", async () => {
      const pool = getRootPostgresPool(root)!;
      const ruleId = "rule-issue905-high";
      await pool.query(
        `insert into dts_sensitive_node_rules (
           id, organization_id, project_id, match_type, pattern, risk_tier,
           required_capability, enabled
         ) values ($1,$2,$3,'path','/logical-905-canonical','high',
           'parameter:edit-critical',true)`,
        [ruleId, fixture.organizationId, fixture.projectId],
      );
      const authorizedAgentAuth: AuthContext = {
        ...fixture.editorAuth,
        permissions: [
          ...fixture.editorAuth.permissions,
          "parameter:edit-critical",
        ],
      };
      try {
        const before = await canonicalState(root, fixture);
        const pending = await startAction({
          root,
          connectionString: database.url,
          objectStore,
          auth: authorizedAgentAuth,
          projectId: fixture.projectId,
          parameterId: fixture.bindingId,
          targetValue: "<2400>",
        });
        const resumedEvents = await resumeAction({
          root,
          connectionString: database.url,
          objectStore,
          auth: authorizedAgentAuth,
          threadId: pending.threadId,
          approvalId: pending.approvalId,
        });
        expect(
          resumedEvents.some((event) => event.event === EventType.RUN_ERROR),
        ).toBe(false);
        const submitted = await canonicalState(root, fixture);
        const request = submitted.requests.find(
          (candidate) => candidate.status === "pending",
        );
        if (!request)
          throw new Error("High-risk Agent action created no request.");
        expect(submitted.drafts).toHaveLength(1);
        expect(submitted.binding?.current_value_id).toBe(
          before.binding?.current_value_id,
        );
        const snapshot = await loadPublishedCatalog(pool);
        if (!snapshot)
          throw new Error("Issue 905 published snapshot is unavailable.");
        await reviewCanonicalValueChange(
          root,
          fixture.reviewerAuth,
          {
            projectId: fixture.projectId,
            requestId: request.id,
            decision: "approve",
          },
          {
            objectStore,
            snapshot,
            invocation: createUserInvocation(fixture.reviewerAuth),
            traceId: `high-review-${randomUUID()}`,
            refusalSink: createTrustedRefusalAuditSink(root),
          },
        );
        const reviewed = await canonicalState(root, fixture);
        expect(reviewed.current?.value).toBe(2400);
        expect(reviewed.historyCount).toBe(before.historyCount + 1);
        expect(reviewed.drafts).toHaveLength(0);
      } finally {
        await pool.query("delete from dts_sensitive_node_rules where id=$1", [
          ruleId,
        ]);
      }
    });

    it("refuses a critical canonical Agent action and records the Agent denial", async () => {
      const pool = getRootPostgresPool(root)!;
      const ruleId = "rule-issue905-critical";
      await pool.query(
        `insert into dts_sensitive_node_rules (
           id, organization_id, project_id, match_type, pattern, risk_tier,
           required_capability, enabled
         ) values ($1,$2,$3,'path','/logical-905-canonical','critical',
           'parameter:edit-critical',true)`,
        [ruleId, fixture.organizationId, fixture.projectId],
      );
      try {
        const before = await canonicalState(root, fixture);
        const pending = await startAction({
          root,
          connectionString: database.url,
          objectStore,
          auth: fixture.editorAuth,
          projectId: fixture.projectId,
          parameterId: fixture.bindingId,
          targetValue: "<2450>",
        });
        await resumeAction({
          root,
          connectionString: database.url,
          objectStore,
          auth: fixture.editorAuth,
          threadId: pending.threadId,
          approvalId: pending.approvalId,
        }).catch(() => undefined);
        const call = await getAgentToolCall(
          root,
          fixture.organizationId,
          pending.toolCallId,
        );
        expect(call).toMatchObject({ status: "failed" });
        const after = await canonicalState(root, fixture);
        expect(after.binding?.current_value_id).toBe(
          before.binding?.current_value_id,
        );
        expect(after.drafts).toHaveLength(0);
        expect(
          after.requests.filter((request) => request.status === "pending"),
        ).toHaveLength(0);
        const refusal = await pool.query<{
          actor_type: string;
          actor_user_id: string;
          target_id: string;
          action: string;
        }>(
          `select actor_type,actor_user_id,target_id,action
             from audit_events
            where organization_id=$1
              and kind='parameter-sensitive-node-denied'
              and target_id=$2`,
          [fixture.organizationId, ruleId],
        );
        expect(refusal.rows).toEqual(
          expect.arrayContaining([
            {
              actor_type: "agent",
              actor_user_id: fixture.editorAuth.user.id,
              target_id: ruleId,
              action: "deny",
            },
          ]),
        );
      } finally {
        await pool.query("delete from dts_sensitive_node_rules where id=$1", [
          ruleId,
        ]);
      }
    });

    it("rolls back the canonical draft and submission when approval audit fails", async () => {
      const pool = getRootPostgresPool(root)!;
      const before = await canonicalState(root, fixture);
      objectStoreWriteKeys.clear();
      const pending = await startAction({
        root,
        connectionString: database.url,
        objectStore,
        auth: fixture.editorAuth,
        projectId: fixture.projectId,
        parameterId: fixture.bindingId,
        targetValue: "<2500>",
      });
      await pool.query(`
        create or replace function public.issue905_fail_approval_audit()
        returns trigger
        language plpgsql
        as $$
        begin
          if new.kind = 'agent-tool' and new.action = 'approval-executed' then
            raise exception 'issue905 injected approval audit failure';
          end if;
          return new;
        end;
        $$;
      `);
      await pool.query(`
        create trigger issue905_fail_approval_audit
        before insert on audit_events
        for each row execute function public.issue905_fail_approval_audit()
      `);
      try {
        await resumeAction({
          root,
          connectionString: database.url,
          objectStore,
          auth: fixture.editorAuth,
          threadId: pending.threadId,
          approvalId: pending.approvalId,
        }).catch(() => undefined);
      } finally {
        await pool.query(
          "drop trigger if exists issue905_fail_approval_audit on audit_events",
        );
        await pool.query(
          "drop function if exists public.issue905_fail_approval_audit()",
        );
      }
      const after = await canonicalState(root, fixture);
      expect(after.binding?.current_value_id).toBe(
        before.binding?.current_value_id,
      );
      expect(after.drafts).toEqual(before.drafts);
      expect(after.candidateCount).toBe(before.candidateCount);
      expect(after.requests).toEqual(before.requests);
      expect(objectStoreWriteKeys.size).toBe(1);
      const [attemptKey] = [...objectStoreWriteKeys];
      if (!attemptKey) throw new Error("The rollback path did not write a source attempt object.");
      await expect(objectStore.get(attemptKey)).rejects.toThrow();
      expect(
        (
          await pool.query(
            `select kind,action,target_id from audit_events
             where organization_id=$1 and trace_id=$2`,
            [fixture.organizationId, `resume-${pending.threadId}`],
          )
        ).rows,
      ).toEqual([]);
      expect(
        await getAgentToolCall(
          root,
          fixture.organizationId,
          pending.toolCallId,
        ),
      ).toMatchObject({ status: "pending_approval" });
      expect(
        await getAgentApproval(
          root,
          fixture.organizationId,
          pending.approvalId,
        ),
      ).toMatchObject({ status: "pending" });
      expect(await oldSemanticCounts(root, fixture.organizationId)).toEqual({
        parameter_drafts: 0,
        parameter_submission_rounds: 0,
        parameter_submission_items: 0,
        parameter_change_requests: 0,
        parameter_specs: 0,
        dts_property_specs: 0,
      });
    });
  },
);

describe.skipIf(!databaseAvailable).each(["dts", "json"] as const)(
  "Issue 905 %s drift after human approval, before Agent execution resumes",
  (sourceFormat) => {
    let testFixture: Awaited<ReturnType<typeof setupParameterActionFixture>>;
    const objectStoreWriteKeys = new Set<string>();

    beforeEach(async () => {
      testFixture = await setupParameterActionFixture(sourceFormat, objectStoreWriteKeys);
      expect(await resolveParameterIdentityMode(testFixture.root)).toBe("semantic");
    }, 120_000);

    afterEach(async () => {
      setParameterIdentityMode(null);
      await closeSharedPostgresCheckpointerSaversForTests();
      testFixture?.catalogLease.release();
      await testFixture?.root.close();
      await testFixture?.database.close();
      if (testFixture?.storageRoot) await rm(testFixture.storageRoot, { recursive: true, force: true });
      objectStoreWriteKeys.clear();
    });

    it.each([
      { drift: "current ProjectValue", reason: "stale-base-value" },
      { drift: "DefinitionRevision", reason: "approved-source-pin-mismatch" },
      { drift: "source pin / config revision", reason: "stale-base-revision" },
    ])("refuses $drift drift with $reason and leaves no Agent artifacts", async ({ drift, reason }) => {
      const { root, database, fixture, objectStore } = testFixture;
      const pool = getRootPostgresPool(root)!;
      const before = await canonicalState(root, fixture);
      const originalPins = await loadCanonicalBindingPins(root, {
        organizationId: fixture.organizationId, projectId: fixture.projectId, bindingId: fixture.bindingId,
      });
      expect(originalPins?.sourceFormat).toBe(sourceFormat);
      const pending = await startAction({
        root, connectionString: database.url, objectStore, auth: fixture.editorAuth,
        projectId: fixture.projectId, parameterId: fixture.bindingId,
        targetValue: sourceFormat === "dts" ? "<2300>" : "7",
      });
      expect(pending.approval.status).toBe("pending");
      expect(pending.call.status).toBe("pending_approval");
      expect(await canonicalState(root, fixture)).toEqual(before);
      let drifted: Awaited<ReturnType<typeof canonicalState>> | undefined;
      let refusal: unknown;
      let executions = 0;
      const events = await resumeAction({
        root, connectionString: database.url, objectStore, auth: fixture.editorAuth,
        threadId: pending.threadId, approvalId: pending.approvalId,
        parameterAction: async (tx, run) => {
          executions += 1;
          expect(await getAgentApproval(tx, fixture.organizationId, pending.approvalId)).toMatchObject({
            status: "approved", decidedByUserId: fixture.editorAuth.user.id,
          });
          const snapshot = await loadPublishedCatalog(pool);
          if (!snapshot || !before.current) throw new Error("Issue 905 canonical source is unavailable.");
          const refusalSink = createTrustedRefusalAuditSink(root);
          if (drift === "current ProjectValue") {
            const appended = await appendSourceCommittedValue(pool, {
              snapshot, binding: fixture.binding, definitionRevisionId: fixture.binding.effectiveRevisionId,
              source: { sourceRef: fixture.sourceRef, configRevisionId: fixture.configRevisionId },
              payload: { kind: "number", value: Number(before.current.value) }, expectedTip: fixture.binding.currentValueId,
            });
            expect(appended).toMatchObject({ ok: true, value: { outcome: "committed" } });
            expect((await pool.query<{ format: string }>(
              `select format from project_parameter_file_candidates where organization_id=$1 and project_id=$2`,
              [fixture.organizationId, fixture.projectId],
            )).rows).toEqual([{ format: sourceFormat }]);
            const state = await canonicalState(root, fixture);
            const request = state.requests.find((entry) => entry.status === "pending");
            if (!request) throw new Error("Issue 905 drift fixture request is unavailable.");
            await reviewCanonicalValueChange(root, fixture.reviewerAuth, {
              projectId: fixture.projectId, requestId: request.id, decision: "reject",
              note: "Close the current-value drift fixture request.",
            }, { invocation: createUserInvocation(fixture.reviewerAuth), refusalSink, traceId: `drift-close-${randomUUID()}` });
          } else if (drift === "DefinitionRevision") {
            await driftDefinitionRevision(root, fixture);
          } else {
            const invocation = createUserInvocation(fixture.editorAuth);
            const draft = await createCanonicalValueDraft(root, fixture.editorAuth, {
              projectId: fixture.projectId, bindingId: fixture.bindingId,
              baseRevisionId: fixture.configRevisionId, baseCurrentValueId: fixture.currentValueId,
              ...(sourceFormat === "json"
                ? { sourceTarget: { format: "json" as const, sourceText: "6" } }
                : { targetValue: parseDtsValue("iin_max", "<1900>").value }),
              reason: "Advance the real source revision before the approved Agent resumes.",
            }, { objectStore, invocation, requestId: `drift-draft-${randomUUID()}`, refusalSink });
            const request = await submitCanonicalValueChange(root, fixture.editorAuth, {
              projectId: fixture.projectId, draftId: draft.id, invocation,
              requestId: `drift-submit-${randomUUID()}`, refusalSink,
            });
            const applied = await reviewCanonicalValueChange(root, fixture.reviewerAuth, {
              projectId: fixture.projectId, requestId: request.id, decision: "approve",
            }, {
              objectStore, snapshot, invocation: createUserInvocation(fixture.reviewerAuth),
              refusalSink, traceId: `drift-review-${randomUUID()}`,
            });
            expect(applied).toMatchObject({ status: "approved", applyOutcome: "committed" });
          }
          const pins = await loadCanonicalBindingPins(root, {
            organizationId: fixture.organizationId, projectId: fixture.projectId, bindingId: fixture.bindingId,
          });
          expect(pins).not.toBeNull();
          if (drift === "current ProjectValue") {
            expect(pins!.currentValueId).not.toBe(originalPins!.currentValueId);
            expect(pins!.configRevisionId).toBe(originalPins!.configRevisionId);
            expect(pins!.definitionRevisionId).toBe(originalPins!.definitionRevisionId);
          } else if (drift === "DefinitionRevision") {
            expect(pins!.definitionRevisionId).not.toBe(originalPins!.definitionRevisionId);
            expect(pins!.currentValueId).toBe(originalPins!.currentValueId);
            expect(pins!.sourcePinId).toBe(originalPins!.sourcePinId);
            expect(pins!.configRevisionId).toBe(originalPins!.configRevisionId);
          } else {
            expect(pins!.configRevisionId).not.toBe(originalPins!.configRevisionId);
            expect(pins!.sourcePinId).not.toBe(originalPins!.sourcePinId);
          }
          drifted = await canonicalState(root, fixture);
          objectStoreWriteKeys.clear();
          try {
            return await run();
          } catch (error) {
            refusal = error;
            throw error;
          }
        },
      });
      expect(executions).toBe(1);
      expect(refusal).toBeInstanceOf(ApiError);
      expect(refusal).toMatchObject({ code: "CONFLICT", details: { reason } });
      expect(events.some((event) => event.event === EventType.RUN_ERROR)).toBe(false);
      expect(JSON.stringify(events)).toContain("操作未能完成");
      expect(await getAgentToolCall(root, fixture.organizationId, pending.toolCallId)).toMatchObject({ status: "failed" });
      expect(await getAgentApproval(root, fixture.organizationId, pending.approvalId)).toMatchObject({
        status: "approved", decidedByUserId: fixture.editorAuth.user.id,
      });
      expect(drifted).toBeDefined();
      expect(await canonicalState(root, fixture)).toEqual(drifted);
      expect(drifted!.drafts).toHaveLength(0);
      expect(drifted!.requests.filter((request) => request.status === "pending")).toHaveLength(0);
      expect(objectStoreWriteKeys.size).toBe(0);
      const source = await loadCanonicalSourceSnapshot(root, objectStore, {
        organizationId: fixture.organizationId, projectId: fixture.projectId,
        bindingId: fixture.bindingId, projectValueId: drifted!.binding!.current_value_id,
      });
      expect(source.manifest.format).toBe(sourceFormat);
    }, 120_000);
  },
);
