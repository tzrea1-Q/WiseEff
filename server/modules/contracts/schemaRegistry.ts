import type { RouteManifestEntry } from "./routeManifest";
import { parameterCatalogSchemaRegistry } from "./dtoSchemas/parameterCatalog";
import { parameterDefinitionDeletionSchemaRegistry } from "./dtoSchemas/parameterDefinitionDeletion";

export type ContractParameterRef = {
  name: string;
  in: "header" | "query";
  required?: boolean;
  description?: string;
  schema?: { type: "string" | "integer"; enum?: string[] };
};

export type ContractHeaderRef = {
  name: string;
  description?: string;
  required?: boolean;
};

export type ContractSchemaRef = {
  summary: string;
  tags: RouteManifestEntry["module"][];
  requestBody?: string;
  requestBodyRequired?: boolean;
  responseBody: string;
  responseMedia?: "json" | "binary" | "zip";
  successStatus?: 200 | 201 | 202 | 204 | 410;
  additionalSuccessResponses?: Record<string, string>;
  additionalResponses?: Record<string, string>;
  requestParameters?: readonly ContractParameterRef[];
  successHeaders?: readonly ContractHeaderRef[];
};

const boundedLegacyReadHeaders: readonly ContractHeaderRef[] = [
  { name: "Deprecation", required: true },
  { name: "Sunset", required: true },
  { name: "Link", required: true },
  { name: "Warning", required: true },
  { name: "X-WiseEff-Legacy-Contract", required: true }
];

function retireLegacySurface(
  entry: Omit<ContractSchemaRef, "requestBody" | "responseBody" | "successStatus">,
): ContractSchemaRef {
  return {
    ...entry,
    summary: `Retired: ${entry.summary}`,
    successStatus: 410,
    responseBody: "CatalogLegacyGoneResponse",
    successHeaders: [{ name: "Link", required: true }],
  };
}

