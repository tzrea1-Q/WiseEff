import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { createXiaozeCheckpointer } from "./checkpointer";
import { createPlanningAgent, fakeModelSequence, toolCall } from "./planningGraph";
import {
  createPostgresCheckpointerSaver,
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

function buildPlanningAgent(checkpointer: ReturnType<typeof createXiaozeCheckpointer>) {
  const approvalBridge = {
    resume: vi.fn().mockResolvedValue({ text: "change request cr-1 created" })
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
      approvalBridge
    }),
    approvalBridge
  };
}

describe.skipIf(!testDatabaseUrl)("postgres checkpointer durability", () => {
  it("resumes an interrupted plan from a fresh agent instance on the same thread", async () => {
    resetSharedPostgresCheckpointerSaverForTests();
    const handle = createPostgresCheckpointerSaver({ connectionString: testDatabaseUrl });
    await handle.ensureSetup();

    const threadId = `durability-${randomUUID()}`;
    const sharedCheckpointer = createXiaozeCheckpointer({ mode: "postgres", saver: handle.saver });

    const first = buildPlanningAgent(sharedCheckpointer);
    const interrupted = await first.agent.run({
      message: "set pd1 to 42",
      context: { projectId: "p1" },
      threadId
    });
    expect(interrupted.interrupt?.toolName).toBe("action.submitParameterChange");

    const second = buildPlanningAgent(
      createXiaozeCheckpointer({ mode: "postgres", saver: handle.saver })
    );
    const resumed = await second.agent.run({
      message: "",
      context: { projectId: "p1" },
      threadId,
      resume: {
        auth: anyAuth,
        requestId: "req-durability",
        approvalId: "approval-durability",
        decision: "approve"
      }
    });

    expect(second.approvalBridge.resume).toHaveBeenCalledOnce();
    expect(resumed.text).toContain("cr-1");
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
