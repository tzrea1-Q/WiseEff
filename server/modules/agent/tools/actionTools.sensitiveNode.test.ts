import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../shared/http/errors";
import { setParameterIdentityMode } from "../../parameter-kernel/parameterIdentityMode";

vi.mock("../../parameter-bindings/drafts", () => ({
  createCanonicalValueDraft: vi.fn(),
  submitCanonicalValueChange: vi.fn()
}));

vi.mock("../approvedParameterInvocation", () => ({
  APPROVED_PARAMETER_PAYLOAD_KEY: "approvedParameter",
  requireApprovedParameterInvocation: vi.fn()
}));

import { createActionTools } from "./actionTools";
import { createAgentInvocation } from "../../auth/trustedInvocation";
import { testRefusalAuditSink } from "../../audit/testRefusalSink";
import { createCanonicalValueDraft, submitCanonicalValueChange } from "../../parameter-bindings/drafts";
import { requireApprovedParameterInvocation } from "../approvedParameterInvocation";

const mockedCreateDraft = vi.mocked(createCanonicalValueDraft);
const mockedSubmit = vi.mocked(submitCanonicalValueChange);
const mockedApproved = vi.mocked(requireApprovedParameterInvocation);

const canonicalPins = {
  projectId: "p1",
  bindingId: "pd1",
  expectedValueId: "value-1",
  definitionId: "def-1",
  definitionRevisionId: "revision-1",
  catalogReleaseId: "release-1",
  configRevisionId: "config-1",
  sourceRef: "config.dts",
  sourcePinId: "pin-1",
  sourceFormat: "dts" as const
};

describe("action.submitParameterChange sensitive node guard", () => {
  beforeEach(() => {
    setParameterIdentityMode("semantic");
    vi.clearAllMocks();
    mockedApproved.mockResolvedValue({ pins: canonicalPins } as never);
  });

  afterEach(() => setParameterIdentityMode(null));

  it("propagates a canonical critical-node refusal and does not submit", async () => {
    const db = {
      query: vi.fn(),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db))
    };
    mockedCreateDraft.mockRejectedValue(
      new ApiError("FORBIDDEN", "Agent writes to critical sensitive nodes require a human.", {
        riskTier: "critical",
        requireHuman: true
      })
    );

    const auth = {
      organization: { id: "org1", name: "Test Organization" },
      user: { id: "u1", organizationId: "org1", name: "Agent", title: "Bot", isActive: true },
      roles: [{ roleId: "admin" as const, projectId: null }],
      permissions: ["parameter:edit" as const, "parameter:edit-critical" as const]
    };
    const invocation = createAgentInvocation(auth, {
      sessionId: "s1",
      toolCallId: "tool-call-1",
      approval: { required: true, approvalId: "approval-1" }
    });
    const tool = createActionTools({ db: db as never, refusalAuditSink: testRefusalAuditSink }).find(
      (item) => item.name === "action.submitParameterChange"
    )!;
    const payload = {
      projectId: "p1",
      parameterId: "pd1",
      targetValue: "<1>",
      reason: "agent tweak",
      approvedParameter: {
        ...canonicalPins,
        target: { format: "dts" as const, sourceText: "<1>" }
      }
    };

    await expect(
      tool.run(
        {
          auth,
          invocation,
          requestId: "r1",
          sessionId: "s1",
          toolCallId: "tool-call-1",
          projectId: "p1",
          approvalId: "approval-1"
        } as never,
        payload
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403, details: { riskTier: "critical", requireHuman: true } });

    expect(mockedCreateDraft).toHaveBeenCalledWith(
      db,
      auth,
      expect.objectContaining({ projectId: "p1", bindingId: "pd1", action: "set" }),
      expect.objectContaining({ invocation, requestId: "r1", refusalSink: testRefusalAuditSink })
    );
    expect(mockedSubmit).not.toHaveBeenCalled();
  });
});
