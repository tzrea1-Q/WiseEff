import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentInvocation } from "../auth/trustedInvocation";
import type { AgentApprovalRecord, AgentSessionRecord, AgentToolCallRecord } from "./repository";

vi.mock("./repository", () => ({
  getAgentApproval: vi.fn(),
  getAgentSession: vi.fn(),
  getAgentToolCall: vi.fn()
}));

import { getAgentApproval, getAgentSession, getAgentToolCall } from "./repository";
import { requireApprovedParameterInvocation } from "./approvedParameterInvocation";

const auth = {
  organization: { id: "org-905", name: "Issue 905" },
  user: { id: "user-905", organizationId: "org-905", name: "Editor", title: "Software User", isActive: true },
  roles: [{ roleId: "software-user", projectId: "project-905" }],
  permissions: ["parameter:edit"]
} as const;

const invocation = createAgentInvocation(auth, {
  sessionId: "session-905",
  toolCallId: "tool-905",
  approval: { required: true, approvalId: "approval-905" }
});

const payload = {
  projectId: "project-905",
  parameterId: "binding-905",
  targetValue: "<0xE10>",
  reason: "normalize the current limit",
  approvedParameter: {
    projectId: "project-905",
    bindingId: "binding-905",
    expectedValueId: "value-905",
    definitionId: "definition-905",
    definitionRevisionId: "revision-905",
    catalogReleaseId: "release-905",
    configRevisionId: "config-905",
    sourceRef: "config-set-905",
    sourcePinId: "source-pin-905",
    sourceFormat: "dts",
    target: { format: "dts", sourceText: "<0xE10>" }
  }
} satisfies Record<string, unknown>;

const session = {
  id: "session-905",
  organizationId: "org-905",
  projectId: "project-905",
  actorUserId: "user-905",
  pageKey: "xiaoze",
  context: { path: "/parameters", pageKey: "parameters", projectId: "project-905" },
  status: "active",
  title: "Issue 905",
  updatedAt: "2026-09-23T00:00:00.000Z",
  createdAt: "2026-09-23T00:00:00.000Z"
} satisfies AgentSessionRecord;

const toolCall = {
  id: "tool-905",
  sessionId: "session-905",
  organizationId: "org-905",
  projectId: "project-905",
  name: "action.submitParameterChange",
  label: "Submit parameter change",
  payload,
  requiresApproval: true,
  status: "pending_approval",
  approvalId: "approval-905"
} satisfies AgentToolCallRecord;

const approval = {
  id: "approval-905",
  sessionId: "session-905",
  organizationId: "org-905",
  projectId: "project-905",
  toolCallId: "tool-905",
  title: "Submit parameter change",
  message: "Approve",
  status: "approved",
  requestedByUserId: "user-905",
  decidedByUserId: "user-905"
} satisfies AgentApprovalRecord;

beforeEach(() => {
  vi.mocked(getAgentSession).mockResolvedValue(session);
  vi.mocked(getAgentToolCall).mockResolvedValue(toolCall);
  vi.mocked(getAgentApproval).mockResolvedValue(approval);
});

describe("requireApprovedParameterInvocation", () => {
  it("accepts semantically equivalent DTS rendering while retaining every durable pin", async () => {
    const proof = await requireApprovedParameterInvocation({ query: vi.fn() }, auth, {
      invocation,
      projectId: "project-905",
      bindingId: "binding-905",
      target: { format: "dts", sourceText: "<3600>" },
      expectedValueId: "value-905"
    });

    expect(proof.pins).toMatchObject({
      definitionId: "definition-905",
      definitionRevisionId: "revision-905",
      configRevisionId: "config-905",
      sourcePinId: "source-pin-905"
    });
  });

  it("rejects a changed approved DTS value", async () => {
    await expect(requireApprovedParameterInvocation({ query: vi.fn() }, auth, {
      invocation,
      projectId: "project-905",
      bindingId: "binding-905",
      target: { format: "dts", sourceText: "<3601>" },
      expectedValueId: "value-905"
    })).rejects.toMatchObject({ code: "INVALID_TRUSTED_INVOCATION_CONTEXT" });
  });
});
