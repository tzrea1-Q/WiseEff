import { describe, expect, it } from "vitest";

import {
  changeRequestFromDto,
  importBatchFromDto,
  parameterRecordFromDto,
  projectFromDto,
  submissionRoundFromDto,
  type ChangeRequestDto,
  type ParameterImportBatchDto,
  type ParameterRecordDto,
  type ParameterSubmissionRoundDto,
  type ProjectDto
} from "./parameterDtos";

describe("parameter http dto mappers", () => {
  it("maps a project dto to a project summary", () => {
    const dto: ProjectDto = {
      id: "aurora",
      name: "Aurora EV Platform",
      code: "AUR"
    };

    expect(projectFromDto(dto)).toEqual({
      id: "aurora",
      name: "Aurora EV Platform",
      code: "AUR"
    });
  });

  it("maps a parameter dto to a parameter record", () => {
    const dto: ParameterRecordDto = {
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
      risk: "high",
      updatedAt: "2026-05-25 10:00",
      updatedAtTs: "2026-05-25T02:00:00.000Z",
      history: [
        {
          version: "v1",
          value: "2800",
          changedAt: "2026-05-24 09:00",
          changedBy: "Xu Yun",
          requestId: "PCR-1"
        }
      ]
    };

    expect(parameterRecordFromDto(dto)).toEqual({
      ...dto,
      risk: "High"
    });
  });

  it("maps a change request dto to a change request", () => {
    const dto: ChangeRequestDto = {
      id: "PCR-1",
      submissionRoundId: "PRS-1",
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
      impact: [
        {
          kind: "module",
          name: "Charging",
          note: "Affects charge profile.",
          risk: "medium"
        }
      ],
      assignedTo: "hardware-committer",
      workflowAssignees: {
        hardwareCommitterId: "u-hw",
        softwareCommitterId: "u-sw",
        softwareUserId: "u-user"
      },
      fastTrack: false,
      reviewerNote: "Check bench data."
    };

    expect(changeRequestFromDto(dto)).toEqual({
      ...dto,
      status: "硬件Committer检视",
      impact: [{ ...dto.impact[0], risk: "Medium" }]
    });
  });

  it("maps a submission round dto to a submission round", () => {
    const dto: ParameterSubmissionRoundDto = {
      id: "PRS-1",
      projectId: "aurora",
      projectName: "Aurora EV Platform",
      submitter: "Xu Yun",
      createdAt: "2026-05-25 10:00",
      status: "waiting_merge",
      summary: "1 parameter submitted.",
      items: [
        {
          requestId: "PCR-1",
          parameterId: "aurora-fast-charge-current",
          name: "Fast charge current",
          module: "Charging",
          currentValue: "2800",
          targetValue: "3000",
          unit: "mA",
          risk: "low",
          reason: "Align with validated pack profile."
        }
      ]
    };

    expect(submissionRoundFromDto(dto)).toEqual({
      ...dto,
      status: "等待合入",
      items: [{ ...dto.items[0], risk: "Low" }]
    });
  });

  it("maps import preview dto summary counts", () => {
    const dto: ParameterImportBatchDto = {
      id: "PIB-1",
      projectId: "aurora",
      sourceName: "parameters.csv",
      status: "previewed",
      createdAt: "2026-05-25T02:00:00.000Z",
      summary: {
        added: 2,
        updated: 3,
        unchanged: 4,
        conflict: 1,
        highRisk: 2
      },
      items: []
    };

    expect(importBatchFromDto(dto).summary).toEqual({
      added: 2,
      updated: 3,
      unchanged: 4,
      conflict: 1,
      highRisk: 2
    });
  });
});
