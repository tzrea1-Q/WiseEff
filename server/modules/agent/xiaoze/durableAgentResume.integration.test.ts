import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../auth/types";
import { developmentAuthContext } from "../../auth/routes";
import { ApiError } from "../../../shared/http/errors";
import { getAgentApproval, getAgentSession, getAgentToolCall, listAgentApprovals, listAgentToolCalls } from "../repository";
import type { AgentToolExecutionContext } from "../toolRegistry";
import type { AgentToolName } from "../types";
import { createAgentOrchestrator } from "../orchestrator";
import { openDatabaseConnection, withTempDatabase } from "../../../testing/tempDatabase";
import { isTestDatabaseAvailable } from "../../../testing/testDatabase";
import { createXiaozeAgUiHandler, createXiaozeAgentFactory } from "./agUiEndpoint";
import {
  closeSharedPostgresCheckpointerSaversForTests,
  createPostgresCheckpointerSaver,
  resetSharedPostgresCheckpointerSaverForTests,
  type PostgresCheckpointerHandle
} from "./durableCheckpointer";
import { createXiaozeCheckpointer } from "./checkpointer";
import { fakeModelSequence, toolCall } from "./testing/fakeModel";
import type { createAgentToolRegistry } from "../toolRegistry";

const databaseAvailable = await isTestDatabaseAvailable();

const actionDefinition = {
  name: "action.submitParameterChange",
  label: "提交参数变更",
  kind: "mutating",
  permission: "parameter:edit",
  requiresApproval: true,
  description: "submit a parameter change for approval",
  schema: {}
} as const;

type ObservedExecution = {
  context: AgentToolExecutionContext;
  payload: Record<string, unknown>;
  authorization: unknown;
};

function authFor(userId: string, organizationId = developmentAuthContext.organization.id): AuthContext {
  return {
    ...developmentAuthContext,
    user: { ...developmentAuthContext.user, id: userId, organizationId },
    organization: { ...developmentAuthContext.organization, id: organizationId }
  };
}

function createActionRegistry(domainWrites: { count: number }, observed: ObservedExecution[]) {
  const authorize = vi.fn((_name: AgentToolName, _context: AgentToolExecutionContext, _payload: Record<string, unknown>) => ({
    kind: "transaction-authorization",
    token: randomUUID()
  }));
  const run = vi.fn(
    async (
      _name: AgentToolName,
      context: AgentToolExecutionContext,
      payload: Record<string, unknown>,
      authorization?: unknown
    ) => {
      domainWrites.count += 1;
      observed.push({ context, payload, authorization });
      return {
        summary: `Submitted ${String(payload.targetValue)}.`,
        data: { targetValue: payload.targetValue },
        citations: []
      };
    }
  );
  const registry = {
    list: () => [actionDefinition],
    get: (name: string) => (name === actionDefinition.name ? actionDefinition : undefined),
    require: (name: string) => {
      if (name !== actionDefinition.name) {
        throw new Error(`Unknown Xiaoze tool ${name}.`);
      }
      return actionDefinition;
    },
    authorize,
    run
  } as unknown as ReturnType<typeof createAgentToolRegistry>;
  return { registry, authorize, run };
}

function testEnv(connectionString: string) {
  return {
    XIAOZE_CHECKPOINTER: "postgres" as const,
    DATABASE_URL: connectionString,
    XIAOZE_REASONING_FALLBACK_HEURISTIC: false,
    XIAOZE_LLM_CONFIG: {
      source: "canonical" as const,
      config: { model: "durable-resume-test" },
      diagnostics: []
    }
  };
}

type DurableResumeResources = {
  instanceASaver?: PostgresCheckpointerHandle["saver"];
  instanceBSaver?: PostgresCheckpointerHandle["saver"];
  instanceBConnection?: ReturnType<typeof openDatabaseConnection>;
};

async function closeDurableResumeResources(resources: DurableResumeResources): Promise<void> {
  const closeQuietly = async (close: () => Promise<void> | undefined): Promise<void> => {
    try {
      await close();
    } catch {
      // Cleanup must not mask the first setup or assertion failure.
    }
  };

  await closeQuietly(() => resources.instanceBConnection?.close());
  await closeQuietly(() => resources.instanceASaver?.end());
  await closeQuietly(() => resources.instanceBSaver?.end());
  await closeQuietly(() => closeSharedPostgresCheckpointerSaversForTests());
}

async function createInstance(options: {
  db: Parameters<typeof createAgentOrchestrator>[0]["db"];
  connectionString: string;
  auth: AuthContext;
  model: ReturnType<typeof fakeModelSequence>;
  domainWrites: { count: number };
  observed: ObservedExecution[];
  registerSaver?: (saver: PostgresCheckpointerHandle["saver"]) => void;
}) {
  const saverHandle = createPostgresCheckpointerSaver({ connectionString: options.connectionString });
  options.registerSaver?.(saverHandle.saver);
  await saverHandle.ensureSetup();
  const checkpointer = createXiaozeCheckpointer({
    mode: "postgres",
    connectionString: options.connectionString,
    saver: saverHandle.saver,
    ...saverHandle.withNamespaceLease && { withNamespaceLease: saverHandle.withNamespaceLease, ensureReady: saverHandle.ensureSetup }
  });
  const execution = createActionRegistry(options.domainWrites, options.observed);
  const orchestrator = createAgentOrchestrator({ db: options.db, toolRegistry: execution.registry });
  const factory = createXiaozeAgentFactory({
    db: options.db,
    env: testEnv(options.connectionString),
    modelFactory: () => options.model,
    checkpointer,
    toolRegistry: execution.registry,
    orchestrator
  });
  return { ...execution, orchestrator, factory, saverHandle };
}

