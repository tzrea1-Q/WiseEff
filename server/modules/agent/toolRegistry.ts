import { ApiError } from "../../shared/http/errors";
import type { Database } from "../../shared/database/client";
import type { KnowledgeEmbeddingClient } from "../knowledge/indexing/embeddingClient";
import type { ObjectStore } from "../logs/objectStore";
import type { AuthContext } from "../auth/types";
import type { TrustedInvocationContext } from "../auth/trustedInvocation";
import type { AgentToolName, AgentToolResult } from "./types";
import type { AgentToolMetadata } from "./toolMetadata";
import { requireAgentPermission, requireAgentProjectAccess } from "./policy";
import { createPerceptionTools } from "./tools/perceptionTools";
import { createActionTools } from "./tools/actionTools";
import { createKnowledgeTools } from "./tools/knowledgeTools";

const agentToolAuthorizationBrand = Symbol("wiseeff.agent-tool-authorization");

export type AgentToolExecutionContext = {
  auth: AuthContext;
  /** Present on server-owned Xiaoze executions; legacy direct tool tests may omit it until later migrations. */
  invocation?: TrustedInvocationContext;
  requestId: string;
  sessionId: string;
  projectId?: string;
  /** Set when executing after an `agent_approvals` decision so device writes can reuse the same row. */
  approvalId?: string;
};

/** Server-owned proof that the exact tool/context/payload tuple passed authorization. */
export type AgentToolAuthorization = {
  readonly [agentToolAuthorizationBrand]: true;
  readonly name: AgentToolName;
  readonly context: AgentToolExecutionContext;
  readonly payload: Record<string, unknown>;
};

/** A registered tool is its metadata (single declaration in `toolMetadata.ts`) plus the runtime implementation. */
export type AgentToolDefinition = AgentToolMetadata & {
  name: AgentToolName;
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
    throw new ApiError("FORBIDDEN", "Agent project access is required.", { projectId });
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

  function matchesAuthorization(
    authorization: AgentToolAuthorization | undefined,
    name: AgentToolName,
    context: AgentToolExecutionContext,
    payload: Record<string, unknown>
  ) {
    return (
      authorization?.[agentToolAuthorizationBrand] === true &&
      authorization.name === name &&
      authorization.context === context &&
      authorization.payload === payload
    );
  }

  return {
    list: () => tools,
    get: (name: string) => byName.get(name),
    require(name: string) {
      const tool = byName.get(name);
      if (!tool) {
        throw new ApiError("VALIDATION_FAILED", "Unknown Agent tool.", { toolName: name });
      }
      return tool;
    },
    authorize(name: AgentToolName, context: AgentToolExecutionContext, payload: Record<string, unknown>) {
      const tool = this.require(name);
      authorizeTool(tool, context, payload);
      return Object.freeze({
        [agentToolAuthorizationBrand]: true as const,
        name,
        context,
        payload
      });
    },
    async run(
      name: AgentToolName,
      context: AgentToolExecutionContext,
      payload: Record<string, unknown>,
      authorization?: AgentToolAuthorization
    ) {
      const tool = this.require(name);
      if (!matchesAuthorization(authorization, name, context, payload)) {
        authorizeTool(tool, context, payload);
      }
      return tool.run(context, payload);
    }
  };
}
