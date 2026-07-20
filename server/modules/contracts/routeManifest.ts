import type { HttpMethod } from "../../shared/http/router";

export type RouteModule =
  | "auth"
  | "audit"
  | "notifications"
  | "users"
  | "parameters"
  | "logs"
  | "product-feedback"
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
  { id: "auth.register", method: "POST", path: "/api/v1/auth/register", module: "auth", stability: "commercial-readiness" },
  { id: "auth.login", method: "POST", path: "/api/v1/auth/login", module: "auth", stability: "commercial-readiness" },
  { id: "auth.logout", method: "POST", path: "/api/v1/auth/logout", module: "auth", stability: "commercial-readiness" },
  { id: "auth.me", method: "GET", path: "/api/v1/me", module: "auth", stability: "mvp" },
  { id: "auth.updateProfile", method: "PATCH", path: "/api/v1/me/profile", module: "auth", stability: "commercial-readiness" },

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

  { id: "parameters.listProjects", method: "GET", path: "/api/v1/projects", module: "parameters", stability: "mvp" },
  { id: "parameters.listProjectModules", method: "GET", path: "/api/v1/projects/:projectId/modules", module: "parameters", stability: "mvp" },
  { id: "parameters.listModules", method: "GET", path: "/api/v1/parameter-modules", module: "parameters", stability: "mvp" },
  { id: "parameters.createModule", method: "POST", path: "/api/v1/parameter-modules", module: "parameters", stability: "mvp" },
  { id: "parameters.updateModule", method: "PATCH", path: "/api/v1/parameter-modules/:moduleId", module: "parameters", stability: "mvp" },
  { id: "parameters.moveModule", method: "POST", path: "/api/v1/parameter-modules/:moduleId/move", module: "parameters", stability: "mvp" },
  { id: "parameters.deleteModule", method: "DELETE", path: "/api/v1/parameter-modules/:moduleId", module: "parameters", stability: "mvp" },
  { id: "parameters.admin.listProjects", method: "GET", path: "/api/v1/parameters/admin/projects", module: "parameters", stability: "mvp" },
  { id: "parameters.admin.getProject", method: "GET", path: "/api/v1/parameters/admin/projects/:projectId", module: "parameters", stability: "mvp" },
  { id: "parameters.admin.createProject", method: "POST", path: "/api/v1/parameters/admin/projects", module: "parameters", stability: "mvp" },
  { id: "parameters.admin.updateProject", method: "PATCH", path: "/api/v1/parameters/admin/projects/:projectId", module: "parameters", stability: "mvp" },
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
    id: "parameterSpecs.get",
    method: "GET",
    path: "/api/v2/parameter-specs/:specId",
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

  { id: "logs.uploadFile", method: "POST", path: "/api/v1/log-files", module: "logs", stability: "mvp" },
  { id: "logs.upload", method: "POST", path: "/api/v1/logs", module: "logs", stability: "mvp" },
  { id: "logs.list", method: "GET", path: "/api/v1/logs", module: "logs", stability: "mvp" },
  { id: "logs.get", method: "GET", path: "/api/v1/logs/:logId", module: "logs", stability: "mvp" },
  { id: "logs.listRuns", method: "GET", path: "/api/v1/logs/:logId/runs", module: "logs", stability: "mvp" },
  { id: "logs.rerun", method: "POST", path: "/api/v1/logs/:logId/rerun", module: "logs", stability: "mvp" },
  { id: "logs.archive", method: "POST", path: "/api/v1/logs/:logId/archive", module: "logs", stability: "mvp" },
  { id: "logs.unarchive", method: "POST", path: "/api/v1/logs/:logId/unarchive", module: "logs", stability: "mvp" },
  { id: "logs.feedback", method: "POST", path: "/api/v1/logs/:logId/feedback", module: "logs", stability: "mvp" },

  { id: "productFeedback.create", method: "POST", path: "/api/v1/product-feedback", module: "product-feedback", stability: "mvp" },
  { id: "productFeedback.list", method: "GET", path: "/api/v1/product-feedback", module: "product-feedback", stability: "mvp" },
  { id: "productFeedback.get", method: "GET", path: "/api/v1/product-feedback/:id", module: "product-feedback", stability: "mvp" },
  { id: "productFeedback.patch", method: "PATCH", path: "/api/v1/product-feedback/:id", module: "product-feedback", stability: "mvp" },
  {
    id: "productFeedback.attachmentContent",
    method: "GET",
    path: "/api/v1/product-feedback/:id/attachments/:attachmentId/content",
    module: "product-feedback",
    stability: "mvp"
  },

  { id: "jobs.get", method: "GET", path: "/api/v1/jobs/:jobId", module: "jobs", stability: "mvp" },
  { id: "jobs.events", method: "GET", path: "/api/v1/jobs/:jobId/events", module: "jobs", stability: "mvp" },

  { id: "debugging.listDevices", method: "GET", path: "/api/v1/debugging/devices", module: "debugging", stability: "mvp" },
  { id: "debugging.detectTarget", method: "POST", path: "/api/v1/debugging/targets/detect", module: "debugging", stability: "mvp" },
  { id: "debugging.listParameters", method: "GET", path: "/api/v1/debugging/parameters", module: "debugging", stability: "mvp" },
  { id: "debugging.listRuntimeNodes", method: "GET", path: "/api/v1/debugging/nodes", module: "debugging", stability: "mvp" },
  { id: "debugging.admin.listParameters", method: "GET", path: "/api/v1/debugging/admin/parameters", module: "debugging", stability: "mvp" },
  { id: "debugging.admin.createParameter", method: "POST", path: "/api/v1/debugging/admin/parameters", module: "debugging", stability: "mvp" },
  {
    id: "debugging.admin.updateParameter",
    method: "PATCH",
    path: "/api/v1/debugging/admin/parameters/:parameterId",
    module: "debugging",
    stability: "mvp"
  },
  {
    id: "debugging.admin.archiveParameter",
    method: "POST",
    path: "/api/v1/debugging/admin/parameters/:parameterId/archive",
    module: "debugging",
    stability: "mvp"
  },
  {
    id: "debugging.admin.restoreParameter",
    method: "POST",
    path: "/api/v1/debugging/admin/parameters/:parameterId/restore",
    module: "debugging",
    stability: "mvp"
  },
  {
    id: "debugging.admin.upsertBinding",
    method: "PUT",
    path: "/api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol",
    module: "debugging",
    stability: "mvp"
  },
  {
    id: "debugging.admin.patchBinding",
    method: "PATCH",
    path: "/api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol",
    module: "debugging",
    stability: "mvp"
  },
  {
    id: "debugging.admin.archiveBinding",
    method: "POST",
    path: "/api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol/archive",
    module: "debugging",
    stability: "mvp"
  },
  { id: "debugging.admin.listNodes", method: "GET", path: "/api/v1/debugging/admin/nodes", module: "debugging", stability: "mvp" },
  { id: "debugging.admin.createNode", method: "POST", path: "/api/v1/debugging/admin/nodes", module: "debugging", stability: "mvp" },
  {
    id: "debugging.admin.updateNode",
    method: "PATCH",
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
    id: "debugging.admin.listReloadBindings",
    method: "GET",
    path: "/api/v1/debugging/admin/reload-bindings",
    module: "debugging",
    stability: "mvp"
  },
  {
    id: "debugging.admin.upsertReloadBinding",
    method: "PUT",
    path: "/api/v1/debugging/admin/reload-bindings",
    module: "debugging",
    stability: "mvp"
  },
  {
    id: "debugging.admin.patchReloadBinding",
    method: "PATCH",
    path: "/api/v1/debugging/admin/reload-bindings",
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
