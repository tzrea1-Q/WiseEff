import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../shared/http/errors";

vi.mock("../../parameters/service", () => ({
  submitParameterChanges: vi.fn()
}));

vi.mock("../../parameters/sensitiveNode", () => ({
  assertSensitiveNodeWriteAllowed: vi.fn()
}));

vi.mock("../../parameters/repository", () => ({
  deleteDraft: vi.fn(),
  getProjectParameterForUpdate: vi.fn()
}));

vi.mock("../../parameters/semanticParameterReads", () => ({
  mustUseSemanticParameterIdentity: vi.fn()
}));

vi.mock("../../parameter-topology/service", () => ({
  createBindingDraft: vi.fn()
}));

vi.mock("../../parameter-topology/writeLock", () => ({
  loadBindingContext: vi.fn(),
  resolveBindingHeadRevisionId: vi.fn()
}));

import { createActionTools } from "./actionTools";
import { submitParameterChanges } from "../../parameters/service";
import { deleteDraft, getProjectParameterForUpdate } from "../../parameters/repository";
import { mustUseSemanticParameterIdentity } from "../../parameters/semanticParameterReads";
import { createBindingDraft } from "../../parameter-topology/service";
import { loadBindingContext, resolveBindingHeadRevisionId } from "../../parameter-topology/writeLock";

const mockedSubmit = vi.mocked(submitParameterChanges);
const mockedLoadBinding = vi.mocked(loadBindingContext);
const mockedDeleteDraft = vi.mocked(deleteDraft);
const mockedCreateDraft = vi.mocked(createBindingDraft);
const mockedResolveHead = vi.mocked(resolveBindingHeadRevisionId);
const mockedMustUseSemantic = vi.mocked(mustUseSemanticParameterIdentity);
const mockedGetLegacyParameter = vi.mocked(getProjectParameterForUpdate);

const bindingContext = {
  binding_id: "binding-1",
  organization_id: "org1",
  project_id: "p1",
  parameter_spec_id: "spec-1",
  logical_node_id: "ln-1",
  property_key: "iin_max",
  node_locator: null,
  constraints: {},
  schema_default: null,
  example_value: null,
  policy_target: null
};

const db = {
  query: vi.fn(),
  transaction: vi.fn()
} as never;

const adminContext = {
  auth: {
    organization: { id: "org1" },
    user: { id: "u1", organizationId: "org1", name: "Admin", title: "Admin", isActive: true },
    roles: [{ roleId: "admin", projectId: null }],
    permissions: ["parameter:edit"]
  },
  requestId: "r1",
  sessionId: "s1",
  projectId: "p1"
} as never;

const draftResult = {
  draftId: "draft-1",
  parameterId: "binding-1",
  candidateRevisionId: "rev-c1",
  workingCandidateRevisionId: "rev-c1",
  rebasedDraftIds: [],
  rawText: "<3600>",
  action: "set" as const,
  parameterSpecId: "spec-1",
  projectParameterBindingId: "binding-1",
  writeTarget: {},
  overlayFileId: "file-overlay",
  overlayFileName: "edit-overlay.dts"
};

function tool() {
  return createActionTools({ db }).find((t) => t.name === "action.submitParameterChange")!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedMustUseSemantic.mockResolvedValue(true);
  mockedLoadBinding.mockResolvedValue(bindingContext as never);
  mockedResolveHead.mockResolvedValue("rev-base");
  mockedCreateDraft.mockResolvedValue(draftResult as never);
  mockedSubmit.mockResolvedValue({ id: "round-1", items: [{ requestId: "cr-9" }] } as never);
});

