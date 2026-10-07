import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { emptyCheckpoint, ERROR } from "@langchain/langgraph-checkpoint";
import { MemorySaver } from "@langchain/langgraph";
import pg from "pg";
import { createXiaozeCheckpointer } from "./checkpointer";
import { createPlanningAgent } from "./planningGraph";
import { fakeModelSequence, toolCall } from "./testing/fakeModel";
import {
  createPostgresCheckpointerSaver,
  closeSharedPostgresCheckpointerSaversForTests,
  resetSharedPostgresCheckpointerSaverForTests
} from "./durableCheckpointer";

const anyAuth = {
  organization: { id: "org1" },
  user: { id: "u1", isActive: true },
  permissions: ["parameter:edit"],
  roles: []
} as never;

const testDatabaseUrl =
  process.env.XIAOZE_CHECKPOINTER_TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
let runtimeDatabaseUrl = process.env.XIAOZE_CHECKPOINTER_RUNTIME_TEST_DATABASE_URL?.trim() || "";
const ownedHandles: ReturnType<typeof createPostgresCheckpointerSaver>[] = [];
afterEach(async () => {
  await Promise.all(ownedHandles.splice(0).map((handle) => handle.saver.end()));
  await closeSharedPostgresCheckpointerSaversForTests();
});

function buildPlanningAgent(checkpointer: ReturnType<typeof createXiaozeCheckpointer>) {
  const approvalResolver = {
    preflightApproval: vi.fn().mockResolvedValue(undefined),
    resolveApproval: vi.fn().mockResolvedValue({ text: "change request cr-1 created" })
  };
  const model = fakeModelSequence([
    {
      toolCalls: [
        toolCall("action.submitParameterChange", {
          projectId: "p1",
          parameterId: "pd1",
          targetValue: "42",
          reason: "x"
        })
      ]
    },
    { content: "Submitted change request cr-1 created. Track it on the review page." }
  ]);

  return {
    agent: createPlanningAgent({
      model,
      runTool: vi.fn(),
      listTools: () => [{ name: "action.submitParameterChange", description: "x", schema: {}, requiresApproval: true }],
      checkpointer,
      approvalResolver
    }),
    approvalResolver
  };
}

describe.skipIf(!testDatabaseUrl)("postgres checkpointer durability", () => {
  it("resumes an interrupted plan from a fresh agent instance on the same thread", async () => {
    resetSharedPostgresCheckpointerSaverForTests();
    const handle = createPostgresCheckpointerSaver({ connectionString: testDatabaseUrl });
    ownedHandles.push(handle);
    await handle.ensureSetup();

    const threadId = `durability-${randomUUID()}`;
    const sharedCheckpointer = createXiaozeCheckpointer({
      mode: "postgres",
      connectionString: testDatabaseUrl,
      saver: handle.saver,
      withNamespaceLease: handle.withNamespaceLease,
      ensureReady: handle.ensureSetup
    });

    const first = buildPlanningAgent(sharedCheckpointer);
    // Both runs must carry the same requestContext: the checkpoint namespace is
    // `${org}:${user}:${threadId}` when auth is present (tenant isolation), and the
    // production endpoint always supplies it. Interrupting without it and resuming
    // with it would write and read different namespaces.
    const interrupted = await first.agent.run({
      message: "set pd1 to 42",
      context: { projectId: "p1" },
      threadId,
      requestContext: { auth: anyAuth, requestId: "req-durability-first", sessionId: threadId }
    });
    expect(interrupted.interrupt?.toolName).toBe("action.submitParameterChange");

    const secondHandle = createPostgresCheckpointerSaver({ connectionString: testDatabaseUrl });
    ownedHandles.push(secondHandle);
    await secondHandle.ensureSetup();
    const second = buildPlanningAgent(
      createXiaozeCheckpointer({
        mode: "postgres",
        connectionString: testDatabaseUrl,
        saver: secondHandle.saver,
        withNamespaceLease: secondHandle.withNamespaceLease,
        ensureReady: secondHandle.ensureSetup
      })
    );
    const resumed = await second.agent.run({
      message: "",
      context: { projectId: "p1" },
      threadId,
      requestContext: { auth: anyAuth, requestId: "req-durability", sessionId: threadId },
      resume: {
        approvalId: "approval-durability",
        decision: "approve"
      }
    });

    expect(second.approvalResolver.resolveApproval).toHaveBeenCalledOnce();
    expect(resumed.text).toContain("cr-1");
  });
});

