import type { RouteManifestEntry } from "./routeManifest";

export type ContractSchemaRef = {
  summary: string;
  tags: RouteManifestEntry["module"][];
  requestBody?: string;
  responseBody: string;
  responseMedia?: "json" | "binary";
  successStatus?: 200 | 201 | 410;
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
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameters.rollbackReleaseBaseline": {
    summary: "Atomically restore working member versions from a baseline without changing the released tip",
    tags: ["parameters"],
    responseBody: "ReleaseBaselineRollbackResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
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
    responseBody: "StructuralReadResponse",
    additionalResponses: { "404": "ErrorResponse" }
  },
  "parameters.listParameterFileCandidates": {
    summary: "List staged parameter-file candidates for a project",
    tags: ["parameters"],
    responseBody: "ParameterFileCandidateListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameters.createParameterFileCandidate": {
    summary: "Upload a staged candidate file version without activating Working configuration",
    tags: ["parameters"],
    requestBody: "CreateParameterFileCandidateRequest",
    responseBody: "ParameterFileCandidateResponse",
    successStatus: 201,
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse" }
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
    responseBody: "DtsSearchResponse",
    additionalResponses: { "403": "ErrorResponse" }
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

  "parameterModules.getRegistry": {
    summary: "Get parameter module registry with mappings",
    tags: ["parameter-modules"],
    responseBody: "ParameterModuleRegistryResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameterModules.discoveryHints": {
    summary: "List unclassified compatible discovery hints",
    tags: ["parameter-modules"],
    responseBody: "ParameterModuleDiscoveryHintsResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameterModules.dismissCompatible": {
    summary: "Dismiss a compatible from the unclassified queue",
    tags: ["parameter-modules"],
    requestBody: "DismissCompatibleRequest",
    responseBody: "ParameterModuleDiscoveryHintsResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameterModules.restoreCompatible": {
    summary: "Restore a dismissed compatible to the unclassified queue",
    tags: ["parameter-modules"],
    responseBody: "ParameterModuleDiscoveryHintsResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterModules.previewMapping": {
    summary: "Preview scoped impact of creating a module mapping",
    tags: ["parameter-modules"],
    requestBody: "CreateModuleMappingRequest",
    responseBody: "ModuleMappingPreviewResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterModules.createMapping": {
    summary: "Create a module mapping and apply scoped recompute",
    tags: ["parameter-modules"],
    requestBody: "CreateModuleMappingRequest",
    responseBody: "ModuleMappingMutationResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterModules.deleteMapping": {
    summary: "Delete a module mapping and apply scoped recompute",
    tags: ["parameter-modules"],
    responseBody: "ModuleMappingMutationResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterModules.recomputeBindings": {
    summary: "Recompute binding module assignments (operations tool)",
    tags: ["parameter-modules"],
    requestBody: "RecomputeBindingModulesRequest",
    responseBody: "RecomputeBindingModulesResponse",
    additionalResponses: { "403": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterModules.listDriverRegistry": {
    summary: "List curated driver-group registry entries with parse coverage",
    tags: ["parameter-modules"],
    responseBody: "DriverRegistryListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameterModules.registerDriver": {
    summary: "Register or claim a driver group with exact compatible mappings",
    tags: ["parameter-modules"],
    requestBody: "RegisterOrClaimDriverRequest",
    responseBody: "RegisterOrClaimDriverResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterModules.updateDriverRegistration": {
    summary: "Update driver registration nature and/or instance cardinality",
    tags: ["parameter-modules"],
    requestBody: "UpdateDriverRegistrationRequest",
    responseBody: "UpdateDriverRegistrationResponse",
    additionalResponses: { "400": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterModules.updateDriverRegistrationDefault": {
    summary: "Update driver registration default business category and replay auto placements",
    tags: ["parameter-modules"],
    requestBody: "UpdateDriverRegistrationDefaultRequest",
    responseBody: "UpdateDriverRegistrationDefaultResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterModules.replayDriverPlacement": {
    summary: "Replay auto driver-group placement from registration default business category",
    tags: ["parameter-modules"],
    responseBody: "ReplayDriverPlacementResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterSpecs.listOrganizationDriverSchemas": {
    summary: "List organization-owned manual driver schema overlays",
    tags: ["parameters"],
    responseBody: "OrganizationDriverSchemaListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameterSpecs.getOrganizationDriverSchema": {
    summary: "Get one organization driver schema overlay",
    tags: ["parameters"],
    responseBody: "OrganizationDriverSchemaResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterSpecs.createOrganizationDriverSchema": {
    summary: "Create a draft organization driver schema overlay",
    tags: ["parameters"],
    requestBody: "CreateOrganizationDriverSchemaRequest",
    responseBody: "OrganizationDriverSchemaResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterSpecs.updateOrganizationDriverSchema": {
    summary: "Update a draft organization driver schema overlay",
    tags: ["parameters"],
    requestBody: "UpdateOrganizationDriverSchemaRequest",
    responseBody: "OrganizationDriverSchemaResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterSpecs.activateOrganizationDriverSchema": {
    summary: "Activate an organization driver schema overlay and upgrade provisional specs",
    tags: ["parameters"],
    responseBody: "ActivateOrganizationDriverSchemaResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterSpecs.previewOrganizationDriverSchemaDeprecation": {
    summary: "Preview coverage and usage impact before overlay retirement",
    tags: ["parameters"],
    responseBody: "OrganizationDriverSchemaDeprecationImpactResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterSpecs.deprecateOrganizationDriverSchema": {
    summary: "Deprecate an organization driver schema overlay",
    tags: ["parameters"],
    requestBody: "DeprecateOrganizationDriverSchemaRequest",
    responseBody: "OrganizationDriverSchemaResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterSpecs.listPromotionCandidates": {
    summary: "List platform driver-schema promotion candidates by compatible",
    tags: ["parameters"],
    responseBody: "DriverSchemaPromotionCandidateListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameterSpecs.promoteDriverSchemaOverlay": {
    summary: "Promote organization driver schema overlays into a platform-tier schema",
    tags: ["parameters"],
    requestBody: "PromoteDriverSchemaOverlayRequest",
    responseBody: "PromoteDriverSchemaOverlayResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterSpecs.revertDriverSchemaPromotion": {
    summary: "Revert a platform driver-schema promotion and restore contributor overlays",
    tags: ["parameters"],
    responseBody: "RevertDriverSchemaPromotionResponse",
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

  "parameterSpecs.list": {
    summary: "List versioned parameter specifications",
    tags: ["parameters"],
    responseBody: "ParameterSpecListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameterSpecs.create": {
    summary: "Create a draft parameter definition bound to an attribution subject",
    tags: ["parameters"],
    requestBody: "CreateParameterSpecRequest",
    responseBody: "ParameterSpecDetailResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterSpecs.get": {
    summary: "Get a parameter specification detail",
    tags: ["parameters"],
    responseBody: "ParameterSpecDetailResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterSpecs.getCutover": {
    summary: "Get open parameter spec version cutover impact",
    tags: ["parameters"],
    responseBody: "ParameterSpecCutoverImpactResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterSpecs.prepareCutover": {
    summary: "Prepare binding items for parameter spec version cutover",
    tags: ["parameters"],
    requestBody: "PrepareParameterSpecCutoverRequest",
    responseBody: "ParameterSpecDetailResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterSpecs.finalizeCutover": {
    summary: "Finalize parameter spec version cutover after prepare",
    tags: ["parameters"],
    requestBody: "FinalizeParameterSpecCutoverRequest",
    responseBody: "ParameterSpecDetailResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterSpecs.listReviewTasks": {
    summary: "List organization-scoped parameter specification review tasks",
    tags: ["parameters"],
    responseBody: "ParameterSpecReviewTaskListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameterSpecs.resolveReviewTask": {
    summary: "Resolve a parameter specification review task",
    tags: ["parameters"],
    requestBody: "ResolveParameterSpecReviewTaskRequest",
    responseBody: "ParameterSpecReviewTaskResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterSpecs.deprecate": {
    summary: "Soft-deprecate a parameter definition (definition lifecycle)",
    tags: ["parameters"],
    requestBody: "DeprecateParameterSpecRequest",
    responseBody: "ParameterSpecDetailResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterSpecs.restore": {
    summary: "Restore a soft-deprecated parameter definition",
    tags: ["parameters"],
    requestBody: "RestoreParameterSpecRequest",
    responseBody: "ParameterSpecDetailResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterSpecs.reattribute": {
    summary: "Correct a parameter definition attribution subject in place",
    tags: ["parameters"],
    requestBody: "ReattributeParameterSpecRequest",
    responseBody: "ParameterSpecDetailResponse",
    additionalResponses: {
      "403": "ErrorResponse",
      "404": "ErrorResponse",
      "409": "ErrorResponse"
    }
  },
  "parameterSpecs.renamePropertyKey": {
    summary: "Rename a zero-reference parameter definition property key in place",
    tags: ["parameters"],
    requestBody: "RenameParameterSpecPropertyKeyRequest",
    responseBody: "ParameterSpecDetailResponse",
    additionalResponses: {
      "403": "ErrorResponse",
      "404": "ErrorResponse",
      "409": "ErrorResponse"
    }
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
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameterTopology.getBindingHistory": {
    summary: "List binding-revision change history for a project parameter binding",
    tags: ["parameters"],
    responseBody: "BindingHistoryListResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterTopology.getBindingCompare": {
    summary: "Compare a project parameter binding across other projects in the same organization",
    tags: ["parameters"],
    responseBody: "BindingCompareListResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "parameterTopology.listIdentityMappingTasks": {
    summary: "List identity mapping tasks",
    tags: ["parameters"],
    responseBody: "IdentityMappingTaskListResponse",
    additionalResponses: { "403": "ErrorResponse" }
  },
  "parameterTopology.resolveIdentityMappingTask": {
    summary: "Resolve an identity mapping task",
    tags: ["parameters"],
    requestBody: "ResolveIdentityMappingTaskRequest",
    responseBody: "IdentityMappingTaskResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterTopology.reopenIdentityMappingTask": {
    summary: "Reopen a non-destructive identity mapping outcome",
    tags: ["parameters"],
    requestBody: "ReopenIdentityMappingTaskRequest",
    responseBody: "IdentityMappingTaskResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
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
  "logs.feedbackInsights": {
    summary: "Aggregate log feedback quality insights",
    tags: ["logs"],
    responseBody: "LogFeedbackInsightsResponse"
  },
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

  "knowledge.createEntry": {
    summary: "Create a knowledge entry (markdown or file form)",
    tags: ["knowledge"],
    requestBody: "CreateKnowledgeEntryRequest",
    responseBody: "KnowledgeEntryResponse",
    successStatus: 201,
    additionalResponses: { "403": "ErrorResponse" }
  },
  "knowledge.listEntries": {
    summary: "List knowledge entries visible to the caller",
    tags: ["knowledge"],
    responseBody: "KnowledgeEntryListResponse",
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
  "knowledge.search": {
    summary:
      "Search published knowledge entries — hybrid vector+FTS when embeddings and pgvector are available, FTS+trigram otherwise; the response reports the retrieval mode that actually ran",
    tags: ["knowledge"],
    responseBody: "KnowledgeSearchResponse",
    additionalResponses: { "403": "ErrorResponse" }
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
  },

  "parameterFiles.listFiles": {
    summary: "List project parameter files with current version metadata",
    tags: ["parameter-files"],
    responseBody: "ParameterFileListResponse",
    additionalResponses: { "403": "ErrorResponse" }
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

  "parameters.deleteAdminProject": {
    summary: "Delete a project and its parameter-management data (cascade)",
    tags: ["parameters"],
    responseBody: "ProjectDeleteResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse" }
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
  "parameterSpecs.update": {
    summary: "Update a parameter definition (draft content or governed fields)",
    tags: ["parameters"],
    requestBody: "UpdateParameterSpecRequest",
    responseBody: "ParameterSpecResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },
  "parameterSpecs.activate": {
    summary: "Activate a draft parameter definition",
    tags: ["parameters"],
    responseBody: "ParameterSpecResponse",
    additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  },

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
  }
};
