import { describe, expect, it, vi } from "vitest";

import type { ParameterRepository } from "@/application/ports/ParameterRepository";
import { initialState } from "@/mockData";
import { createParameterRuntimeActions, parameterRuntimeFailureNotification } from "./parameterRuntime";

const apiProjects = [{ id: "api-project", name: "API Project", code: "API" }];
const apiParameter = { ...initialState.parameters[0], id: "api-project-param-1", projectId: "api-project" };
const apiChangeRequest = { ...initialState.changeRequests[0], id: "api-change-1", parameterId: apiParameter.id, projectId: "api-project" };
const apiRound = { ...initialState.parameterSubmissionRounds[0], id: "api-round-1", projectId: "api-project" };
const apiDraft = {
  id: "draft-1",
  projectId: "api-project",
  parameterId: apiParameter.id,
  targetValue: "42",
  reason: "Tune value",
  updatedAt: "2026-05-25T08:00:00.000Z"
};
const apiPreviewBatch = {
  id: "batch-1",
  projectId: "api-project",
  sourceName: "import.csv",
  status: "previewed" as const,
  createdAt: "2026-05-25T08:00:00.000Z",
  summary: { added: 1, updated: 0, unchanged: 0, conflict: 0, highRisk: 0 },
  items: []
};

function createRepository(overrides: Partial<ParameterRepository> = {}): ParameterRepository {
  return {
    listProjects: vi.fn().mockResolvedValue(apiProjects),
    listParameters: vi.fn().mockResolvedValue([apiParameter]),
    getParameter: vi.fn().mockResolvedValue(apiParameter),
    listParameterHistory: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([apiDraft]),
    saveDraft: vi.fn().mockResolvedValue(apiDraft),
    deleteDraft: vi.fn().mockResolvedValue(undefined),
    listChangeRequests: vi.fn().mockResolvedValue([apiChangeRequest]),
    listSubmissionRounds: vi.fn().mockResolvedValue([apiRound]),
    submitParameterChanges: vi.fn().mockResolvedValue(apiRound),
    reviewChange: vi.fn().mockResolvedValue(apiChangeRequest),
    createImportPreview: vi.fn().mockResolvedValue(apiPreviewBatch),
    applyImportBatch: vi.fn().mockResolvedValue({
      id: "batch-1",
      projectId: "api-project",
      sourceName: "import.csv",
      status: "applied",
      createdAt: "2026-05-25T08:00:00.000Z",
      appliedAt: "2026-05-25T08:01:00.000Z",
      summary: { added: 1, updated: 0, unchanged: 0, conflict: 0, highRisk: 0 },
      items: []
    }),
    ...overrides
  };
}

