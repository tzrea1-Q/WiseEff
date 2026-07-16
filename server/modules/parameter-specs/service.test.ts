import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { writeGovernanceAudit } from "../parameter-topology/governanceAudit";
import { countOpenIdentityMappingTasksForRevision } from "../parameter-topology/bindingService";
import {
  applyDismissedSpecReview,
  applyResolvedSpecReview,
  assertPropertyKeyMatchOrConfirmed,
  createOrgManualParameterSpec,
  refreshConfigRevisionAfterSpecReview,
  requireOrgOrGlobalSpec,
} from "./reviewApply";
import {
  getSpecReviewTaskById,
  listSpecReviewTaskRows,
  lockOpenSpecReviewTask,
  resolveSpecReviewTaskRow,
  countOpenSpecReviewTasksForRevision,
} from "./repository";
import { listSpecReviewTasks, resolveCandidateSpecId, resolveSpecReviewTask, toReviewTaskDto } from "./service";
import { assertSpecResolvable } from "./specCompleteness";

vi.mock("./repository", () => ({
  getParameterSpecRow: vi.fn(),
  getSpecReviewTaskById: vi.fn(),
  listParameterSpecRows: vi.fn(),
  listSpecReviewTaskRows: vi.fn(),
  lockOpenSpecReviewTask: vi.fn(),
  resolveSpecReviewTaskRow: vi.fn(),
  countOpenSpecReviewTasksForRevision: vi.fn(),
  validateSpecReviewTenantEvidence: vi.fn(async (_db, input) => input.locate),
}));

vi.mock("./specCompleteness", () => ({
  assertSpecResolvable: vi.fn(),
  assertSpecActivatable: vi.fn(),
}));

vi.mock("./reviewApply", () => ({
  applyResolvedSpecReview: vi.fn(),
  applyDismissedSpecReview: vi.fn(),
  assertPropertyKeyMatchOrConfirmed: vi.fn(() => ({
    mismatchConfirmed: false,
    taskPropertyKey: "gpio_int",
    specPropertyKey: "gpio_int",
  })),
  createOrgManualParameterSpec: vi.fn(),
  parseSpecReviewEvidence: vi.fn((task: { sourceEvidence: Record<string, unknown> }) => ({
    organizationId: "org-1",
    projectId: task.sourceEvidence.projectId ?? "project-1",
    configRevisionId: task.sourceEvidence.configRevisionId ?? "rev-1",
    propertyOccurrenceId: task.sourceEvidence.propertyOccurrenceId ?? "po-1",
    logicalNodeId: task.sourceEvidence.logicalNodeId ?? "ln-1",
    propertyKey: task.sourceEvidence.propertyKey ?? "gpio_int",
    nodeLocator: "/node",
    compatible: ["vendor,sc8562"],
    matcherCandidates: [],
  })),
  refreshConfigRevisionAfterSpecReview: vi.fn(),
  requireOrgOrGlobalSpec: vi.fn(),
  requireLocateEvidence: vi.fn((evidence: { projectId?: string; configRevisionId?: string; propertyOccurrenceId?: string; logicalNodeId?: string; propertyKey?: string }) => ({
    projectId: evidence.projectId ?? "project-1",
    configRevisionId: evidence.configRevisionId ?? "rev-1",
    propertyOccurrenceId: evidence.propertyOccurrenceId ?? "po-1",
    logicalNodeId: evidence.logicalNodeId ?? "ln-1",
    propertyKey: evidence.propertyKey ?? "gpio_int",
  })),
}));

vi.mock("../parameter-topology/governanceAudit", () => ({
  writeGovernanceAudit: vi.fn(),
}));