describe("action.submitParameterChange", () => {
  it("is mutating and approval-gated", () => {
    expect(tool().kind).toBe("mutating");
    expect(tool().requiresApproval).toBe(true);
  });

  it("creates a typed binding draft and submits it with the draft identity", async () => {
    const result = await tool().run(adminContext, {
      projectId: "p1",
      parameterId: "binding-1",
      targetValue: "<3600>",
      reason: "charging slow"
    });

    expect(mockedCreateDraft).toHaveBeenCalledWith(
      db,
      (adminContext as { auth: unknown }).auth,
      expect.objectContaining({
        projectId: "p1",
        bindingId: "binding-1",
        baseRevisionId: "rev-base",
        action: "set",
        reason: "charging slow",
        targetValue: {
          kind: "cells",
          bits: 32,
          groups: [[{ kind: "integer", raw: "3600", value: "3600" }]]
        }
      }),
      expect.anything()
    );
    expect(mockedSubmit).toHaveBeenCalledWith(
      db,
      (adminContext as { auth: unknown }).auth,
      expect.objectContaining({
        projectId: "p1",
        items: [
          expect.objectContaining({
            draftId: "draft-1",
            editSubjectKind: "binding",
            projectParameterBindingId: "binding-1",
            parameterSpecId: "spec-1",
            action: "set",
            targetValue: "<3600>",
            reason: "charging slow"
          })
        ]
      }),
      expect.objectContaining({ requestId: "r1", actorType: "agent" })
    );
    expect(result.data).toMatchObject({ changeRequestId: "cr-9", targetValue: "<3600>", draftId: "draft-1" });
    expect(result.citations[0]?.id).toBe("cr-9");
    expect(mockedDeleteDraft).not.toHaveBeenCalled();
  });

  it("rejects target values that are not DTS source text before creating any draft", async () => {
    await expect(
      tool().run(adminContext, { projectId: "p1", parameterId: "binding-1", targetValue: "3600", reason: "tune" })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });

    expect(mockedCreateDraft).not.toHaveBeenCalled();
    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it("returns 404 when the binding belongs to a different project", async () => {
    mockedLoadBinding.mockResolvedValue({ ...bindingContext, project_id: "other-project" } as never);

    await expect(
      tool().run(adminContext, { projectId: "p1", parameterId: "binding-1", targetValue: "<1>", reason: "tune" })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    expect(mockedCreateDraft).not.toHaveBeenCalled();
  });

  it("raises a conflict when the binding has no config revision yet", async () => {
    mockedResolveHead.mockResolvedValue(undefined);

    await expect(
      tool().run(adminContext, { projectId: "p1", parameterId: "binding-1", targetValue: "<1>", reason: "tune" })
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(mockedCreateDraft).not.toHaveBeenCalled();
  });

  it("submits the legacy flat shape on legacy-identity databases (TD-079)", async () => {
    mockedMustUseSemantic.mockResolvedValue(false);
    mockedGetLegacyParameter.mockResolvedValue({ name: "iin_max", sourceNodePath: undefined } as never);

    const result = await tool().run(adminContext, {
      projectId: "p1",
      parameterId: "legacy-param-1",
      targetValue: "18A",
      reason: "tune"
    });

    expect(mockedSubmit).toHaveBeenCalledWith(
      db,
      (adminContext as { auth: unknown }).auth,
      expect.objectContaining({
        projectId: "p1",
        items: [{ parameterId: "legacy-param-1", targetValue: "18A", reason: "tune" }]
      }),
      expect.objectContaining({ actorType: "agent" })
    );
    expect(mockedLoadBinding).not.toHaveBeenCalled();
    expect(mockedCreateDraft).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ changeRequestId: "cr-9", targetValue: "18A" });
  });

  it("cleans up the created draft when submission fails", async () => {
    mockedSubmit.mockRejectedValue(new ApiError("CONFLICT", "stale", 409));

    await expect(
      tool().run(adminContext, { projectId: "p1", parameterId: "binding-1", targetValue: "<3600>", reason: "tune" })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(mockedDeleteDraft).toHaveBeenCalledWith(db, {
      organizationId: "org1",
      userId: "u1",
      draftId: "draft-1"
    });
  });
});
