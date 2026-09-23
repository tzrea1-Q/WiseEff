import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../shared/http/errors";
import { createAgentInvocation, TRUSTED_INVOCATION_CONTEXT_ERROR_CODE } from "../../auth/trustedInvocation";
import { testRefusalAuditSink } from "../../audit/testRefusalSink";
import { setParameterIdentityMode } from "../../parameter-kernel/parameterIdentityMode";

vi.mock("../../parameter-bindings/drafts", () => ({
  createCanonicalValueDraft: vi.fn(),
  loadCanonicalBindingPins: vi.fn(),
  submitCanonicalValueChange: vi.fn()
}));

vi.mock("../approvedParameterInvocation", () => ({
  APPROVED_PARAMETER_PAYLOAD_KEY: "approvedParameter",
  requireApprovedParameterInvocation: vi.fn()
}));

import { createActionTools } from "./actionTools";
import {
  createCanonicalValueDraft,
  loadCanonicalBindingPins,
  submitCanonicalValueChange
} from "../../parameter-bindings/drafts";
import { requireApprovedParameterInvocation } from "../approvedParameterInvocation";

const mockedCreateDraft = vi.mocked(createCanonicalValueDraft);
const mockedLoadPins = vi.mocked(loadCanonicalBindingPins);
const mockedSubmit = vi.mocked(submitCanonicalValueChange);
const mockedApproved = vi.mocked(requireApprovedParameterInvocation);

const dbMock = {
  query: vi.fn(),
  transaction: vi.fn((fn: (tx: typeof dbMock) => Promise<unknown>) => fn(dbMock))
};
const db = dbMock as never;

const agentAuth = {
  organization: { id: "org1", name: "Test Organization" },
  user: { id: "u1", organizationId: "org1", name: "Admin", title: "Admin", isActive: true },
  roles: [{ roleId: "admin", projectId: null }],
  permissions: ["parameter:edit"]
} as const;

const durableAgentInvocation = createAgentInvocation(agentAuth, {
  sessionId: "s1",
  toolCallId: "tool-call-1",
  approval: { required: true, approvalId: "approval-1" }
});

const adminContext = {
  auth: agentAuth,
  invocation: durableAgentInvocation,
  requestId: "r1",
  sessionId: "s1",
  toolCallId: "tool-call-1",
  projectId: "p1",
  approvalId: "approval-1"
} as never;

const canonicalPins = {
  bindingId: "binding-1",
  projectId: "p1",
  organizationId: "org1",
  definitionId: "definition-1",
  definitionRevisionId: "revision-1",
  catalogReleaseId: "release-1",
  currentValueId: "value-1",
  configRevisionId: "rev-base",
  sourceRef: "config.dts",
  sourcePinId: "source-pin-1",
  sourceFormat: "dts" as const
};

const draftResult = {
  id: "draft-1",
  bindingId: "binding-1",
  definitionId: "definition-1",
  effectiveRevisionId: "revision-1",
  currentValueId: "value-1",
  targetValue: "<3600>",
  sourceFormat: "dts" as const,
  baseRevisionId: "rev-base",
  sourcePinId: "source-pin-1",
  candidateId: "candidate-1",
  reason: "charging slow",
  updatedAt: "2026-09-23T00:00:00.000Z",
  action: "set" as const
};

function canonicalPayload(input: {
  projectId?: string;
  parameterId?: string;
  targetValue?: string;
  reason?: string;
} = {}) {
  const projectId = input.projectId ?? "p1";
  const parameterId = input.parameterId ?? "binding-1";
  const targetValue = input.targetValue ?? "<3600>";
  return {
    projectId,
    parameterId,
    targetValue,
    reason: input.reason ?? "charging slow",
    approvedParameter: {
      ...canonicalPins,
      projectId,
      bindingId: parameterId,
      target: { format: "dts" as const, sourceText: targetValue }
    }
  };
}

function tool() {
  return createActionTools({ db, refusalAuditSink: testRefusalAuditSink }).find(
    (item) => item.name === "action.submitParameterChange"
  )!;
}

beforeEach(() => {
  setParameterIdentityMode("semantic");
  vi.clearAllMocks();
  mockedLoadPins.mockResolvedValue(canonicalPins);
  mockedApproved.mockResolvedValue({
    pins: {
      projectId: canonicalPins.projectId,
      bindingId: canonicalPins.bindingId,
      expectedValueId: canonicalPins.currentValueId,
      definitionId: canonicalPins.definitionId,
      definitionRevisionId: canonicalPins.definitionRevisionId,
      catalogReleaseId: canonicalPins.catalogReleaseId,
      configRevisionId: canonicalPins.configRevisionId,
      sourceRef: canonicalPins.sourceRef,
      sourcePinId: canonicalPins.sourcePinId,
      sourceFormat: canonicalPins.sourceFormat
    }
  } as never);
  mockedCreateDraft.mockResolvedValue(draftResult as never);
  mockedSubmit.mockResolvedValue({
    id: "cr-9",
    projectId: "p1",
    bindingId: "binding-1",
    targetValue: "<3600>",
    action: "set"
  } as never);
});

