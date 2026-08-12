import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../parameters/service", () => ({
  submitParameterChanges: vi.fn()
}));

vi.mock("../../parameters/sensitiveNode", () => ({
  assertSensitiveNodeWriteAllowed: vi.fn()
}));

vi.mock("../../parameters/repository", () => ({
  getProjectParameterForUpdate: vi.fn()
}));

import { createActionTools } from "./actionTools";
import { submitParameterChanges } from "../../parameters/service";
import { getProjectParameterForUpdate } from "../../parameters/repository";

const mockedSubmit = vi.mocked(submitParameterChanges);
const mockedGetParameter = vi.mocked(getProjectParameterForUpdate);

const db = {
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db))
};

const adminContext = {
  auth: { organization: { id: "org1" }, user: { id: "u1" }, roles: [{ roleId: "admin", projectId: null }] },
  requestId: "r1",
  sessionId: "s1",
  projectId: "p1"
} as never;

describe("action.submitParameterChange", () => {
  beforeEach(() => {
    mockedSubmit.mockReset();
    mockedGetParameter.mockReset();
  });

  it("is mutating and approval-gated", () => {
    const tool = createActionTools({ db }).find((t) => t.name === "action.submitParameterChange")!;
    expect(tool.kind).toBe("mutating");
    expect(tool.requiresApproval).toBe(true);
  });

  it("submits through the real parameter change workflow and cites the created request", async () => {
    mockedGetParameter.mockResolvedValue(null as Awaited<ReturnType<typeof getProjectParameterForUpdate>>);
    mockedSubmit.mockResolvedValue({
      id: "round-1",
      items: [{ requestId: "cr-1" }]
    } as Awaited<ReturnType<typeof submitParameterChanges>>);

    const tool = createActionTools({ db }).find((t) => t.name === "action.submitParameterChange")!;
    const result = await tool.run(adminContext, {
      projectId: "p1",
      parameterId: "pd1",
      targetValue: "42",
      reason: "charging slow"
    });

    expect(mockedSubmit).toHaveBeenCalledWith(
      db,
      expect.anything(),
      { projectId: "p1", items: [{ parameterId: "pd1", targetValue: "42", reason: "charging slow" }] },
      { requestId: "r1", actorType: "agent" }
    );
    expect(result.citations[0]?.id).toBe("cr-1");
  });

  it("rejects submissions missing required fields", async () => {
    const tool = createActionTools({ db }).find((t) => t.name === "action.submitParameterChange")!;
    await expect(
      tool.run(adminContext, { projectId: "p1", parameterId: "pd1", targetValue: "42" })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(mockedSubmit).not.toHaveBeenCalled();
  });
});
