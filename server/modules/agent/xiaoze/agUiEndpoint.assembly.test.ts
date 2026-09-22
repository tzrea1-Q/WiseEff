import { describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/core";

vi.mock("../../parameter-bindings/drafts", () => ({
  createCanonicalValueDraft: vi.fn(),
  loadCanonicalBindingPins: vi.fn(),
  submitCanonicalValueChange: vi.fn()
}));

vi.mock("../approvedParameterInvocation", () => ({
  APPROVED_PARAMETER_PAYLOAD_KEY: "approvedParameter",
  requireApprovedParameterInvocation: vi.fn()
}));

vi.mock("../../parameter-kernel/sensitiveNode", () => ({
  assertSensitiveNodeWriteAllowed: vi.fn(),
  assertTrustedSensitiveNodeSubmissionAllowed: vi.fn()
}));

vi.mock("../../parameters/repository", () => ({
  deleteDraft: vi.fn(),
  getProjectParameterForUpdate: vi.fn()
}));

vi.mock("../../parameter-kernel/parameterIdentityMode", () => ({
  resolveParameterIdentityMode: vi.fn().mockResolvedValue("semantic")
}));

vi.mock("../../parameter-topology/service", () => ({
  createBindingDraft: vi.fn()
}));

vi.mock("../../parameter-topology/writeLock", () => ({
  loadBindingContext: vi.fn(),
  loadLogicalNodeSubmissionContext: vi.fn(),
  resolveBindingHeadRevisionId: vi.fn()
}));

import { createRouter } from "../../../shared/http/router";
import { developmentAuthContext } from "../../auth/routes";
import { createAgentSession } from "../repository";
import { createMemoryAgentDb } from "../testing/memoryAgentDb";
import { registerXiaozeRoutes } from "./agUiEndpoint";
import {
  createCanonicalValueDraft,
  loadCanonicalBindingPins,
  submitCanonicalValueChange
} from "../../parameter-bindings/drafts";
import { requireApprovedParameterInvocation } from "../approvedParameterInvocation";
import { testRefusalAuditSink } from "../../audit/testRefusalSink";

const mockedSubmit = vi.mocked(submitCanonicalValueChange);
const mockedLoadPins = vi.mocked(loadCanonicalBindingPins);
const mockedCreateDraft = vi.mocked(createCanonicalValueDraft);
const mockedApproved = vi.mocked(requireApprovedParameterInvocation);

function primeParameterMocks(editedRawText: string) {
  const pins = {
    bindingId: "pd-1",
    projectId: "aurora",
    organizationId: "org-chargelab",
    definitionId: "def-1",
    definitionRevisionId: "revision-1",
    catalogReleaseId: "release-1",
    currentValueId: "value-1",
    configRevisionId: "rev-base",
    sourceRef: "config.dts",
    sourcePinId: "source-pin-1",
    sourceFormat: "dts" as const
  };
  mockedLoadPins.mockResolvedValue(pins);
  mockedApproved.mockResolvedValue({
    pins: {
      projectId: pins.projectId,
      bindingId: pins.bindingId,
      expectedValueId: pins.currentValueId,
      definitionId: pins.definitionId,
      definitionRevisionId: pins.definitionRevisionId,
      catalogReleaseId: pins.catalogReleaseId,
      configRevisionId: pins.configRevisionId,
      sourceRef: pins.sourceRef,
      sourcePinId: pins.sourcePinId,
      sourceFormat: pins.sourceFormat
    }
  } as never);
  mockedCreateDraft.mockResolvedValue({
    id: "draft-1",
    bindingId: "pd-1",
    definitionId: "def-1",
    effectiveRevisionId: "revision-1",
    currentValueId: "value-1",
    targetValue: editedRawText,
    sourceFormat: "dts",
    baseRevisionId: "rev-base",
    sourcePinId: "source-pin-1",
    candidateId: "candidate-1",
    reason: "edited before approval",
    updatedAt: new Date().toISOString(),
    action: "set"
  });
}

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
  it("normalizes a partial route env before resolving the Xiaoze model label", async () => {
    const { db } = createMemoryAgentDb();
    const router = createRouter();
    registerXiaozeRoutes(router, {
      db,
      refusalAuditSink: testRefusalAuditSink,
      env: {
        XIAOZE_PROACTIVE_ENABLED: false,
        XIAOZE_CHECKPOINTER: "memory",
        XIAOZE_REASONING_FALLBACK_HEURISTIC: false
      } as never,
      getCurrentAuthContext: () => developmentAuthContext,
      createAgent: () => ({
        run: async () => ({ text: "normalized", citations: [] })
      })
    });

    const { events } = await postXiaoze(router, "req-partial-env", {
      threadId: "thread-partial-env",
      runId: "run-partial-env",
      messages: [{ id: "m-user", role: "user", content: "hello" }]
    });

    expect(events.some((event) => event.event === EventType.RUN_ERROR)).toBe(false);
    expect(events.some((event) => event.event === EventType.RUN_FINISHED)).toBe(true);
  });

  it("executes the edited payload when an approval is resumed with editedArgs", async () => {
    primeParameterMocks("<3600>");
    mockedSubmit.mockResolvedValue({ id: "cr-777" } as never);

    const { db, tables } = createMemoryAgentDb();
    const router = createRouter();
    registerXiaozeRoutes(router, {
      db,
      refusalAuditSink: testRefusalAuditSink,
      getCurrentAuthContext: () => developmentAuthContext
    });

    const threadId = "thread-assembly-edited";
    const started = await postXiaoze(router, "req-assembly-1", {
      threadId,
      runId: "run-assembly-1",
      messages: [{ id: "m-user", role: "user", content: "set pd-1 to <3100>" }],
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
      targetValue: "<3600>",
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

    expect(mockedCreateDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        projectId: "aurora",
        bindingId: "pd-1",
        baseRevisionId: "rev-base",
        baseCurrentValueId: "value-1",
        action: "set",
        targetValue: {
          kind: "cells",
          bits: 32,
          groups: [[{ kind: "integer", raw: "3600", value: "3600" }]]
        }
      }),
      expect.objectContaining({
        invocation: expect.anything(),
        requestId: expect.any(String),
        refusalSink: testRefusalAuditSink
      })
    );
    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    expect(mockedSubmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        projectId: "aurora",
        draftId: "draft-1",
        invocation: expect.objectContaining({
          initiator: "agent",
          sessionId: threadId,
          toolCallId: expect.any(String),
          approvalId: interrupt.approvalId
        }),
        requestId: "req-assembly-2",
        refusalSink: testRefusalAuditSink
      }
    );
    expect(JSON.parse(String(tables.toolCalls[0].payload))).toMatchObject({ targetValue: "<3600>" });
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
    primeParameterMocks("<42>");
    mockedSubmit.mockReset();

    const { db, tables } = createMemoryAgentDb();
    const router = createRouter();
    registerXiaozeRoutes(router, {
      db,
      refusalAuditSink: testRefusalAuditSink,
      getCurrentAuthContext: () => developmentAuthContext
    });

    const threadId = "thread-assembly-reject";
    const started = await postXiaoze(router, "req-assembly-3", {
      threadId,
      runId: "run-assembly-3",
      messages: [{ id: "m-user", role: "user", content: "set pd-2 to <42>" }],
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

  it("persists a Chinese halt and leaves the thread usable when approved execution fails", async () => {
    const { ApiError } = await import("../../../shared/http/errors");
    mockedSubmit.mockReset();
    mockedCreateDraft.mockReset();
    primeParameterMocks("<3100>");

    const { db, tables } = createMemoryAgentDb();
    const router = createRouter();
    registerXiaozeRoutes(router, {
      db,
      refusalAuditSink: testRefusalAuditSink,
      getCurrentAuthContext: () => developmentAuthContext
    });

    const threadId = "thread-assembly-exec-fail";
    const started = await postXiaoze(router, "req-assembly-fail-1", {
      threadId,
      runId: "run-assembly-fail-1",
      messages: [{ id: "m-user", role: "user", content: "set pd-1 to <3100>" }],
      context: [
        {
          description: "wiseeff.page",
          value: { pageKey: "parameters", projectId: "aurora", path: "/parameters?project=aurora" }
        }
      ]
    });
    const interrupt = readInterruptApprovalId(started.events);
    expect(interrupt.approvalId).toBeTruthy();

    mockedCreateDraft.mockRejectedValue(
      new ApiError("CONFLICT", "请刷新后基于本轮最新工作版本继续编辑。", {
        reason: "stale-working-tip"
      })
    );

    const resumed = await postXiaoze(router, "req-assembly-fail-2", {
      threadId,
      runId: "run-assembly-fail-2",
      messages: [{ id: "m-resume", role: "user", content: "approve" }],
      resume: [
        {
          interruptId: interrupt.approvalId,
          status: "resolved",
          payload: {
            approvalId: interrupt.approvalId,
            decision: "approve"
          }
        }
      ]
    });

    expect(resumed.events.some((event) => event.event === EventType.RUN_ERROR)).toBe(false);
    const finished = resumed.events.find((event) => event.event === EventType.RUN_FINISHED);
    expect((finished?.data as { outcome?: { type?: string } })?.outcome?.type).toBe("success");
    const answer = resumed.events
      .filter((event) => event.event === EventType.TEXT_MESSAGE_CONTENT)
      .map((event) => (event.data as { delta?: string }).delta ?? "")
      .join("");
    expect(answer).toContain("操作未能完成");
    expect(answer).toContain("请刷新后基于本轮最新工作版本继续编辑");
    expect(tables.toolCalls[0]).toMatchObject({ status: "failed" });
    expect(tables.approvals[0]).toMatchObject({ status: "approved" });
    expect(tables.audits.map((row) => row.action)).toContain("approval-execution-failed");
    expect(tables.messages.some((row) => String(row.role) === "assistant" && String(row.content).includes("操作未能完成"))).toBe(
      true
    );

    const followUp = await postXiaoze(router, "req-assembly-fail-3", {
      threadId,
      runId: "run-assembly-fail-3",
      messages: [{ id: "m-follow", role: "user", content: "然后呢" }]
    });
    const followUpError = followUp.events.find((event) => event.event === EventType.RUN_ERROR);
    expect(JSON.stringify(followUpError ?? {})).not.toMatch(/pending interrupt/i);
    expect(followUp.events.some((event) => event.event === EventType.RUN_STARTED)).toBe(true);
  });

  it("refuses to run against a thread owned by another same-org user", async () => {
    const { db, tables } = createMemoryAgentDb();
    const owner = developmentAuthContext;
    const intruder = {
      ...owner,
      user: { ...owner.user, id: "u-intruder" }
    };
    let currentAuth = owner;
    const router = createRouter();
    registerXiaozeRoutes(router, {
      db,
      refusalAuditSink: testRefusalAuditSink,
      getCurrentAuthContext: () => currentAuth
    });

    const threadId = "thread-assembly-ownership";
    await createAgentSession(db, {
      id: threadId,
      organizationId: owner.organization.id,
      projectId: "aurora",
      actorUserId: owner.user.id,
      pageKey: "xiaoze",
      roleId: "hardware-user",
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" },
      title: "Owner thread"
    });
    const messagesBefore = tables.messages.length;

    currentAuth = intruder;
    await expect(
      postXiaoze(router, "req-assembly-intruder", {
        threadId,
        runId: "run-assembly-intruder",
        messages: [{ id: "m-intruder", role: "user", content: "inject into someone else's thread" }]
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    // No message may be appended to the owner's thread by the intruder.
    expect(tables.messages.length).toBe(messagesBefore);

    // The owner still passes the ownership gate: the run starts streaming
    // instead of being rejected up front (tool SQL support in the memory DB is
    // out of scope here).
    currentAuth = owner;
    const ownerRun = await postXiaoze(router, "req-assembly-owner", {
      threadId,
      runId: "run-assembly-owner",
      messages: [{ id: "m-owner", role: "user", content: "你好" }]
    });
    expect(ownerRun.events.some((event) => event.event === EventType.RUN_STARTED)).toBe(true);
  });
});