export const schemaRegistry: Record<string, ContractSchemaRef> = {
  ...parameterDefinitionDeletionSchemaRegistry,
  "auth.localConfig": {
    summary: "Get public local-account auth configuration",
    tags: ["auth"],
    responseBody: "LocalAuthPublicConfigResponse"
  },
  "auth.register": {
    summary: "Register a local WiseEff account",
    tags: ["auth"],
    requestBody: "RegisterLocalAccountRequest",
    responseBody: "AuthSessionResponse",
    successStatus: 201,
    additionalSuccessResponses: { "202": "PendingRegistrationResponse" },
    additionalResponses: { "403": "ErrorResponse", "409": "ErrorResponse", "429": "ErrorResponse" }
  },
  "auth.login": {
    summary: "Log in with a local WiseEff account",
    tags: ["auth"],
    requestBody: "LoginLocalAccountRequest",
    responseBody: "AuthSessionResponse",
    additionalResponses: { "401": "ErrorResponse", "403": "ErrorResponse", "429": "ErrorResponse" }
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
    additionalResponses: { "400": "ErrorResponse", "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "auth.changePassword": {
    summary: "Change the current local-account password",
    tags: ["auth"],
    requestBody: "ChangeCurrentUserPasswordRequest",
    responseBody: "OkResponse",
    additionalResponses: { "401": "ErrorResponse", "404": "ErrorResponse" }
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

  "organization.get": {
    summary: "Get the caller's home organization",
    tags: ["users"],
    responseBody: "OrganizationResponse",
    additionalResponses: { "401": "ErrorResponse", "404": "ErrorResponse" }
  },
  "organization.update": {
    summary: "Rename the caller's home organization",
    tags: ["users"],
    requestBody: "UpdateOrganizationRequest",
    responseBody: "OrganizationResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "users.list": {
    summary: "List governed users",
    tags: ["users"],
    responseBody: "UserGovernanceListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "users.create": {
    summary: "Create a local account or provision a configured OIDC member",
    tags: ["users"],
    requestBody: "CreateLocalAccountUserRequest",
    responseBody: "UserGovernanceResponse",
    successStatus: 201,
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "409": "ErrorResponse" }
  },
  "users.setOidcIdentity": {
    summary: "Bind a member to the configured OIDC issuer and subject with optimistic concurrency",
    tags: ["users"],
    requestBody: "SetUserOidcIdentityRequest",
    responseBody: "UserGovernanceResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
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
  "users.enableBasicRegistrationRoleRequest": {
    summary: "Reject role promotion and enable the ordinary member account atomically",
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
  "users.delete": {
    summary: "Permanently delete a governed user account",
    tags: ["users"],
    responseBody: "DeleteResponse",
    successStatus: 204,
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
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
  "users.replaceOrganizationRoles": {
    summary: "Replace user organization roles with optimistic concurrency control",
    tags: ["users"],
    requestBody: "ReplaceUserOrganizationRolesRequest",
    responseBody: "UserGovernanceResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "users.getProjectWorkflowRoleBindings": {
    summary: "Get project workflow role bindings and readiness",
    tags: ["users"],
    responseBody: "ProjectWorkflowRoleBindingsResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "users.replaceProjectWorkflowRoleBindings": {
    summary: "Replace project workflow role bindings with optimistic concurrency control",
    tags: ["users"],
    requestBody: "ReplaceProjectWorkflowRolesRequest",
    responseBody: "UserGovernanceResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "users.resetPassword": {
    summary: "Reset a governed user's local password",
    tags: ["users"],
    requestBody: "ResetUserPasswordRequest",
    responseBody: "UserGovernanceResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },

  "parameters.listProjects": { summary: "List projects", tags: ["parameters"], responseBody: "ProjectListResponse" },
  "parameters.listConfigSetFiles": {
    summary: "List Config set member files with active version identity",
    tags: ["parameters"],
    responseBody: "ConfigSetMemberFileListResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameters.getConfigSetReleaseReadiness": {
    summary: "Evaluate server-owned release readiness for a Config set (gate token + ordered blockers/warnings)",
    tags: ["parameters"],
    responseBody: "ConfigSetReleaseReadinessResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameters.getReleaseBaseline": {
    summary: "Read one release baseline with pinned member versions",
    tags: ["parameters"],
    responseBody: "ReleaseBaselineDetailResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameters.compareReleaseBaseline": {
    summary: "Compare a release baseline against working or current released tip members",
    tags: ["parameters"],
    responseBody: "ReleaseBaselineCompareResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameters.previewRestoreReleaseBaseline": {
    summary: "Preview member/version blast radius for restoring a baseline without applying it",
    tags: ["parameters"],
    responseBody: "ReleaseBaselineRestorePreviewResponse",
    requestParameters: [{ name: "sourceConfigRevisionId", in: "query", description: "Explicit actual historical composition for a legacy snapshot without saved source composition.", schema: { type: "string" } }],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameters.rollbackReleaseBaseline": {
    summary: "Atomically restore working member versions from a baseline without changing the released tip",
    tags: ["parameters"],
    requestBody: "ReleaseBaselineRestoreRequest",
    requestBodyRequired: false,
    responseBody: "ReleaseBaselineRollbackResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameters.releaseReleaseBaseline": {
    summary: "Release a draft baseline tip with readiness gate evidence and demote the previous tip to historical",
    tags: ["parameters"],
    requestBody: "ReleaseBaselineRequest",
    responseBody: "ReleaseBaselineReleaseResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameters.getParameterFileStructure": {
    summary: "Read structured DTS nodes/properties for a file version (includes source locators)",
    tags: ["parameters"],
    requestParameters: [{ name: "navigationScope", in: "query", schema: { type: "string", enum: ["organization"] },
      description: "Also resolve directly matched organization-registered nodes for navigation; full nodes remain available." }],
    responseBody: "StructuralReadResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameters.listParameterFileCandidates": {
    summary: "List staged parameter-file candidates for a project",
    tags: ["parameters"],
    responseBody: "ParameterFileCandidateListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameters.createParameterFileCandidate": {
    summary: "Upload a staged candidate; source_revision intent requires original file/config versions and a scoped mutation key",
    tags: ["parameters"],
    requestBody: "CreateParameterFileCandidateRequest",
    responseBody: "ParameterFileCandidateResponse",
    successStatus: 201,
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse", "413": "ErrorResponse" }
  },
  "parameters.getParameterFileCandidate": {
    summary: "Read one staged parameter-file candidate",
    tags: ["parameters"],
    responseBody: "ParameterFileCandidateResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameters.getParameterFileCandidateImpact": {
    summary: "Read candidate impact evidence (diff, diagnostics, coverage, conflicts, blockers)",
    tags: ["parameters"],
    responseBody: "ParameterFileCandidateImpactResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameters.getParameterFileCandidateContent": {
    summary: "Download staged candidate file bytes",
    tags: ["parameters"],
    responseBody: "ParameterFileCandidateContent",
    responseMedia: "binary",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameters.abandonParameterFileCandidate": {
    summary: "Abandon a ready, blocked, or failed candidate without changing Working configuration",
    tags: ["parameters"],
    responseBody: "ParameterFileCandidateResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameters.recomputeParameterFileCandidate": {
    summary: "Recompute candidate impact when external blockers change",
    tags: ["parameters"],
    responseBody: "ParameterFileCandidateResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameters.searchDts": {
    summary: "Search project DTS structure by path/address/label/compatible/value/file (omit by for all)",
    tags: ["parameters"],
    requestParameters: [
      { name: "q", in: "query", required: true, schema: { type: "string" } },
      { name: "by", in: "query", schema: { type: "string", enum: ["path", "address", "label", "compatible", "value", "file"] } },
      { name: "navigationScope", in: "query", schema: { type: "string", enum: ["organization"] },
        description: "Restrict node/property results to organization-managed nodes and structural ancestors; file-name results remain reachable." }
    ],
    responseBody: "DtsSearchResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "500": "ErrorResponse" }
  },

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
    summary: "Create parameter module (shared business-category CRUD supported; structural writes return 410)",
    tags: ["parameters"],
    requestBody: "CreateParameterModuleRequest",
    responseBody: "ParameterModuleResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse", "410": "CatalogLegacyGoneResponse" }
  },
  "parameters.updateModule": {
    summary: "Update parameter module (shared business-category CRUD supported; structural writes return 410)",
    tags: ["parameters"],
    requestBody: "UpdateParameterModuleRequest",
    responseBody: "ParameterModuleResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse", "410": "CatalogLegacyGoneResponse" }
  },
  "parameters.moveModule": {
    summary: "Move parameter module to a new parent (shared business-category CRUD supported; structural writes return 410)",
    tags: ["parameters"],
    requestBody: "MoveParameterModuleRequest",
    responseBody: "ParameterModuleResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse", "410": "CatalogLegacyGoneResponse" }
  },
  "parameters.deleteModule": {
    summary: "Delete parameter module (shared business-category CRUD supported; structural writes return 410)",
    tags: ["parameters"],
    responseBody: "DeleteResponse",
    successStatus: 204,
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse", "410": "CatalogLegacyGoneResponse" }
  },

  "parameterModules.getRegistry": {
    summary: "Get parameter module registry with mappings",
    tags: ["parameter-modules"],
    responseBody: "ParameterModuleRegistryResponse",
    additionalResponses: { "403": "ErrorResponse", "410": "ErrorResponse" },
    successHeaders: boundedLegacyReadHeaders
  },
  "parameterModules.discoveryHints": {
    summary: "List unclassified compatible discovery hints",
    tags: ["parameter-modules"],
    responseBody: "ParameterModuleDiscoveryHintsResponse",
    additionalResponses: { "403": "ErrorResponse", "410": "ErrorResponse" },
    successHeaders: boundedLegacyReadHeaders
  },
  "parameterModules.dismissCompatible": retireLegacySurface({
    summary: "Dismiss a compatible from the unclassified queue",
    tags: ["parameter-modules"],
    additionalResponses: { "403": "ErrorResponse" }
  }),
  "parameterModules.restoreCompatible": retireLegacySurface({
    summary: "Restore a dismissed compatible to the unclassified queue",
    tags: ["parameter-modules"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  }),
  "parameterModules.previewMapping": retireLegacySurface({
    summary: "Preview scoped impact of creating a module mapping",
    tags: ["parameter-modules"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  }),
  "parameterModules.createMapping": retireLegacySurface({
    summary: "Create a module mapping and apply scoped recompute",
    tags: ["parameter-modules"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  }),
  "parameterModules.deleteMapping": retireLegacySurface({
    summary: "Delete a module mapping and apply scoped recompute",
    tags: ["parameter-modules"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  }),
  "parameterModules.recomputeBindings": retireLegacySurface({
    summary: "Recompute binding module assignments (operations tool)",
    tags: ["parameter-modules"],
    additionalResponses: { "403": "ErrorResponse", "409": "ErrorResponse" }
  }),
  "parameterModules.listDriverRegistry": {
    summary: "List curated driver-group registry entries with parse coverage",
    tags: ["parameter-modules"],
    responseBody: "DriverRegistryListResponse",
    additionalResponses: { "403": "ErrorResponse", "410": "ErrorResponse" },
    successHeaders: boundedLegacyReadHeaders
  },
  "parameterModules.registerDriver": retireLegacySurface({
    summary: "Register or claim a driver group with exact compatible mappings",
    tags: ["parameter-modules"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  }),
  "parameterModules.updateDriverRegistration": retireLegacySurface({
    summary: "Update driver registration nature and/or instance cardinality",
    tags: ["parameter-modules"],
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse" }
  }),
  "parameterModules.updateDriverRegistrationDefault": retireLegacySurface({
    summary: "Update driver registration default business category and replay auto placements",
    tags: ["parameter-modules"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  }),
  "parameterModules.replayDriverPlacement": retireLegacySurface({
    summary: "Replay auto driver-group placement from registration default business category",
    tags: ["parameter-modules"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  }),
  "parameterSpecs.listOrganizationDriverSchemas": retireLegacySurface({
    summary: "List organization-owned manual driver schema overlays",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse" }
  }),
  "parameterSpecs.getOrganizationDriverSchema": retireLegacySurface({
    summary: "Get one organization driver schema overlay",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  }),
  "parameterSpecs.createOrganizationDriverSchema": retireLegacySurface({
    summary: "Create a draft organization driver schema overlay",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse", "409": "ErrorResponse" }
  }),
  "parameterSpecs.updateOrganizationDriverSchema": retireLegacySurface({
    summary: "Update a draft organization driver schema overlay",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  }),
  "parameterSpecs.activateOrganizationDriverSchema": retireLegacySurface({
    summary: "Activate an organization driver schema overlay and upgrade provisional specs",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  }),
  "parameterSpecs.previewOrganizationDriverSchemaDeprecation": retireLegacySurface({
    summary: "Preview coverage and usage impact before overlay retirement",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  }),
  "parameterSpecs.deprecateOrganizationDriverSchema": retireLegacySurface({
    summary: "Deprecate an organization driver schema overlay",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  }),
  "parameterSpecs.listPromotionCandidates": retireLegacySurface({
    summary: "List platform driver-schema promotion candidates by compatible",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse" }
  }),
  "parameterSpecs.promoteDriverSchemaOverlay": retireLegacySurface({
    summary: "Promote organization driver schema overlays into a platform-tier schema",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse", "409": "ErrorResponse" }
  }),
  "parameterSpecs.revertDriverSchemaPromotion": retireLegacySurface({
    summary: "Revert a platform driver-schema promotion and restore contributor overlays",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  }),

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
  "parameters.initialization.get": {
    summary: "Get project parameter initialization status and draft",
    tags: ["parameters"],
    responseBody: "ProjectInitializationStatusResponse"
  },
  "parameters.initialization.upsertDraft": {
    summary: "Upsert project parameter initialization draft",
    tags: ["parameters"],
    requestBody: "UpsertProjectInitializationDraftRequest",
    responseBody: "ProjectInitializationDraftResponse"
  },
  "parameters.initialization.preview": {
    summary: "Preview merged initialization binding snapshots",
    tags: ["parameters"],
    requestBody: "PreviewProjectInitializationSnapshotRequest",
    responseBody: "ProjectInitializationSnapshotPreviewResponse"
  },
  "parameters.initialization.submit": {
    summary: "Submit project parameter initialization for review",
    tags: ["parameters"],
    responseBody: "ProjectInitializationReviewResponse",
    successStatus: 201
  },
  "parameters.admin.listInitializationReviews": {
    summary: "List pending project parameter initialization reviews",
    tags: ["parameters"],
    responseBody: "ProjectInitializationReviewListResponse"
  },
  "parameters.admin.approveInitializationReview": {
    summary: "Approve project parameter initialization review",
    tags: ["parameters"],
    responseBody: "ProjectInitializationReviewResponse"
  },
  "parameters.admin.rejectInitializationReview": {
    summary: "Reject project parameter initialization review",
    tags: ["parameters"],
    requestBody: "RejectProjectInitializationReviewRequest",
    responseBody: "ProjectInitializationReviewResponse"
  },
  "parameters.list": { summary: "List parameters", tags: ["parameters"], responseBody: "ParameterListResponse" },
  "parameters.get": {
    summary: "Get canonical parameter Binding (legacy IDs require an exact typed mapping)",
    tags: ["parameters"], responseBody: "ParameterResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse", "410": "CatalogLegacyGoneResponse" }
  },
  "parameters.history": {
    summary: "Get canonical Binding and Project value history",
    tags: ["parameters"],
    responseBody: "ParameterHistoryResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "410": "CatalogLegacyGoneResponse" }
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

  "parameterSpecs.list": {
    summary: "Read exact canonical spec mappings during the legacy read window",
    tags: ["parameters"],
    responseBody: "CatalogLegacySpecListResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse", "410": "ErrorResponse", "503": "ErrorResponse" },
    successHeaders: boundedLegacyReadHeaders
  },
  "parameterSpecs.create": retireLegacySurface({
    summary: "Create a draft parameter definition bound to an attribution subject",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse", "409": "ErrorResponse" }
  }),
  "parameterSpecs.get": {
    summary: "Read an exact canonical spec mapping during the legacy read window",
    tags: ["parameters"],
    responseBody: "CatalogLegacySpecResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse", "410": "ErrorResponse", "503": "ErrorResponse" },
    successHeaders: boundedLegacyReadHeaders
  },
  "parameterSpecs.getCutover": retireLegacySurface({
    summary: "Get open parameter spec version cutover impact",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  }),
  "parameterSpecs.prepareCutover": retireLegacySurface({
    summary: "Prepare binding items for parameter spec version cutover",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  }),
  "parameterSpecs.finalizeCutover": retireLegacySurface({
    summary: "Finalize parameter spec version cutover after prepare",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  }),
  "parameterSpecs.listReviewTasks": {
    summary: "List organization-scoped parameter specification review tasks",
    tags: ["parameters"],
    responseBody: "ParameterSpecReviewTaskListResponse",
    additionalResponses: { "403": "ErrorResponse", "410": "ErrorResponse" },
    successHeaders: boundedLegacyReadHeaders
  },
  "parameterSpecs.resolveReviewTask": retireLegacySurface({
    summary: "Resolve a parameter specification review task",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  }),
  "parameterSpecs.deprecate": retireLegacySurface({
    summary: "Soft-deprecate a parameter definition (definition lifecycle)",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  }),
  "parameterSpecs.restore": retireLegacySurface({
    summary: "Restore a soft-deprecated parameter definition",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  }),
  "parameterSpecs.reattribute": retireLegacySurface({
    summary: "Correct a parameter definition attribution subject in place",
    tags: ["parameters"],
    additionalResponses: {
      "403": "ErrorResponse",
      "404": "ErrorResponse",
      "409": "ErrorResponse"
    }
  }),
  "parameterSpecs.renamePropertyKey": retireLegacySurface({
    summary: "Rename a zero-reference parameter definition property key in place",
    tags: ["parameters"],
    additionalResponses: {
      "403": "ErrorResponse",
      "404": "ErrorResponse",
      "409": "ErrorResponse"
    }
  }),
  "parameterSpecs.getPropertyKeyCutover": retireLegacySurface({
    summary: "Read the open property-key source cutover run for a spec",
    tags: ["parameters"],
    additionalResponses: {
      "403": "ErrorResponse",
      "404": "ErrorResponse"
    }
  }),
  "parameterSpecs.previewPropertyKeyCutover": retireLegacySurface({
    summary: "Preview a referenced property-key source cutover without writing catalog or source",
    tags: ["parameters"],
    additionalResponses: {
      "400": "ErrorResponse",
      "403": "ErrorResponse",
      "404": "ErrorResponse"
    }
  }),
  "parameterSpecs.startPropertyKeyCutover": retireLegacySurface({
    summary: "Start a referenced property-key source cutover run from the preview locations",
    tags: ["parameters"],
    additionalResponses: {
      "400": "ErrorResponse",
      "403": "ErrorResponse",
      "404": "ErrorResponse",
      "409": "ErrorResponse"
    }
  }),
  "parameterSpecs.preparePropertyKeyCutover": retireLegacySurface({
    summary: "Stage property-key source rewrites as file-candidate drafts without writing live source or catalog",
    tags: ["parameters"],
    additionalResponses: {
      "403": "ErrorResponse",
      "404": "ErrorResponse",
      "409": "ErrorResponse"
    }
  }),
  "parameterSpecs.finalizePropertyKeyCutover": retireLegacySurface({
    summary: "Finalize a property-key source cutover by rewriting the catalog triple after sources moved",
    tags: ["parameters"],
    additionalResponses: {
      "400": "ErrorResponse",
      "403": "ErrorResponse",
      "404": "ErrorResponse",
      "409": "ErrorResponse"
    }
  }),
  "parameterTopology.listConfigRevisions": {
    summary: "List config revisions for a project config set",
    tags: ["parameters"],
    responseBody: "ConfigRevisionListResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterTopology.getTopology": {
    summary: "Get source or effective DTS topology for a config revision",
    tags: ["parameters"],
    responseBody: "ParameterTopologyResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterTopology.listBindings": {
    summary: "List semantic project parameter bindings",
    tags: ["parameters"],
    responseBody: "ProjectParameterBindingListResponse",
    additionalResponses: { "403": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterTopology.getBindingHistory": {
    summary: "List binding-revision change history for a project parameter binding",
    tags: ["parameters"],
    responseBody: "BindingHistoryListResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterTopology.getBindingCompare": {
    summary: "Compare a project parameter binding across other projects in the same organization",
    tags: ["parameters"],
    responseBody: "BindingCompareListResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterTopology.listIdentityMappingTasks": {
    summary: "List identity mapping tasks",
    tags: ["parameters"],
    responseBody: "IdentityMappingTaskListResponse",
    additionalResponses: { "403": "ErrorResponse", "410": "ErrorResponse" },
    successHeaders: boundedLegacyReadHeaders
  },
  "parameterTopology.resolveIdentityMappingTask": retireLegacySurface({
    summary: "Resolve or protected re-resolve an identity mapping task",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  }),
  "parameterTopology.reopenIdentityMappingTask": retireLegacySurface({
    summary: "Reopen a non-destructive identity mapping outcome",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  }),
  "parameterTopology.validateConfigRevision": {
    summary: "Validate a config revision with the DTS toolchain gate",
    tags: ["parameters"],
    requestBody: "ValidateConfigRevisionRequest",
    responseBody: "ConfigRevisionValidationResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterTopology.createBindingDraft": {
    summary: "Create a typed parameter binding draft with precise Config Set writeback",
    tags: ["parameters"],
    requestBody: "CreateBindingDraftRequest",
    responseBody: "BindingDraftResponse",
    successStatus: 201,
    additionalResponses: {
      "400": "ErrorResponse",
      "403": "ErrorResponse",
      "404": "ErrorResponse",
      "409": "ErrorResponse"
    }
  },
  "parameterTopology.createNodeEnablementDraft": {
    summary: "Create a node enablement draft that shares the binding draft tip pipeline",
    tags: ["parameters"],
    requestBody: "CreateNodeEnablementDraftRequest",
    responseBody: "NodeEnablementDraftResponse",
    successStatus: 201,
    additionalResponses: {
      "400": "ErrorResponse",
      "403": "ErrorResponse",
      "404": "ErrorResponse",
      "409": "ErrorResponse"
    }
  },

  "parameterTopology.listProjectValueDrafts": {
    summary: "List the calling user's pending canonical value drafts for a project",
    tags: ["parameters"],
    responseBody: "ProjectValueDraftListResponse",
    additionalResponses: {
      "403": "ErrorResponse",
      "404": "ErrorResponse"
    }
  },
  "parameterTopology.removeProjectValueDraft": {
    summary: "Remove one pending canonical value draft",
    tags: ["parameters"],
    responseBody: "ProjectValueDraftRemovedResponse",
    additionalResponses: {
      "403": "ErrorResponse",
      "404": "ErrorResponse"
    }
  },
  "parameterTopology.getBindingChangeHistory": {
    summary: "Read canonical binding change history with exact value and revision pins",
    tags: ["parameters"],
    responseBody: "BindingChangeHistoryListResponse",
    additionalResponses: {
      "403": "ErrorResponse",
      "404": "ErrorResponse"
    }
  },
  "parameterTopology.exportProjectBinding": {
    summary: "Export the exact canonical project-source bytes for a binding's pinned revision",
    tags: ["parameters"],
    responseBody: "BindingExportResponse",
    additionalResponses: {
      "403": "ErrorResponse",
      "404": "ErrorResponse",
      "409": "ErrorResponse"
    }
  },
  "parameterTopology.submitProjectValueChangeRequest": {
    summary: "Freeze a pending canonical value draft into a reviewable change request",
    tags: ["parameters"],
    requestBody: "SubmitProjectValueChangeRequest",
    responseBody: "ProjectValueChangeRequestResponse",
    successStatus: 201,
    additionalResponses: {
      "400": "ErrorResponse",
      "403": "ErrorResponse",
      "404": "ErrorResponse",
      "409": "ErrorResponse"
    }
  },
  "parameterTopology.listProjectValueChangeRequests": {
    summary: "List canonical value change requests for a project",
    tags: ["parameters"],
    responseBody: "ProjectValueChangeRequestListResponse",
    additionalResponses: {
      "403": "ErrorResponse",
      "404": "ErrorResponse"
    }
  },
  "parameterTopology.submitMemberRemovalRequest": {
    summary: "Freeze one canonical JSON source member removal for a separate human reviewer",
    tags: ["parameters"],
    requestBody: "SubmitMemberRemovalRequest",
    responseBody: "MemberRemovalRequestResponse",
    successStatus: 201,
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse",
      "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterTopology.listMemberRemovalRequests": {
    summary: "List visible canonical member removal requests",
    tags: ["parameters"],
    responseBody: "MemberRemovalRequestListResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterTopology.getMemberRemovalRequest": {
    summary: "Read one frozen canonical member removal proof for its submitter or assigned reviewer",
    tags: ["parameters"],
    responseBody: "MemberRemovalRequestResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterTopology.getProjectValueBatchChangeRequest": {
    summary: "Read one frozen canonical batch request, ordered cohort draft impact and targets for its submitter or assigned reviewer",
    tags: ["parameters"],
    responseBody: "ProjectValueBatchChangeRequestResponse",
    additionalResponses: {
      "403": "ErrorResponse",
      "404": "ErrorResponse"
    }
  },
  "parameterTopology.submitProjectValueBatchChangeRequest": {
    summary: "Freeze and submit one canonical JSON or DTS batch request and its full cohort draft impact for a separate assigned software reviewer",
    tags: ["parameters"],
    requestBody: "SubmitProjectValueBatchChangeRequest",
    responseBody: "ProjectValueBatchChangeRequestResponse",
    successStatus: 201,
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse",
      "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterTopology.listProjectValueBatchChangeRequests": {
    summary: "List canonical batch requests assigned to the reviewer or submitted by the caller",
    tags: ["parameters"],
    responseBody: "ProjectValueBatchChangeRequestListResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterTopology.reviewProjectValueChangeRequest": {
    summary: "Review one canonical value, batch, or member removal request with its frozen proof",
    tags: ["parameters"],
    requestBody: "ReviewProjectValueChangeRequest",
    responseBody: "ProjectValueChangeReviewResponse",
    additionalResponses: {
      "400": "ErrorResponse",
      "403": "ErrorResponse",
      "404": "ErrorResponse",
      "409": "ErrorResponse"
    }
  },
  "parameterTopology.withdrawProjectValueChangeRequest": {
    summary: "Withdraw one pending canonical value change request as its submitter",
    tags: ["parameters"],
    responseBody: "ProjectValueChangeWithdrawalResponse",
    additionalResponses: {
      "403": "ErrorResponse",
      "404": "ErrorResponse",
      "409": "ErrorResponse"
    }
  },
  "parameterTopology.getProjectValueChangeRequestSourceDiff": {
    summary: "Read the exact canonical source diff for one pending value change request",
    tags: ["parameters"],
    responseBody: "ValueChangeSourceDiffResponse",
    additionalResponses: {
      "403": "ErrorResponse",
      "404": "ErrorResponse",
      "409": "ErrorResponse"
    }
  },
  "parameterTopology.reimportPreviewProjectBinding": {
    summary: "Verify that exported canonical source bytes still match the pinned binding",
    tags: ["parameters"],
    requestBody: "BindingExportRequest",
    responseBody: "BindingExportResponse",
    additionalResponses: {
      "400": "ErrorResponse",
      "403": "ErrorResponse",
      "404": "ErrorResponse",
      "409": "ErrorResponse"
    }
  },
  "parameterTopology.registerConfigurationInstances": {
    summary: "Register JSON configuration-instance mappings as canonical bindings",
    tags: ["parameters"],
    requestBody: "RegisterConfigurationInstancesRequest",
    responseBody: "ProjectParameterBindingListResponse",
    successStatus: 201,
    additionalResponses: {
      "400": "ErrorResponse",
      "403": "ErrorResponse",
      "404": "ErrorResponse",
      "409": "ErrorResponse"
    }
  },

  "logs.listIntegrationCredentials": { summary: "List organization integration credentials (logs:admin-domains)", tags: ["logs"], responseBody: "LogIntegrationCredentialListResponse" },
  "logs.issueIntegrationCredential": { summary: "Issue integration credential; secret returned once (logs:admin-domains)", tags: ["logs"], requestBody: "IssueLogIntegrationCredentialRequest", responseBody: "LogIntegrationCredentialSecretResponse", successStatus: 201 },
  "logs.rotateIntegrationCredential": { summary: "Rotate integration credential immediately; secret returned once (logs:admin-domains)", tags: ["logs"], responseBody: "LogIntegrationCredentialSecretResponse" },
  "logs.revokeIntegrationCredential": { summary: "Revoke integration credential (logs:admin-domains)", tags: ["logs"], responseBody: "LogIntegrationCredentialResponse" },
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
  "logs.getTrace": { summary: "Read current run trace (logs:admin-domains)", tags: ["logs"], responseBody: "LogTraceResponse", additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" } },
  "logs.listAnalysisCases": { summary: "List skill analysis cases and current run (logs:admin-domains)", tags: ["logs"], responseBody: "LogAnalysisCaseListResponse" },
  "logs.createAnalysisCase": { summary: "Create an audited skill analysis case", tags: ["logs"], requestBody: "LogAnalysisCaseCreateRequest", responseBody: "LogAnalysisCaseResponse", successStatus: 201 },
  "logs.updateAnalysisCase": { summary: "Update audited analysis-case expectations", tags: ["logs"], requestBody: "LogAnalysisCaseUpdateRequest", responseBody: "LogAnalysisCaseResponse" },
  "logs.deleteAnalysisCase": { summary: "Delete an audited skill analysis case", tags: ["logs"], responseBody: "LogFeedbackResponse" },
  "logs.startAnalysisCaseRun": { summary: "Compare saved draft and published revision on analysis cases", tags: ["logs"], requestBody: "LogAnalysisCaseRunRequest", responseBody: "LogAnalysisCaseRunResponse", successStatus: 202, additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse", "429": "ErrorResponse" } },
  "logs.getAnalysisCaseRun": { summary: "Read an analysis-case run", tags: ["logs"], responseBody: "LogAnalysisCaseRunResponse" },
  "logs.getAnalysisCaseTrace": { summary: "Read a case trace for the captured revision", tags: ["logs"], responseBody: "LogTraceResponse", requestParameters: [{ name: "revision", in: "query", schema: { type: "string", enum: ["draft", "published"] } }] },
  "logs.getAnalysisCasePrefill": { summary: "Prefill a case from a completed accessible skill report", tags: ["logs"], responseBody: "LogAnalysisCasePrefillResponse" },
  "logs.importAnalysisCases": { summary: "Import bounded analysis cases from an eval ZIP", tags: ["logs"], requestBody: "LogAnalysisCaseMultipartImport", responseBody: "LogAnalysisCaseImportResponse", successStatus: 201 },
  "logs.exportAnalysisCases": { summary: "Export analysis cases as an eval ZIP", tags: ["logs"], responseBody: "BinaryAttachment", responseMedia: "binary" },
  "logs.startDryRun": { summary: "Run the saved draft on its stored sample (logs:admin-domains)", tags: ["logs"], responseBody: "LogSkillDryRunResponse", successStatus: 202, additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse", "429": "ErrorResponse" } },
  "logs.getDryRun": { summary: "Read skill dry run and trace (logs:admin-domains)", tags: ["logs"], responseBody: "LogSkillDryRunDetailResponse", additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" } },
  "logs.getDryRunLines": { summary: "Read at most 400 lines from the dry run pinned sample (logs:admin-domains)", tags: ["logs"], responseBody: "LogLineRangeResponse", additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" },
    requestParameters: [
      { name: "file", in: "query", required: true, schema: { type: "string" } },
      { name: "startLine", in: "query", required: true, schema: { type: "integer" } },
      { name: "endLine", in: "query", required: true, schema: { type: "integer" } }
    ] },
  "logs.get": { summary: "Get log record with run-owned signals and line templates", tags: ["logs"], responseBody: "LogRecordResponse" },
  "logs.previewDeletion": {
    summary: "Preview organization-owned log deletion, task effects and retained shared data without writes",
    tags: ["logs"], responseBody: "LogDeletionPreviewResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "logs.purge": {
    summary: "Permanently delete the confirmed organization-owned log and retry remaining object cleanup",
    tags: ["logs"], requestBody: "LogDeletionRequest", responseBody: "LogDeletionStatusResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "logs.deletionStatus": {
    summary: "Read the authorized durable database and storage cleanup result for a deleted log",
    tags: ["logs"], responseBody: "LogDeletionStatusResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "logs.pendingDeletions": {
    summary: "List this organization's logs with remaining storage cleanup",
    tags: ["logs"], responseBody: "LogDeletionStatusListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "logs.listSkillDeletions": {
    summary: "List this organization's deleted skills with remaining storage cleanup", tags: ["logs"],
    responseBody: "SkillDeletionListResponse", additionalResponses: { "403": "ErrorResponse" }
  },
  "logs.retrySourceSnapshot": {
    summary: "Retry a failed source snapshot's original uploaded content and index inputs under the same identity",
    tags: ["logs"], requestBody: "RetryLogSourceSnapshotRequest", requestBodyRequired: false,
    responseBody: "LogSourceSnapshotResponse", successStatus: 202,
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "logs.restoreSourceSnapshot": {
    summary: "Restore an archived source snapshot under its original identity and requeue its original uploaded content for indexing",
    tags: ["logs"], requestBody: "RetryLogSourceSnapshotRequest", requestBodyRequired: false,
    responseBody: "LogSourceSnapshotResponse", successStatus: 202,
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "logs.previewSkillDeletion": {
    summary: "Inspect exact references and owned objects before deleting an unpublished experimental skill", tags: ["logs"],
    responseBody: "SkillDeletionPreviewResponse", additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "logs.getSkillDeletionStatus": {
    summary: "Read the durable database and object cleanup result for a deleted skill", tags: ["logs"],
    responseBody: "SkillDeletionStatusResponse", additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "logs.purgeSkill": {
    summary: "Delete an unchanged unpublished, unreferenced experimental skill and retry owned object cleanup", tags: ["logs"],
    requestBody: "SkillDeletionRequest", responseBody: "SkillDeletionStatusResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "logs.getLines": {
    summary: "Read an inclusive window of at most 400 indexed log lines",
    tags: ["logs"], responseBody: "LogLineRangeResponse",
    requestParameters: [
      { name: "file", in: "query", required: true, description: "Exact file path in the record inventory", schema: { type: "string" } },
      { name: "startLine", in: "query", required: true, description: "First line, 1-based inclusive", schema: { type: "integer" } },
      { name: "endLine", in: "query", required: true, description: "Last line, inclusive; clipped to the file length", schema: { type: "integer" } }
    ]
  },
  "logs.listRuns": { summary: "List log analysis runs", tags: ["logs"], responseBody: "LogRunListResponse" },
  "logs.rerun": { summary: "Rerun log analysis", tags: ["logs"], requestBody: "LogRerunRequest", responseBody: "LogRunResponse" },
  "logs.archive": { summary: "Archive log record", tags: ["logs"], responseBody: "LogRecordResponse" },
  "logs.unarchive": { summary: "Unarchive log record", tags: ["logs"], responseBody: "LogRecordResponse" },
  "logs.feedback": {
    summary: "Submit log feedback",
    tags: ["logs"],
    requestBody: "LogFeedbackRequest",
    responseBody: "LogFeedbackResponse"
  },
  "logs.feedbackInsights": {
    summary: "Aggregate log feedback quality insights",
    tags: ["logs"],
    responseBody: "LogFeedbackInsightsResponse"
  },
  "logs.listSkills": { summary: "List analysis skills", tags: ["logs"], responseBody: "LogSkillListResponse" },
  "logs.recommendSkills": { summary: "Recommend published organization skills from bounded file heads (logs:upload)", tags: ["logs"], requestBody: "LogSkillRecommendationRequest", responseBody: "LogSkillRecommendationResponse", additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "413": "ErrorResponse" } },
  "logs.createSkill": { summary: "Create analysis skill", tags: ["logs"], requestBody: "CreateLogSkillRequest", responseBody: "LogSkillResponse", successStatus: 201 },
  "logs.importSkillPackage": {
    summary: "Import a validated skill ZIP atomically (logs:admin-domains)", tags: ["logs"],
    requestBody: "LogSkillPackageMultipartImport", responseBody: "LogSkillResponse", successStatus: 201,
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "409": "ErrorResponse" }
  },
  "logs.exportSkillPackage": {
    summary: "Export a skill revision as a ZIP (logs:admin-domains)", tags: ["logs"],
    responseBody: "BinaryAttachment", responseMedia: "zip",
    requestParameters: [{ name: "revision", in: "query", description: "Defaults to published; draft requires a saved draft.", schema: { type: "string", enum: ["published", "draft"] } }],
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "logs.listSkillTemplates": { summary: "List skill templates", tags: ["logs"], responseBody: "LogSkillTemplateListResponse" },
  "logs.getSkillSample": { summary: "Read skill sample inventory and first 5000 lines per text file", tags: ["logs"], responseBody: "LogSkillSampleResponse" },
  "logs.replaceSkillSample": { summary: "Replace skill sample (text or archive, up to 2 MiB uploaded and expanded)", tags: ["logs"], requestBody: "ReplaceLogSkillSampleRequest", responseBody: "LogSkillSampleReplaceResponse" },
  "logs.deleteSkillSample": { summary: "Delete skill sample", tags: ["logs"], successStatus: 204, responseBody: "LogSkillDiscardResponse" },
  "logs.listSourceSnapshots": { summary: "List source snapshot metadata", tags: ["logs"], responseBody: "LogSourceSnapshotListResponse" },
  "logs.listSourceVersions": { summary: "List ready source version labels (logs:view or logs:upload)", tags: ["logs"], responseBody: "LogSourceVersionListResponse", additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" } },
  "logs.uploadSourceSnapshot": { summary: "Upload a version-labelled source archive", tags: ["logs"], requestBody: "LogSourceSnapshotUploadRequest", responseBody: "LogSourceSnapshotResponse", successStatus: 201 },
  "logs.defaultSourceSnapshot": { summary: "Set the skill draft default source snapshot", tags: ["logs"], responseBody: "LogSkillResponse" },
  "logs.archiveSourceSnapshot": { summary: "Archive a source snapshot", tags: ["logs"], responseBody: "LogSourceSnapshotResponse" },
  "logs.locateSourceStatement": { summary: "Locate log statements in a ready source snapshot (logs:admin-domains)", tags: ["logs"], requestBody: "LogSourceLocateRequest", responseBody: "LogSourceLocateResponse", additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" } },
  "logs.sourceEvidence": { summary: "Read the bounded source excerpt cited by record evidence (logs:view)", tags: ["logs"], responseBody: "LogSourceEvidenceResponse", additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" } },
  "logs.getSkill": { summary: "Get analysis skill", tags: ["logs"], responseBody: "LogSkillResponse" },
  "logs.parsePreview": { summary: "Preview unsaved parsing rules", tags: ["logs"], requestBody: "LogParsePreviewRequest", responseBody: "LogParsePreviewResponse" },
  "logs.parseTests": { summary: "Run parse tests against an unsaved skill draft", tags: ["logs"], requestBody: "LogParseTestRequest", responseBody: "LogParseTestRun" },
  "logs.signalPreview": { summary: "Preview draft signal rules on the stored sample", tags: ["logs"], requestBody: "LogSignalPreviewRequest", responseBody: "LogSignalPreviewResponse" },
  "logs.filesPreview": { summary: "Preview draft applicability on the stored sample inventory", tags: ["logs"], requestBody: "LogSkillFilePreviewRequest", responseBody: "LogSkillFilePreviewResponse" },
  "logs.extractorPreview": { summary: "Generate and preview an extractor pattern", tags: ["logs"], requestBody: "LogExtractorPreviewRequest", responseBody: "LogExtractorPreviewResponse" },
  "logs.formatPreview": { summary: "Preview an unsaved basic format profile", tags: ["logs"], requestBody: "LogFormatPreviewRequest", responseBody: "LogFormatPreviewResponse" },
  "logs.saveSkillDraft": { summary: "Save skill draft", tags: ["logs"], requestBody: "LogSkillDraftRequest", responseBody: "LogSkillRevisionResponse", additionalResponses: { "409": "ErrorResponse" } },
  "logs.discardSkillDraft": { summary: "Discard skill draft", tags: ["logs"], successStatus: 204, responseBody: "LogSkillDiscardResponse",
    requestParameters: [{ name: "draftRevisionId", in: "query", required: true, description: "The draft id observed by the editor.", schema: { type: "string" } }],
    additionalResponses: { "409": "ErrorResponse" } },
  "logs.restoreSkillRevision": { summary: "Restore skill as a new published revision", tags: ["logs"], responseBody: "LogSkillResponse", additionalResponses: { "409": "ErrorResponse" } },
  "logs.publishSkill": { summary: "Publish skill revision", tags: ["logs"], requestBody: "LogSkillPublishRequest", responseBody: "LogSkillResponse", additionalResponses: { "409": "ErrorResponse" } },
  "logs.listSkillRevisions": { summary: "List skill revisions", tags: ["logs"], responseBody: "LogSkillRevisionListResponse" },
  "logs.getSkillRevision": { summary: "Get skill revision", tags: ["logs"], responseBody: "LogSkillRevisionResponse" },
  "logs.listDomains": {
    summary: "List log domains",
    tags: ["logs"],
    responseBody: "LogDomainListResponse"
  },
  "logs.createDomain": {
    summary: "Create a log domain",
    tags: ["logs"],
    requestBody: "CreateLogDomainRequest",
    responseBody: "LogDomainResponse",
    successStatus: 201
  },
  "logs.updateDomain": {
    summary: "Update a log domain",
    tags: ["logs"],
    requestBody: "UpdateLogDomainRequest",
    responseBody: "LogDomainResponse"
  },
  "logs.archiveDomain": {
    summary: "Archive a log domain",
    tags: ["logs"],
    responseBody: "LogDomainResponse"
  },
  "logs.listDomainKnowledgeLinks": {
    summary: "List a log domain's linked knowledge entries",
    tags: ["logs"],
    responseBody: "LogDomainKnowledgeLinkListResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "logs.setDomainKnowledgeLinks": {
    summary: "Replace a log domain's knowledge-entry links (published entries only)",
    tags: ["logs"],
    requestBody: "SetLogDomainKnowledgeLinksRequest",
    responseBody: "LogDomainKnowledgeLinkListResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "logs.setDomainWebhook": {
    summary: "Replace a log domain's result-webhook config (SSRF-validated URL; write-only secret)",
    tags: ["logs"],
    requestBody: "SetLogDomainWebhookRequest",
    responseBody: "LogDomainResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "logs.listDomainWebhookDeliveries": {
    summary: "List a log domain's recent webhook delivery attempts",
    tags: ["logs"],
    responseBody: "LogWebhookDeliveryListResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "logs.sendDomainWebhookTest": {
    summary: "Send an audited single-attempt test delivery through the SSRF-guarded webhook sender",
    tags: ["logs"],
    requestBody: "SendLogDomainWebhookTestRequest",
    responseBody: "LogWebhookTestOutcomeResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },

  "productFeedback.create": {
    summary: "Create product feedback",
    tags: ["product-feedback"],
    requestBody: "CreateProductFeedbackRequest",
    responseBody: "ProductFeedbackResponse",
    successStatus: 201
  },
  "productFeedback.createDraft": {
    summary: "Create product feedback draft",
    tags: ["product-feedback"],
    requestBody: "CreateProductFeedbackDraftRequest",
    responseBody: "ProductFeedbackUserResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse" }
  },
  "productFeedback.patchDraft": {
    summary: "Update product feedback draft",
    tags: ["product-feedback"],
    requestBody: "PatchProductFeedbackDraftRequest",
    responseBody: "ProductFeedbackUserResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "productFeedback.deleteDraft": {
    summary: "Delete product feedback draft",
    tags: ["product-feedback"],
    responseBody: "DeleteProductFeedbackDraftResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "productFeedback.submitDraft": {
    summary: "Submit product feedback draft",
    tags: ["product-feedback"],
    requestBody: "SubmitProductFeedbackDraftRequest",
    responseBody: "ProductFeedbackUserResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "productFeedback.listMine": {
    summary: "List current user product feedback and drafts",
    tags: ["product-feedback"],
    responseBody: "ProductFeedbackUserListResponse",
    requestParameters: [
      { name: "q", in: "query", description: "Search the current user's description or source page." },
      { name: "status", in: "query", schema: { type: "string", enum: ["draft", "open", "in_progress", "resolved", "closed"] } },
      { name: "cursor", in: "query", description: "Opaque base64url nextCursor returned by the previous page." },
      { name: "limit", in: "query", schema: { type: "integer" }, description: "1–100; defaults to 50." }
    ],
    additionalResponses: { "403": "ErrorResponse" }
  },
  "productFeedback.getMine": {
    summary: "Get current user product feedback or draft",
    tags: ["product-feedback"],
    responseBody: "ProductFeedbackUserResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "productFeedback.mineAttachmentContent": {
    summary: "Get current user product feedback attachment content",
    tags: ["product-feedback"],
    responseBody: "BinaryAttachment",
    responseMedia: "binary",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "productFeedback.retryAttachmentCleanup": {
    summary: "Retry this user's pending feedback attachment upload cleanup in the current organization",
    tags: ["product-feedback"], requestBody: "ProductFeedbackAttachmentCleanupRequest", responseBody: "ProductFeedbackAttachmentCleanupResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse" }
  },
  "productFeedback.deleteAttachment": {
    summary: "Remove an owned submitted feedback attachment, retain a content-free message marker and retry exclusive object cleanup",
    tags: ["product-feedback"], responseBody: "ProductFeedbackAttachmentDeletionResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "productFeedback.replyToMine": {
    summary: "Submitter adds public details and optional images, or reopens resolved/closed feedback",
    tags: ["product-feedback"],
    requestBody: "ReplyToProductFeedbackRequest",
    responseBody: "ProductFeedbackUserResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "productFeedback.list": {
    summary: "List product feedback",
    tags: ["product-feedback"],
    responseBody: "ProductFeedbackListResponse",
    requestParameters: [
      { name: "status", in: "query", schema: { type: "string", enum: ["open", "in_progress", "resolved", "closed"] } },
      { name: "feedbackType", in: "query", schema: { type: "string", enum: ["experience", "data", "export_submit", "feature"] } },
      { name: "q", in: "query" }, { name: "pagePath", in: "query" },
      { name: "createdFrom", in: "query" }, { name: "createdTo", in: "query" },
      { name: "cursor", in: "query", description: "Opaque base64url nextCursor returned by the previous page." },
      { name: "limit", in: "query", schema: { type: "integer" }, description: "1–100; defaults to 50." }
    ],
    additionalResponses: { "403": "ErrorResponse" }
  },
  "productFeedback.stats": {
    summary: "Get product feedback statistics",
    tags: ["product-feedback"],
    responseBody: "ProductFeedbackStatsResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "productFeedback.assignees": {
    summary: "List active administrators eligible for assignment in the authenticated organization",
    tags: ["product-feedback"],
    responseBody: "ProductFeedbackAssigneesResponse",
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
  "productFeedback.appendProgress": {
    summary: "Append progress event to product feedback",
    tags: ["product-feedback"],
    requestBody: "AppendProductFeedbackProgressRequest",
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

  "knowledge.createEntry": {
    summary: "Create a knowledge entry (markdown or file form)",
    tags: ["knowledge"],
    requestBody: "CreateKnowledgeEntryRequest",
    responseBody: "KnowledgeEntryResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse" }
  },
  "knowledge.openImport": {
    summary: "Open an organization-scoped, importer-owned batch with fixed tags (knowledge:edit)",
    tags: ["knowledge"], requestBody: "OpenKnowledgeImportRequest", responseBody: "OpenKnowledgeImportResponse", successStatus: 201,
    additionalResponses: { "403": "ErrorResponse" }
  },
  "knowledge.importDocument": {
    summary: "Import one document through the existing upload path; enforce 200 documents / 100 MB per batch and 20 MB per file; skip readable SHA-256 duplicates",
    tags: ["knowledge"], requestBody: "ImportKnowledgeDocumentRequest", responseBody: "ImportKnowledgeDocumentResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "knowledge.getImport": {
    summary: "Read the importer's persisted document outcomes and server-computed totals",
    tags: ["knowledge"], responseBody: "KnowledgeImportReportResponse", additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "knowledge.completeImport": {
    summary: "Complete a batch once and audit its server-recorded outcome counts (knowledge:edit)",
    tags: ["knowledge"], requestBody: "CompleteKnowledgeImportRequest", responseBody: "KnowledgeImportReportResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "knowledge.listEntries": {
    summary: "List knowledge entries visible to the caller",
    tags: ["knowledge"],
    responseBody: "KnowledgeEntryListResponse",
    requestParameters: [
      { name: "origin", in: "query", schema: { type: "string", enum: ["authored", "uploaded", "distilled", "agent-drafted", "imported"] } },
      { name: "governable", in: "query", description: "Only non-archived entries owned by the caller, or any owner for knowledge:manage. Requires knowledge:edit or knowledge:manage.", schema: { type: "string", enum: ["true", "false"] } }
    ],
    additionalResponses: { "403": "ErrorResponse" }
  },
  "knowledge.distillFromLog": {
    summary:
      "Distil a completed log-analysis record into a pre-filled knowledge draft (knowledge:edit plus logs:view on the source record); the draft stays out of retrieval until published",
    tags: ["knowledge"],
    requestBody: "DistillKnowledgeFromLogRequest",
    responseBody: "KnowledgeEntryResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "knowledge.distillFromReloadRun": {
    summary:
      "Distil a terminal DTS reload run (verified, unverifiable, contradicted, or failed) into a pre-filled knowledge draft (knowledge:edit plus the reload read gate on the source run); the outcome is stated honestly and the draft stays out of retrieval until published",
    tags: ["knowledge"],
    requestBody: "DistillKnowledgeFromReloadRunRequest",
    responseBody: "KnowledgeEntryResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "knowledge.search": {
    summary:
      "Search published knowledge entries — hybrid vector+FTS when embeddings and pgvector are available, FTS+trigram otherwise; the response reports the retrieval mode that actually ran",
    tags: ["knowledge"],
    responseBody: "KnowledgeSearchResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "knowledge.relatedToLog": {
    summary:
      "Related published knowledge for a completed log-analysis record (knowledge:view plus logs:view and organization scope on the record) — the similarity query derives from the stored conclusion/impact text, runs through hybrid retrieval with a relevance cutoff so unrelated entries are dropped, and the response reports the retrieval mode that actually ran",
    tags: ["knowledge"],
    responseBody: "KnowledgeSearchResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "knowledge.relatedToSpec": {
    summary:
      "Published knowledge entries structurally referencing one parameter definition (knowledge:view, organization-scoped; published-only — drafts and archived entries never appear; specs outside the caller's scope are 404)",
    tags: ["knowledge"],
    responseBody: "KnowledgeRelatedToSpecResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "knowledge.relatedToDefinition": {
    summary: "Published knowledge structurally referencing one exact visible Catalog Definition (knowledge:view and parameter:view; published-only)",
    tags: ["knowledge"],
    responseBody: "KnowledgeRelatedToSpecResponse",
    requestParameters: [{ name: "definitionId", in: "query", required: true }, { name: "limit", in: "query", required: false }],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "knowledge.addDefinitionReference": {
    summary: "Idempotently add a verified Catalog Definition reference to a knowledge entry (entry owner or knowledge:manage, plus parameter:view; audited)",
    tags: ["knowledge"],
    responseBody: "KnowledgeEntryResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "knowledge.removeDefinitionReference": {
    summary: "Idempotently remove an exact Catalog Definition reference from a knowledge entry (entry owner or knowledge:manage; audited)",
    tags: ["knowledge"],
    responseBody: "KnowledgeEntryResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "knowledge.addParameterReference": {
    summary:
      "Replay an existing historical Spec reference; new legacy Spec references are rejected with 409 (entry owner with knowledge:edit, or knowledge:manage)",
    tags: ["knowledge"],
    responseBody: "KnowledgeEntryResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "knowledge.removeParameterReference": {
    summary:
      "Remove an existing historical Spec reference from a knowledge entry (entry owner with knowledge:edit, or knowledge:manage)",
    tags: ["knowledge"],
    responseBody: "KnowledgeEntryResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "knowledge.indexStatus": {
    summary: "Read per-entry retrieval index health and the honest retrieval mode (knowledge:manage only)",
    tags: ["knowledge"],
    responseBody: "KnowledgeIndexHealthResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "knowledge.indexRebuild": {
    summary: "Re-enqueue every published entry for index rebuild (knowledge:manage only)",
    tags: ["knowledge"],
    responseBody: "KnowledgeIndexRebuildResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "knowledge.indexRetryEntry": {
    summary: "Re-enqueue one entry's index refresh (knowledge:manage only)",
    tags: ["knowledge"],
    responseBody: "KnowledgeIndexRetryResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "knowledge.getEntry": {
    summary: "Get a knowledge entry with head-revision content",
    tags: ["knowledge"],
    responseBody: "KnowledgeEntryResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "knowledge.getBinding": {
    summary: "Read a knowledge binding, retaining deleted and unavailable identities",
    tags: ["knowledge"],
    responseBody: "KnowledgeBindingResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "knowledge.updateEntry": {
    summary: "Save a knowledge entry edit as a new immutable revision (optimistic concurrency)",
    tags: ["knowledge"],
    requestBody: "UpdateKnowledgeEntryRequest",
    responseBody: "KnowledgeEntryResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "knowledge.publishEntry": {
    summary: "Publish a draft knowledge entry into retrieval",
    tags: ["knowledge"],
    responseBody: "KnowledgeEntryResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "knowledge.archiveEntry": {
    summary: "Archive a published knowledge entry out of retrieval",
    tags: ["knowledge"],
    responseBody: "KnowledgeEntryResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "knowledge.restoreEntry": {
    summary: "Restore an archived knowledge entry to published",
    tags: ["knowledge"],
    responseBody: "KnowledgeEntryResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "knowledge.rejectAgentDraft": {
    summary:
      "Archive-reject an agent-sourced knowledge draft from the publish queue (entry owner with knowledge:edit, or knowledge:manage)",
    tags: ["knowledge"],
    responseBody: "KnowledgeEntryResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "knowledge.deleteEntry": {
    summary: "Hard delete a knowledge entry (knowledge:manage only)",
    tags: ["knowledge"],
    responseBody: "KnowledgeDeleteResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "knowledge.listRevisions": {
    summary: "List immutable revisions of a knowledge entry",
    tags: ["knowledge"],
    responseBody: "KnowledgeRevisionListResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "knowledge.restoreRevision": {
    summary: "Restore a prior revision as a new head revision",
    tags: ["knowledge"],
    requestBody: "RestoreKnowledgeRevisionRequest",
    responseBody: "KnowledgeEntryResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "knowledge.fileContent": {
    summary: "Download the current file binary of a file-form knowledge entry",
    tags: ["knowledge"],
    responseBody: "BinaryAttachment",
    responseMedia: "binary",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },

  "dtsReload.listCandidates": {
    summary: "List DTS reload debugging candidates for a project",
    tags: ["dts-reload"],
    responseBody: "DtsReloadCandidateListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "dtsReload.listRuns": {
    summary: "List DTS reload runs filtered by project and/or device, most recent first",
    tags: ["dts-reload"],
    responseBody: "DtsReloadRunListResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse" }
  },
  "dtsReload.startRun": {
    summary: "Start a DTS reload run for a batch of parameters (stops at validated overlay)",
    tags: ["dts-reload"],
    requestBody: "StartDtsReloadRunRequest",
    responseBody: "DtsReloadRunResponse",
    successStatus: 201,
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "dtsReload.restoreBaseline": {
    summary: "Start a compensating restore-baseline reload from recorded device residue",
    tags: ["dts-reload"],
    requestBody: "RestoreDtsReloadBaselineRequest",
    responseBody: "DtsReloadRunResponse",
    successStatus: 201,
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "dtsReload.getResidue": {
    summary: "Get platform bookkeeping residue for a device (not confirmed from the device)",
    tags: ["dts-reload"],
    responseBody: "DtsReloadResidueResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse" }
  },
  "dtsReload.deployRun": {
    summary: "Deploy a validated reload overlay to a device through the local device bridge",
    tags: ["dts-reload"],
    requestBody: "DeployDtsReloadRunRequest",
    responseBody: "DtsReloadRunResponse",
    successStatus: 200,
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "dtsReload.promoteToDrafts": {
    summary: "Promote stored debug values from a terminal reload run into parameter drafts (does not create change requests)",
    tags: ["dts-reload"],
    requestBody: "PromoteDtsReloadRunToDraftsRequest",
    responseBody: "PromoteDtsReloadRunToDraftsResponse",
    successStatus: 201,
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "dtsReload.getRun": {
    summary: "Get a DTS reload run detail including overlay source",
    tags: ["dts-reload"],
    responseBody: "DtsReloadRunResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "dtsReload.downloadArtifact": {
    summary: "Download the compiled debug overlay artifact for a validated reload run",
    tags: ["dts-reload"],
    responseBody: "BinaryAttachment",
    responseMedia: "binary",
    additionalResponses: {
      "403": "ErrorResponse",
      "404": "ErrorResponse",
      "409": "ErrorResponse",
      "410": "ErrorResponse"
    }
  },
  "dtsReload.getConfiguration": {
    summary: "Get organisation reload configuration defaults",
    tags: ["dts-reload"],
    responseBody: "DtsReloadConfigurationAdminResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "dtsReload.updateOrganisationConfiguration": {
    summary: "Update organisation reload configuration defaults",
    tags: ["dts-reload"],
    requestBody: "DtsReloadConfigurationContractRequest",
    responseBody: "DtsReloadOrganisationConfigurationResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse" }
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
  "debugging.admin.deleteNode": {
    summary: "Delete a debug node with its bindings and operation history",
    tags: ["debugging"],
    responseBody: "DeleteResponse",
    successStatus: 204,
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
  "debugging.admin.exportCatalog": {
    summary: "Export the complete debug node catalog",
    tags: ["debugging"],
    responseBody: "DebugCatalogExportResponse",
    additionalResponses: { "403": "ErrorResponse", "413": "ErrorResponse" }
  },
  "debugging.admin.previewCatalogImport": {
    summary: "Preview a debug node catalog import without writing",
    tags: ["debugging"],
    requestBody: "DebugCatalogTransferRequest",
    responseBody: "DebugCatalogImportPreviewResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "409": "ErrorResponse", "413": "ErrorResponse" }
  },
  "debugging.admin.importCatalog": {
    summary: "Merge-import a previewed debug node catalog",
    tags: ["debugging"],
    requestBody: "DebugCatalogImportExecuteRequest",
    responseBody: "DebugCatalogImportResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "409": "ErrorResponse", "413": "ErrorResponse" }
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
  "debugging.admin.previewModuleDeletion": {
    summary: "Preview a leaf debug module deletion and relocation blockers",
    tags: ["debugging"],
    responseBody: "DebugModuleDeletionPreviewResponse",
    requestParameters: [{ name: "targetModuleId", in: "query", required: false,
      description: "Existing target in the same organization; omit to move nodes to unclassified.", schema: { type: "string" } }],
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "debugging.admin.deleteModule": {
    summary: "Relocate all nodes and delete a leaf debug module atomically",
    tags: ["debugging"],
    requestBody: "DeleteDebugModuleRequest",
    requestBodyRequired: false,
    responseBody: "DeleteResponse",
    successStatus: 204,
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "debugging.listReloadTargets": {
    summary: "Retired parameter-reload target list (always 410 Gone)",
    tags: ["debugging"],
    responseBody: "ErrorResponse",
    successStatus: 410
  },
  "debugging.reloadParameter": {
    summary: "Retired parameter-reload write (always 410 Gone)",
    tags: ["debugging"],
    responseBody: "ErrorResponse",
    successStatus: 410
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

  "xiaoze.run": {
    summary: "Run Xiaoze AG-UI agent",
    tags: ["agent"],
    requestBody: "XiaozeAgUiRunRequest",
    responseBody: "GenericObjectResponse"
  },
  "xiaoze.suggest": {
    summary: "Run Xiaoze proactive suggest pass",
    tags: ["agent"],
    requestBody: "XiaozeSuggestRequest",
    responseBody: "XiaozeSuggestResponse"
  },
  "xiaoze.listThreads": { summary: "List Xiaoze chat threads", tags: ["agent"], responseBody: "XiaozeThreadListResponse" },
  "xiaoze.createThread": {
    summary: "Create Xiaoze chat thread id",
    tags: ["agent"],
    requestBody: "XiaozeThreadCreateRequest",
    responseBody: "XiaozeThreadCreateResponse",
    successStatus: 201
  },
  "xiaoze.getThread": { summary: "Get Xiaoze chat thread", tags: ["agent"], responseBody: "XiaozeThreadDetailResponse" },
  "xiaoze.patchThread": {
    summary: "Update Xiaoze chat thread title",
    tags: ["agent"],
    requestBody: "XiaozeThreadPatchRequest",
    responseBody: "XiaozeThreadPatchResponse"
  },
  "xiaoze.deleteThread": { summary: "Archive Xiaoze chat thread", tags: ["agent"], responseBody: "XiaozeThreadArchiveResponse" },

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
  },

  "parameterFiles.listFiles": {
    summary: "List project parameter files with current version metadata",
    tags: ["parameter-files"],
    responseBody: "ParameterFileListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameterFiles.listSourceRevisionRequests": {
    summary: "List the submitter's and eligible assigned reviewer's whole-DTS source requests",
    tags: ["parameter-files"],
    requestParameters: [
      { name: "mine", in: "query", schema: { type: "string", enum: ["true", "false"] } },
      { name: "status", in: "query", schema: { type: "string", enum: ["pending", "approved", "rejected", "withdrawn"] } }
    ],
    responseBody: "SourceRevisionRequestListResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.getSourceRevisionRequest": {
    summary: "Read a visible whole-DTS source request and its verified immutable source diff",
    tags: ["parameter-files"],
    responseBody: "SourceRevisionRequestDetailResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.reviewSourceRevisionRequest": {
    summary: "Approve or reject the frozen whole-source proof as its separate assigned file administrator and software reviewer",
    tags: ["parameter-files"],
    requestBody: "SourceRevisionReviewRequest",
    responseBody: "SourceRevisionRequestResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.withdrawSourceRevisionRequest": {
    summary: "Withdraw the submitter's pending whole-source request without changing active source",
    tags: ["parameter-files"],
    requestBody: "SourceRevisionWithdrawRequest",
    responseBody: "SourceRevisionRequestResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.cancelSourceRevisionRequest": {
    summary: "Cancel this organization's unchanged pending source request as its file administrator with an audit reason",
    tags: ["parameter-files"], requestBody: "SourceRevisionCancelRequest", responseBody: "SourceRevisionRequestResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.reassignSourceRevisionRequest": {
    summary: "Reassign the unchanged pending source proof to a currently eligible reviewer without changing its author or diff",
    tags: ["parameter-files"], requestBody: "SourceRevisionReassignRequest", responseBody: "SourceRevisionRequestResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.uploadFile": {
    summary: "Upload a project parameter file (new file or new version) and sync drafts",
    tags: ["parameter-files"],
    requestBody: "UploadParameterFileRequest",
    responseBody: "ParameterFileUploadResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameterFiles.listFileVersions": {
    summary: "List immutable versions of one project parameter file",
    tags: ["parameter-files"],
    responseBody: "ParameterFileVersionListResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterFiles.uploadFileVersion": {
    summary: "Upload a new version for an existing project parameter file",
    tags: ["parameter-files"],
    requestBody: "UploadParameterFileVersionRequest",
    responseBody: "ParameterFileVersionUploadResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterFiles.downloadFileVersionContent": {
    summary: "Download the stored bytes of one parameter file version",
    tags: ["parameter-files"],
    responseBody: "ParameterFileVersionContent",
    responseMedia: "binary",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterFiles.rollbackFileVersion": {
    summary: "Insert a new current version that reuses a historical blob (origin=rollback)",
    tags: ["parameter-files"],
    responseBody: "ParameterFileVersionUploadResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.syncFileVersion": {
    summary: "Sync a parameter file version into project drafts and detect conflicts",
    tags: ["parameter-files"],
    requestBody: "SyncParameterFileRequest",
    responseBody: "ParameterFileSyncResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.listConflicts": {
    summary: "List file↔UI sync conflicts for a project",
    tags: ["parameter-files"],
    responseBody: "FileSyncConflictListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameterFiles.resolveConflict": {
    summary: "Resolve one open file↔UI conflict toward the file or the UI draft",
    tags: ["parameter-files"],
    requestBody: "ResolveFileSyncConflictRequest",
    responseBody: "FileSyncConflictResolveResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.previewBulkConflictResolution": {
    summary: "Preview a bulk conflict resolution: eligible, ineligible, and impact",
    tags: ["parameter-files"],
    requestBody: "BulkConflictPreviewRequest",
    responseBody: "BulkConflictPreviewResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameterFiles.resolveConflictsBulk": {
    summary: "Resolve eligible conflicts as one atomic batch (ADR-0027); mid-batch failure rolls back",
    tags: ["parameter-files"],
    requestBody: "BulkConflictResolveRequest",
    responseBody: "BulkConflictResolveResponse",
    additionalResponses: { "403": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.listConfigSets": {
    summary: "List project DTS config sets with members",
    tags: ["parameter-files"],
    responseBody: "ConfigSetListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameterFiles.createConfigSet": {
    summary: "Create a project DTS config set",
    tags: ["parameter-files"],
    requestBody: "CreateConfigSetRequest",
    responseBody: "ConfigSetResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.addConfigSetFile": {
    summary: "Add a parameter file to a config set with role and sort order",
    tags: ["parameter-files"],
    requestBody: "AddConfigSetFileRequest",
    responseBody: "ConfigSetMembershipResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.removeConfigSetFile": {
    summary: "Remove a member file from a config set (requires confirmation semantics)",
    tags: ["parameter-files"],
    responseBody: "ConfigSetMembershipResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.previewAdministratorMemberRemoval": {
    summary: "Preview an administrator's complete Canonical member removal and effective parameter impact",
    tags: ["parameter-files"], responseBody: "AdministratorMemberRemovalPreviewResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.previewCanonicalMemberAddition": {
    summary: "Preview a staged or existing member against the complete Canonical configuration",
    tags: ["parameter-files"], requestBody: "CanonicalMemberAdditionPreviewRequest",
    responseBody: "CanonicalMemberAdditionPreviewResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.applyCanonicalMemberAddition": {
    summary: "Atomically add the confirmed Canonical member as the current human administrator",
    tags: ["parameter-files"], requestBody: "CanonicalMemberAdditionApplyRequest",
    responseBody: "CanonicalMemberAdditionApplyResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.applyAdministratorMemberRemoval": {
    summary: "Atomically apply a confirmed Canonical member removal as the current human administrator",
    tags: ["parameter-files"], requestBody: "AdministratorMemberRemovalApplyRequest",
    responseBody: "AdministratorMemberRemovalApplyResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.exportConfigSet": {
    summary: "Export a config set as a lossless manifest with validation evidence",
    tags: ["parameter-files"],
    responseBody: "ConfigSetExportResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.listConfigSetBaselines": {
    summary: "List release baselines of a config set",
    tags: ["parameter-files"],
    responseBody: "ReleaseBaselineListResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterFiles.createConfigSetBaseline": {
    summary: "Create a release baseline snapshot of the working configuration (gate token required)",
    tags: ["parameter-files"],
    requestBody: "CreateReleaseBaselineRequest",
    responseBody: "ReleaseBaselineResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.submitStructuredEdits": {
    summary: "Submit structured DTS edits through the draft → submission round → change request flow",
    tags: ["parameter-files"],
    requestBody: "SubmitStructuredEditsRequest",
    responseBody: "StructuredEditsSubmitResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.activateCandidate": {
    summary: "Activate a staged candidate file version with expected-current-version CAS",
    tags: ["parameter-files"],
    requestBody: "ActivateParameterFileCandidateRequest",
    responseBody: "ParameterFileCandidateActivateResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.getCanonicalSourceWorkflow": {
    summary: "Inspect the canonical source cohort and proof for a parameter file",
    tags: ["parameter-files"],
    responseBody: "CanonicalSourceWorkflowResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.previewCanonicalCandidate": {
    summary: "Preview a staged candidate against exact source pins or its complete source_revision proof and impact",
    tags: ["parameter-files"],
    responseBody: "CanonicalSourceCandidatePreviewResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.listCanonicalSourceConflicts": {
    summary: "Find exact canonical file/UI draft choices for a staged source candidate",
    tags: ["parameter-files"],
    responseBody: "CanonicalSourceConflictListResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.submitCanonicalSourceConflict": {
    summary: "Freeze one selected canonical source conflict for human review",
    tags: ["parameter-files"],
    requestBody: "CanonicalSourceConflictSubmitRequest",
    responseBody: "CanonicalSourceConflictSubmitResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterTopology.getCanonicalSourceConflictDecision": {
    summary: "Read the frozen choice and verified source diff of one visible conflict request",
    tags: ["parameters"],
    responseBody: "CanonicalSourceConflictDecisionResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.submitCanonicalCandidate": {
    summary: "Submit a source candidate for human review; source_revision candidates require assignedToUserId and clientMutationId",
    tags: ["parameter-files"],
    requestBody: "CanonicalSourceSubmitRequest",
    responseBody: "CanonicalSourceSubmissionResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.applySourceRevisionCandidate": {
    summary: "Apply a confirmed complete DTS preview as the current human administrator without a separate reviewer",
    tags: ["parameter-files"],
    requestBody: "SourceRevisionDirectApplyRequest",
    responseBody: "SourceRevisionRequestResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.rollbackCanonicalSource": {
    summary: "Submit a historical source version through canonical draft and human review",
    tags: ["parameter-files"],
    requestBody: "CanonicalSourceRollbackRequest",
    responseBody: "CanonicalSourceSubmissionResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.prepareCanonicalBatchRollback": {
    summary: "Prepare exact ordered JSON or DTS historical batch rollback proof",
    tags: ["parameter-files"],
    requestParameters: [{ name: "X-Request-Id", in: "header",
      description: "Reuse this stable key to replay the same preparation." }],
    requestBody: "CanonicalBatchRollbackPrepareRequest",
    responseBody: "CanonicalBatchRollbackPrepareResponse",
    successStatus: 201,
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse",
      "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.prepareCanonicalManualSync": {
    summary: "Prepare exact uploaded JSON or DTS bytes for one canonical batch review request",
    tags: ["parameter-files"],
    requestParameters: [{ name: "X-Request-Id", in: "header",
      description: "Reuse this stable key only for the same preparation bytes and source proof." }],
    requestBody: "CanonicalManualSyncPrepareRequest",
    responseBody: "CanonicalManualSyncPrepareResponse",
    successStatus: 201,
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse",
      "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterFiles.submitCanonicalBatchRollback": {
    summary: "Freeze one historical multi-Binding rollback for assigned human review",
    tags: ["parameter-files"],
    requestParameters: [{ name: "X-Request-Id", in: "header",
      description: "Reuse this stable key to replay the same review request." }],
    requestBody: "CanonicalBatchRollbackSubmitRequest",
    responseBody: "CanonicalBatchRollbackSubmitResponse",
    successStatus: 201,
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse",
      "404": "ErrorResponse", "409": "ErrorResponse" }
  },

  "parameters.previewAdminProjectDeletion": {
    summary: "Preview project-owned deletion scope, retained resources and current blockers without mutation",
    tags: ["parameters"],
    responseBody: "ProjectDeletionPreviewResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameters.deleteAdminProject": {
    summary: "Delete an empty or legacy-only project; retain canonical project history",
    tags: ["parameters"],
    responseBody: "ProjectDeleteResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameters.purgeAdminProject": {
    summary: "Permanently delete confirmed project-owned data and retry pending exclusive object cleanup",
    tags: ["parameters"], requestBody: "ProjectPurgeRequest", responseBody: "ProjectDeletionStatusResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameters.getAdminProjectDeletionStatus": {
    summary: "Read database and object cleanup status for a deleted project",
    tags: ["parameters"], responseBody: "ProjectDeletionStatusResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameters.listAdminProjectDeletions": {
    summary: "List project cleanup receipts in the current organization",
    tags: ["parameters"], responseBody: "ProjectDeletionStatusListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameters.parseDtsImport": {
    summary: "Parse a full DTS source into import preview rows",
    tags: ["parameters"],
    requestBody: "ParseDtsImportRequest",
    responseBody: "DtsImportParseResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameters.listWorkflowAssignees": {
    summary: "List selectable reviewer/assignee users for parameter workflows in a project",
    tags: ["parameters"],
    responseBody: "ParameterWorkflowAssigneeListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameterSpecs.update": retireLegacySurface({
    summary: "Update documentation-class fields on an active definition",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  }),
  "parameterSpecs.activate": retireLegacySurface({
    summary: "Activate a draft, or mint a successor on an active definition",
    tags: ["parameters"],
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  }),

  "deviceBridges.createPairingCode": {
    summary: "Create a short-lived pairing code for a local device bridge",
    tags: ["device-bridge"],
    responseBody: "DeviceBridgePairingCodeResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse" }
  },
  "deviceBridges.pair": {
    summary: "Exchange a pairing code for a bridge identity and token",
    tags: ["device-bridge"],
    requestBody: "DeviceBridgePairRequest",
    responseBody: "DeviceBridgePairResponse",
    successStatus: 201,
    additionalResponses: { "409": "ErrorResponse" }
  },
  "deviceBridges.listMine": {
    summary: "List the caller's paired device bridges",
    tags: ["device-bridge"],
    responseBody: "DeviceBridgeListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "deviceBridges.listOrganization": {
    summary: "List this organization's paired device bridges and their owners without credentials",
    tags: ["device-bridge"], responseBody: "OrganizationDeviceBridgeListResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse" }
  },
  "deviceBridges.getOrganizationBridge": {
    summary: "Read a device bridge in the administrator's current organization",
    tags: ["device-bridge"], responseBody: "OrganizationDeviceBridgeResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "deviceBridges.revokeOrganizationBridge": {
    summary: "Revoke an organization member's bridge credentials and connections with an audited reason",
    tags: ["device-bridge"], requestBody: "RevokeOrganizationDeviceBridgeRequest", responseBody: "OrganizationDeviceBridgeResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "deviceBridges.updateBridge": {
    summary: "Update a paired bridge (for example its machine label)",
    tags: ["device-bridge"],
    requestBody: "UpdateDeviceBridgeRequest",
    responseBody: "DeviceBridgeResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "deviceBridges.revokeBridge": {
    summary: "Revoke a paired bridge's token",
    tags: ["device-bridge"],
    responseBody: "DeviceBridgeResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "deviceBridges.getReleaseManifest": {
    summary: "Get the latest local device bridge release manifest",
    tags: ["device-bridge"],
    responseBody: "DeviceBridgeReleaseManifestResponse",
    additionalResponses: { "404": "ErrorResponse" }
  },
  "deviceBridges.getToolReleaseManifest": {
    summary: "Get the latest bridge tool (hdc/adb) release manifest",
    tags: ["device-bridge"],
    responseBody: "DeviceBridgeToolReleaseManifestResponse",
    additionalResponses: { "404": "ErrorResponse" }
  },

  ...(parameterCatalogSchemaRegistry as unknown as Record<string, ContractSchemaRef>)
};