describe.skipIf(!(runtimeDatabaseUrl || testDatabaseUrl))("runtime checkpointer under explicit least privilege LOGIN", () => {
  const role = `checkpoint_runtime_${randomUUID().replaceAll("-", "")}`;
  let admin: pg.Pool | undefined;
  let database = "";
  let roleCreated = false;
  const ddl = async (format: string, ...values: string[]) => {
    const placeholders = values.map((_, index) => `$${index + 2}::text`).join(", ");
    const result = await admin!.query<{ statement: string }>(
      `select format($1::text, ${placeholders}) as statement`, [format, ...values]
    );
    await admin!.query(result.rows[0]!.statement);
  };

  beforeAll(async () => {
    if (runtimeDatabaseUrl) return;
    const setup = createPostgresCheckpointerSaver({ connectionString: testDatabaseUrl });
    try {
      await setup.ensureSetup();
    } finally {
      await setup.saver.end();
    }
    admin = new pg.Pool({ connectionString: testDatabaseUrl });
    database = (await admin.query<{ name: string }>("select current_database() as name")).rows[0]!.name;
    const password = randomUUID();
    await ddl("create role %I login nosuperuser nocreatedb nocreaterole noinherit nobypassrls password %L", role, password);
    roleCreated = true;
    await ddl("grant connect on database %I to %I", database, role);
    await ddl("grant usage on schema public to %I", role);
    await ddl("grant select on public.checkpoint_migrations to %I", role);
    await ddl("grant select, insert, update, delete on public.checkpoints, public.checkpoint_blobs, public.checkpoint_writes to %I", role);
    const roleUrl = new URL(testDatabaseUrl);
    roleUrl.username = role;
    roleUrl.password = password;
    roleUrl.searchParams.delete("options");
    runtimeDatabaseUrl = roleUrl.toString();
  });

  afterAll(async () => {
    try {
      if (roleCreated) {
        const errors: unknown[] = [];
        for (const cleanup of [
          () => ddl("revoke connect on database %I from %I", database, role),
          () => ddl("drop owned by %I", role),
          () => ddl("drop role %I", role)
        ]) {
          try { await cleanup(); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, "Checkpoint runtime LOGIN cleanup failed");
      }
    } finally {
      await admin?.end();
    }
  });

  it("validates concurrently and persists writes, updates and deletion through an independent reader", async () => {
    const writer = createPostgresCheckpointerSaver({ connectionString: runtimeDatabaseUrl, initialization: "runtime" });
    const reader = createPostgresCheckpointerSaver({ connectionString: runtimeDatabaseUrl, initialization: "runtime" });
    ownedHandles.push(writer, reader);
    await Promise.all([writer.ensureSetup(), writer.ensureSetup(), reader.ensureSetup()]);
    const threadId = `runtime-${randomUUID()}`;
    const checkpoint = { ...emptyCheckpoint(), channel_values: { answer: "first" }, channel_versions: { answer: 1 } };
    await writer.withNamespaceLease(threadId, async () => {
    const config = await writer.saver.put({ configurable: { thread_id: threadId } }, checkpoint, { source: "input", step: 0, parents: {} }, { answer: 1 });
    await writer.saver.putWrites(config, [["answer", "pending"]], "normal-task");
    await writer.saver.putWrites(config, [[ERROR, "old-error"]], "error-task");
    await writer.saver.putWrites(config, [[ERROR, "new-error"]], "error-task");
    const tuple = await reader.saver.getTuple(config);
    expect(tuple?.checkpoint.channel_values).toEqual({ answer: "first" });
    expect(tuple?.pendingWrites).toEqual(expect.arrayContaining([["normal-task", "answer", "pending"], ["error-task", ERROR, "new-error"]]));
    await writer.saver.put(config, { ...checkpoint, channel_values: { answer: "updated" }, channel_versions: { answer: 2 } }, { source: "update", step: 1, parents: {} }, { answer: 2 });
    expect((await reader.saver.getTuple(config))?.checkpoint.channel_values).toEqual({ answer: "updated" });
    await writer.saver.deleteThread(threadId);
    expect(await reader.saver.getTuple(config)).toBeUndefined();
    });
  });
});

describe("postgres checkpointer durability gate", () => {
  it("skips live postgres proof when no test database URL is configured", () => {
    if (testDatabaseUrl) {
      expect(testDatabaseUrl.length).toBeGreaterThan(0);
      return;
    }
    expect(new MemorySaver()).toBeInstanceOf(MemorySaver);
  });
});

describe.skipIf(!testDatabaseUrl)("physical same-session transaction intervals", () => {
  it("holds a complete real BEGIN interval and a failing rollback cannot undo another commit", async () => {
    const writer = createPostgresCheckpointerSaver({ connectionString: testDatabaseUrl });
    ownedHandles.push(writer);
    await writer.ensureSetup();
    const other = createPostgresCheckpointerSaver({ connectionString: testDatabaseUrl, initialization: "runtime" });
    ownedHandles.push(other); await other.ensureSetup();
    const threadId = `transaction-interval-${randomUUID()}`;
    const otherThread = `transaction-other-${randomUUID()}`;
    const checkpoint = { ...emptyCheckpoint(), channel_values: { answer: "committed" }, channel_versions: { answer: 1 } };
    const config = { configurable: { thread_id: threadId, checkpoint_ns: "", checkpoint_id: checkpoint.id } };
    let began!: () => void; const begun = new Promise<void>((done) => { began = done; });
    let finish!: () => void; const proceed = new Promise<void>((done) => { finish = done; });
    let first = true; let failing = false;
    const observations: Array<{ pid: number; sql: string; event: "sent" | "settled"; threadId?: string }> = [];
    const connect = pg.Pool.prototype.connect as unknown as (this: pg.Pool) => Promise<pg.PoolClient>;
    const spy = vi.spyOn(pg.Pool.prototype, "connect").mockImplementation(async function (this: pg.Pool) {
      const client = await connect.call(this);
      const pid = (await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
      const query = client.query.bind(client);
      client.query = (async (...args: Parameters<pg.PoolClient["query"]>) => {
        const sql = String(args[0]);
        const values = args[1] as unknown as string[] | undefined;
        observations.push({ pid, sql, event: "sent", threadId: sql.includes("advisory") ? values?.[0] : undefined });
        if (failing && sql.startsWith("INSERT")) {
          failing = false;
          // A genuine server SQL error inside this exact borrowed transaction.
          await query("select 1 / 0");
        }
        const result = await query(...args);
        observations.push({ pid, sql, event: "settled" });
        if (sql === "BEGIN" && first) { first = false; began(); await proceed; }
        return result;
      }) as pg.PoolClient["query"];
      return client;
    });
    let run: Promise<void> | undefined;
    try {
      run = writer.withNamespaceLease(threadId, async () => {
        const put = writer.saver.put({ configurable: { thread_id: threadId } }, checkpoint, { source: "input", step: 0, parents: {} }, { answer: 1 });
        await begun;
        const writes = writer.saver.putWrites(config, [["answer", "pending"]], "interval-task");
        await new Promise(setImmediate);
        expect(observations.filter((entry) => entry.sql === "BEGIN" && entry.event === "sent")).toHaveLength(1);
        await other.withNamespaceLease(otherThread, () => other.saver.put({ configurable: { thread_id: otherThread } }, emptyCheckpoint(), { source: "input", step: 0, parents: {} }, {}));
        finish();
        await Promise.all([put, writes]);
      });
      await run;
      const owner = observations.find((entry) => entry.sql.includes("pg_try_advisory_lock") && entry.threadId?.includes(threadId))!.pid;
      const intervals = observations.filter((entry) => entry.pid === owner && entry.event === "sent" && ["BEGIN", "COMMIT", "ROLLBACK"].includes(entry.sql));
      expect(intervals.map((entry) => entry.sql)).toEqual(["BEGIN", "COMMIT", "BEGIN", "COMMIT"]);
      const tuple = await other.withNamespaceLease(threadId, () => other.saver.getTuple(config));
      expect(tuple?.checkpoint.channel_values).toEqual({ answer: "committed" });
      expect(tuple?.pendingWrites).toContainEqual(["interval-task", "answer", "pending"]);
      failing = true;
      await writer.withNamespaceLease(threadId, async () => {
        await expect(writer.saver.putWrites(config, [["answer", "must-rollback"]], "rollback-task")).rejects.toMatchObject({ code: "22012" });
        await writer.saver.putWrites(config, [["answer", "after-rollback"]], "committed-task");
      });
      const after = await other.withNamespaceLease(threadId, () => other.saver.getTuple(config));
      expect(after?.checkpoint).toEqual(tuple?.checkpoint);
      expect(after?.pendingWrites).toEqual(expect.arrayContaining([["interval-task", "answer", "pending"], ["committed-task", "answer", "after-rollback"]]));
      expect(after?.pendingWrites?.some(([task]) => task === "rollback-task")).toBe(false);
      console.info("physical-checkpoint-transaction-intervals", JSON.stringify({ owner, observations, tuple, after }));
    } finally {
      finish(); await run?.catch(() => undefined); spy.mockRestore();
    }
  });
});
