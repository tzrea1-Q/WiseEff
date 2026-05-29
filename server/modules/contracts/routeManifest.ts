import type { HttpMethod } from "../../shared/http/router";

export type RouteModule = "auth" | "audit" | "parameters" | "logs" | "jobs" | "debugging" | "operations" | "agent";
export type RouteStability = "mvp" | "commercial-readiness";

export type RouteManifestEntry = {
  id: string;
  method: HttpMethod;
  path: string;
  module: RouteModule;
  stability: RouteStability;
};

export const routeManifest = [
  { id: "auth.me", method: "GET", path: "/api/v1/me", module: "auth", stability: "mvp" },

  { id: "audit.createEvent", method: "POST", path: "/api/v1/audit-events", module: "audit", stability: "mvp" },
  { id: "audit.listEvents", method: "GET", path: "/api/v1/audit-events", module: "audit", stability: "mvp" },

  { id: "parameters.listProjects", method: "GET", path: "/api/v1/projects", module: "parameters", stability: "mvp" },
  { id: "parameters.listProjectModules", method: "GET", path: "/api/v1/projects/:projectId/modules", module: "parameters", stability: "mvp" },
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

  { id: "logs.uploadFile", method: "POST", path: "/api/v1/log-files", module: "logs", stability: "mvp" },
  { id: "logs.upload", method: "POST", path: "/api/v1/logs", module: "logs", stability: "mvp" },
  { id: "logs.list", method: "GET", path: "/api/v1/logs", module: "logs", stability: "mvp" },
  { id: "logs.get", method: "GET", path: "/api/v1/logs/:logId", module: "logs", stability: "mvp" },
  { id: "logs.listRuns", method: "GET", path: "/api/v1/logs/:logId/runs", module: "logs", stability: "mvp" },
  { id: "logs.rerun", method: "POST", path: "/api/v1/logs/:logId/rerun", module: "logs", stability: "mvp" },
  { id: "logs.archive", method: "POST", path: "/api/v1/logs/:logId/archive", module: "logs", stability: "mvp" },
  { id: "logs.unarchive", method: "POST", path: "/api/v1/logs/:logId/unarchive", module: "logs", stability: "mvp" },
  { id: "logs.feedback", method: "POST", path: "/api/v1/logs/:logId/feedback", module: "logs", stability: "mvp" },

  { id: "jobs.get", method: "GET", path: "/api/v1/jobs/:jobId", module: "jobs", stability: "mvp" },
  { id: "jobs.events", method: "GET", path: "/api/v1/jobs/:jobId/events", module: "jobs", stability: "mvp" },

  { id: "debugging.listDevices", method: "GET", path: "/api/v1/debugging/devices", module: "debugging", stability: "mvp" },
  { id: "debugging.detectTarget", method: "POST", path: "/api/v1/debugging/targets/detect", module: "debugging", stability: "mvp" },
  { id: "debugging.listParameters", method: "GET", path: "/api/v1/debugging/parameters", module: "debugging", stability: "mvp" },
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

  { id: "agent.createSession", method: "POST", path: "/api/v1/agent/sessions", module: "agent", stability: "mvp" },
  { id: "agent.sendMessage", method: "POST", path: "/api/v1/agent/sessions/:sessionId/messages", module: "agent", stability: "mvp" },
  {
    id: "agent.runToolCall",
    method: "POST",
    path: "/api/v1/agent/sessions/:sessionId/tool-calls/:toolCallId/run",
    module: "agent",
    stability: "mvp"
  },
  {
    id: "agent.approveToolCall",
    method: "POST",
    path: "/api/v1/agent/sessions/:sessionId/approvals/:approvalId/approve",
    module: "agent",
    stability: "mvp"
  },
  {
    id: "agent.rejectToolCall",
    method: "POST",
    path: "/api/v1/agent/sessions/:sessionId/approvals/:approvalId/reject",
    module: "agent",
    stability: "mvp"
  },

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
