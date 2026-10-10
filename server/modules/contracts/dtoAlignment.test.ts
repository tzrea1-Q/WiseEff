import { describe, expect, it } from "vitest";
import type { z } from "zod";

import type { CanonicalParameterCompatibilityRecordDto, ChangeRequestDto, ParameterRecordDto } from "../../../src/infrastructure/http/parameterDtos";
import type { LogRecordDto } from "../../../src/infrastructure/http/logDtos";
import type { XiaozeThreadListItemDto } from "../../../src/infrastructure/http/xiaozeThreadsClient";
import type { CanonicalParameterCompatibilityRecordDto as BackendParameterCompatibilityRecordDto, ParameterRecordDto as BackendParameterRecordDto } from "../parameters/types";
import type { LogRecordDto as BackendLogRecordDto } from "../logs/types";
import type { XiaozeThreadListItem } from "../agent/xiaoze/threadRepository";
import {
  changeRequestDtoSchema,
  canonicalParameterCompatibilityRecordDtoSchema,
  dtoSchemaCatalog,
  logRecordDtoSchema,
  parameterRecordDtoSchema,
  xiaozeAgUiRunRequestSchema,
  xiaozeThreadListItemDtoSchema
} from "./dtoSchemas";
import { schemaRegistry } from "./schemaRegistry";

type Assignable<Left, Right> = Left extends Right ? true : false;
type Expect<T extends true> = T;

type ParameterRecordBackendFitsSchema = Expect<
  Assignable<BackendParameterRecordDto, z.infer<typeof parameterRecordDtoSchema>>
>;
type ParameterRecordSchemaFitsFrontend = Expect<
  Assignable<z.infer<typeof parameterRecordDtoSchema>, ParameterRecordDto>
>;
type ParameterCompatibilityBackendFitsSchema = Expect<
  Assignable<BackendParameterCompatibilityRecordDto, z.infer<typeof canonicalParameterCompatibilityRecordDtoSchema>>
>;
type ParameterCompatibilitySchemaFitsBackend = Expect<
  Assignable<z.infer<typeof canonicalParameterCompatibilityRecordDtoSchema>, BackendParameterCompatibilityRecordDto>
>;
type ParameterCompatibilitySchemaFitsFrontend = Expect<
  Assignable<z.infer<typeof canonicalParameterCompatibilityRecordDtoSchema>, CanonicalParameterCompatibilityRecordDto>
>;
type LogRecordBackendFitsSchema = Expect<Assignable<BackendLogRecordDto, z.infer<typeof logRecordDtoSchema>>>;
type LogRecordSchemaFitsFrontend = Expect<Assignable<z.infer<typeof logRecordDtoSchema>, LogRecordDto>>;
type XiaozeThreadBackendFitsSchema = Expect<
  Assignable<XiaozeThreadListItem, z.infer<typeof xiaozeThreadListItemDtoSchema>>
>;
type XiaozeThreadSchemaFitsFrontend = Expect<
  Assignable<z.infer<typeof xiaozeThreadListItemDtoSchema>, XiaozeThreadListItemDto>
>;

const _typeChecks: [
  ParameterRecordBackendFitsSchema,
  ParameterRecordSchemaFitsFrontend,
  ParameterCompatibilityBackendFitsSchema,
  ParameterCompatibilitySchemaFitsBackend,
  ParameterCompatibilitySchemaFitsFrontend,
  LogRecordBackendFitsSchema,
  LogRecordSchemaFitsFrontend,
  XiaozeThreadBackendFitsSchema,
  XiaozeThreadSchemaFitsFrontend
] = [true, true, true, true, true, true, true, true, true];

