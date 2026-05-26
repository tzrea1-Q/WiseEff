import { describe, expect, it, vi } from "vitest";

import { WiseEffApiError, createApiClient } from "./apiClient";
import { createHttpParameterRepository } from "./parameterClient";
import type {
  ChangeRequestDto,
  ParameterDraftDto,
  ParameterHistoryEntryDto,
  ParameterImportBatchDto,
  ParameterRecordDto,
  ParameterSubmissionRoundDto,
  ProjectDto
} from "./parameterDtos";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function fetchQueue(...bodies: unknown[]) {
  return vi.fn(async () => response(bodies.shift()));
}

const parameterDto: ParameterRecordDto = {
  id: "aurora-fast-charge-current",
  name: "Fast charge current",
  description: "Peak fast-charge current limit.",
  explanation: "Caps charge current during thermal-sensitive phases.",
  configFormat: "integer",
  module: "Charging",
  projectId: "aurora",
  currentValue: "2800",
  recommendedValue: "3000",
  range: "0-3500",
  unit: "mA",
  risk: "High",
  updatedAt: "2026-05-25 10:00",
  updatedAtTs: "2026-05-25T02:00:00.000Z",
  history: []
};

const historyDto: ParameterHistoryEntryDto = {
  version: "v1",
  value: "2800",
  changedAt: "2026-05-24 09:00",
  changedBy: "Xu Yun",
  requestId: "PCR-1"
};

const draftDto: ParameterDraftDto = {
  id: "draft-1",
  projectId: "aurora",
  parameterId: "aurora-fast-charge-current",
  targetValue: "3200",
  reason: "Reduce thermal risk.",
  updatedAt: "2026-05-25T00:00:00.000Z"
};

const changeRequestDto: ChangeRequestDto = {
  id: "request-1",
  submissionRoundId: "round-1",
  projectId: "aurora",
  parameterId: "aurora-fast-charge-current",
  module: "Charging",
  title: "Fast charge current -> 3000",
  currentValue: "2800",
  targetValue: "3000",
  submitter: "Xu Yun",
  createdAt: "2026-05-25 10:00",
  createdAtTs: "2026-05-25T02:00:00.000Z",
  updatedAt: "2026-05-25T02:00:00.000Z",
  status: "hardware_review",
  aiSummary: "Review thermal evidence before advancing.",
  waitingHours: 2,
  aiSuggestion: {
    recommendation: "needs-review",
    confidence: "mid",
    summary: "Needs hardware review.",
    reasons: ["Thermal margin changed."],
    similarRequests: ["PCR-0"]
  },
  impact: []
};

const submissionRoundDto: ParameterSubmissionRoundDto = {
  id: "round-1",
  projectId: "aurora",
  projectName: "Aurora EV Platform",
  submitter: "Xu Yun",
  createdAt: "2026-05-25 10:00",
  status: "hardware_review",
  summary: "1 parameter submitted.",
  items: [
    {
      requestId: "request-1",
      parameterId: "aurora-fast-charge-current",
      name: "Fast charge current",
      module: "Charging",
      currentValue: "2800",
      targetValue: "3000",
      unit: "mA",
      risk: "High",
      reason: "Reduce thermal risk."
    }
  ]
};

const importBatchDto: ParameterImportBatchDto = {
  id: "batch-1",
  projectId: "aurora",
  sourceName: "parameters.csv",
  status: "previewed",
  createdAt: "2026-05-25T02:00:00.000Z",
  summary: {
    added: 1,
    updated: 0,
    unchanged: 0,
    conflict: 0,
    highRisk: 1
  },
  items: [
    {
      id: "batch-item-1",
      name: "Fast charge current",
      module: "Charging",
      risk: "High",
      unit: "mA",
      range: "0-3500",
      currentValue: "2800",
      classification: "added",
      riskFlag: true
    }
  ]
};

