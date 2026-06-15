import type { RouteManifestEntry } from "./routeManifest";

export type ContractSchemaRef = {
  summary: string;
  tags: RouteManifestEntry["module"][];
  requestBody?: string;
  responseBody: string;
  successStatus?: 200 | 201;
  additionalSuccessResponses?: Record<string, string>;
  additionalResponses?: Record<string, string>;
};

export const schemaRegistry: Record<string, ContractSchemaRef> = {
  "auth.register": {
    summary: "Register a local WiseEff account",
    tags: ["auth"],
    requestBody: "RegisterLocalAccountRequest",
    responseBody: "AuthSessionResponse",
    successStatus: 201,
    additionalSuccessResponses: { "202": "PendingRegistrationResponse" },
    additionalResponses: { "409": "ErrorResponse" }
  },
  "auth.login": {
    summary: "Log in with a local WiseEff account",
    tags: ["auth"],
    requestBody: "LoginLocalAccountRequest",
    responseBody: "AuthSessionResponse",
    additionalResponses: { "401": "ErrorResponse", "403": "ErrorResponse" }
  },
  "auth.logout": {
    summary: "Log out the current local account session",
    tags: ["auth"],
    responseBody: "LogoutResponse",
    additionalResponses: { "401": "ErrorResponse" }
  },
  "auth.me": { summary: "Get current user context", tags: ["auth"], responseBody: "MeResponse" },
  "auth.updateProfile": {
    summary: "Update the current user profile",
    tags: ["auth"],
    requestBody: "UpdateCurrentUserProfileRequest",
    responseBody: "MeResponse",
    additionalResponses: { "401": "ErrorResponse" }
  },

  "audit.createEvent": {
    summary: "Create audit event",
    tags: ["audit"],
    requestBody: "CreateAuditEventRequest",
    responseBody: "AuditEventResponse",
    successStatus: 201
  },
  "audit.listEvents": { summary: "List audit events", tags: ["audit"], responseBody: "AuditEventListResponse" },

  "users.list": {
    summary: "List governed users",
    tags: ["users"],
    responseBody: "UserGovernanceListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "users.create": {
    summary: "Create local account user",
    tags: ["users"],
    requestBody: "CreateLocalAccountUserRequest",
    responseBody: "UserGovernanceResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "409": "ErrorResponse" }
  },
  "users.listRegistrationRoleRequests": {
    summary: "List pending local registration role requests",
    tags: ["users"],
    responseBody: "RegistrationRoleRequestListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "users.approveRegistrationRoleRequest": {
    summary: "Approve a pending local registration role request",
    tags: ["users"],
    responseBody: "RegistrationRoleRequestResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "users.rejectRegistrationRoleRequest": {
    summary: "Reject a pending local registration role request",
    tags: ["users"],
    responseBody: "RegistrationRoleRequestResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "users.update": {
    summary: "Update governed user profile",
    tags: ["users"],
    requestBody: "UpdateUserGovernanceRequest",
    responseBody: "UserGovernanceResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "users.activation": {
    summary: "Update governed user activation",
    tags: ["users"],
    requestBody: "UpdateUserActivationRequest",
    responseBody: "UserGovernanceResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "users.replaceRoles": {
    summary: "Replace governed user role bindings",
    tags: ["users"],
    requestBody: "ReplaceUserRolesRequest",
    responseBody: "UserGovernanceResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },

  "parameters.listProjects": { summary: "List projects", tags: ["parameters"], responseBody: "ProjectListResponse" },
  "parameters.listProjectModules": {
    summary: "List project modules",
    tags: ["parameters"],
    responseBody: "ProjectModuleListResponse"
  },
  "parameters.list": { summary: "List parameters", tags: ["parameters"], responseBody: "ParameterListResponse" },
  "parameters.get": { summary: "Get parameter", tags: ["parameters"], responseBody: "ParameterResponse" },
  "parameters.history": {
    summary: "Get parameter history",
    tags: ["parameters"],
    responseBody: "ParameterHistoryResponse"
  },
  "parameters.saveDraft": {
    summary: "Save parameter draft",
    tags: ["parameters"],
    requestBody: "SaveParameterDraftRequest",
    responseBody: "ParameterDraftResponse",
    successStatus: 201
  },
  "parameters.listMyDrafts": {
    summary: "List my parameter drafts",
    tags: ["parameters"],
    responseBody: "ParameterDraftListResponse"
  },
  "parameters.deleteDraft": {
    summary: "Delete parameter draft",
    tags: ["parameters"],
    responseBody: "DeleteResponse"
  },
  "parameters.submitRound": {
    summary: "Submit parameter review round",
    tags: ["parameters"],
    requestBody: "SubmitParameterRoundRequest",
    responseBody: "ParameterSubmissionRoundResponse",
    successStatus: 201
  },
  "parameters.listSubmissionRounds": {
    summary: "List parameter submission rounds",
    tags: ["parameters"],
    responseBody: "ParameterSubmissionRoundListResponse"
  },
  "parameters.listChangeRequests": {
    summary: "List parameter change requests",
    tags: ["parameters"],
    responseBody: "ParameterChangeRequestListResponse"
  },
  "parameters.reviewChangeRequest": {
    summary: "Review parameter change request",
    tags: ["parameters"],
    requestBody: "ReviewParameterChangeRequest",
    responseBody: "ParameterChangeRequestResponse"
  },
  "parameters.createImportBatch": {
    summary: "Create parameter import batch",
    tags: ["parameters"],
    requestBody: "CreateParameterImportBatchRequest",
    responseBody: "ParameterImportBatchResponse",
    successStatus: 201
  },
  "parameters.applyImportBatch": {
    summary: "Apply parameter import batch",
    tags: ["parameters"],
    requestBody: "ApplyParameterImportBatchRequest",
    responseBody: "ParameterImportBatchResponse"
  },

  "logs.uploadFile": {
    summary: "Upload log file",
    tags: ["logs"],
    requestBody: "LogFileUploadRequest",
    responseBody: "LogFileUploadResponse",
    successStatus: 201
  },
  "logs.upload": {
    summary: "Create log analysis record",
    tags: ["logs"],
    requestBody: "CreateLogRecordRequest",
    responseBody: "LogRecordResponse",
    successStatus: 201
  },
  "logs.list": { summary: "List log records", tags: ["logs"], responseBody: "LogRecordListResponse" },
  "logs.get": { summary: "Get log record", tags: ["logs"], responseBody: "LogRecordResponse" },
  "logs.listRuns": { summary: "List log analysis runs", tags: ["logs"], responseBody: "LogRunListResponse" },
  "logs.rerun": { summary: "Rerun log analysis", tags: ["logs"], responseBody: "LogRunResponse" },
  "logs.archive": { summary: "Archive log record", tags: ["logs"], responseBody: "LogRecordResponse" },
  "logs.unarchive": { summary: "Unarchive log record", tags: ["logs"], responseBody: "LogRecordResponse" },
  "logs.feedback": {
    summary: "Submit log feedback",
    tags: ["logs"],
    requestBody: "LogFeedbackRequest",
    responseBody: "LogFeedbackResponse"
  },

  "jobs.get": { summary: "Get job status", tags: ["jobs"], responseBody: "JobResponse" },
  "jobs.events": { summary: "List job events", tags: ["jobs"], responseBody: "JobEventListResponse" },

  "debugging.listDevices": {
    summary: "List debug devices",
    tags: ["debugging"],
    responseBody: "DebugDeviceListResponse"
  },
  "debugging.detectTarget": {
    summary: "Detect debug target",
    tags: ["debugging"],
    requestBody: "DetectDebugTargetRequest",
    responseBody: "DebugTargetListResponse"
  },
  "debugging.listParameters": {
    summary: "List debug parameters",
    tags: ["debugging"],
    responseBody: "DebugParameterListResponse"
  },
  "debugging.createSession": {
    summary: "Create debug session",
    tags: ["debugging"],
    requestBody: "CreateDebugSessionRequest",
    responseBody: "DebugSessionResponse",
    successStatus: 201
  },
  "debugging.getSession": { summary: "Get debug session", tags: ["debugging"], responseBody: "DebugSessionResponse" },
  "debugging.sessionEvents": {
    summary: "List debug session events",
    tags: ["debugging"],
    responseBody: "DebugSessionEventListResponse"
  },
  "debugging.readNode": {
    summary: "Read debug node",
    tags: ["debugging"],
    requestBody: "ReadDebugNodeRequest",
    responseBody: "DebugNodeOperationResponse"
  },
  "debugging.writeNode": {
    summary: "Write debug node",
    tags: ["debugging"],
    requestBody: "WriteDebugNodeRequest",
    responseBody: "DebugNodeOperationResponse"
  },
  "debugging.rollbackSnapshot": {
    summary: "Rollback debug snapshot",
    tags: ["debugging"],
    requestBody: "RollbackDebugSnapshotRequest",
    responseBody: "DebugRollbackResponse"
  },

  "agent.createSession": {
    summary: "Create Agent session",
    tags: ["agent"],
    requestBody: "CreateAgentSessionRequest",
    responseBody: "AgentTurnResponse",
    successStatus: 201
  },
  "agent.sendMessage": {
    summary: "Send Agent message",
    tags: ["agent"],
    requestBody: "SendAgentMessageRequest",
    responseBody: "AgentTurnResponse"
  },
  "agent.runToolCall": { summary: "Run Agent tool call", tags: ["agent"], responseBody: "AgentTurnResponse" },
  "agent.approveToolCall": {
    summary: "Approve Agent tool call",
    tags: ["agent"],
    requestBody: "AgentApprovalRequest",
    responseBody: "AgentTurnResponse"
  },
  "agent.rejectToolCall": {
    summary: "Reject Agent tool call",
    tags: ["agent"],
    requestBody: "AgentApprovalRequest",
    responseBody: "AgentTurnResponse"
  },

  "operations.live": { summary: "Liveness check", tags: ["operations"], responseBody: "LiveHealthResponse" },
  "operations.ready": { summary: "Readiness check", tags: ["operations"], responseBody: "ReadyHealthResponse" },
  "operations.pilotReadiness": {
    summary: "Pilot readiness gate",
    tags: ["operations"],
    responseBody: "PilotReadinessResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "operations.compatHealth": {
    summary: "Compatibility health check",
    tags: ["operations"],
    responseBody: "CompatHealthResponse"
  }
};
