import type { RouteManifestEntry } from "./routeManifest";

export type ContractSchemaRef = {
  summary: string;
  tags: RouteManifestEntry["module"][];
  requestBody?: string;
  responseBody: string;
  responseMedia?: "json" | "binary";
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

  "notifications.list": { summary: "List inbox notifications", tags: ["notifications"], responseBody: "NotificationListResponse" },
  "notifications.unreadCount": {
    summary: "Get unread notification count",
    tags: ["notifications"],
    responseBody: "NotificationUnreadCountResponse"
  },
  "notifications.markRead": {
    summary: "Mark one notification read",
    tags: ["notifications"],
    responseBody: "NotificationItemResponse",
    additionalResponses: { "404": "ErrorResponse" }
  },
  "notifications.markAllRead": {
    summary: "Mark all notifications read",
    tags: ["notifications"],
    responseBody: "NotificationMarkAllReadResponse"
  },

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
  "parameters.listModules": {
    summary: "List parameter module tree",
    tags: ["parameters"],
    responseBody: "ParameterModuleListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameters.createModule": {
    summary: "Create parameter module",
    tags: ["parameters"],
    requestBody: "CreateParameterModuleRequest",
    responseBody: "ParameterModuleResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameters.updateModule": {
    summary: "Update parameter module",
    tags: ["parameters"],
    requestBody: "UpdateParameterModuleRequest",
    responseBody: "ParameterModuleResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameters.moveModule": {
    summary: "Move parameter module to a new parent",
    tags: ["parameters"],
    requestBody: "MoveParameterModuleRequest",
    responseBody: "ParameterModuleResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameters.deleteModule": {
    summary: "Delete parameter module",
    tags: ["parameters"],
    responseBody: "DeleteResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameters.admin.listProjects": {
    summary: "List projects for parameter admin",
    tags: ["parameters"],
    responseBody: "ProjectAdminListResponse"
  },
  "parameters.admin.getProject": {
    summary: "Get project admin detail",
    tags: ["parameters"],
    responseBody: "ProjectAdminDetailResponse"
  },
  "parameters.admin.createProject": {
    summary: "Create project",
    tags: ["parameters"],
    requestBody: "CreateProjectRequest",
    responseBody: "ProjectAdminSummaryResponse",
    successStatus: 201
  },
  "parameters.admin.updateProject": {
    summary: "Update project",
    tags: ["parameters"],
    requestBody: "UpdateProjectRequest",
    responseBody: "ProjectAdminDetailResponse"
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
  "parameters.withdrawSubmissionRound": {
    summary: "Withdraw parameter submission round",
    tags: ["parameters"],
    responseBody: "ParameterSubmissionRoundResponse"
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
  "parameters-dashboard-summary": {
    summary: "Parameter dashboard summary",
    tags: ["parameters"],
    responseBody: "ParameterDashboardSummaryResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameters-dashboard-hotspots": {
    summary: "Parameter dashboard hotspots",
    tags: ["parameters"],
    responseBody: "ParameterDashboardHotspotsResponse",
    additionalResponses: { "403": "ErrorResponse" }
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

  "productFeedback.create": {
    summary: "Create product feedback",
    tags: ["product-feedback"],
    requestBody: "CreateProductFeedbackRequest",
    responseBody: "ProductFeedbackResponse",
    successStatus: 201
  },
  "productFeedback.list": {
    summary: "List product feedback",
    tags: ["product-feedback"],
    responseBody: "ProductFeedbackListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "productFeedback.get": {
    summary: "Get product feedback",
    tags: ["product-feedback"],
    responseBody: "ProductFeedbackResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "productFeedback.patch": {
    summary: "Update product feedback",
    tags: ["product-feedback"],
    requestBody: "PatchProductFeedbackRequest",
    responseBody: "ProductFeedbackResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "productFeedback.attachmentContent": {
    summary: "Get product feedback attachment content",
    tags: ["product-feedback"],
    responseBody: "BinaryAttachment",
    responseMedia: "binary",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
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
  "debugging.listRuntimeNodes": {
    summary: "List runtime debug nodes",
    tags: ["debugging"],
    responseBody: "DebugNodeListResponse"
  },
  "debugging.admin.listParameters": {
    summary: "List debug admin catalog parameters",
    tags: ["debugging"],
    responseBody: "DebugAdminParameterListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "debugging.admin.createParameter": {
    summary: "Create debug admin catalog parameter",
    tags: ["debugging"],
    requestBody: "DebugAdminParameterRequest",
    responseBody: "DebugAdminParameterResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "409": "ErrorResponse" }
  },
  "debugging.admin.updateParameter": {
    summary: "Update debug admin catalog parameter",
    tags: ["debugging"],
    requestBody: "DebugAdminParameterPatchRequest",
    responseBody: "DebugAdminParameterResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "debugging.admin.archiveParameter": {
    summary: "Archive debug admin catalog parameter",
    tags: ["debugging"],
    requestBody: "DebugAdminArchiveParameterRequest",
    responseBody: "DebugAdminParameterResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "debugging.admin.restoreParameter": {
    summary: "Restore debug admin catalog parameter",
    tags: ["debugging"],
    responseBody: "DebugAdminParameterResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "debugging.admin.upsertBinding": {
    summary: "Upsert debug admin protocol binding",
    tags: ["debugging"],
    requestBody: "DebugAdminBindingRequest",
    responseBody: "DebugAdminBindingResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "debugging.admin.patchBinding": {
    summary: "Update debug admin protocol binding",
    tags: ["debugging"],
    requestBody: "DebugAdminBindingRequest",
    responseBody: "DebugAdminBindingResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "debugging.admin.archiveBinding": {
    summary: "Archive debug admin protocol binding",
    tags: ["debugging"],
    responseBody: "DebugAdminBindingResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "debugging.admin.listNodes": {
    summary: "List debug node registry entries",
    tags: ["debugging"],
    responseBody: "DebugNodeListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "debugging.admin.createNode": {
    summary: "Create debug node registry entry",
    tags: ["debugging"],
    requestBody: "DebugNodeAdminRequest",
    responseBody: "DebugNodeResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse" }
  },
  "debugging.admin.updateNode": {
    summary: "Update debug node registry entry",
    tags: ["debugging"],
    requestBody: "DebugNodeAdminPatchRequest",
    responseBody: "DebugNodeResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "debugging.admin.upsertNodeBinding": {
    summary: "Upsert debug node protocol binding",
    tags: ["debugging"],
    requestBody: "DebugAdminNodeBindingRequest",
    responseBody: "DebugAdminNodeBindingResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "debugging.admin.patchNodeBinding": {
    summary: "Update debug node protocol binding",
    tags: ["debugging"],
    requestBody: "DebugAdminNodeBindingRequest",
    responseBody: "DebugAdminNodeBindingResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "debugging.admin.archiveNodeBinding": {
    summary: "Archive debug node protocol binding",
    tags: ["debugging"],
    responseBody: "DebugAdminNodeBindingResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "debugging.admin.listModules": {
    summary: "List debug node module registry entries",
    tags: ["debugging"],
    responseBody: "DebugNodeModuleListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "debugging.admin.createModule": {
    summary: "Create debug node module registry entry",
    tags: ["debugging"],
    requestBody: "DebugNodeModuleRequest",
    responseBody: "DebugNodeModuleResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "409": "ErrorResponse" }
  },
  "debugging.admin.updateModule": {
    summary: "Update debug node module registry entry",
    tags: ["debugging"],
    requestBody: "DebugNodeModulePatchRequest",
    responseBody: "DebugNodeModuleResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "debugging.admin.moveModule": {
    summary: "Move debug node module to a new parent",
    tags: ["debugging"],
    requestBody: "MoveDebugNodeModuleRequest",
    responseBody: "DebugNodeModuleResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "debugging.admin.deleteModule": {
    summary: "Delete debug node module registry entry",
    tags: ["debugging"],
    responseBody: "DeleteResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "debugging.admin.listReloadBindings": {
    summary: "List parameter reload bindings",
    tags: ["debugging"],
    responseBody: "ParameterReloadBindingListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "debugging.admin.upsertReloadBinding": {
    summary: "Upsert parameter reload binding",
    tags: ["debugging"],
    requestBody: "ParameterReloadBindingRequest",
    responseBody: "ParameterReloadBindingResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "debugging.admin.patchReloadBinding": {
    summary: "Patch parameter reload binding",
    tags: ["debugging"],
    requestBody: "ParameterReloadBindingRequest",
    responseBody: "ParameterReloadBindingResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "debugging.listReloadTargets": {
    summary: "List managed parameters with reload bindings for a project",
    tags: ["debugging"],
    responseBody: "ParameterReloadTargetListResponse"
  },
  "debugging.reloadParameter": {
    summary: "Reload managed parameter value onto device",
    tags: ["debugging"],
    requestBody: "ReloadParameterRequest",
    responseBody: "DebugNodeOperationResponse"
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

  "xiaoze.run": { summary: "Run Xiaoze AG-UI agent", tags: ["agent"], responseBody: "GenericObjectResponse" },
  "xiaoze.suggest": { summary: "Run Xiaoze proactive suggest pass", tags: ["agent"], responseBody: "GenericObjectResponse" },
  "xiaoze.listThreads": { summary: "List Xiaoze chat threads", tags: ["agent"], responseBody: "GenericObjectResponse" },
  "xiaoze.createThread": {
    summary: "Create Xiaoze chat thread id",
    tags: ["agent"],
    responseBody: "GenericObjectResponse",
    successStatus: 201
  },
  "xiaoze.getThread": { summary: "Get Xiaoze chat thread", tags: ["agent"], responseBody: "GenericObjectResponse" },
  "xiaoze.patchThread": {
    summary: "Update Xiaoze chat thread title",
    tags: ["agent"],
    requestBody: "GenericObjectRequest",
    responseBody: "GenericObjectResponse"
  },
  "xiaoze.deleteThread": { summary: "Archive Xiaoze chat thread", tags: ["agent"], responseBody: "GenericObjectResponse" },

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