describe("createHttpParameterRepository", () => {
  it("lists parameters with encoded filters", async () => {
    const fetchMock = fetchQueue({ items: [parameterDto] });
    const repository = createHttpParameterRepository(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    const parameters = await repository.listParameters({ projectId: "aurora", risk: ["High"] });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/parameters?projectId=aurora&risk=High", expect.objectContaining({ method: "GET" }));
    expect(parameters).toEqual([{ ...parameterDto, risk: "High", history: [] }]);
  });

  it("unwraps list and single item response envelopes", async () => {
    const project: ProjectDto = { id: "aurora", name: "Aurora EV Platform", code: "AUR" };
    const fetchMock = fetchQueue(
      { items: [project] },
      { item: parameterDto },
      { items: [historyDto] },
      { item: draftDto },
      { items: [draftDto] },
      { items: [changeRequestDto] },
      { items: [submissionRoundDto] }
    );
    const repository = createHttpParameterRepository(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    await expect(repository.listProjects()).resolves.toEqual([project]);
    await expect(repository.getParameter("parameter with spaces")).resolves.toMatchObject({ id: parameterDto.id });
    await expect(repository.listParameterHistory("parameter with spaces")).resolves.toEqual([historyDto]);
    await expect(repository.saveDraft(draftDto)).resolves.toEqual(draftDto);
    await expect(repository.listDrafts("aurora")).resolves.toEqual([draftDto]);
    await expect(repository.listChangeRequests({ projectId: "aurora" })).resolves.toHaveLength(1);
    await expect(repository.listSubmissionRounds({ projectId: "aurora" })).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/parameters/parameter%20with%20spaces", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/v1/parameters/parameter%20with%20spaces/history", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenNthCalledWith(5, "/api/v1/parameter-drafts/mine?projectId=aurora", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenNthCalledWith(6, "/api/v1/parameter-change-requests?projectId=aurora", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenNthCalledWith(7, "/api/v1/parameter-submission-rounds?projectId=aurora", expect.objectContaining({ method: "GET" }));
  });

  it("posts parameter submissions and reviews to the production endpoints", async () => {
    const fetchMock = fetchQueue({ item: submissionRoundDto }, { item: changeRequestDto });
    const repository = createHttpParameterRepository(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    await repository.submitParameterChanges({
      projectId: "aurora",
      items: [{ parameterId: "aurora-fast-charge-current", targetValue: "3200", reason: "Reduce thermal risk." }],
      reason: "Thermal tuning."
    });
    await repository.reviewChange({
      requestId: "request/with spaces",
      decision: "advance",
      note: "Looks good.",
      expectedVersion: 3
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/parameter-submission-rounds",
      expect.objectContaining({
        body: JSON.stringify({
          projectId: "aurora",
          items: [{ parameterId: "aurora-fast-charge-current", targetValue: "3200", reason: "Reduce thermal risk." }],
          reason: "Thermal tuning."
        }),
        method: "POST"
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/parameter-change-requests/request%2Fwith%20spaces/review",
      expect.objectContaining({
        body: JSON.stringify({ decision: "advance", note: "Looks good.", expectedVersion: 3 }),
        method: "POST"
      })
    );
  });

  it("maps workflow status filters to backend API status values", async () => {
    const fetchMock = fetchQueue({ items: [changeRequestDto] }, { items: [submissionRoundDto] });
    const repository = createHttpParameterRepository(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    await repository.listChangeRequests({ status: ["硬件Committer检视", "已打回"] });
    await repository.listSubmissionRounds({ status: ["软件User合入", "已暂存"] });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/parameter-change-requests?status=hardware_review&status=rejected",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/parameter-submission-rounds?status=software_merge&status=stashed",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("creates and applies import batches through import endpoints", async () => {
    const appliedBatch = { ...importBatchDto, status: "applied" as const, appliedAt: "2026-05-25T03:00:00.000Z" };
    const fetchMock = fetchQueue({ item: importBatchDto }, { item: appliedBatch });
    const repository = createHttpParameterRepository(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    await expect(
      repository.createImportPreview({
        projectId: "aurora",
        sourceName: "parameters.csv",
        items: [{ name: "Fast charge current", module: "Charging", risk: "High", unit: "mA", range: "0-3500", currentValue: "2800" }]
      })
    ).resolves.toEqual(importBatchDto);
    await expect(repository.applyImportBatch({ batchId: "batch/with spaces", selectedItemIds: ["batch-item-1"], expectedVersion: 99 })).resolves.toEqual(
      appliedBatch
    );

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/parameter-import-batches", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/parameter-import-batches/batch%2Fwith%20spaces/apply",
      expect.objectContaining({
        body: JSON.stringify({ selectedItemIds: ["batch-item-1"] }),
        method: "POST"
      })
    );
  });

  it("deletes drafts through the API client", async () => {
    const fetchMock = fetchQueue({ ok: true });
    const repository = createHttpParameterRepository(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    await expect(repository.deleteDraft("draft/with spaces")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/parameter-drafts/draft%2Fwith%20spaces", expect.objectContaining({ method: "DELETE" }));
  });

  it("preserves WiseEffApiError failures from the API client", async () => {
    const fetchMock = vi.fn(async () =>
      response(
        {
          error: {
            code: "FORBIDDEN",
            message: "Parameter view permission is required.",
            details: {},
            requestId: "req-1"
          }
        },
        403
      )
    );
    const repository = createHttpParameterRepository(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    await expect(repository.listParameters()).rejects.toBeInstanceOf(WiseEffApiError);
  });
});