describe("createParameterRuntimeActions", () => {
  it("dispatches existing reducer actions in mock mode", async () => {
    const dispatch = vi.fn();
    const actions = createParameterRuntimeActions({ runtimeMode: "mock", dispatch });
    const draftItem = { parameterId: initialState.parameters[0].id, targetValue: "4100", reason: "Raise target" };
    const assignees = {
      hardwareCommitterId: "u-wang-jie",
      softwareCommitterId: "u-sun-mei",
      softwareUserId: "u-chen-na"
    };

    await actions.submitChanges({ projectId: "aurora", items: [draftItem], reason: "submit reason", assignees });
    await actions.stashChanges([draftItem]);
    await actions.reviewChange({ requestId: "CR-1", decision: "advance", note: "Looks good" });
    await actions.reviewChange({ requestId: "CR-2", decision: "reject", note: "Needs data" });
    await actions.applyImportBatch({ batchId: "batch-1" });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "ADD_PARAMETER_SUBMISSION_ROUND",
      items: [draftItem],
      reason: "submit reason",
      assignees
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "STASH_PARAMETER_SUBMISSION_ROUND", items: [draftItem] });
    expect(dispatch).toHaveBeenNthCalledWith(3, { type: "ADVANCE_REVIEW", requestId: "CR-1", note: "Looks good" });
    expect(dispatch).toHaveBeenNthCalledWith(4, { type: "REJECT_REVIEW", requestId: "CR-2", reason: "Needs data" });
    expect(dispatch).toHaveBeenNthCalledWith(5, { type: "IMPORT_PARAMETERS" });
  });

  it("calls the repository and hydrates local parameter runtime after an api submit", async () => {
    const dispatch = vi.fn();
    const repository = createRepository();
    const actions = createParameterRuntimeActions({ runtimeMode: "api", repository, dispatch });
    const input = {
      projectId: "api-project",
      items: [{ parameterId: apiParameter.id, targetValue: "42", reason: "Tune value" }],
      reason: "submit reason"
    };

    await actions.submitChanges(input);

    expect(repository.submitParameterChanges).toHaveBeenCalledWith(input);
    expect(dispatch).toHaveBeenCalledWith({
      type: "HYDRATE_PARAMETER_RUNTIME",
      projects: apiProjects,
      parameters: [apiParameter],
      changeRequests: [apiChangeRequest],
      parameterSubmissionRounds: [apiRound],
      parameterDrafts: [apiDraft]
    });
  });

  it("marks api action failures that already dispatched a notification", async () => {
    const dispatch = vi.fn();
    const repository = createRepository({
      submitParameterChanges: vi.fn().mockRejectedValue(new Error("database unavailable"))
    });
    const actions = createParameterRuntimeActions({ runtimeMode: "api", repository, dispatch });

    const result = await actions.submitChanges({
      projectId: "api-project",
      items: [{ parameterId: apiParameter.id, targetValue: "42", reason: "Tune value" }]
    });

    expect(result).toEqual({ notification: parameterRuntimeFailureNotification, alreadyNotified: true });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "ADD_NOTIFICATION", message: parameterRuntimeFailureNotification });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "ADD_PARAMETER_SUBMISSION_ROUND" }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "STASH_PARAMETER_SUBMISSION_ROUND" }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "ADVANCE_REVIEW" }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "REJECT_REVIEW" }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "IMPORT_PARAMETERS" }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "HYDRATE_PARAMETER_RUNTIME" }));
  });

  it("refresh loads projects, parameters, change requests, submission rounds, and drafts", async () => {
    const dispatch = vi.fn();
    const repository = createRepository();
    const actions = createParameterRuntimeActions({ runtimeMode: "api", repository, dispatch });

    await actions.refresh();

    expect(repository.listProjects).toHaveBeenCalledTimes(1);
    expect(repository.listParameters).toHaveBeenCalledTimes(1);
    expect(repository.listChangeRequests).toHaveBeenCalledTimes(1);
    expect(repository.listSubmissionRounds).toHaveBeenCalledTimes(1);
    expect(repository.listDrafts).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "HYDRATE_PARAMETER_RUNTIME",
      projects: apiProjects,
      parameters: [apiParameter],
      changeRequests: [apiChangeRequest],
      parameterSubmissionRounds: [apiRound],
      parameterDrafts: [apiDraft]
    });
  });

  it("loads a single parameter detail from the repository in api mode", async () => {
    const dispatch = vi.fn();
    const repository = createRepository();
    const actions = createParameterRuntimeActions({ runtimeMode: "api", repository, dispatch });

    await expect(actions.getParameter(apiParameter.id)).resolves.toEqual(apiParameter);

    expect(repository.getParameter).toHaveBeenCalledWith(apiParameter.id);
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "HYDRATE_PARAMETER_RUNTIME" }));
  });

  it("can return a refresh failure without dispatching a duplicate notification", async () => {
    const dispatch = vi.fn();
    const repository = createRepository({
      listProjects: vi.fn().mockRejectedValue(new Error("api down"))
    });
    const actions = createParameterRuntimeActions({ runtimeMode: "api", repository, dispatch });

    const result = await actions.refresh({ notifyOnFailure: false });

    expect(result).toEqual({ notification: parameterRuntimeFailureNotification });
    expect(dispatch).not.toHaveBeenCalledWith({ type: "ADD_NOTIFICATION", message: parameterRuntimeFailureNotification });
  });

  it("refreshes parameter runtime after an api import preview succeeds", async () => {
    const dispatch = vi.fn();
    const repository = createRepository();
    const actions = createParameterRuntimeActions({ runtimeMode: "api", repository, dispatch });
    const input = {
      projectId: "api-project",
      sourceName: "import.csv",
      items: [
        {
          name: "previewed_parameter",
          module: "Charging Policy",
          risk: "High" as const,
          unit: "mA",
          range: "0-5000"
        }
      ]
    };

    const result = await actions.createImportPreview(input);

    expect(result).toEqual(apiPreviewBatch);
    expect(repository.createImportPreview).toHaveBeenCalledWith(input);
    expect(repository.listProjects).toHaveBeenCalledTimes(1);
    expect(repository.listParameters).toHaveBeenCalledTimes(1);
    expect(repository.listChangeRequests).toHaveBeenCalledTimes(1);
    expect(repository.listSubmissionRounds).toHaveBeenCalledTimes(1);
    expect(repository.listDrafts).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "HYDRATE_PARAMETER_RUNTIME",
      projects: apiProjects,
      parameters: [apiParameter],
      changeRequests: [apiChangeRequest],
      parameterSubmissionRounds: [apiRound],
      parameterDrafts: [apiDraft]
    });
  });
});