afterEach(() => setParameterIdentityMode(null));

describe("action.submitParameterChange", () => {
  it("is mutating and approval-gated", () => {
    expect(tool().kind).toBe("mutating");
    expect(tool().requiresApproval).toBe(true);
  });

  it("freezes the canonical binding pins before approval", async () => {
    const prepared = await tool().prepareApproval!(
      {
        auth: agentAuth,
        requestId: "r1",
        sessionId: "s1",
        projectId: "p1"
      },
      canonicalPayload()
    );

    expect(mockedLoadPins).toHaveBeenCalledWith(db, {
      organizationId: "org1",
      projectId: "p1",
      bindingId: "binding-1"
    });
    expect(prepared.approvedParameter).toEqual({
      projectId: "p1",
      bindingId: "binding-1",
      expectedValueId: "value-1",
      definitionId: "definition-1",
      definitionRevisionId: "revision-1",
      catalogReleaseId: "release-1",
      configRevisionId: "rev-base",
      sourceRef: "config.dts",
      sourcePinId: "source-pin-1",
      sourceFormat: "dts",
      target: { format: "dts", sourceText: "<3600>" }
    });
  });

  it("rejects a durable invocation correlated to a different tool call before domain work", async () => {
    await expect(
      tool().run({ ...adminContext, toolCallId: "tool-call-spoofed" } as never, canonicalPayload({ reason: "spoof" }))
    ).rejects.toMatchObject({ code: TRUSTED_INVOCATION_CONTEXT_ERROR_CODE });

    expect(mockedCreateDraft).not.toHaveBeenCalled();
    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it("creates a typed binding draft and submits it with the approved pins", async () => {
    const result = await tool().run(adminContext, canonicalPayload());

    expect(mockedCreateDraft).toHaveBeenCalledWith(
      db,
      (adminContext as { auth: unknown }).auth,
      expect.objectContaining({
        projectId: "p1",
        bindingId: "binding-1",
        baseRevisionId: "rev-base",
        baseCurrentValueId: "value-1",
        action: "set",
        reason: "charging slow",
        targetValue: {
          kind: "cells",
          bits: 32,
          groups: [[{ kind: "integer", raw: "3600", value: "3600" }]]
        }
      }),
      expect.objectContaining({
        invocation: durableAgentInvocation,
        requestId: "r1",
        refusalSink: testRefusalAuditSink,
        objectStore: undefined
      })
    );
    expect(mockedSubmit).toHaveBeenCalledWith(db, (adminContext as { auth: unknown }).auth, {
      projectId: "p1",
      draftId: "draft-1",
      invocation: durableAgentInvocation,
      requestId: "r1",
      refusalSink: testRefusalAuditSink
    });
    expect(result.data).toMatchObject({ changeRequestId: "cr-9", targetValue: "<3600>", draftId: "draft-1" });
    expect(result.citations[0]?.id).toBe("cr-9");
    expect(result.citations[0]?.href).toBe("/parameter-review?request=cr-9&project=p1");
    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
  });

  it("rejects target values that are not DTS source text before creating any draft", async () => {
    await expect(
      tool().prepareApproval!(
        { auth: agentAuth, requestId: "r1", sessionId: "s1", projectId: "p1" },
        canonicalPayload({ targetValue: "3600" })
      )
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });

    expect(mockedCreateDraft).not.toHaveBeenCalled();
    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it("returns 404 when the binding belongs to a different project", async () => {
    mockedLoadPins.mockResolvedValue(null);

    await expect(
      tool().prepareApproval!(
        { auth: agentAuth, requestId: "r1", sessionId: "s1", projectId: "p1" },
        canonicalPayload({ targetValue: "<1>" })
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    expect(mockedCreateDraft).not.toHaveBeenCalled();
  });

  it("does not fall back to legacy parameter IDs when canonical binding pins are absent", async () => {
    mockedLoadPins.mockResolvedValue(null);
    await expect(
      tool().prepareApproval!(
        { auth: agentAuth, requestId: "r1", sessionId: "s1", projectId: "p1" },
        canonicalPayload({ parameterId: "legacy-param-1", targetValue: "18A" })
      )
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });

    expect(mockedLoadPins).toHaveBeenCalled();
    expect(mockedCreateDraft).not.toHaveBeenCalled();
    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it("rolls back the canonical draft transaction when submission fails", async () => {
    mockedSubmit.mockRejectedValue(new ApiError("CONFLICT", "stale"));

    await expect(tool().run(adminContext, canonicalPayload())).rejects.toMatchObject({ code: "CONFLICT" });

    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
    expect(mockedCreateDraft).toHaveBeenCalledTimes(1);
    expect(mockedSubmit).toHaveBeenCalledTimes(1);
  });
});
