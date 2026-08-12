import { ApiError } from "../../shared/http/errors";
import type { Database } from "../../shared/database/client";
import type { KnowledgeEmbeddingClient } from "../knowledge/indexing/embeddingClient";
import type { ObjectStore } from "../logs/objectStore";
import type { AuthContext } from "../auth/types";
import type { AgentToolName, AgentToolResult } from "./types";
import { requireAgentPermission, requireAgentProjectAccess } from "./policy";
import { createPerceptionTools } from "./tools/perceptionTools";
import { createActionTools } from "./tools/actionTools";
import { createKnowledgeTools } from "./tools/knowledgeTools";

export type AgentToolExecutionContext = {
  auth: AuthContext;
  requestId: string;
  sessionId: string;
  projectId?: string;
};

export type AgentToolDefinition = {
  name: AgentToolName;
  label: string;
  kind: "read" | "preparation" | "mutating";
  permission: Parameters<typeof requireAgentPermission>[1];
  requiresApproval: boolean;
  /**
   * Project-scoped tools (default) require an effective project or a global
   * admin; organization-scoped tools (e.g. knowledge) rely on their
   * permission plus the org isolation their services already enforce.
   */
  scope?: "project" | "organization";
  run(context: AgentToolExecutionContext, payload: Record<string, unknown>): Promise<AgentToolResult>;
};

function readEffectiveProjectId(context: AgentToolExecutionContext, payload: Record<string, unknown>) {
  return typeof payload.projectId === "string" ? payload.projectId : context.projectId;
}

function requireScopedProjectOrGlobalAdmin(context: AgentToolExecutionContext, projectId?: string) {
  const hasGlobalAdmin = context.auth.roles.some(
    (role) => (role.roleId === "admin" || role.roleId === "platform-admin") && role.projectId === null
  );
  if (!projectId && !hasGlobalAdmin) {
    throw new ApiError("FORBIDDEN", "Agent project access is required.", 403, { projectId });
  }
}

function authorizeTool(tool: AgentToolDefinition, context: AgentToolExecutionContext, payload: Record<string, unknown>) {
  requireAgentPermission(context.auth, tool.permission);
  if (tool.scope === "organization") {
    return;
  }
  const projectId = readEffectiveProjectId(context, payload);
  requireScopedProjectOrGlobalAdmin(context, projectId);
  requireAgentProjectAccess(context.auth, projectId);
}

export function createAgentToolRegistry(options: {
  db: Database;
  objectStore?: ObjectStore;
  knowledgeEmbeddingClient?: KnowledgeEmbeddingClient;
}) {
  const tools = [
    ...createPerceptionTools(options),
    ...createKnowledgeTools({ db: options.db, knowledgeEmbeddingClient: options.knowledgeEmbeddingClient }),
    ...createActionTools(options)
  ];
  const byName = new Map<string, AgentToolDefinition>(tools.map((tool) => [tool.name, tool]));

  return {
    list: () => tools,
    get: (name: string) => byName.get(name),
    require(name: string) {
      const tool = byName.get(name);
      if (!tool) {
        throw new ApiError("VALIDATION_FAILED", "Unknown Agent tool.", 400, { toolName: name });
      }
      return tool;
    },
    authorize(name: AgentToolName, context: AgentToolExecutionContext, payload: Record<string, unknown>) {
      const tool = this.require(name);
      authorizeTool(tool, context, payload);
    },
    async run(name: AgentToolName, context: AgentToolExecutionContext, payload: Record<string, unknown>) {
      const tool = this.require(name);
      authorizeTool(tool, context, payload);
      return tool.run(context, payload);
    }
  };
}
