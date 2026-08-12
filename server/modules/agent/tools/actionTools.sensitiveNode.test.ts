import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../shared/http/errors";

vi.mock("../../parameters/service", () => ({
  submitParameterChanges: vi.fn()
}));

vi.mock("../../parameters/sensitiveNode", () => ({
  assertSensitiveNodeWriteAllowed: vi.fn()
}));

vi.mock("../../parameters/repository", () => ({
  deleteDraft: vi.fn()
}));

vi.mock("../../parameter-topology/service", () => ({
  createBindingDraft: vi.fn()
}));

vi.mock("../../parameter-topology/editService", () => ({
  loadBindingContext: vi.fn(),
  resolveBindingHeadRevisionId: vi.fn()
}));

vi.mock("../../audit/repository", () => ({
  createAuditEvent: vi.fn()
}));

import { createActionTools } from "./actionTools";
import { submitParameterChanges } from "../../parameters/service";
import { assertSensitiveNodeWriteAllowed } from "../../parameters/sensitiveNode";
import { loadBindingContext } from "../../parameter-topology/editService";
import { createBindingDraft } from "../../parameter-topology/service";

const mockedSubmit = vi.mocked(submitParameterChanges);
const mockedAssert = vi.mocked(assertSensitiveNodeWriteAllowed);
const mockedLoadBinding = vi.mocked(loadBindingContext);
const mockedCreateDraft = vi.mocked(createBindingDraft);

describe("action.submitParameterChange sensitive node guard", () => {
  beforeEach(() => {
    mockedSubmit.mockReset();
    mockedAssert.mockReset();
    mockedLoadBinding.mockReset();
  });

  it("denies agent writes to critical nodes early and does not submit", async () => {
    const db = {
      query: vi.fn(),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ query: vi.fn() }))
    };
    mockedLoadBinding.mockResolvedValue({
      binding_id: "pd1",
      organization_id: "org1",
      project_id: "p1",
      parameter_spec_id: "def-1",
      logical_node_id: "ln-1",
      property_key: "status",
      node_locator: "safety/cutover/status",
      constraints: {},
      schema_default: null,
      example_value: null,
      policy_target: null
    } as never);

    mockedAssert.mockRejectedValue(
      new ApiError("FORBIDDEN", "Agent writes to critical sensitive nodes require a human.", 403, {
        riskTier: "critical",
        requireHuman: true
      })
    );

    const tool = createActionTools({ db }).find((item) => item.name === "action.submitParameterChange")!;
    await expect(
      tool.run(
        {
          auth: {
            organization: { id: "org1" },
            user: { id: "u1", organizationId: "org1", name: "Agent", title: "Bot", isActive: true },
            roles: [{ roleId: "admin", projectId: null }],
            permissions: ["parameter:edit", "parameter:edit-critical"]
          },
          requestId: "r1",
          sessionId: "s1",
          projectId: "p1"
        } as never,
        {
          projectId: "p1",
          parameterId: "pd1",
          targetValue: "locked",
          reason: "agent tweak"
        }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    expect(mockedAssert).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        actorType: "agent",
        nodePath: "safety/cutover/status",
        projectId: "p1"
      })
    );
    expect(mockedCreateDraft).not.toHaveBeenCalled();
    expect(mockedSubmit).not.toHaveBeenCalled();
  });
});
