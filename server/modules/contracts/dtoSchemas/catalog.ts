import type { ZodTypeAny } from "zod";

import {
  xiaozeAgUiRunRequestSchema,
  xiaozeThreadArchiveResponseSchema,
  xiaozeThreadCreateRequestSchema,
  xiaozeThreadCreateResponseSchema,
  xiaozeThreadDetailResponseSchema,
  xiaozeThreadListResponseSchema,
  xiaozeThreadPatchRequestSchema,
  xiaozeThreadPatchResponseSchema
} from "./agent";
import {
  debugDeviceListResponseSchema,
  debugNodeListResponseSchema,
  debugNodeOperationResponseSchema,
  debugParameterListResponseSchema,
  debugRollbackResponseSchema,
  debugSessionEventListResponseSchema,
  debugSessionResponseSchema,
  debugTargetListResponseSchema
} from "./debugging";
import {
  jobResponseSchema,
  logDomainKnowledgeLinkListResponseSchema,
  logDomainListResponseSchema,
  logDomainResponseSchema,
  logFeedbackInsightsResponseSchema,
  logFeedbackResponseSchema,
  logFileUploadResponseSchema,
  logRecordListResponseSchema,
  logRecordResponseSchema,
  logRunListResponseSchema,
  logRunResponseSchema,
  logWebhookDeliveryListResponseSchema,
  logWebhookTestOutcomeResponseSchema
} from "./logs";
import {
  parameterChangeRequestListResponseSchema,
  parameterChangeRequestResponseSchema,
  parameterDraftListResponseSchema,
  parameterDraftResponseSchema,
  parameterHistoryResponseSchema,
  parameterImportBatchResponseSchema,
  parameterListResponseSchema,
  parameterResponseSchema,
  parameterSubmissionRoundListResponseSchema,
  parameterSubmissionRoundResponseSchema,
  projectListResponseSchema
} from "./parameters";

/**
 * OpenAPI component names realized with Zod (parameters / logs / debugging /
 * Xiaoze). Names not listed here stay as `x-wiseeff-schema` placeholders.
 */
export const dtoSchemaCatalog: Record<string, ZodTypeAny> = {
  ProjectListResponse: projectListResponseSchema,
  ParameterListResponse: parameterListResponseSchema,
  ParameterResponse: parameterResponseSchema,
  ParameterHistoryResponse: parameterHistoryResponseSchema,
  ParameterDraftResponse: parameterDraftResponseSchema,
  ParameterDraftListResponse: parameterDraftListResponseSchema,
  ParameterSubmissionRoundResponse: parameterSubmissionRoundResponseSchema,
  ParameterSubmissionRoundListResponse: parameterSubmissionRoundListResponseSchema,
  ParameterChangeRequestListResponse: parameterChangeRequestListResponseSchema,
  ParameterChangeRequestResponse: parameterChangeRequestResponseSchema,
  ParameterImportBatchResponse: parameterImportBatchResponseSchema,

  LogFileUploadResponse: logFileUploadResponseSchema,
  LogRecordListResponse: logRecordListResponseSchema,
  LogRecordResponse: logRecordResponseSchema,
  LogRunListResponse: logRunListResponseSchema,
  LogRunResponse: logRunResponseSchema,
  JobResponse: jobResponseSchema,
  LogDomainListResponse: logDomainListResponseSchema,
  LogDomainResponse: logDomainResponseSchema,
  LogDomainKnowledgeLinkListResponse: logDomainKnowledgeLinkListResponseSchema,
  LogFeedbackInsightsResponse: logFeedbackInsightsResponseSchema,
  LogWebhookDeliveryListResponse: logWebhookDeliveryListResponseSchema,
  LogWebhookTestOutcomeResponse: logWebhookTestOutcomeResponseSchema,
  LogFeedbackResponse: logFeedbackResponseSchema,

  DebugDeviceListResponse: debugDeviceListResponseSchema,
  DebugTargetListResponse: debugTargetListResponseSchema,
  DebugParameterListResponse: debugParameterListResponseSchema,
  DebugNodeListResponse: debugNodeListResponseSchema,
  DebugSessionResponse: debugSessionResponseSchema,
  DebugSessionEventListResponse: debugSessionEventListResponseSchema,
  DebugNodeOperationResponse: debugNodeOperationResponseSchema,
  DebugRollbackResponse: debugRollbackResponseSchema,

  XiaozeThreadListResponse: xiaozeThreadListResponseSchema,
  XiaozeThreadCreateRequest: xiaozeThreadCreateRequestSchema,
  XiaozeThreadCreateResponse: xiaozeThreadCreateResponseSchema,
  XiaozeThreadDetailResponse: xiaozeThreadDetailResponseSchema,
  XiaozeThreadPatchRequest: xiaozeThreadPatchRequestSchema,
  XiaozeThreadPatchResponse: xiaozeThreadPatchResponseSchema,
  XiaozeThreadArchiveResponse: xiaozeThreadArchiveResponseSchema,
  XiaozeAgUiRunRequest: xiaozeAgUiRunRequestSchema
};

export const dtoSchemaCoveredRouteIds = [
  "parameters.listProjects",
  "parameters.list",
  "parameters.get",
  "parameters.history",
  "parameters.saveDraft",
  "parameters.listMyDrafts",
  "parameters.submitRound",
  "parameters.listSubmissionRounds",
  "parameters.withdrawSubmissionRound",
  "parameters.listChangeRequests",
  "parameters.reviewChangeRequest",
  "parameters.createImportBatch",
  "parameters.applyImportBatch",
  "logs.uploadFile",
  "logs.list",
  "logs.get",
  "logs.listRuns",
  "logs.rerun",
  "logs.archive",
  "logs.unarchive",
  "logs.feedback",
  "logs.feedbackInsights",
  "logs.listDomains",
  "logs.createDomain",
  "logs.updateDomain",
  "logs.archiveDomain",
  "logs.listDomainKnowledgeLinks",
  "logs.setDomainKnowledgeLinks",
  "logs.setDomainWebhook",
  "logs.listDomainWebhookDeliveries",
  "logs.sendDomainWebhookTest",
  "jobs.get",
  "debugging.listDevices",
  "debugging.detectTarget",
  "debugging.listParameters",
  "debugging.listRuntimeNodes",
  "debugging.createSession",
  "debugging.getSession",
  "debugging.sessionEvents",
  "debugging.readNode",
  "debugging.writeNode",
  "debugging.rollbackSnapshot",
  "xiaoze.run",
  "xiaoze.listThreads",
  "xiaoze.createThread",
  "xiaoze.getThread",
  "xiaoze.patchThread",
  "xiaoze.deleteThread"
] as const;

export type DtoSchemaCoveredRouteId = (typeof dtoSchemaCoveredRouteIds)[number];