function createHandler(options: {
  db: Parameters<typeof createAgentOrchestrator>[0]["db"];
  auth: AuthContext;
  factory: ReturnType<typeof createXiaozeAgentFactory>;
  orchestrator: ReturnType<typeof createAgentOrchestrator>;
}) {
  return createXiaozeAgUiHandler({
    resolveAuth: async () => options.auth,
    createAgent: options.factory,
    approvalChain: options.orchestrator,
    assertThreadAccess: async ({ auth, threadId }) => {
      const session = await getAgentSession(options.db, auth.organization.id, threadId);
      if (session && session.actorUserId !== auth.user.id) {
        throw new ApiError("FORBIDDEN", "This Xiaoze thread belongs to another user.", { threadId });
      }
    }
  });
}

async function collectSse(response: Awaited<ReturnType<ReturnType<typeof createXiaozeAgUiHandler>>>) {
  if (!("sse" in response)) {
    throw new Error("Expected an AG-UI SSE response.");
  }
  const events: Array<{ event: string; data: unknown }> = [];
  for await (const event of response.sse as AsyncIterable<{ event: string; data: unknown }>) {
    events.push(event);
  }
  return events;
}

async function post(handler: ReturnType<typeof createXiaozeAgUiHandler>, input: {
  auth: AuthContext;
  threadId: string;
  requestId: string;
  approvalId?: string;
  bodyThreadId?: string;
  decision?: "approve" | "reject";
}) {
  const body: Record<string, unknown> = input.approvalId
    ? {
        threadId: input.bodyThreadId ?? input.threadId,
        runId: `run-${input.requestId}`,
        messages: [],
        resume: [
          {
            interruptId: input.approvalId,
            status: "resolved",
            payload: { approvalId: input.approvalId, decision: input.decision ?? "approve" }
          }
        ]
      }
    : {
        threadId: input.threadId,
        runId: `run-${input.requestId}`,
        messages: [{ id: `message-${input.requestId}`, role: "user", content: "set pd-1 to 42" }],
        context: [
          {
            description: "wiseeff.page",
            value: { pageKey: "parameters", projectId: "aurora", path: "/parameters?project=aurora" }
          }
        ]
      };

  const response = await handler({
    headers: { authorization: "Bearer integration-test" },
    body,
    requestId: input.requestId
  });
  return collectSse(response);
}

async function interruptAction(options: {
  handler: ReturnType<typeof createXiaozeAgUiHandler>;
  db: Parameters<typeof createAgentOrchestrator>[0]["db"];
  auth: AuthContext;
  threadId: string;
  requestId: string;
}) {
  const events = await post(options.handler, options);
  const toolCalls = await listAgentToolCalls(options.db, options.auth.organization.id, options.threadId);
  const approvals = await listAgentApprovals(options.db, options.auth.organization.id, options.threadId);
  const toolCall = toolCalls[0];
  const approval = approvals[0];
  if (!toolCall || !approval) {
    throw new Error(`Expected persisted interrupt; events=${JSON.stringify(events)}`);
  }
  expect(toolCall).toMatchObject({ status: "pending_approval", requiresApproval: true });
  expect(approval).toMatchObject({ status: "pending", toolCallId: toolCall?.id });
  return { toolCallId: toolCall!.id, approvalId: approval!.id };
}

const initialActionModel = () =>
  fakeModelSequence([
    {
      toolCalls: [
        toolCall("action.submitParameterChange", {
          projectId: "aurora",
          parameterId: "pd-1",
          targetValue: "42",
          reason: "initial request"
        })
      ]
    }
  ]);

function admissionBarrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe.skipIf(!databaseAvailable)("Xiaoze PostgreSQL concurrent namespace admission", () => {
  it.each(["reject", "approve"] as const)("refuses a concurrent ordinary writer after genuine %s preflight", async (decision) => {
    resetSharedPostgresCheckpointerSaverForTests();
    await withTempDatabase({ prefix: "xiaoze_concurrent_admission" }, async ({ db, connectionString }) => {
      const savers: PostgresCheckpointerHandle["saver"][] = [];
      const connections: ReturnType<typeof openDatabaseConnection>[] = [];
      const release = admissionBarrier();
      let held: ReturnType<typeof post> | undefined;
      try {
        const auth = authFor(`concurrent-${decision}`);
        await db.query("insert into organizations (id, name) values ($1, 'Concurrent admission')", [auth.organization.id]);
        await db.query("insert into users (id, organization_id, name, email, title) values ($1, $2, 'Requester', $3, 'Engineer')", [auth.user.id, auth.organization.id, `${decision}@example.com`]);
        const domainWrites = { count: 0 }; const observed: ObservedExecution[] = [];
        const fresh = async (model = initialActionModel()) => {
          const connection = openDatabaseConnection(connectionString); connections.push(connection);
          const instance = await createInstance({ db: connection.db, connectionString, auth, model, domainWrites, observed, registerSaver: (saver) => savers.push(saver) });
          const errors: unknown[] = [];
          const factory: typeof instance.factory = (context) => {
            const agent = instance.factory(context);
            return { ...agent, async run(input) {
              try { return await agent.run(input); } catch (error) { errors.push(error); throw error; }
            } };
          };
          return { ...instance, model, errors, handler: createHandler({ db: connection.db, auth, factory, orchestrator: instance.orchestrator }) };
        };
        const initial = await fresh();
        const threadId = `concurrent-${decision}-${randomUUID()}`;
        const original = await interruptAction({ handler: initial.handler, db, auth, threadId, requestId: `start-${decision}` });
        const r1 = await fresh(fakeModelSequence([{ content: "Decision completed." }]));
        const r2 = await fresh();
        expect(r1.saverHandle.saver).not.toBe(r2.saverHandle.saver);
        const reader = await fresh();
        const namespace = `${auth.organization.id}:${auth.user.id}:${threadId}`;
        const snapshot = async () => {
          const checkpointRows: Record<string, unknown> = {};
          for (const table of ["checkpoints", "checkpoint_blobs", "checkpoint_writes"]) {
            checkpointRows[table] = (await db.query(`select * from ${table} where thread_id = $1 order by row_to_json(${table})::text`, [namespace])).rows;
          }
          const tools = await listAgentToolCalls(db, auth.organization.id, threadId);
          return JSON.parse(JSON.stringify({ tuple: await reader.saverHandle.saver.getTuple({ configurable: { thread_id: namespace } }), checkpointRows,
            approvals: await listAgentApprovals(db, auth.organization.id, threadId), tools,
            audits: (await db.query("select * from audit_events where target_id = any($1::text[]) order by id", [tools.map((tool) => tool.id)])).rows,
            executions: domainWrites.count, observed, authorizations: r1.authorize.mock.calls.length + r2.authorize.mock.calls.length,
            registryCalls: r1.run.mock.calls.length + r2.run.mock.calls.length }));
        };
        const before = await snapshot();
        const reached = admissionBarrier();
        const genuinePreflight = r1.orchestrator.preflightApproval.bind(r1.orchestrator);
        vi.spyOn(r1.orchestrator, "preflightApproval").mockImplementation(async (input) => {
          await genuinePreflight(input);
          reached.resolve();
          await release.promise;
        });
        const stream = vi.spyOn(r2.model, "stream"); const invoke = vi.spyOn(r2.model, "invoke");
        held = post(r1.handler, { auth, threadId, approvalId: original.approvalId, decision, requestId: `r1-${decision}` });
        await reached.promise;
        const contender = await post(r2.handler, { auth, threadId, requestId: `r2-${decision}` });
        const during = await snapshot();
        console.info("concurrent-admission-held", JSON.stringify({ decision, before, during, contender, errors: r2.errors, modelStreamCalls: stream.mock.calls.length, modelInvokeCalls: invoke.mock.calls.length }));
        expect.soft(JSON.stringify(contender)).toContain("操作与当前状态冲突");
        expect.soft(r2.errors).toContainEqual(expect.objectContaining({ code: "CONFLICT", details: { reason: "xiaoze-thread-busy" } }));
        expect.soft(stream).not.toHaveBeenCalled(); expect.soft(invoke).not.toHaveBeenCalled();
        expect.soft(during).toEqual(before);
        const otherThread = `independent-${randomUUID()}`;
        await interruptAction({ handler: r2.handler, db, auth, threadId: otherThread, requestId: `other-${decision}` });
        expect(await reader.saverHandle.saver.getTuple({ configurable: { thread_id: `${auth.organization.id}:${auth.user.id}:${otherThread}` } })).toBeDefined();
        release.resolve();
        const completion = await held;
        const after = await snapshot();
        const originalApproval = await getAgentApproval(db, auth.organization.id, original.approvalId);
        const originalTool = await getAgentToolCall(db, auth.organization.id, original.toolCallId);
        const audit = await db.query<{ count: string }>("select count(*)::text as count from audit_events where action = 'approval-rejected' and target_id = $1", [original.toolCallId]);
        console.info("concurrent-admission-completed", JSON.stringify({ decision, completion, after, originalApproval, originalTool, rejectionAudits: audit.rows[0].count }));
        expect.soft(originalApproval).toMatchObject({ status: decision === "reject" ? "rejected" : "approved", decidedByUserId: auth.user.id });
        expect.soft(originalTool).toMatchObject({ status: decision === "reject" ? "rejected" : "succeeded" });
        expect.soft(domainWrites.count).toBe(decision === "reject" ? 0 : 1);
        expect.soft(audit.rows[0].count).toBe(decision === "reject" ? "1" : "0");
        // Preserve baseline B's actual later result even when the original A oracle failed.
        const pending = (await listAgentApprovals(db, auth.organization.id, threadId)).find((approval) => approval.id !== original.approvalId && approval.status === "pending");
        if (pending) {
          const bEvents = await post(r2.handler, { auth, threadId, approvalId: pending.id, decision: "reject", requestId: `baseline-b-${decision}` });
          console.info("concurrent-admission-baseline-b", JSON.stringify({ bEvents, state: await snapshot() }));
        }
        const reacquired = await post(r2.handler, { auth, threadId, requestId: `reacquire-${decision}` });
        expect.soft(reacquired.some((event) => event.event === "RUN_ERROR")).toBe(false);
      } finally {
        release.resolve(); await held?.catch(() => undefined);
        await Promise.all(connections.map((connection) => connection.close()));
        await Promise.all(savers.map((saver) => saver.end()));
        await closeSharedPostgresCheckpointerSaversForTests();
      }
    });
  });

  it("preserves complete state after genuine preflight succeeds then throws and permits reacquisition", async () => {
    await withTempDatabase({ prefix: "xiaoze_preflight_throw" }, async ({ db, connectionString }) => {
      const savers: PostgresCheckpointerHandle["saver"][] = [];
      try {
        const auth = authFor("preflight-throw");
        await db.query("insert into organizations (id, name) values ($1, 'Preflight throw')", [auth.organization.id]);
        await db.query("insert into users (id, organization_id, name, email, title) values ($1, $2, 'Requester', 'throw@example.com', 'Engineer')", [auth.user.id, auth.organization.id]);
        const domainWrites = { count: 0 }; const observed: ObservedExecution[] = [];
        const fresh = async () => {
          const instance = await createInstance({ db, connectionString, auth, model: initialActionModel(), domainWrites, observed, registerSaver: (saver) => savers.push(saver) });
          return { ...instance, handler: createHandler({ db, auth, factory: instance.factory, orchestrator: instance.orchestrator }) };
        };
        const initial = await fresh(); const r1 = await fresh(); const r2 = await fresh();
        const threadId = `preflight-throw-${randomUUID()}`;
        const a = await interruptAction({ handler: initial.handler, db, auth, threadId, requestId: "throw-start" });
        const namespace = `${auth.organization.id}:${auth.user.id}:${threadId}`;
        const snapshot = async () => {
          const rows = {} as Record<string, unknown>;
          for (const table of ["checkpoints", "checkpoint_blobs", "checkpoint_writes"]) rows[table] = (await db.query(`select * from ${table} where thread_id = $1 order by row_to_json(${table})::text`, [namespace])).rows;
          return JSON.parse(JSON.stringify({ tuple: await r2.saverHandle.saver.getTuple({ configurable: { thread_id: namespace } }), rows,
            approvals: await listAgentApprovals(db, auth.organization.id, threadId), tools: await listAgentToolCalls(db, auth.organization.id, threadId),
            audits: (await db.query("select * from audit_events where target_id = $1 order by id", [a.toolCallId])).rows, executions: domainWrites.count }));
        };
        const before = await snapshot();
        const preflight = r1.orchestrator.preflightApproval.bind(r1.orchestrator);
        const failure = new Error("deterministic-after-genuine-preflight");
        const spy = vi.spyOn(r1.orchestrator, "preflightApproval").mockImplementation(async (input) => { await preflight(input); throw failure; });
        const events = await post(r1.handler, { auth, threadId, approvalId: a.approvalId, decision: "reject", requestId: "throw-decision" });
        const after = await snapshot();
        console.info("preflight-throw-state", JSON.stringify({ before, after, events }));
        expect(spy).toHaveBeenCalledOnce(); expect(events.some((event) => event.event === "RUN_ERROR")).toBe(true);
        expect(after).toEqual(before); expect(r1.run).not.toHaveBeenCalled(); expect(r1.authorize).not.toHaveBeenCalled();
        await post(r2.handler, { auth, threadId, approvalId: a.approvalId, decision: "reject", requestId: "throw-reacquire" });
        expect(await getAgentApproval(db, auth.organization.id, a.approvalId)).toMatchObject({ status: "rejected" });
      } finally {
        await Promise.all(savers.map((saver) => saver.end())); await closeSharedPostgresCheckpointerSaversForTests();
      }
    });
  });
});

