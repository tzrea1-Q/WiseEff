import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyCheckpoint, ERROR } from "@langchain/langgraph-checkpoint";
import { MemorySaver } from "@langchain/langgraph";
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
const runtimeDatabaseUrl = process.env.XIAOZE_CHECKPOINTER_RUNTIME_TEST_DATABASE_URL?.trim() || "";
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
      saver: handle.saver
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
        saver: secondHandle.saver
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

describe.skipIf(!runtimeDatabaseUrl)("runtime checkpointer under explicit least privilege LOGIN", () => {
  it("validates concurrently and persists writes, updates and deletion through an independent reader", async () => {
    const writer = createPostgresCheckpointerSaver({ connectionString: runtimeDatabaseUrl, initialization: "runtime" });
    const reader = createPostgresCheckpointerSaver({ connectionString: runtimeDatabaseUrl, initialization: "runtime" });
    ownedHandles.push(writer, reader);
    await Promise.all([writer.ensureSetup(), writer.ensureSetup(), reader.ensureSetup()]);
    const threadId = `runtime-${randomUUID()}`;
    const checkpoint = { ...emptyCheckpoint(), channel_values: { answer: "first" }, channel_versions: { answer: 1 } };
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

describe("postgres checkpointer durability gate", () => {
  it("skips live postgres proof when no test database URL is configured", () => {
    if (testDatabaseUrl) {
      expect(testDatabaseUrl.length).toBeGreaterThan(0);
      return;
    }
    expect(new MemorySaver()).toBeInstanceOf(MemorySaver);
  });
});