vi.mock("../parameter-topology/bindingService", () => ({
  countOpenIdentityMappingTasksForRevision: vi.fn(),
}));

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Engineer",
      isActive: true,
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "admin:access"],
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
    vi.mocked(assertSpecResolvable).mockImplementation(() => undefined);
    vi.mocked(countOpenSpecReviewTasksForRevision).mockResolvedValue(0);
    vi.mocked(countOpenIdentityMappingTasksForRevision).mockResolvedValue(0);
    vi.mocked(refreshConfigRevisionAfterSpecReview).mockResolvedValue("resolved");
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

  it("resolveSpecReviewTask rejects cross-org or unknown parameterSpecId with 404", async () => {
    vi.mocked(lockOpenSpecReviewTask).mockResolvedValue(openTask);
    vi.mocked(requireOrgOrGlobalSpec).mockRejectedValue(
      new ApiError("NOT_FOUND", "Parameter spec was not found for this organization.", 404, {
        parameterSpecId: "pspec:other-org",
      }),
    );

    await expect(
      resolveSpecReviewTask(makeDb(), makeAuth(), {
        taskId: "task-1",
        decision: "resolved",
        parameterSpecId: "pspec:other-org",
        reason: "wrong org",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      details: { parameterSpecId: "pspec:other-org" },
    } satisfies Partial<ApiError>);

    expect(resolveSpecReviewTaskRow).not.toHaveBeenCalled();
    expect(writeGovernanceAudit).not.toHaveBeenCalled();
  });

  it("resolveSpecReviewTask returns 404 for cross-org task ids", async () => {
    vi.mocked(lockOpenSpecReviewTask).mockResolvedValue(null);
    vi.mocked(getSpecReviewTaskById).mockResolvedValue(null);

    await expect(
      resolveSpecReviewTask(makeDb(), makeAuth(), {
        taskId: "task-cross",
        decision: "dismissed",
        reason: "not mine",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      details: { taskId: "task-cross" },
    } satisfies Partial<ApiError>);
  });

  it("resolveSpecReviewTask applies binding path and writes audit before close", async () => {
    vi.mocked(lockOpenSpecReviewTask).mockResolvedValue(openTask);
    vi.mocked(requireOrgOrGlobalSpec).mockResolvedValue({
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
      policyTarget: null,
    });
    vi.mocked(applyResolvedSpecReview).mockResolvedValue({
      bindingId: "binding-1",
      projectId: "project-1",
      configRevisionId: "rev-1",
    });
    vi.mocked(resolveSpecReviewTaskRow).mockResolvedValue({
      ...openTask,
      parameterSpecId: "pspec:vendor,sc8562:gpio_int",
      status: "resolved",
      reason: "Matched SC8562",
      resolvedAt: "2026-07-16T02:00:00.000Z",
    });

    const result = await resolveSpecReviewTask(
      makeDb(),
      makeAuth(),
      {
        taskId: "task-1",
        decision: "resolved",
        parameterSpecId: "pspec:vendor,sc8562:gpio_int",
        reason: "Matched SC8562",
      },
      { requestId: "req-1" },
    );

    expect(result).toMatchObject({
      id: "task-1",
      status: "resolved",
      parameterSpecId: "pspec:vendor,sc8562:gpio_int",
    });
    expect(applyResolvedSpecReview).toHaveBeenCalled();
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
          bindingId: "binding-1",
        }),
      }),
      { requestId: "req-1" },
    );
    expect(resolveSpecReviewTaskRow).toHaveBeenCalled();
  });

  it("duplicate resolve with same choice is idempotent", async () => {
    vi.mocked(lockOpenSpecReviewTask).mockResolvedValue(null);
    vi.mocked(getSpecReviewTaskById).mockResolvedValue({
      ...openTask,
      status: "resolved",
      parameterSpecId: "pspec:vendor,sc8562:gpio_int",
      reason: "Matched SC8562",
      resolvedAt: "2026-07-16T02:00:00.000Z",
    });

    const result = await resolveSpecReviewTask(makeDb(), makeAuth(), {
      taskId: "task-1",
      decision: "resolved",
      parameterSpecId: "pspec:vendor,sc8562:gpio_int",
      reason: "Matched SC8562 again",
    });

    expect(result.status).toBe("resolved");
    expect(applyResolvedSpecReview).not.toHaveBeenCalled();
    expect(resolveSpecReviewTaskRow).not.toHaveBeenCalled();
  });

  it("conflicting resolve choice returns 409", async () => {
    vi.mocked(lockOpenSpecReviewTask).mockResolvedValue(null);
    vi.mocked(getSpecReviewTaskById).mockResolvedValue({
      ...openTask,
      status: "resolved",
      parameterSpecId: "pspec:vendor,sc8562:gpio_int",
      reason: "Matched SC8562",
      resolvedAt: "2026-07-16T02:00:00.000Z",
    });

    await expect(
      resolveSpecReviewTask(makeDb(), makeAuth(), {
        taskId: "task-1",
        decision: "resolved",
        parameterSpecId: "pspec:other",
        reason: "different",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("dismiss applies fail-closed path without binding", async () => {
    vi.mocked(lockOpenSpecReviewTask).mockResolvedValue(openTask);
    vi.mocked(applyDismissedSpecReview).mockResolvedValue({
      projectId: "project-1",
      configRevisionId: "rev-1",
    });
    vi.mocked(resolveSpecReviewTaskRow).mockResolvedValue({
      ...openTask,
      status: "dismissed",
      reason: "Not this board",
      resolvedAt: "2026-07-16T02:00:00.000Z",
    });

    const result = await resolveSpecReviewTask(makeDb(), makeAuth(), {
      taskId: "task-1",
      decision: "dismissed",
      reason: "Not this board",
    });

    expect(result.status).toBe("dismissed");
    expect(applyDismissedSpecReview).toHaveBeenCalled();
    expect(applyResolvedSpecReview).not.toHaveBeenCalled();
    expect(writeGovernanceAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        action: "spec-review-dismissed",
        metadata: expect.objectContaining({ failClosedDismiss: true, bindingId: null }),
      }),
      expect.anything(),
    );
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

  it("resolveSpecReviewTask rejects property key mismatch without confirmPropertyMismatch", async () => {
    vi.mocked(lockOpenSpecReviewTask).mockResolvedValue(openTask);
    vi.mocked(requireOrgOrGlobalSpec).mockResolvedValue({
      id: "pspec:other",
      sourceKind: "manual",
      specificationKey: "manual/other_key",
      propertyKey: "other_key",
      driverModule: "manual",
      lifecycle: "active",
      currentVersionId: "ver-other",
      currentVersion: 1,
      displayName: null,
      description: null,
      valueShape: null,
      schemaDefault: null,
      exampleValue: null,
      schemaNamespace: "manual",
      units: null,
      constraints: null,
      documentation: null,
      compatiblePatterns: null,
      policyTarget: null,
    });
    vi.mocked(assertPropertyKeyMatchOrConfirmed).mockImplementation(() => {
      throw new ApiError("CONFLICT", "Selected parameter spec property key does not match the review task.", 409, {
        taskPropertyKey: "gpio_int",
        specPropertyKey: "other_key",
        confirmRequired: true,
      });
    });

    await expect(
      resolveSpecReviewTask(makeDb(), makeAuth(), {
        taskId: "task-1",
        decision: "resolved",
        parameterSpecId: "pspec:other",
        reason: "forced mismatch",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(applyResolvedSpecReview).not.toHaveBeenCalled();
    expect(writeGovernanceAudit).not.toHaveBeenCalled();
  });

  it("resolveSpecReviewTask audits confirmed property key mismatch", async () => {
    vi.mocked(lockOpenSpecReviewTask).mockResolvedValue(openTask);
    vi.mocked(requireOrgOrGlobalSpec).mockResolvedValue({
      id: "pspec:other",
      sourceKind: "manual",
      specificationKey: "manual/other_key",
      propertyKey: "other_key",
      driverModule: "manual",
      lifecycle: "active",
      currentVersionId: "ver-other",
      currentVersion: 1,
      displayName: null,
      description: null,
      valueShape: null,
      schemaDefault: null,
      exampleValue: null,
      schemaNamespace: "manual",
      units: null,
      constraints: null,
      documentation: null,
      compatiblePatterns: null,
      policyTarget: null,
    });
    vi.mocked(assertPropertyKeyMatchOrConfirmed).mockReturnValue({
      mismatchConfirmed: true,
      taskPropertyKey: "gpio_int",
      specPropertyKey: "other_key",
    });
    vi.mocked(applyResolvedSpecReview).mockResolvedValue({
      bindingId: "binding-1",
      projectId: "project-1",
      configRevisionId: "rev-1",
    });
    vi.mocked(resolveSpecReviewTaskRow).mockResolvedValue({
      ...openTask,
      parameterSpecId: "pspec:other",
      status: "resolved",
      reason: "confirmed mismatch",
      resolvedAt: "2026-07-16T02:00:00.000Z",
    });

    await resolveSpecReviewTask(makeDb(), makeAuth(), {
      taskId: "task-1",
      decision: "resolved",
      parameterSpecId: "pspec:other",
      reason: "confirmed mismatch",
      confirmPropertyMismatch: true,
    });

    expect(writeGovernanceAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          propertyKeyMismatchConfirmed: true,
          taskPropertyKey: "gpio_int",
          specPropertyKey: "other_key",
        }),
      }),
      expect.anything(),
    );
  });

  it("resolveSpecReviewTask createSpec creates draft and keeps task open", async () => {
    const unmatchedTask = {
      ...openTask,
      candidateSchemas: [],
      sourceEvidence: {
        ...openTask.sourceEvidence,
        propertyKey: "mystery_prop",
      },
    };
    vi.mocked(lockOpenSpecReviewTask).mockResolvedValue(unmatchedTask);
    const txQuery = vi.fn().mockResolvedValue({
      rows: [
        {
          ast_json: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "1", value: "1" }]] },
          raw_text: "<1>",
        },
      ],
    });
    const db = {
      query: vi.fn(),
      transaction: vi.fn(async (fn: (tx: { query: typeof txQuery }) => unknown) => fn({ query: txQuery })),
    } as unknown as Database;
    vi.mocked(createOrgManualParameterSpec).mockResolvedValue({
      parameterSpecId: "spec-draft-1",
      parameterSpecVersionId: "spec-draft-1-v1",
      created: true,
      valueShape: { kind: "cells", bits: 32 },
    });

    const result = await resolveSpecReviewTask(db, makeAuth(), {
      taskId: "task-1",
      decision: "resolved",
      createSpec: true,
      reason: "Created from review",
    });

    expect(createOrgManualParameterSpec).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org-1",
        propertyKey: "mystery_prop",
        sourceReviewTaskId: "task-1",
      }),
    );
    expect(result).toMatchObject({
      status: "open",
      draftCreated: true,
      parameterSpecId: "spec-draft-1",
    });
    expect(writeGovernanceAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        action: "spec-draft-created",
        metadata: expect.objectContaining({ created: true }),
      }),
      expect.anything(),
    );
    expect(applyResolvedSpecReview).not.toHaveBeenCalled();
    expect(resolveSpecReviewTaskRow).not.toHaveBeenCalled();
  });
});