describe.skipIf(!databaseAvailable)("Xiaoze PostgreSQL physical backend loss", () => {
  it("a delayed preflight owner cannot write after its disposable backend is terminated and R2 reacquires", async () => {
    await withTempDatabase({ prefix: "xiaoze_owned_backend_loss" }, async ({ db, connectionString }) => {
      const savers: PostgresCheckpointerHandle["saver"][] = [];
      const connections: ReturnType<typeof openDatabaseConnection>[] = [];
      const release = admissionBarrier(); let held: ReturnType<typeof post> | undefined;
      const trace: Array<{ pid: number; sql: string; key?: string }> = [];
      const originals = new Map<pg.PoolClient, pg.PoolClient["query"]>();
      const connect = pg.Pool.prototype.connect;
      const spy = vi.spyOn(pg.Pool.prototype, "connect").mockImplementation(function (this: pg.Pool, ...args: unknown[]) {
        // Outside-read Pool.query uses callback connect/query; leave that public API intact.
        if (args.length) return Reflect.apply(connect, this, args);
        return (Reflect.apply(connect, this, []) as Promise<pg.PoolClient>).then(async (client) => {
          if (!originals.has(client)) {
            const query = client.query.bind(client); originals.set(client, client.query);
            const pid = (await query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
            client.query = function (...queryArgs: unknown[]) {
              if (typeof queryArgs.at(-1) === "function") return Reflect.apply(query, client, queryArgs);
              trace.push({ pid, sql: String(queryArgs[0]), key: String(queryArgs[0]).includes("advisory") ? (queryArgs[1] as string[] | undefined)?.[0] : undefined });
              return Reflect.apply(query, client, queryArgs);
            } as pg.PoolClient["query"];
          }
          return client;
        });
      });
      try {
        const auth = authFor("owned-backend-loss");
        await db.query("insert into organizations (id, name) values ($1, 'Backend loss')", [auth.organization.id]);
        await db.query("insert into users (id, organization_id, name, email, title) values ($1, $2, 'Requester', 'backend-loss@example.com', 'Engineer')", [auth.user.id, auth.organization.id]);
        const domainWrites = { count: 0 }; const observed: ObservedExecution[] = [];
        const fresh = async () => {
          const connection = openDatabaseConnection(connectionString); connections.push(connection);
          const instance = await createInstance({ db: connection.db, connectionString, auth, model: initialActionModel(), domainWrites, observed, registerSaver: (saver) => savers.push(saver) });
          const errors: unknown[] = [];
          const factory: typeof instance.factory = (context) => {
            const agent = instance.factory(context);
            return { ...agent, async run(input) { try { return await agent.run(input); } catch (error) { errors.push(error); throw error; } } };
          };
          return { ...instance, errors, handler: createHandler({ db: connection.db, auth, factory, orchestrator: instance.orchestrator }) };
        };
        const initial = await fresh(); const r1 = await fresh(); const r2 = await fresh(); const reader = await fresh();
        const threadId = `owned-backend-loss-${randomUUID()}`;
        const namespace = `${auth.organization.id}:${auth.user.id}:${threadId}`;
        const a = await interruptAction({ handler: initial.handler, db, auth, threadId, requestId: "loss-start-a" });
        const checkpointSql = trace.filter((entry) => entry.sql.startsWith("INSERT") || entry.sql === "BEGIN");
        const initialOwner = trace.find((entry) => entry.sql.includes("pg_try_advisory_lock") && entry.key?.includes(namespace))!.pid;
        expect(checkpointSql.filter((entry) => entry.pid === initialOwner).some((entry) => entry.sql.startsWith("INSERT"))).toBe(true);
        const preflight = r1.orchestrator.preflightApproval.bind(r1.orchestrator);
        const reached = admissionBarrier();
        vi.spyOn(r1.orchestrator, "preflightApproval").mockImplementation(async (input) => { await preflight(input); reached.resolve(); await release.promise; });
        held = post(r1.handler, { auth, threadId, approvalId: a.approvalId, decision: "reject", requestId: "loss-r1" });
        await reached.promise;
        const lockEntry = trace.filter((entry) => entry.sql.includes("pg_try_advisory_lock") && entry.key?.includes(namespace)).at(-1)!;
        const owner = lockEntry.pid;
        expect(trace.filter((entry) => entry.pid === owner).some((entry) => entry.sql.includes("checkpoint_writes"))).toBe(true);
        const current = (await db.query<{ name: string }>("select current_database() as name")).rows[0].name;
        const backend = await db.query<{ datname: string; usename: string }>("select datname, usename from pg_stat_activity where pid = $1", [owner]);
        expect(backend.rows).toEqual([{ datname: current, usename: "postgres" }]);
        const terminated = await db.query<{ terminated: boolean }>("select pg_terminate_backend($1, 2000) as terminated", [owner]);
        expect(terminated.rows[0].terminated).toBe(true);
        expect((await db.query("select pid from pg_stat_activity where pid = $1", [owner])).rows).toEqual([]);
        const r2Events = await post(r2.handler, { auth, threadId, requestId: "loss-r2" });
        const r2Tuple = await reader.saverHandle.saver.getTuple({ configurable: { thread_id: namespace } });
        const b = (await listAgentApprovals(db, auth.organization.id, threadId)).find((approval) => approval.toolCallId === r2Tuple?.checkpoint.channel_values.pendingMutatingToolCallId);
        expect(b).toMatchObject({ status: "pending" });
        const r2Owner = trace.filter((entry) => entry.sql.includes("pg_try_advisory_lock") && entry.key?.includes(namespace)).at(-1)!.pid;
        expect(r2Owner).not.toBe(owner);
        const snapshot = async () => {
          const rows = {} as Record<string, unknown>;
          for (const table of ["checkpoints", "checkpoint_blobs", "checkpoint_writes"]) rows[table] = (await db.query(`select * from ${table} where thread_id = $1 order by row_to_json(${table})::text`, [namespace])).rows;
          const tools = await listAgentToolCalls(db, auth.organization.id, threadId);
          return JSON.parse(JSON.stringify({ tuple: await reader.saverHandle.saver.getTuple({ configurable: { thread_id: namespace } }), rows,
            approvals: await listAgentApprovals(db, auth.organization.id, threadId), tools,
            audits: (await db.query("select * from audit_events where target_id = any($1::text[]) order by id", [tools.map((tool) => tool.id)])).rows, executions: domainWrites.count }));
        };
        const before = await snapshot(); const traceBefore = trace.length;
        release.resolve(); const r1Events = await held; const after = await snapshot();
        expect(r1.errors).toHaveLength(1); expect(after).toEqual(before);
        expect(trace.slice(traceBefore).some((entry) => entry.pid === owner && entry.sql.startsWith("INSERT"))).toBe(false);
        expect(r1.run).not.toHaveBeenCalled(); expect(r1.authorize).not.toHaveBeenCalled();
        console.info("physical-owned-backend-loss", JSON.stringify({ initialOwner, owner, r2Owner, backend: backend.rows, terminated: terminated.rows, before, after, r1Events, r2Events, r1Errors: r1.errors.map((error) => String(error)), trace }));
        await post(r2.handler, { auth, threadId, approvalId: b!.id, decision: "reject", requestId: "loss-r2-reject" });
        expect(await getAgentApproval(db, auth.organization.id, b!.id)).toMatchObject({ status: "rejected" });
      } finally {
        release.resolve(); await held?.catch(() => undefined);
        spy.mockRestore(); for (const [client, query] of originals) client.query = query;
        await Promise.all(connections.map((connection) => connection.close()));
        await Promise.all(savers.map((saver) => saver.end())); await closeSharedPostgresCheckpointerSaversForTests();
      }
    });
  });
});

describe.skipIf(!databaseAvailable)("Xiaoze PostgreSQL durable resume", () => {
  it("keeps denied substitutions out of durable task writes and accepts a later genuine reject", async () => {
    resetSharedPostgresCheckpointerSaverForTests();
    const savers: PostgresCheckpointerHandle["saver"][] = [];
    try {
      await withTempDatabase({ prefix: "xiaoze_resume_admission" }, async ({ db, connectionString }) => {
        try {
        const auth = authFor("resume-admission-user");
        await db.query("insert into organizations (id, name) values ($1, 'Resume admission')", [auth.organization.id]);
        await db.query(
          "insert into users (id, organization_id, name, email, title) values ($1, $2, 'Requester', 'admission@example.com', 'Engineer')",
          [auth.user.id, auth.organization.id]
        );
        const domainWrites = { count: 0 };
        const observed: ObservedExecution[] = [];
        const fresh = async (model = initialActionModel()) => {
          const instance = await createInstance({ db, connectionString, auth, model, domainWrites, observed,
            registerSaver: (saver) => savers.push(saver) });
          return { ...instance, handler: createHandler({ db, auth, factory: instance.factory, orchestrator: instance.orchestrator }) };
        };
        const initial = await fresh();
        const threadA = `admission-a-${randomUUID()}`;
        const threadB = `admission-b-${randomUUID()}`;
        const a = await interruptAction({ handler: initial.handler, db, auth, threadId: threadA, requestId: "admission-start-a" });
        const b = await interruptAction({ handler: initial.handler, db, auth, threadId: threadB, requestId: "admission-start-b" });
        await initial.saverHandle.saver.end();
        savers.splice(savers.indexOf(initial.saverHandle.saver), 1);
        const resumed = await fresh();
        const tuple = async (threadId: string, expectedToolCallId: string) => {
          const saved = await resumed.saverHandle.saver.getTuple({ configurable: {
            thread_id: `${auth.organization.id}:${auth.user.id}:${threadId}`
          } });
          expect(saved).toBeDefined();
          expect(saved!.checkpoint.channel_values.pendingMutatingToolCallId).toBe(expectedToolCallId);
          return { checkpointId: saved!.checkpoint.id, pendingWrites: saved!.pendingWrites };
        };
        const beforeA = await tuple(threadA, a.toolCallId);
        const beforeB = await tuple(threadB, b.toolCallId);
        for (const saved of [beforeA, beforeB]) {
          expect(saved.pendingWrites).toHaveLength(1);
          expect(saved.pendingWrites![0]).toEqual([expect.any(String), "__interrupt__", expect.objectContaining({
            id: expect.any(String), value: expect.objectContaining({ toolCallId: expect.any(String) })
          })]);
        }
        const rows = async () => ({
          a: await getAgentApproval(db, auth.organization.id, a.approvalId),
          b: await getAgentApproval(db, auth.organization.id, b.approvalId),
          toolA: await getAgentToolCall(db, auth.organization.id, a.toolCallId),
          toolB: await getAgentToolCall(db, auth.organization.id, b.toolCallId)
        });
        const beforeRows = await rows();
        expect(beforeRows.a).toMatchObject({ sessionId: threadA, toolCallId: a.toolCallId, requestedByUserId: auth.user.id });
        expect(beforeRows.b).toMatchObject({ sessionId: threadB, toolCallId: b.toolCallId, requestedByUserId: auth.user.id });
        console.info("resume-admission-before", JSON.stringify({ a: beforeA, b: beforeB }));
        for (const [threadId, approvalId] of [[threadA, b.approvalId], [threadB, a.approvalId]]) {
          const events = await post(resumed.handler, { auth, threadId, approvalId, decision: "reject", requestId: `admission-deny-${threadId}` });
          expect(JSON.stringify(events)).toContain("操作与当前状态冲突");
          expect(await rows()).toEqual(beforeRows);
          expect(domainWrites.count).toBe(0);
          expect(observed).toEqual([]);
          const afterA = await tuple(threadA, a.toolCallId);
          const afterB = await tuple(threadB, b.toolCallId);
          console.info("resume-admission-after-denial", JSON.stringify({ threadId, a: afterA, b: afterB }));
          expect.soft(afterA).toEqual(beforeA);
          expect.soft(afterB).toEqual(beforeB);
        }
        const legitimate = await fresh();
        await post(legitimate.handler, { auth, threadId: threadA, approvalId: a.approvalId, decision: "reject", requestId: "admission-valid-reject" });
        const final = await rows();
        console.info("resume-admission-final", JSON.stringify({ approvalA: final.a?.status, toolA: final.toolA?.status }));
        expect.soft(final.a).toMatchObject({ status: "rejected", decidedByUserId: auth.user.id });
        expect.soft(final.toolA).toMatchObject({ status: "rejected" });
        expect(final.b).toEqual(beforeRows.b);
        expect(final.toolB).toEqual(beforeRows.toolB);
        expect.soft(await tuple(threadB, b.toolCallId)).toEqual(beforeB);
        const rejectedAudits = await db.query<{ count: string }>(
          "select count(*)::text as count from audit_events where action = 'approval-rejected' and target_id = $1", [a.toolCallId]
        );
        expect.soft(rejectedAudits.rows[0].count).toBe("1");
        expect(domainWrites.count).toBe(0);
        expect(observed).toEqual([]);
        expect(legitimate.run).not.toHaveBeenCalled();
        expect(legitimate.authorize).not.toHaveBeenCalled();
        } finally {
          await Promise.all(savers.splice(0).map((saver) => saver.end()));
          await closeSharedPostgresCheckpointerSaversForTests();
        }
      });
    } finally {
      await Promise.all(savers.map((saver) => saver.end()));
      await closeSharedPostgresCheckpointerSaversForTests();
      resetSharedPostgresCheckpointerSaverForTests();
    }
  });

  it("cleans instance A when failure occurs before instance B is created", async () => {
    resetSharedPostgresCheckpointerSaverForTests();
    const originalError = new Error("instance B setup was intentionally not reached");
    let saverEndCalls = 0;

    try {
      await expect(
        withTempDatabase({ prefix: "xiaoze_resume_611_cleanup" }, async ({ db, connectionString }) => {
          const resources: DurableResumeResources = {};
          try {
            const instanceA = await createInstance({
              db,
              connectionString,
              auth: authFor("resume-user"),
              model: initialActionModel(),
              domainWrites: { count: 0 },
              observed: [],
              registerSaver: (saver) => {
                resources.instanceASaver = saver;
              }
            });
            const originalEnd = instanceA.saverHandle.saver.end.bind(instanceA.saverHandle.saver);
            vi.spyOn(instanceA.saverHandle.saver, "end").mockImplementation(async () => {
              saverEndCalls += 1;
              await originalEnd();
            });

            throw originalError;
          } finally {
            await closeDurableResumeResources(resources);
            resetSharedPostgresCheckpointerSaverForTests();
          }
        })
      ).rejects.toBe(originalError);
      expect(saverEndCalls).toBe(1);
    } finally {
      resetSharedPostgresCheckpointerSaverForTests();
    }
  });

  it("reconstructs instance B from durable state and rejects public resume substitutions before execution", async () => {
    resetSharedPostgresCheckpointerSaverForTests();
    try {
      await withTempDatabase({ prefix: "xiaoze_resume_611" }, async ({ db, connectionString }) => {
        const resources: DurableResumeResources = {};
        try {
          await db.query(
        `insert into organizations (id, name)
         values ($1, 'Resume Organization'), ($2, 'Other Resume Organization')`,
        [authFor("seed-user").organization.id, "org-other"]
      );
      await db.query(
        `insert into users (id, organization_id, name, email, title)
         values
           ($1, $4, 'Resume User', 'resume-user@example.com', 'Engineer'),
           ($2, $4, 'Different User', 'different-user@example.com', 'Engineer'),
           ($3, $5, 'Other Organization User', 'other-org-user@example.com', 'Engineer')`,
        ["resume-user", "different-user", "other-org-user", authFor("seed-user").organization.id, "org-other"]
      );
      const domainWrites = { count: 0 };
      const observed: ObservedExecution[] = [];
      const auth = authFor("resume-user");

      // Instance A owns the first connection, checkpointer, registry, model, and
      // orchestrator. After the interrupt, instance A is discarded; B below gets
      // a fresh DB connection, checkpointer, registry, model, and orchestrator.
      const instanceA = await createInstance({
        db,
        connectionString,
        auth,
        model: initialActionModel(),
        domainWrites,
        observed,
        registerSaver: (saver) => {
          resources.instanceASaver = saver;
        }
      });
      const handlerA = createHandler({ db, auth, factory: instanceA.factory, orchestrator: instanceA.orchestrator });
      const threadId = `resume-${randomUUID()}`;
      const interrupted = await interruptAction({
        handler: handlerA,
        db,
        auth,
        threadId,
        requestId: "resume-instance-a"
      });

      expect(domainWrites.count).toBe(0);
      expect(interrupted.toolCallId).toBeTruthy();
      expect(interrupted.approvalId).toBeTruthy();

      const instanceBConnection = openDatabaseConnection(connectionString);
      resources.instanceBConnection = instanceBConnection;
      const instanceB = await createInstance({
          db: instanceBConnection.db,
          connectionString,
          auth,
          model: fakeModelSequence([{ content: "The edited change was submitted." }]),
          domainWrites,
          observed,
          registerSaver: (saver) => {
            resources.instanceBSaver = saver;
          }
        });
        const handlerB = createHandler({
          db: instanceBConnection.db,
          auth,
          factory: instanceB.factory,
          orchestrator: instanceB.orchestrator
        });

        const editedArgs = {
          projectId: "aurora",
          parameterId: "pd-1",
          targetValue: "99",
          reason: "complete replacement from resume"
        };
        const resumeResponse = await handlerB({
          headers: { authorization: "Bearer integration-test" },
          body: {
            threadId,
            runId: "resume-instance-b",
            messages: [],
            resume: [
              {
                interruptId: interrupted.approvalId,
                status: "resolved",
                payload: {
                  approvalId: interrupted.approvalId,
                  decision: "approve",
                  editedArgs
                }
              }
            ]
          },
          requestId: "resume-instance-b"
        });
        const resumeEvents = await collectSse(resumeResponse);
        expect(resumeEvents.some((event) => event.event === "RUN_ERROR")).toBe(false);
        expect(instanceB.run).toHaveBeenCalledOnce();
        expect(instanceB.authorize).toHaveBeenCalledOnce();
        expect(instanceB.run.mock.calls[0]?.[3]).toBe(instanceB.authorize.mock.results[0]?.value);

        const execution = observed[0];
        expect(execution.context.invocation).toMatchObject({
          initiator: "agent",
          principal: {
            user: { id: auth.user.id, organizationId: auth.user.organizationId },
            organization: { id: auth.organization.id }
          },
          sessionId: threadId,
          toolCallId: interrupted.toolCallId,
          approvalRequired: true,
          approvalId: interrupted.approvalId
        });
        expect(execution.payload).toEqual(editedArgs);

        const persistedToolCall = await getAgentToolCall(
          instanceBConnection.db,
          auth.organization.id,
          interrupted.toolCallId
        );
        const persistedApproval = await getAgentApproval(
          instanceBConnection.db,
          auth.organization.id,
          interrupted.approvalId
        );
        expect(persistedToolCall).toMatchObject({
          id: interrupted.toolCallId,
          sessionId: threadId,
          payload: editedArgs,
          status: "succeeded"
        });
        expect(persistedApproval).toMatchObject({
          id: interrupted.approvalId,
          sessionId: threadId,
          toolCallId: interrupted.toolCallId,
          status: "approved",
          requestedByUserId: auth.user.id
        });

        const wrongApprovalThread = `negative-wrong-approval-${randomUUID()}`;
        const wrongApproval = await interruptAction({
          handler: handlerA,
          db,
          auth,
          threadId: wrongApprovalThread,
          requestId: "negative-wrong-approval-start"
        });
        const writesBeforeWrongApproval = domainWrites.count;
        await post(handlerB, {
          auth,
          threadId: wrongApprovalThread,
          requestId: "negative-wrong-approval-resume",
          approvalId: "approval-from-another-session"
        });
        expect(instanceB.run).toHaveBeenCalledTimes(1);
        expect(domainWrites.count).toBe(writesBeforeWrongApproval);
        expect(await getAgentApproval(instanceBConnection.db, auth.organization.id, wrongApproval.approvalId)).toMatchObject({
          status: "pending"
        });
        expect(await getAgentToolCall(instanceBConnection.db, auth.organization.id, wrongApproval.toolCallId)).toMatchObject({
          status: "pending_approval"
        });

        const otherThread = `negative-other-thread-${randomUUID()}`;
        const otherThreadFixture = await interruptAction({
          handler: handlerA,
          db,
          auth,
          threadId: otherThread,
          requestId: "negative-other-thread-start"
        });
        const writesBeforeOtherThread = domainWrites.count;
        await post(handlerB, {
          auth,
          threadId: otherThread,
          bodyThreadId: `thread-not-the-checkpoint-${randomUUID()}`,
          requestId: "negative-other-thread-resume",
          approvalId: otherThreadFixture.approvalId
        });
        expect(instanceB.run).toHaveBeenCalledTimes(1);
        expect(domainWrites.count).toBe(writesBeforeOtherThread);
        expect(await getAgentApproval(instanceBConnection.db, auth.organization.id, otherThreadFixture.approvalId)).toMatchObject({
          status: "pending"
        });

        const mismatchThread = `negative-approval-tool-${randomUUID()}`;
        const mismatch = await interruptAction({
          handler: handlerA,
          db,
          auth,
          threadId: mismatchThread,
          requestId: "negative-approval-tool-start"
        });
        const mismatchOther = await instanceA.orchestrator.beginApproval({
          auth,
          requestId: "negative-approval-tool-second",
          sessionId: mismatchThread,
          toolName: actionDefinition.name,
          payload: {
            projectId: "aurora",
            parameterId: "pd-2",
            targetValue: "43",
            reason: "second pending call"
          },
          citations: []
        });
        await db.query("delete from agent_approvals where id = $1", [mismatchOther.approvalId]);
        await db.query("update agent_approvals set tool_call_id = $2 where id = $1", [mismatch.approvalId, mismatchOther.toolCallId]);
        const writesBeforeApprovalToolMismatch = domainWrites.count;
        await post(handlerB, {
          auth,
          threadId: mismatchThread,
          requestId: "negative-approval-tool-resume",
          approvalId: mismatch.approvalId
        });
        expect(instanceB.run).toHaveBeenCalledTimes(1);
        expect(domainWrites.count).toBe(writesBeforeApprovalToolMismatch);
        expect(await getAgentApproval(instanceBConnection.db, auth.organization.id, mismatch.approvalId)).toMatchObject({
          status: "pending"
        });
        expect(await getAgentToolCall(instanceBConnection.db, auth.organization.id, mismatch.toolCallId)).toMatchObject({
          status: "pending_approval"
        });

        const checkpointMismatchThread = `negative-checkpoint-tool-${randomUUID()}`;
        const checkpointMismatch = await interruptAction({
          handler: handlerA,
          db,
          auth,
          threadId: checkpointMismatchThread,
          requestId: "negative-checkpoint-tool-start"
        });
        const checkpointOther = await instanceA.orchestrator.beginApproval({
          auth,
          requestId: "negative-checkpoint-tool-second",
          sessionId: checkpointMismatchThread,
          toolName: actionDefinition.name,
          payload: {
            projectId: "aurora",
            parameterId: "pd-3",
            targetValue: "44",
            reason: "checkpoint mismatch call"
          },
          citations: []
        });
        expect(checkpointOther.toolCallId).not.toBe(checkpointMismatch.toolCallId);
        const writesBeforeCheckpointMismatch = domainWrites.count;
        await post(handlerB, {
          auth,
          threadId: checkpointMismatchThread,
          requestId: "negative-checkpoint-tool-resume",
          approvalId: checkpointOther.approvalId
        });
        expect(instanceB.run).toHaveBeenCalledTimes(1);
        expect(domainWrites.count).toBe(writesBeforeCheckpointMismatch);
        expect(await getAgentApproval(instanceBConnection.db, auth.organization.id, checkpointOther.approvalId)).toMatchObject({
          status: "pending"
        });
        expect(await getAgentToolCall(instanceBConnection.db, auth.organization.id, checkpointOther.toolCallId)).toMatchObject({
          status: "pending_approval"
        });

        const otherUserThread = `negative-other-user-${randomUUID()}`;
        const otherUserFixture = await interruptAction({
          handler: handlerA,
          db,
          auth,
          threadId: otherUserThread,
          requestId: "negative-other-user-start"
        });
        const otherUser = authFor("different-user", auth.organization.id);
        const otherUserHandler = createHandler({
          db: instanceBConnection.db,
          auth: otherUser,
          factory: instanceB.factory,
          orchestrator: instanceB.orchestrator
        });
        await expect(
          post(otherUserHandler, {
            auth: otherUser,
            threadId: otherUserThread,
            requestId: "negative-other-user-resume",
            approvalId: otherUserFixture.approvalId
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(instanceB.run).toHaveBeenCalledTimes(1);
        expect(domainWrites.count).toBe(1);
        expect(await getAgentApproval(instanceBConnection.db, auth.organization.id, otherUserFixture.approvalId)).toMatchObject({
          status: "pending"
        });

        const otherOrg = authFor("other-org-user", "org-other");
        const writesBeforeOtherOrg = domainWrites.count;
        const otherOrgHandler = createHandler({
          db: instanceBConnection.db,
          auth: otherOrg,
          factory: instanceB.factory,
          orchestrator: instanceB.orchestrator
        });
        await post(otherOrgHandler, {
          auth: otherOrg,
          threadId,
          requestId: "negative-other-org-resume",
          approvalId: interrupted.approvalId
        });
        expect(instanceB.run).toHaveBeenCalledTimes(1);
        expect(domainWrites.count).toBe(writesBeforeOtherOrg);
        expect(await getAgentApproval(instanceBConnection.db, auth.organization.id, interrupted.approvalId)).toMatchObject({
          status: "approved"
        });
        } finally {
          await closeDurableResumeResources(resources);
          resetSharedPostgresCheckpointerSaverForTests();
        }
      });
    } finally {
      resetSharedPostgresCheckpointerSaverForTests();
    }
  });
});

describe("Xiaoze PostgreSQL durable resume gate", () => {
  it("records that this live proof is skipped when PostgreSQL is unavailable", () => {
    if (databaseAvailable) {
      expect(databaseAvailable).toBe(true);
      return;
    }
    expect(databaseAvailable).toBe(false);
  });
});
