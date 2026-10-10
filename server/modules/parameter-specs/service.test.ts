import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { listSpecReviewTaskRows } from "./repository";
import { listSpecReviewTasks, resolveCandidateSpecId, toReviewTaskDto } from "./service";

vi.mock("./repository", () => ({ listSpecReviewTaskRows: vi.fn() }));

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    ...makeTestAuthContext({
      userId: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Engineer",
      organizationName: "ChargeLab",
      permissions: ["parameter:view", "parameter:edit", "admin:access"],
    }),
    ...overrides,
  };
}

function makeDb(): Database {
  return {
    query: vi.fn(),
    transaction: vi.fn(async (fn) => fn({ query: vi.fn() })),
  };
}

const openTask = {
  id: "task-1",
  organizationId: "org-1",
  sourceEvidence: {
    propertyKey: "gpio_int",
    evidence: ["ambiguous"],
    projectId: "project-1",
    configRevisionId: "rev-1",
    propertyOccurrenceId: "po-1",
    logicalNodeId: "ln-1",
  },
  candidateSchemas: [{ id: "pspec:vendor,sc8562:gpio_int" }],
  projectCount: 2,
  status: "open" as const,
  createdAt: "2026-07-16T01:00:00.000Z",
};

describe("parameter spec review service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps legacy propspec candidate ids to parameterSpecId", () => {
    expect(resolveCandidateSpecId({ id: "propspec:vendor,sc8562:gpio_int:v1" })).toBe(
      "pspec:vendor,sc8562:gpio_int",
    );
    expect(resolveCandidateSpecId({ parameterSpecId: "pspec:a", id: "propspec:x:y:v1" })).toBe("pspec:a");
  });

  it("listSpecReviewTasks returns org-scoped paginated DTOs", async () => {
    vi.mocked(listSpecReviewTaskRows).mockResolvedValue({
      items: [
        {
          id: "task-1",
          organizationId: "org-1",
          sourceEvidence: {
            propertyKey: "gpio_int",
            evidence: ["compatible unmatched"],
          },
          candidateSchemas: [
            {
              id: "pspec:vendor,sc8562:gpio_int",
              propertyKey: "gpio_int",
              schemaNamespace: "vendor,sc8562",
            },
            {
              id: "propspec:mediatek,mt5788:gpio_int:v1",
              propertyKey: "gpio_int",
              schemaNamespace: "mediatek,mt5788",
            },
          ],
          projectCount: 2,
          status: "open",
          createdAt: "2026-07-16T01:00:00.000Z",
        },
      ],
      nextCursor: { createdAt: "2026-07-16T01:00:00.000Z", id: "task-1" },
    });

    const result = await listSpecReviewTasks(makeDb(), makeAuth(), { status: "open", limit: 10 });

    expect(listSpecReviewTaskRows).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      status: "open",
      limit: 10,
      cursor: null,
    });
    expect(result.items[0]).toMatchObject({
      id: "task-1",
      propertyKey: "gpio_int",
      ambiguous: true,
      projectCount: 2,
    });
    expect(result.items[0]?.candidates.map((c) => c.id)).toEqual([
      "pspec:vendor,sc8562:gpio_int",
      "pspec:mediatek,mt5788:gpio_int",
    ]);
    expect(result.nextCursor).toBeTruthy();
  });

  it("toReviewTaskDto marks multi-candidate tasks as ambiguous", () => {
    const dto = toReviewTaskDto({
      id: "task-1",
      organizationId: "org-1",
      sourceEvidence: { propertyKey: "gpio_int", evidence: ["a", "b"] },
      candidateSchemas: [
        { id: "pspec:a", propertyKey: "gpio_int", schemaNamespace: "a" },
        { id: "pspec:b", propertyKey: "gpio_int", schemaNamespace: "b" },
      ],
      projectCount: 1,
      status: "open",
      createdAt: "2026-07-16T01:00:00.000Z",
    });
    expect(dto.ambiguous).toBe(true);
    expect(dto.evidence).toEqual(["a", "b"]);
    expect(dto.candidates[0]).toMatchObject({
      id: "pspec:a",
      propertyKey: "gpio_int",
      driverModule: "a",
    });
  });
});
