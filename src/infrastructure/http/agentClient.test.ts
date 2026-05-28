import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "./apiClient";
import { createHttpAgentGateway } from "./agentClient";
import type { AgentTurnDto } from "./agentDtos";

const turnDto: AgentTurnDto = {
  session: {
    id: "session-1",
    context: {
      path: "/parameter-review",
      pageKey: "parameter-review",
      projectId: "aurora"
    },
    messages: [
      {
        id: "agent-msg-1",
        role: "system",
        content: "Parameter review",
        createdAt: "2026-05-27T00:00:00.000Z"
      }
    ]
  },
  messages: [
    {
      id: "agent-msg-2",
      role: "assistant",
      content: "Review summary",
      confidence: 0.82,
      createdAt: "2026-05-27T00:00:01.000Z"
    }
  ],
  toolCalls: [
    {
      id: "tool-1",
      name: "parameter.summarizeReviewQueue",
      label: "Summarize review queue",
      payload: { projectId: "aurora" },
      requiresApproval: false,
      status: "succeeded",
      createdAt: "2026-05-27T00:00:01.000Z"
    }
  ],
  approvals: []
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function createFetchMock(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => jsonResponse(body, status));
}

function createGateway(fetchMock: typeof fetch) {
  return createHttpAgentGateway(createApiClient({ baseUrl: "http://127.0.0.1:8787", fetchImpl: fetchMock }));
}

describe("createHttpAgentGateway", () => {
  it("starts sessions through the agent sessions endpoint and returns the envelope session", async () => {
    const fetchMock = createFetchMock({ turn: turnDto });
    const gateway = createGateway(fetchMock);
    const context = { path: "/parameter-review", pageKey: "parameter-review", projectId: "aurora" };

    await expect(gateway.startSession(context)).resolves.toEqual(turnDto.session);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/v1/agent/sessions",
      expect.objectContaining({
        body: JSON.stringify({ context }),
        method: "POST"
      })
    );
  });

  it("sends messages through the encoded session route and returns the mapped turn", async () => {
    const fetchMock = createFetchMock({ turn: turnDto });
    const gateway = createGateway(fetchMock);

    await expect(gateway.sendMessage("session/with spaces", "Summarize this page")).resolves.toEqual(turnDto);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/v1/agent/sessions/session%2Fwith%20spaces/messages",
      expect.objectContaining({
        body: JSON.stringify({ message: "Summarize this page" }),
        method: "POST"
      })
    );
  });

  it("runs tool calls through the encoded run route with payload", async () => {
    const fetchMock = createFetchMock({ turn: turnDto });
    const gateway = createGateway(fetchMock);
    const payload = { projectId: "aurora", dryRun: true };

    await expect(gateway.runAction("session/with spaces", "tool/with spaces", payload)).resolves.toEqual(turnDto);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/v1/agent/sessions/session%2Fwith%20spaces/tool-calls/tool%2Fwith%20spaces/run",
      expect.objectContaining({
        body: JSON.stringify({ payload }),
        method: "POST"
      })
    );
  });

  it("approves tool calls with the pending approval status guard", async () => {
    const fetchMock = createFetchMock({ turn: turnDto });
    const gateway = createGateway(fetchMock);

    await expect(gateway.approveToolCall("session-1", "approval-1")).resolves.toEqual(turnDto);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/v1/agent/sessions/session-1/approvals/approval-1/approve",
      expect.objectContaining({
        body: JSON.stringify({ expectedToolCallStatus: "pending_approval" }),
        method: "POST"
      })
    );
  });

  it("rejects tool calls with an optional reason", async () => {
    const fetchMock = createFetchMock({ turn: turnDto });
    const gateway = createGateway(fetchMock);

    await expect(gateway.rejectToolCall("session-1", "approval-1", "Needs clearer evidence")).resolves.toEqual(turnDto);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/v1/agent/sessions/session-1/approvals/approval-1/reject",
      expect.objectContaining({
        body: JSON.stringify({ reason: "Needs clearer evidence" }),
        method: "POST"
      })
    );
  });

  it("rejects tool calls with an empty body when no reason is supplied", async () => {
    const fetchMock = createFetchMock({ turn: turnDto });
    const gateway = createGateway(fetchMock);

    await expect(gateway.rejectToolCall("session-1", "approval-1")).resolves.toEqual(turnDto);

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({});
  });
});