const parameterRecordFixture: ParameterRecordDto = {
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

const parameterCompatibilityFixture: BackendParameterCompatibilityRecordDto = {
  ...parameterRecordFixture,
  id: "pbind_compatibility",
  bindingId: "pbind_compatibility",
  projectParameterBindingId: "pbind_compatibility",
  definitionId: "pdef_compatibility",
  effectiveRevisionId: "drev_compatibility",
  currentValueId: "pval_compatibility",
  sourceFileId: "file-compatibility",
  sourceNodePath: "",
  sourceOccurrenceId: "occurrence-compatibility",
  recommendedValue: null,
  range: null,
  unit: null,
  risk: null,
  updatedAt: null,
  updatedAtTs: null,
  history: null,
  metadataAvailability: { status: "unavailable", reason: "canonical-compatibility-metadata-unavailable" }
};

const logRecordFixture: LogRecordDto = {
  id: "log-1",
  reportId: "report-1",
  fileName: "pack-controller.log",
  source: "upload",
  fileSizeBytes: 1_572_864,
  status: "complete",
  archiveState: "active",
  stage: "report",
  confidence: 0.91,
  conclusion: "Charge current derated after thermal warning.",
  impact: "Fast charge throughput reduced.",
  evidence: [
    {
      id: "ev-1",
      stageId: "pattern",
      lineNumbers: [12],
      inference: "Thermal warnings cluster before derating.",
      suggestedAction: "Check pack coolant loop."
    }
  ],
  suggestedActions: ["Inspect coolant loop"],
  severity: "Warning",
  rawLines: ["12 WARN temp=74"],
  capturedAt: "2026-05-25T02:00:00.000Z",
  updatedAt: "2026-05-25T02:05:00.000Z",
  submittedBy: "Xu Yun"
};

describe("DTO schema alignment", () => {
  it("keeps the compile-time backend/frontend assignability checks", () => {
    expect(_typeChecks).toEqual([true, true, true, true, true, true, true, true, true]);
  });

  it("parses representative parameter and log frontend fixtures", () => {
    expect(parameterRecordDtoSchema.parse(parameterRecordFixture).id).toBe(parameterRecordFixture.id);
    expect(logRecordDtoSchema.parse(logRecordFixture).id).toBe(logRecordFixture.id);
  });

  it("the registered v1 list contract preserves exact pins and explicitly unavailable metadata", () => {
    const schema = dtoSchemaCatalog[schemaRegistry["parameters.list"].responseBody]!;
    const response = { items: [parameterCompatibilityFixture] };
    expect(schema.parse(response)).toEqual(response);
    expect(schema.parse({ items: [] })).toEqual({ items: [] });
  });

  it("the registered v1 list contract rejects fabricated metadata and missing canonical identity", () => {
    const schema = dtoSchemaCatalog[schemaRegistry["parameters.list"].responseBody]!;
    expect(schema.safeParse({ items: [{ ...parameterCompatibilityFixture,
      recommendedValue: "", range: "", unit: "", risk: "Low", updatedAt: "", updatedAtTs: "", history: []
    }] }).success).toBe(false);
    expect(schema.safeParse({ items: [{ ...parameterCompatibilityFixture, metadataAvailability: undefined }] }).success).toBe(false);
    expect(schema.safeParse({ items: [{ ...parameterCompatibilityFixture, currentValueId: undefined }] }).success).toBe(false);
  });

  it("the historical detail contract retains metadata and history and does not become the compatibility list DTO", () => {
    const schema = dtoSchemaCatalog[schemaRegistry["parameters.get"].responseBody]!;
    const historical = { ...parameterRecordFixture, history: [{
      version: "v1", value: "2800", changedAt: "2026-05-24T02:00:00.000Z", changedBy: "Reviewer", requestId: "historical-request"
    }] };
    expect(schema.parse({ item: historical })).toEqual({ item: historical });
    expect(schema.safeParse({ item: parameterCompatibilityFixture }).success).toBe(false);
  });

  it("accepts a change-request fixture the HTTP client already maps", () => {
    const dto: ChangeRequestDto = {
      id: "PCR-1",
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
      impact: [{ kind: "module", name: "Charging", note: "Affects charge profile.", risk: "Medium" }]
    };
    expect(changeRequestDtoSchema.parse(dto).id).toBe("PCR-1");
  });

  it("parses the AG-UI fields WiseEff reads without rejecting protocol extras", () => {
    expect(
      xiaozeAgUiRunRequestSchema.parse({
        threadId: "thread-1",
        messages: [{ id: "m1", role: "user", content: "hello" }],
        tools: [],
        extraProtocolField: { type: "RUN_STARTED" }
      })
    ).toMatchObject({ threadId: "thread-1" });
  });
});
