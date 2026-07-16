import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { writeGovernanceAudit } from "../parameter-topology/governanceAudit";
import {
  getParameterSpecRow,
  getSpecReviewTaskById,
  listSpecReviewTaskRows,
  resolveSpecReviewTaskRow
} from "./repository";
import { listSpecReviewTasks, resolveCandidateSpecId, resolveSpecReviewTask, toReviewTaskDto } from "./service";

vi.mock("./repository", () => ({
  getParameterSpecRow: vi.fn(),
  getSpecReviewTaskById: vi.fn(),
  listParameterSpecRows: vi.fn(),
  listSpecReviewTaskRows: vi.fn(),
  resolveSpecReviewTaskRow: vi.fn()
}));

vi.mock("../parameter-topology/governanceAudit", () => ({
  writeGovernanceAudit: vi.fn()
}));

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Engineer",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "admin:access"],
    ...overrides
  };
}

function makeDb(): Database {
  return {
    query: vi.fn(),
    transaction: vi.fn()
  };
}

describe("parameter spec review service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps legacy propspec candidate ids to parameterSpecId", () => {
    expect(resolveCandidateSpecId({ id: "propspec:vendor,sc8562:gpio_int:v1" })).toBe(
      "pspec:vendor,sc8562:gpio_int"
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
            evidence: ["compatible unmatched"]
          },
          candidateSchemas: [
            {
              id: "pspec:vendor,sc8562:gpio_int",
              propertyKey: "gpio_int",
              schemaNamespace: "vendor,sc8562"
            },
            {
              id: "propspec:mediatek,mt5788:gpio_int:v1",
              propertyKey: "gpio_int",
              schemaNamespace: "mediatek,mt5788"
            }
          ],
          projectCount: 2,
          status: "open",
          createdAt: "2026-07-16T01:00:00.000Z"
        }
      ],
      nextCursor: { createdAt: "2026-07-16T01:00:00.000Z", id: "task-1" }
    });

    const result = await listSpecReviewTasks(makeDb(), makeAuth(), { status: "open", limit: 10 });

    expect(listSpecReviewTaskRows).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      status: "open",
      limit: 10,
      cursor: null
    });
    expect(result.items[0]).toMatchObject({
      id: "task-1",
      propertyKey: "gpio_int",
      ambiguous: true,
      projectCount: 2
    });
    expect(result.items[0]?.candidates.map((c) => c.id)).toEqual([
      "pspec:vendor,sc8562:gpio_int",
      "pspec:mediatek,mt5788:gpio_int"
    ]);
    expect(result.nextCursor).toBeTruthy();
  });

  it("resolveSpecReviewTask rejects cross-org or unknown parameterSpecId with 404", async () => {
    vi.mocked(getSpecReviewTaskById).mockResolvedValue({
      id: "task-1",
      organizationId: "org-1",
      sourceEvidence: { propertyKey: "gpio_int", evidence: [] },
      candidateSchemas: [],
      projectCount: 1,
      status: "open",
      createdAt: "2026-07-16T01:00:00.000Z"
    });
    vi.mocked(getParameterSpecRow).mockResolvedValue(null);

    await expect(
      resolveSpecReviewTask(makeDb(), makeAuth(), {
        taskId: "task-1",
        decision: "resolved",
        parameterSpecId: "pspec:other-org",
        reason: "wrong org"
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      details: { parameterSpecId: "pspec:other-org" }
    } satisfies Partial<ApiError>);

    expect(resolveSpecReviewTaskRow).not.toHaveBeenCalled();
    expect(writeGovernanceAudit).not.toHaveBeenCalled();
  });

  it("resolveSpecReviewTask returns 404 for cross-org task ids", async () => {
    vi.mocked(getSpecReviewTaskById).mockResolvedValue(null);

    await expect(
      resolveSpecReviewTask(makeDb(), makeAuth(), {
        taskId: "task-cross",
        decision: "dismissed",
        reason: "not mine"
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      details: { taskId: "task-cross" }
    } satisfies Partial<ApiError>);
  });

  it("resolveSpecReviewTask accepts org or global specs and writes audit", async () => {
    vi.mocked(getSpecReviewTaskById).mockResolvedValue({
      id: "task-1",
      organizationId: "org-1",
      sourceEvidence: { propertyKey: "gpio_int", evidence: ["ambiguous"] },
      candidateSchemas: [{ id: "pspec:vendor,sc8562:gpio_int" }],
      projectCount: 2,
      status: "open",
      createdAt: "2026-07-16T01:00:00.000Z"
    });
    vi.mocked(getParameterSpecRow).mockResolvedValue({
      id: "pspec:vendor,sc8562:gpio_int",
      sourceKind: "dts",
      specificationKey: "vendor,sc8562/gpio_int",
      propertyKey: "gpio_int",
      driverModule: "vendor,sc8562",
      lifecycle: "active",
      currentVersionId: "ver-1",
      currentVersion: 1,
      displayName: null,
      description: null,
      valueShape: null,
      schemaDefault: null,
      exampleValue: null,
      schemaNamespace: "vendor,sc8562",
      units: null,
      constraints: null,
      documentation: null,
      compatiblePatterns: null,
      policyTarget: null
    });
    vi.mocked(resolveSpecReviewTaskRow).mockResolvedValue({
      id: "task-1",
      organizationId: "org-1",
      parameterSpecId: "pspec:vendor,sc8562:gpio_int",
      sourceEvidence: { propertyKey: "gpio_int", evidence: ["ambiguous"] },
      candidateSchemas: [],
      projectCount: 2,
      status: "resolved",
      reason: "Matched SC8562",
      createdAt: "2026-07-16T01:00:00.000Z",
      resolvedAt: "2026-07-16T02:00:00.000Z"
    });

    const result = await resolveSpecReviewTask(
      makeDb(),
      makeAuth(),
      {
        taskId: "task-1",
        decision: "resolved",
        parameterSpecId: "pspec:vendor,sc8562:gpio_int",
        reason: "Matched SC8562"
      },
      { requestId: "req-1" }
    );

    expect(result).toMatchObject({
      id: "task-1",
      status: "resolved",
      parameterSpecId: "pspec:vendor,sc8562:gpio_int"
    });
    expect(writeGovernanceAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        action: "spec-review-resolved",
        targetType: "parameter-spec-review-task",
        targetId: "task-1",
        metadata: expect.objectContaining({
          decision: "resolved",
          parameterSpecId: "pspec:vendor,sc8562:gpio_int",
          propertyKey: "gpio_int"
        })
      }),
      { requestId: "req-1" }
    );
  });

  it("toReviewTaskDto marks multi-candidate tasks as ambiguous", () => {
    const dto = toReviewTaskDto({
      id: "task-1",
      organizationId: "org-1",
      sourceEvidence: { propertyKey: "gpio_int", evidence: ["a", "b"] },
      candidateSchemas: [
        { id: "pspec:a", propertyKey: "gpio_int", schemaNamespace: "a" },
        { id: "pspec:b", propertyKey: "gpio_int", schemaNamespace: "b" }
      ],
      projectCount: 1,
      status: "open",
      createdAt: "2026-07-16T01:00:00.000Z"
    });
    expect(dto.ambiguous).toBe(true);
    expect(dto.evidence).toEqual(["a", "b"]);
  });
});
