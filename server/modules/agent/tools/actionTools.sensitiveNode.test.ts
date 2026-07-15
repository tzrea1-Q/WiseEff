import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../shared/http/errors";

vi.mock("../../parameters/service", () => ({
  submitParameterChanges: vi.fn()
}));

vi.mock("../../parameters/sensitiveNode", () => ({
  assertSensitiveNodeWriteAllowed: vi.fn()
}));

vi.mock("../../parameters/repository", () => ({
  getProjectParameterForUpdate: vi.fn()
}));

vi.mock("../../audit/repository", () => ({
  createAuditEvent: vi.fn()
}));

import { createActionTools } from "./actionTools";
import { submitParameterChanges } from "../../parameters/service";
import { assertSensitiveNodeWriteAllowed } from "../../parameters/sensitiveNode";
import { getProjectParameterForUpdate } from "../../parameters/repository";

const mockedSubmit = vi.mocked(submitParameterChanges);
const mockedAssert = vi.mocked(assertSensitiveNodeWriteAllowed);
const mockedGetParameter = vi.mocked(getProjectParameterForUpdate);

describe("action.submitParameterChange sensitive node guard", () => {
  beforeEach(() => {
    mockedSubmit.mockReset();
    mockedAssert.mockReset();
    mockedGetParameter.mockReset();
  });

  it("denies agent writes to critical nodes early and does not submit", async () => {
    const db = {
      query: vi.fn(),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ query: vi.fn() }))
    };
    mockedGetParameter.mockResolvedValue({
      id: "pd1",
      projectId: "p1",
      parameterDefinitionId: "def-1",
      name: "safety_status",
      module: "Safety",
      unit: "",
      risk: "High",
      currentValue: "okay",
      recommendedValue: "okay",
      valueVersion: 1,
      sourceNodePath: "safety/cutover/status"
    } as Awaited<ReturnType<typeof getProjectParameterForUpdate>>);

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
    expect(mockedSubmit).not.toHaveBeenCalled();
  });
});
