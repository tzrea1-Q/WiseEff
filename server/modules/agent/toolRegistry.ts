import { ApiError } from "../../shared/http/errors";
import type { Database } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import type { AgentToolName, AgentToolResult } from "./types";
import { requireAgentPermission, requireAgentProjectAccess } from "./policy";
import { createAuditTools } from "./tools/auditTools";
import { createDebuggingTools } from "./tools/debuggingTools";
import { createLogTools } from "./tools/logTools";
import { createParameterTools } from "./tools/parameterTools";

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
  run(context: AgentToolExecutionContext, payload: Record<string, unknown>): Promise<AgentToolResult>;
};

function readEffectiveProjectId(context: AgentToolExecutionContext, payload: Record<string, unknown>) {
  return typeof payload.projectId === "string" ? payload.projectId : context.projectId;
}

export function createAgentToolRegistry(options: { db: Database | { query: Database["query"] } }) {
  const tools = [
    ...createParameterTools(options),
    ...createLogTools(options),
    ...createAuditTools(options),
    ...createDebuggingTools(options)
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
    async run(name: AgentToolName, context: AgentToolExecutionContext, payload: Record<string, unknown>) {
      const tool = this.require(name);
      requireAgentPermission(context.auth, tool.permission);
      requireAgentProjectAccess(context.auth, readEffectiveProjectId(context, payload));
      return tool.run(context, payload);
    }
  };
}
