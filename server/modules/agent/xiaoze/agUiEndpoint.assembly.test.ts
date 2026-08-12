import { describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/core";

vi.mock("../../parameters/service", () => ({
  submitParameterChanges: vi.fn()
}));

vi.mock("../../parameters/sensitiveNode", () => ({
  assertSensitiveNodeWriteAllowed: vi.fn()
}));

vi.mock("../../parameters/repository", () => ({
  getProjectParameterForUpdate: vi.fn()
}));

import { createRouter } from "../../../shared/http/router";
import { developmentAuthContext } from "../../auth/routes";
import { createMemoryAgentDb } from "../testing/memoryAgentDb";
import { registerXiaozeRoutes } from "./agUiEndpoint";
import { submitParameterChanges } from "../../parameters/service";
import { getProjectParameterForUpdate } from "../../parameters/repository";

const mockedSubmit = vi.mocked(submitParameterChanges);
const mockedGetParameter = vi.mocked(getProjectParameterForUpdate);

type SseEvent = { event: string; data: unknown };

async function postXiaoze(router: ReturnType<typeof createRouter>, requestId: string, body: Record<string, unknown>) {
  const response = await router.handle({
    method: "POST",
    path: "/api/v1/agent/xiaoze",
    params: {},
    query: {},
    headers: { authorization: "Bearer dev" },
    requestId,
    body
  });
  const events: SseEvent[] = [];
  if ("sse" in response) {
    for await (const event of response.sse as AsyncIterable<SseEvent>) {
      events.push(event);
    }
  }
  return { response, events };
}

function readInterruptApprovalId(events: SseEvent[]) {
  const finished = events.find((event) => event.event === EventType.RUN_FINISHED);
  const outcome = (finished?.data as { outcome?: { type?: string; interrupts?: Array<{ id?: string }> } })?.outcome;
  return { outcomeType: outcome?.type, approvalId: outcome?.interrupts?.[0]?.id };
}

/**
 * Assembly-level regression for the double-approval-bridge defect: begin and
 * resume must operate on the same DB-backed approval chain wired by
 * registerXiaozeRoutes, so an approval with editedArgs executes the edited
 * payload. This drives the real router, the real deterministic model, the real
 * planning graph, the real orchestrator, and the shared memory agent DB.
 */
describe("registerXiaozeRoutes approval assembly", () => {
  it("executes the edited payload when an approval is resumed with editedArgs", async () => {
    mockedGetParameter.mockResolvedValue(null as never);
    mockedSubmit.mockResolvedValue({ id: "batch-1", items: [{ requestId: "cr-777" }] } as never);

    const { db, tables } = createMemoryAgentDb();
    const router = createRouter();
    registerXiaozeRoutes(router, {
      db,
      getCurrentAuthContext: () => developmentAuthContext
    });

    const threadId = "thread-assembly-edited";
    const started = await postXiaoze(router, "req-assembly-1", {
      threadId,
      runId: "run-assembly-1",
      messages: [{ id: "m-user", role: "user", content: "set pd-1 to 3100" }],
      context: [
        {
          description: "wiseeff.page",
          value: { pageKey: "parameters", projectId: "aurora", path: "/parameters?project=aurora" }
        }
      ]
    });

    const interrupt = readInterruptApprovalId(started.events);
    expect(interrupt.outcomeType).toBe("interrupt");
    expect(interrupt.approvalId).toBeTruthy();
    expect(mockedSubmit).not.toHaveBeenCalled();
    expect(tables.toolCalls[0]).toMatchObject({ status: "pending_approval" });

    const editedArgs = {
      projectId: "aurora",
      parameterId: "pd-1",
      targetValue: "3600",
      reason: "edited before approval"
    };
    const resumed = await postXiaoze(router, "req-assembly-2", {
      threadId,
      runId: "run-assembly-2",
      messages: [{ id: "m-resume", role: "user", content: "approve" }],
      resume: [
        {
          interruptId: interrupt.approvalId,
          status: "resolved",
          payload: {
            approvalId: interrupt.approvalId,
            decision: "approve",
            editedArgs
          }
        }
      ]
    });

    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    expect(mockedSubmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        projectId: "aurora",
        items: [expect.objectContaining({ parameterId: "pd-1", targetValue: "3600" })]
      }),
      expect.objectContaining({ actorType: "agent" })
    );
    expect(JSON.parse(String(tables.toolCalls[0].payload))).toMatchObject({ targetValue: "3600" });
    expect(tables.toolCalls[0]).toMatchObject({ status: "succeeded" });
    expect(tables.approvals[0]).toMatchObject({ status: "approved" });

    const finished = resumed.events.find((event) => event.event === EventType.RUN_FINISHED);
    expect((finished?.data as { outcome?: { type?: string } })?.outcome?.type).toBe("success");
    const answer = resumed.events
      .filter((event) => event.event === EventType.TEXT_MESSAGE_CONTENT)
      .map((event) => (event.data as { delta?: string }).delta ?? "")
      .join("");
    expect(answer).toContain("cr-777");

    const auditActions = tables.audits.map((row) => row.action);
    expect(auditActions).toContain("approval-requested");
    expect(auditActions).toContain("approval-executed");
  });

  it("rejects an approval through the same chain without executing the tool", async () => {
    mockedGetParameter.mockResolvedValue(null as never);
    mockedSubmit.mockReset();

    const { db, tables } = createMemoryAgentDb();
    const router = createRouter();
    registerXiaozeRoutes(router, {
      db,
      getCurrentAuthContext: () => developmentAuthContext
    });

    const threadId = "thread-assembly-reject";
    const started = await postXiaoze(router, "req-assembly-3", {
      threadId,
      runId: "run-assembly-3",
      messages: [{ id: "m-user", role: "user", content: "set pd-2 to 42" }],
      context: [
        {
          description: "wiseeff.page",
          value: { pageKey: "parameters", projectId: "aurora", path: "/parameters?project=aurora" }
        }
      ]
    });
    const interrupt = readInterruptApprovalId(started.events);
    expect(interrupt.approvalId).toBeTruthy();

    await postXiaoze(router, "req-assembly-4", {
      threadId,
      runId: "run-assembly-4",
      messages: [{ id: "m-resume", role: "user", content: "reject" }],
      resume: [
        {
          interruptId: interrupt.approvalId,
          status: "cancelled",
          payload: {
            approvalId: interrupt.approvalId,
            decision: "reject",
            reason: "Not now"
          }
        }
      ]
    });

    expect(mockedSubmit).not.toHaveBeenCalled();
    expect(tables.toolCalls[0]).toMatchObject({ status: "rejected" });
    expect(tables.approvals[0]).toMatchObject({ status: "rejected", decision_reason: "Not now" });
  });
});
