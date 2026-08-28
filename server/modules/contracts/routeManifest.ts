import type { HttpMethod } from "../../shared/http/router";

export type RouteModule =
  | "auth"
  | "audit"
  | "notifications"
  | "users"
  | "parameters"
  | "parameter-modules"
  | "parameter-files"
  | "device-bridge"
  | "logs"
  | "product-feedback"
  | "knowledge"
  | "dts-reload"
  | "jobs"
  | "debugging"
  | "operations"
  | "agent";
export type RouteStability = "mvp" | "commercial-readiness" | "deprecated";

export type RouteManifestEntry = {
  id: string;
  method: HttpMethod;
  path: string;
  module: RouteModule;
  stability: RouteStability;
};

export const routeManifest = [
  { id: "auth.localConfig", method: "GET", path: "/api/v1/auth/local-config", module: "auth", stability: "commercial-readiness" },
  { id: "auth.register", method: "POST", path: "/api/v1/auth/register", module: "auth", stability: "commercial-readiness" },
  { id: "auth.login", method: "POST", path: "/api/v1/auth/login", module: "auth", stability: "commercial-readiness" },
  { id: "auth.logout", method: "POST", path: "/api/v1/auth/logout", module: "auth", stability: "commercial-readiness" },
  { id: "auth.me", method: "GET", path: "/api/v1/me", module: "auth", stability: "mvp" },
  { id: "auth.updateProfile", method: "PATCH", path: "/api/v1/me/profile", module: "auth", stability: "commercial-readiness" },
  { id: "auth.changePassword", method: "POST", path: "/api/v1/me/password", module: "auth", stability: "commercial-readiness" },

  { id: "audit.createEvent", method: "POST", path: "/api/v1/audit-events", module: "audit", stability: "mvp" },
  { id: "audit.listEvents", method: "GET", path: "/api/v1/audit-events", module: "audit", stability: "mvp" },

  { id: "notifications.list", method: "GET", path: "/api/v1/notifications", module: "notifications", stability: "mvp" },
  {
    id: "notifications.unreadCount",
    method: "GET",
    path: "/api/v1/notifications/unread-count",
    module: "notifications",
    stability: "mvp"
  },
  {
    id: "notifications.markRead",
    method: "POST",
    path: "/api/v1/notifications/:notificationId/read",
    module: "notifications",
    stability: "mvp"
  },
  {
    id: "notifications.markAllRead",
    method: "POST",
    path: "/api/v1/notifications/mark-all-read",
    module: "notifications",
    stability: "mvp"
  },

  { id: "organization.get", method: "GET", path: "/api/v1/organization", module: "users", stability: "commercial-readiness" },
  {
    id: "organization.update",
    method: "PATCH",
    path: "/api/v1/organization",
    module: "users",
    stability: "commercial-readiness"
  },
  { id: "users.list", method: "GET", path: "/api/v1/users", module: "users", stability: "commercial-readiness" },
  { id: "users.create", method: "POST", path: "/api/v1/users", module: "users", stability: "commercial-readiness" },
  {
    id: "users.listRegistrationRoleRequests",
    method: "GET",
    path: "/api/v1/users/registration-role-requests",
    module: "users",
    stability: "commercial-readiness"
  },
  {
    id: "users.approveRegistrationRoleRequest",
    method: "POST",
    path: "/api/v1/users/registration-role-requests/:requestId/approve",
    module: "users",
    stability: "commercial-readiness"
  },
  {
    id: "users.rejectRegistrationRoleRequest",
    method: "POST",
    path: "/api/v1/users/registration-role-requests/:requestId/reject",
    module: "users",
    stability: "commercial-readiness"
  },
  { id: "users.update", method: "PATCH", path: "/api/v1/users/:userId", module: "users", stability: "commercial-readiness" },
  { id: "users.delete", method: "DELETE", path: "/api/v1/users/:userId", module: "users", stability: "commercial-readiness" },
  {
    id: "users.activation",
    method: "PATCH",
    path: "/api/v1/users/:userId/activation",
    module: "users",
    stability: "commercial-readiness"
  },
  {
    id: "users.replaceRoles",
    method: "PUT",
    path: "/api/v1/users/:userId/roles",
    module: "users",
    stability: "commercial-readiness"
  },
  {
    id: "users.resetPassword",
    method: "POST",
    path: "/api/v1/users/:userId/password",
    module: "users",
    stability: "commercial-readiness"
  },

  { id: "parameters.listProjects", method: "GET", path: "/api/v1/projects", module: "parameters", stability: "mvp" },
  {
    id: "parameters.listConfigSetFiles",
    method: "GET",
    path: "/api/v1/projects/:projectId/config-sets/:configSetId/files",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.getConfigSetReleaseReadiness",
    method: "GET",
    path: "/api/v1/projects/:projectId/config-sets/:configSetId/release-readiness",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.getReleaseBaseline",
    method: "GET",
    path: "/api/v1/projects/:projectId/baselines/:baselineId",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.compareReleaseBaseline",
    method: "GET",
    path: "/api/v1/projects/:projectId/baselines/:baselineId/compare",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.previewRestoreReleaseBaseline",
    method: "GET",
    path: "/api/v1/projects/:projectId/baselines/:baselineId/restore-preview",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.rollbackReleaseBaseline",
    method: "POST",
    path: "/api/v1/projects/:projectId/baselines/:baselineId/rollback",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.releaseReleaseBaseline",
    method: "POST",
    path: "/api/v1/projects/:projectId/baselines/:baselineId/release",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.getParameterFileStructure",
    method: "GET",
    path: "/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/structure",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.listParameterFileCandidates",
    method: "GET",
    path: "/api/v1/projects/:projectId/parameter-file-candidates",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.createParameterFileCandidate",
    method: "POST",
    path: "/api/v1/projects/:projectId/parameter-file-candidates",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.getParameterFileCandidate",
    method: "GET",
    path: "/api/v1/projects/:projectId/parameter-file-candidates/:candidateId",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.getParameterFileCandidateImpact",
    method: "GET",
    path: "/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/impact",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.getParameterFileCandidateContent",
    method: "GET",
    path: "/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/content",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.abandonParameterFileCandidate",
    method: "POST",
    path: "/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/abandon",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.recomputeParameterFileCandidate",
    method: "POST",
    path: "/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/recompute",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.searchDts",
    method: "GET",
    path: "/api/v1/projects/:projectId/dts-search",
    module: "parameters",
    stability: "mvp"
  },
  { id: "parameters.listProjectModules", method: "GET", path: "/api/v1/projects/:projectId/modules", module: "parameters", stability: "mvp" },
  { id: "parameters.listModules", method: "GET", path: "/api/v1/parameter-modules", module: "parameters", stability: "mvp" },
  { id: "parameters.createModule", method: "POST", path: "/api/v1/parameter-modules", module: "parameters", stability: "mvp" },
  { id: "parameters.updateModule", method: "PATCH", path: "/api/v1/parameter-modules/:moduleId", module: "parameters", stability: "mvp" },
  { id: "parameters.moveModule", method: "POST", path: "/api/v1/parameter-modules/:moduleId/move", module: "parameters", stability: "mvp" },
  { id: "parameters.deleteModule", method: "DELETE", path: "/api/v1/parameter-modules/:moduleId", module: "parameters", stability: "mvp" },
  { id: "parameterModules.getRegistry", method: "GET", path: "/api/v2/parameter-modules", module: "parameter-modules", stability: "mvp" },
  { id: "parameterModules.discoveryHints", method: "GET", path: "/api/v2/parameter-modules/discovery-hints", module: "parameter-modules", stability: "mvp" },
  { id: "parameterModules.dismissCompatible", method: "POST", path: "/api/v2/parameter-modules/discovery-hints/dismissals", module: "parameter-modules", stability: "mvp" },
  { id: "parameterModules.restoreCompatible", method: "DELETE", path: "/api/v2/parameter-modules/discovery-hints/dismissals/:compatible", module: "parameter-modules", stability: "mvp" },
  { id: "parameterModules.previewMapping", method: "POST", path: "/api/v2/parameter-modules/mappings/preview", module: "parameter-modules", stability: "mvp" },
  { id: "parameterModules.createMapping", method: "POST", path: "/api/v2/parameter-modules/mappings", module: "parameter-modules", stability: "mvp" },
  { id: "parameterModules.deleteMapping", method: "DELETE", path: "/api/v2/parameter-modules/mappings/:mappingId", module: "parameter-modules", stability: "mvp" },
  { id: "parameterModules.recomputeBindings", method: "POST", path: "/api/v2/parameter-modules/recompute-bindings", module: "parameter-modules", stability: "mvp" },
  { id: "parameterModules.listDriverRegistry", method: "GET", path: "/api/v2/parameter-modules/driver-registry", module: "parameter-modules", stability: "mvp" },
  { id: "parameterModules.registerDriver", method: "POST", path: "/api/v2/parameter-modules/driver-registry", module: "parameter-modules", stability: "mvp" },
  { id: "parameterModules.updateDriverRegistration", method: "PATCH", path: "/api/v2/parameter-modules/driver-registry/:moduleId", module: "parameter-modules", stability: "mvp" },
  { id: "parameterModules.updateDriverRegistrationDefault", method: "PATCH", path: "/api/v2/parameter-modules/driver-registry/:moduleId/default-business-category", module: "parameter-modules", stability: "mvp" },
  { id: "parameterModules.replayDriverPlacement", method: "POST", path: "/api/v2/parameter-modules/driver-registry/:moduleId/replay-placement", module: "parameter-modules", stability: "mvp" },
  { id: "parameterSpecs.listOrganizationDriverSchemas", method: "GET", path: "/api/v2/organization-driver-schemas", module: "parameters", stability: "mvp" },
  { id: "parameterSpecs.getOrganizationDriverSchema", method: "GET", path: "/api/v2/organization-driver-schemas/:schemaId", module: "parameters", stability: "mvp" },
  { id: "parameterSpecs.createOrganizationDriverSchema", method: "POST", path: "/api/v2/organization-driver-schemas", module: "parameters", stability: "mvp" },
  { id: "parameterSpecs.updateOrganizationDriverSchema", method: "PATCH", path: "/api/v2/organization-driver-schemas/:schemaId", module: "parameters", stability: "mvp" },
  { id: "parameterSpecs.activateOrganizationDriverSchema", method: "POST", path: "/api/v2/organization-driver-schemas/:schemaId/activate", module: "parameters", stability: "mvp" },
  { id: "parameterSpecs.previewOrganizationDriverSchemaDeprecation", method: "GET", path: "/api/v2/organization-driver-schemas/:schemaId/deprecation-impact", module: "parameters", stability: "mvp" },
  { id: "parameterSpecs.deprecateOrganizationDriverSchema", method: "POST", path: "/api/v2/organization-driver-schemas/:schemaId/deprecate", module: "parameters", stability: "mvp" },
  { id: "parameterSpecs.listPromotionCandidates", method: "GET", path: "/api/v2/platform/driver-schemas/promotion-candidates", module: "parameters", stability: "mvp" },
  { id: "parameterSpecs.promoteDriverSchemaOverlay", method: "POST", path: "/api/v2/platform/driver-schemas/promotions", module: "parameters", stability: "mvp" },
  { id: "parameterSpecs.revertDriverSchemaPromotion", method: "POST", path: "/api/v2/platform/driver-schemas/promotions/:promotionId/revert", module: "parameters", stability: "mvp" },
  { id: "parameters.admin.listProjects", method: "GET", path: "/api/v1/parameters/admin/projects", module: "parameters", stability: "mvp" },
  { id: "parameters.admin.getProject", method: "GET", path: "/api/v1/parameters/admin/projects/:projectId", module: "parameters", stability: "mvp" },
  { id: "parameters.admin.createProject", method: "POST", path: "/api/v1/parameters/admin/projects", module: "parameters", stability: "mvp" },
  { id: "parameters.admin.updateProject", method: "PATCH", path: "/api/v1/parameters/admin/projects/:projectId", module: "parameters", stability: "mvp" },
  {
    id: "parameters.initialization.get",
    method: "GET",
    path: "/api/v1/parameters/projects/:projectId/initialization",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.initialization.upsertDraft",
    method: "PUT",
    path: "/api/v1/parameters/projects/:projectId/initialization/draft",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.initialization.preview",
    method: "POST",
    path: "/api/v1/parameters/projects/:projectId/initialization/preview",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.initialization.submit",
    method: "POST",
    path: "/api/v1/parameters/projects/:projectId/initialization/submit",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.admin.listInitializationReviews",
    method: "GET",
    path: "/api/v1/parameters/admin/initialization-reviews",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.admin.approveInitializationReview",
    method: "POST",
    path: "/api/v1/parameters/admin/initialization-reviews/:reviewId/approve",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.admin.rejectInitializationReview",
    method: "POST",
    path: "/api/v1/parameters/admin/initialization-reviews/:reviewId/reject",
    module: "parameters",
    stability: "mvp"
  },
  { id: "parameters.list", method: "GET", path: "/api/v1/parameters", module: "parameters", stability: "mvp" },
  { id: "parameters.get", method: "GET", path: "/api/v1/parameters/:parameterId", module: "parameters", stability: "mvp" },
  { id: "parameters.history", method: "GET", path: "/api/v1/parameters/:parameterId/history", module: "parameters", stability: "mvp" },
  { id: "parameters.saveDraft", method: "POST", path: "/api/v1/parameter-drafts", module: "parameters", stability: "mvp" },
  { id: "parameters.listMyDrafts", method: "GET", path: "/api/v1/parameter-drafts/mine", module: "parameters", stability: "mvp" },
  { id: "parameters.deleteDraft", method: "DELETE", path: "/api/v1/parameter-drafts/:draftId", module: "parameters", stability: "mvp" },
  {
    id: "parameters.submitRound",
    method: "POST",
    path: "/api/v1/parameter-submission-rounds",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.listSubmissionRounds",
    method: "GET",
    path: "/api/v1/parameter-submission-rounds",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.withdrawSubmissionRound",
    method: "POST",
    path: "/api/v1/parameter-submission-rounds/:roundId/withdraw",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.listChangeRequests",
    method: "GET",
    path: "/api/v1/parameter-change-requests",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.reviewChangeRequest",
    method: "POST",
    path: "/api/v1/parameter-change-requests/:requestId/review",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.createImportBatch",
    method: "POST",
    path: "/api/v1/parameter-import-batches",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters.applyImportBatch",
    method: "POST",
    path: "/api/v1/parameter-import-batches/:batchId/apply",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters-dashboard-summary",
    method: "GET",
    path: "/api/v1/parameters/dashboard/summary",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameters-dashboard-hotspots",
    method: "GET",
    path: "/api/v1/parameters/dashboard/hotspots",
    module: "parameters",
    stability: "mvp"
  },

  { id: "parameterSpecs.list", method: "GET", path: "/api/v2/parameter-specs", module: "parameters", stability: "mvp" },
  {
    id: "parameterSpecs.create",
    method: "POST",
    path: "/api/v2/parameter-specs",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterSpecs.get",
    method: "GET",
    path: "/api/v2/parameter-specs/:specId",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterSpecs.getCutover",
    method: "GET",
    path: "/api/v2/parameter-specs/:specId/cutover",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterSpecs.prepareCutover",
    method: "POST",
    path: "/api/v2/parameter-specs/:specId/cutover/prepare",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterSpecs.finalizeCutover",
    method: "POST",
    path: "/api/v2/parameter-specs/:specId/cutover/finalize",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterSpecs.listReviewTasks",
    method: "GET",
    path: "/api/v2/parameter-spec-review-tasks",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterSpecs.resolveReviewTask",
    method: "POST",
    path: "/api/v2/parameter-spec-review-tasks/:taskId/resolve",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterSpecs.deprecate",
    method: "POST",
    path: "/api/v2/parameter-specs/:specId/deprecate",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterSpecs.restore",
    method: "POST",
    path: "/api/v2/parameter-specs/:specId/restore",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterSpecs.reattribute",
    method: "POST",
    path: "/api/v2/parameter-specs/:specId/reattribute",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterSpecs.renamePropertyKey",
    method: "POST",
    path: "/api/v2/parameter-specs/:specId/rename-property-key",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterSpecs.getPropertyKeyCutover",
    method: "GET",
    path: "/api/v2/parameter-specs/:specId/property-key-cutover",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterSpecs.previewPropertyKeyCutover",
    method: "POST",
    path: "/api/v2/parameter-specs/:specId/property-key-cutover/preview",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterSpecs.startPropertyKeyCutover",
    method: "POST",
    path: "/api/v2/parameter-specs/:specId/property-key-cutover/start",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterSpecs.preparePropertyKeyCutover",
    method: "POST",
    path: "/api/v2/parameter-specs/:specId/property-key-cutover/prepare",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterSpecs.finalizePropertyKeyCutover",
    method: "POST",
    path: "/api/v2/parameter-specs/:specId/property-key-cutover/finalize",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterTopology.listConfigRevisions",
    method: "GET",
    path: "/api/v2/projects/:projectId/config-sets/:configSetId/revisions",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterTopology.getTopology",
    method: "GET",
    path: "/api/v2/projects/:projectId/config-sets/:configSetId/revisions/:revisionId/topology",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterTopology.listBindings",
    method: "GET",
    path: "/api/v2/projects/:projectId/parameter-bindings",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterTopology.getBindingHistory",
    method: "GET",
    path: "/api/v2/projects/:projectId/bindings/:bindingId/history",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterTopology.getBindingCompare",
    method: "GET",
    path: "/api/v2/projects/:projectId/bindings/:bindingId/compare",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterTopology.listIdentityMappingTasks",
    method: "GET",
    path: "/api/v2/identity-mapping-tasks",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterTopology.resolveIdentityMappingTask",
    method: "POST",
    path: "/api/v2/identity-mapping-tasks/:taskId/resolve",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterTopology.reopenIdentityMappingTask",
    method: "POST",
    path: "/api/v2/identity-mapping-tasks/:taskId/reopen",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterTopology.validateConfigRevision",
    method: "POST",
    path: "/api/v2/projects/:projectId/config-revisions/:revisionId/validate",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterTopology.createBindingDraft",
    method: "POST",
    path: "/api/v2/projects/:projectId/parameter-bindings/:bindingId/drafts",
    module: "parameters",
    stability: "mvp"
  },
  {
    id: "parameterTopology.createNodeEnablementDraft",
    method: "POST",
    path: "/api/v2/projects/:projectId/node-enablement-drafts",
    module: "parameters",
    stability: "mvp"
  },

  { id: "logs.uploadFile", method: "POST", path: "/api/v1/log-files", module: "logs", stability: "mvp" },
  { id: "logs.upload", method: "POST", path: "/api/v1/logs", module: "logs", stability: "mvp" },
  { id: "logs.list", method: "GET", path: "/api/v1/logs", module: "logs", stability: "mvp" },
  { id: "logs.feedbackInsights", method: "GET", path: "/api/v1/logs/feedback-insights", module: "logs", stability: "mvp" },
  { id: "logs.get", method: "GET", path: "/api/v1/logs/:logId", module: "logs", stability: "mvp" },
  { id: "logs.listRuns", method: "GET", path: "/api/v1/logs/:logId/runs", module: "logs", stability: "mvp" },
  { id: "logs.rerun", method: "POST", path: "/api/v1/logs/:logId/rerun", module: "logs", stability: "mvp" },
  { id: "logs.archive", method: "POST", path: "/api/v1/logs/:logId/archive", module: "logs", stability: "mvp" },
  { id: "logs.unarchive", method: "POST", path: "/api/v1/logs/:logId/unarchive", module: "logs", stability: "mvp" },
  { id: "logs.feedback", method: "POST", path: "/api/v1/logs/:logId/feedback", module: "logs", stability: "mvp" },
  { id: "logs.listDomains", method: "GET", path: "/api/v1/log-domains", module: "logs", stability: "mvp" },
  { id: "logs.createDomain", method: "POST", path: "/api/v1/log-domains", module: "logs", stability: "mvp" },
  { id: "logs.updateDomain", method: "PATCH", path: "/api/v1/log-domains/:domainId", module: "logs", stability: "mvp" },
  { id: "logs.archiveDomain", method: "POST", path: "/api/v1/log-domains/:domainId/archive", module: "logs", stability: "mvp" },
  {
    id: "logs.listDomainKnowledgeLinks",
    method: "GET",
    path: "/api/v1/log-domains/:domainId/knowledge-links",
    module: "logs",
    stability: "mvp"
  },
  {
    id: "logs.setDomainKnowledgeLinks",
    method: "PUT",
    path: "/api/v1/log-domains/:domainId/knowledge-links",
    module: "logs",
    stability: "mvp"
  },
  { id: "logs.setDomainWebhook", method: "PUT", path: "/api/v1/log-domains/:domainId/webhook", module: "logs", stability: "mvp" },
  {
    id: "logs.listDomainWebhookDeliveries",
    method: "GET",
    path: "/api/v1/log-domains/:domainId/webhook-deliveries",
    module: "logs",
    stability: "mvp"
  },
  {
    id: "logs.sendDomainWebhookTest",
    method: "POST",
    path: "/api/v1/log-domains/:domainId/webhook-test",
    module: "logs",
    stability: "mvp"
  },

  { id: "productFeedback.create", method: "POST", path: "/api/v1/product-feedback", module: "product-feedback", stability: "mvp" },
  { id: "productFeedback.list", method: "GET", path: "/api/v1/product-feedback", module: "product-feedback", stability: "mvp" },
  { id: "productFeedback.get", method: "GET", path: "/api/v1/product-feedback/:id", module: "product-feedback", stability: "mvp" },
  { id: "productFeedback.patch", method: "PATCH", path: "/api/v1/product-feedback/:id", module: "product-feedback", stability: "mvp" },
  { id: "knowledge.createEntry", method: "POST", path: "/api/v1/knowledge/entries", module: "knowledge", stability: "mvp" },
  { id: "knowledge.listEntries", method: "GET", path: "/api/v1/knowledge/entries", module: "knowledge", stability: "mvp" },
  {
    id: "knowledge.distillFromLog",
    method: "POST",
    path: "/api/v1/knowledge/distill-from-log",
    module: "knowledge",
    stability: "mvp"
  },
  {
    id: "knowledge.distillFromReloadRun",
    method: "POST",
    path: "/api/v1/knowledge/distill-from-reload-run",
    module: "knowledge",
    stability: "mvp"
  },
  { id: "knowledge.search", method: "GET", path: "/api/v1/knowledge/search", module: "knowledge", stability: "mvp" },
  {
    id: "knowledge.relatedToLog",
    method: "GET",
    path: "/api/v1/knowledge/related-to-log",
    module: "knowledge",
    stability: "mvp"
  },
  {
    id: "knowledge.relatedToSpec",
    method: "GET",
    path: "/api/v1/knowledge/related-to-spec",
    module: "knowledge",
    stability: "mvp"
  },
  {
    id: "knowledge.addParameterReference",
    method: "PUT",
    path: "/api/v1/knowledge/entries/:entryId/parameter-references/:specId",
    module: "knowledge",
    stability: "mvp"
  },
  {
    id: "knowledge.removeParameterReference",
    method: "DELETE",
    path: "/api/v1/knowledge/entries/:entryId/parameter-references/:specId",
    module: "knowledge",
    stability: "mvp"
  },
  { id: "knowledge.indexStatus", method: "GET", path: "/api/v1/knowledge/index/status", module: "knowledge", stability: "mvp" },
  { id: "knowledge.indexRebuild", method: "POST", path: "/api/v1/knowledge/index/rebuild", module: "knowledge", stability: "mvp" },
  {
    id: "knowledge.indexRetryEntry",
    method: "POST",
    path: "/api/v1/knowledge/entries/:entryId/index/retry",
    module: "knowledge",
    stability: "mvp"
  },
  { id: "knowledge.getEntry", method: "GET", path: "/api/v1/knowledge/entries/:entryId", module: "knowledge", stability: "mvp" },
  { id: "knowledge.updateEntry", method: "PATCH", path: "/api/v1/knowledge/entries/:entryId", module: "knowledge", stability: "mvp" },
  {
    id: "knowledge.publishEntry",
    method: "POST",
    path: "/api/v1/knowledge/entries/:entryId/publish",
    module: "knowledge",
    stability: "mvp"
  },
  {
    id: "knowledge.archiveEntry",
    method: "POST",
    path: "/api/v1/knowledge/entries/:entryId/archive",
    module: "knowledge",
    stability: "mvp"
  },
  {
    id: "knowledge.restoreEntry",
    method: "POST",
    path: "/api/v1/knowledge/entries/:entryId/restore",
    module: "knowledge",
    stability: "mvp"
  },
  {
    id: "knowledge.rejectAgentDraft",
    method: "POST",
    path: "/api/v1/knowledge/entries/:entryId/reject",
    module: "knowledge",
    stability: "mvp"
  },
  { id: "knowledge.deleteEntry", method: "DELETE", path: "/api/v1/knowledge/entries/:entryId", module: "knowledge", stability: "mvp" },
  {
    id: "knowledge.listRevisions",
    method: "GET",
    path: "/api/v1/knowledge/entries/:entryId/revisions",
    module: "knowledge",
    stability: "mvp"
  },
  {
    id: "knowledge.restoreRevision",
    method: "POST",
    path: "/api/v1/knowledge/entries/:entryId/revisions/:revisionId/restore",
    module: "knowledge",
    stability: "mvp"
  },
  {
    id: "knowledge.fileContent",
    method: "GET",
    path: "/api/v1/knowledge/entries/:entryId/file/content",
    module: "knowledge",
    stability: "mvp"
  },

  {
    id: "productFeedback.attachmentContent",
    method: "GET",
    path: "/api/v1/product-feedback/:id/attachments/:attachmentId/content",
    module: "product-feedback",
    stability: "mvp"
  },

  {
    id: "dtsReload.listCandidates",
    method: "GET",
    path: "/api/v1/dts-reload/projects/:projectId/candidates",
    module: "dts-reload",
    stability: "mvp"
  },
  {
    id: "dtsReload.listRuns",
    method: "GET",
    path: "/api/v1/dts-reload/runs",
    module: "dts-reload",
    stability: "mvp"
  },
  {
    id: "dtsReload.startRun",
    method: "POST",
    path: "/api/v1/dts-reload/projects/:projectId/runs",
    module: "dts-reload",
    stability: "mvp"
  },
  {
    id: "dtsReload.restoreBaseline",
    method: "POST",
    path: "/api/v1/dts-reload/projects/:projectId/restore-baseline",
    module: "dts-reload",
    stability: "mvp"
  },
  {
    id: "dtsReload.getResidue",
    method: "GET",
    path: "/api/v1/dts-reload/residue",
    module: "dts-reload",
    stability: "mvp"
  },
  {
    id: "dtsReload.deployRun",
    method: "POST",
    path: "/api/v1/dts-reload/runs/:runId/deploy",
    module: "dts-reload",
    stability: "mvp"
  },
  {
    id: "dtsReload.promoteToDrafts",
    method: "POST",
    path: "/api/v1/dts-reload/runs/:runId/promote-to-drafts",
    module: "dts-reload",
    stability: "mvp"
  },
  {
    id: "dtsReload.getRun",
    method: "GET",
    path: "/api/v1/dts-reload/runs/:runId",
    module: "dts-reload",
    stability: "mvp"
  },
  {
    id: "dtsReload.downloadArtifact",
    method: "GET",
    path: "/api/v1/dts-reload/runs/:runId/artifact",
    module: "dts-reload",
    stability: "mvp"
  },
  {
    id: "dtsReload.getConfiguration",
    method: "GET",
    path: "/api/v1/dts-reload/configuration",
    module: "dts-reload",
    stability: "mvp"
  },
  {
    id: "dtsReload.updateOrganisationConfiguration",
    method: "PUT",
    path: "/api/v1/dts-reload/configuration",
    module: "dts-reload",
    stability: "mvp"
  },

  { id: "jobs.get", method: "GET", path: "/api/v1/jobs/:jobId", module: "jobs", stability: "mvp" },
  { id: "jobs.events", method: "GET", path: "/api/v1/jobs/:jobId/events", module: "jobs", stability: "mvp" },

  { id: "debugging.listDevices", method: "GET", path: "/api/v1/debugging/devices", module: "debugging", stability: "mvp" },
  { id: "debugging.detectTarget", method: "POST", path: "/api/v1/debugging/targets/detect", module: "debugging", stability: "mvp" },
  { id: "debugging.listParameters", method: "GET", path: "/api/v1/debugging/parameters", module: "debugging", stability: "mvp" },
  { id: "debugging.listRuntimeNodes", method: "GET", path: "/api/v1/debugging/nodes", module: "debugging", stability: "mvp" },
  { id: "debugging.admin.listNodes", method: "GET", path: "/api/v1/debugging/admin/nodes", module: "debugging", stability: "mvp" },
  { id: "debugging.admin.createNode", method: "POST", path: "/api/v1/debugging/admin/nodes", module: "debugging", stability: "mvp" },
  {
    id: "debugging.admin.updateNode",
    method: "PATCH",
    path: "/api/v1/debugging/admin/nodes/:nodeId",
    module: "debugging",
    stability: "mvp"
  },
  {
    id: "debugging.admin.deleteNode",
    method: "DELETE",
    path: "/api/v1/debugging/admin/nodes/:nodeId",
    module: "debugging",
    stability: "mvp"
  },
  { id: "debugging.admin.listModules", method: "GET", path: "/api/v1/debugging/admin/modules", module: "debugging", stability: "mvp" },
  { id: "debugging.admin.createModule", method: "POST", path: "/api/v1/debugging/admin/modules", module: "debugging", stability: "mvp" },
  {
    id: "debugging.admin.updateModule",
    method: "PATCH",
    path: "/api/v1/debugging/admin/modules/:moduleId",
    module: "debugging",
    stability: "mvp"
  },
  {
    id: "debugging.admin.moveModule",
    method: "POST",
    path: "/api/v1/debugging/admin/modules/:moduleId/move",
    module: "debugging",
    stability: "mvp"
  },
  {
    id: "debugging.admin.deleteModule",
    method: "DELETE",
    path: "/api/v1/debugging/admin/modules/:moduleId",
    module: "debugging",
    stability: "mvp"
  },
  {
    id: "debugging.admin.upsertNodeBinding",
    method: "PUT",
    path: "/api/v1/debugging/admin/nodes/:nodeId/bindings/:protocol",
    module: "debugging",
    stability: "mvp"
  },
  {
    id: "debugging.admin.patchNodeBinding",
    method: "PATCH",
    path: "/api/v1/debugging/admin/nodes/:nodeId/bindings/:protocol",
    module: "debugging",
    stability: "mvp"
  },
  {
    id: "debugging.admin.archiveNodeBinding",
    method: "POST",
    path: "/api/v1/debugging/admin/nodes/:nodeId/bindings/:protocol/archive",
    module: "debugging",
    stability: "mvp"
  },
  {
    id: "debugging.admin.exportCatalog",
    method: "GET",
    path: "/api/v1/debugging/admin/catalog/export",
    module: "debugging",
    stability: "mvp"
  },
  {
    id: "debugging.admin.importCatalog",
    method: "POST",
    path: "/api/v1/debugging/admin/catalog/import",
    module: "debugging",
    stability: "mvp"
  },
  { id: "debugging.listReloadTargets", method: "GET", path: "/api/v1/debugging/reload-targets", module: "debugging", stability: "deprecated" },
  { id: "debugging.reloadParameter", method: "POST", path: "/api/v1/debugging/parameters/reload", module: "debugging", stability: "deprecated" },
  { id: "debugging.createSession", method: "POST", path: "/api/v1/debugging/sessions", module: "debugging", stability: "mvp" },
  { id: "debugging.getSession", method: "GET", path: "/api/v1/debugging/sessions/:sessionId", module: "debugging", stability: "mvp" },
  {
    id: "debugging.sessionEvents",
    method: "GET",
    path: "/api/v1/debugging/sessions/:sessionId/events",
    module: "debugging",
    stability: "mvp"
  },
  { id: "debugging.readNode", method: "POST", path: "/api/v1/debugging/nodes/read", module: "debugging", stability: "mvp" },
  { id: "debugging.writeNode", method: "POST", path: "/api/v1/debugging/nodes/write", module: "debugging", stability: "mvp" },
  {
    id: "debugging.rollbackSnapshot",
    method: "POST",
    path: "/api/v1/debugging/snapshots/:snapshotId/rollback",
    module: "debugging",
    stability: "mvp"
  },

  { id: "xiaoze.run", method: "POST", path: "/api/v1/agent/xiaoze", module: "agent", stability: "mvp" },
  { id: "xiaoze.suggest", method: "POST", path: "/api/v1/agent/xiaoze/suggest", module: "agent", stability: "mvp" },
  { id: "xiaoze.listThreads", method: "GET", path: "/api/v1/agent/xiaoze/threads", module: "agent", stability: "mvp" },
  { id: "xiaoze.createThread", method: "POST", path: "/api/v1/agent/xiaoze/threads", module: "agent", stability: "mvp" },
  { id: "xiaoze.getThread", method: "GET", path: "/api/v1/agent/xiaoze/threads/:threadId", module: "agent", stability: "mvp" },
  { id: "xiaoze.patchThread", method: "PATCH", path: "/api/v1/agent/xiaoze/threads/:threadId", module: "agent", stability: "mvp" },
  { id: "xiaoze.deleteThread", method: "DELETE", path: "/api/v1/agent/xiaoze/threads/:threadId", module: "agent", stability: "mvp" },

  { id: "parameterFiles.listFiles", method: "GET", path: "/api/v1/projects/:projectId/parameter-files", module: "parameter-files", stability: "mvp" },
  { id: "parameterFiles.uploadFile", method: "POST", path: "/api/v1/projects/:projectId/parameter-files", module: "parameter-files", stability: "mvp" },
  { id: "parameterFiles.listFileVersions", method: "GET", path: "/api/v1/projects/:projectId/parameter-files/:fileId/versions", module: "parameter-files", stability: "mvp" },
  { id: "parameterFiles.uploadFileVersion", method: "POST", path: "/api/v1/projects/:projectId/parameter-files/:fileId/versions", module: "parameter-files", stability: "mvp" },
  {
    id: "parameterFiles.downloadFileVersionContent",
    method: "GET",
    path: "/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/content",
    module: "parameter-files",
    stability: "mvp"
  },
  {
    id: "parameterFiles.rollbackFileVersion",
    method: "POST",
    path: "/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/rollback",
    module: "parameter-files",
    stability: "mvp"
  },
  { id: "parameterFiles.syncFileVersion", method: "POST", path: "/api/v1/projects/:projectId/parameter-files/:fileId/sync", module: "parameter-files", stability: "mvp" },
  { id: "parameterFiles.listConflicts", method: "GET", path: "/api/v1/projects/:projectId/parameter-file-conflicts", module: "parameter-files", stability: "mvp" },
  {
    id: "parameterFiles.resolveConflict",
    method: "POST",
    path: "/api/v1/projects/:projectId/parameter-file-conflicts/:conflictId/resolve",
    module: "parameter-files",
    stability: "mvp"
  },
  {
    id: "parameterFiles.previewBulkConflictResolution",
    method: "POST",
    path: "/api/v1/projects/:projectId/parameter-file-conflicts/bulk-preview",
    module: "parameter-files",
    stability: "mvp"
  },
  {
    id: "parameterFiles.resolveConflictsBulk",
    method: "POST",
    path: "/api/v1/projects/:projectId/parameter-file-conflicts/bulk-resolve",
    module: "parameter-files",
    stability: "mvp"
  },
  { id: "parameterFiles.listConfigSets", method: "GET", path: "/api/v1/projects/:projectId/config-sets", module: "parameter-files", stability: "mvp" },
  { id: "parameterFiles.createConfigSet", method: "POST", path: "/api/v1/projects/:projectId/config-sets", module: "parameter-files", stability: "mvp" },
  {
    id: "parameterFiles.addConfigSetFile",
    method: "POST",
    path: "/api/v1/projects/:projectId/config-sets/:configSetId/files",
    module: "parameter-files",
    stability: "mvp"
  },
  {
    id: "parameterFiles.removeConfigSetFile",
    method: "DELETE",
    path: "/api/v1/projects/:projectId/config-sets/:configSetId/files/:fileId",
    module: "parameter-files",
    stability: "mvp"
  },
  {
    id: "parameterFiles.exportConfigSet",
    method: "GET",
    path: "/api/v1/projects/:projectId/config-sets/:configSetId/export",
    module: "parameter-files",
    stability: "mvp"
  },
  {
    id: "parameterFiles.listConfigSetBaselines",
    method: "GET",
    path: "/api/v1/projects/:projectId/config-sets/:configSetId/baselines",
    module: "parameter-files",
    stability: "mvp"
  },
  {
    id: "parameterFiles.createConfigSetBaseline",
    method: "POST",
    path: "/api/v1/projects/:projectId/config-sets/:configSetId/baselines",
    module: "parameter-files",
    stability: "mvp"
  },
  {
    id: "parameterFiles.submitStructuredEdits",
    method: "POST",
    path: "/api/v1/projects/:projectId/dts-structured-edits/submit",
    module: "parameter-files",
    stability: "mvp"
  },
  {
    id: "parameterFiles.activateCandidate",
    method: "POST",
    path: "/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/activate",
    module: "parameter-files",
    stability: "mvp"
  },

  { id: "parameters.deleteAdminProject", method: "DELETE", path: "/api/v1/parameters/admin/projects/:projectId", module: "parameters", stability: "mvp" },
  { id: "parameters.parseDtsImport", method: "POST", path: "/api/v1/parameter-import/parse-dts", module: "parameters", stability: "mvp" },
  {
    id: "parameters.listWorkflowAssignees",
    method: "GET",
    path: "/api/v1/projects/:projectId/parameter-workflow-assignees",
    module: "parameters",
    stability: "mvp"
  },
  { id: "parameterSpecs.update", method: "PATCH", path: "/api/v2/parameter-specs/:specId", module: "parameters", stability: "mvp" },
  { id: "parameterSpecs.activate", method: "POST", path: "/api/v2/parameter-specs/:specId/activate", module: "parameters", stability: "mvp" },

  { id: "deviceBridges.createPairingCode", method: "POST", path: "/api/v1/device-bridges/pairing-codes", module: "device-bridge", stability: "mvp" },
  { id: "deviceBridges.pair", method: "POST", path: "/api/v1/device-bridges/pair", module: "device-bridge", stability: "mvp" },
  { id: "deviceBridges.listMine", method: "GET", path: "/api/v1/device-bridges/mine", module: "device-bridge", stability: "mvp" },
  { id: "deviceBridges.updateBridge", method: "PATCH", path: "/api/v1/device-bridges/:bridgeId", module: "device-bridge", stability: "mvp" },
  { id: "deviceBridges.revokeBridge", method: "POST", path: "/api/v1/device-bridges/:bridgeId/revoke", module: "device-bridge", stability: "mvp" },
  { id: "deviceBridges.getReleaseManifest", method: "GET", path: "/api/v1/device-bridges/releases", module: "device-bridge", stability: "mvp" },
  { id: "deviceBridges.getToolReleaseManifest", method: "GET", path: "/api/v1/device-bridges/tool-releases", module: "device-bridge", stability: "mvp" },

  { id: "operations.live", method: "GET", path: "/health/live", module: "operations", stability: "commercial-readiness" },
  { id: "operations.ready", method: "GET", path: "/health/ready", module: "operations", stability: "commercial-readiness" },
  {
    id: "operations.pilotReadiness",
    method: "GET",
    path: "/api/v1/operations/pilot-readiness",
    module: "operations",
    stability: "commercial-readiness"
  },
  { id: "operations.compatHealth", method: "GET", path: "/api/v1/health", module: "operations", stability: "commercial-readiness" }
] as const satisfies readonly RouteManifestEntry[];
