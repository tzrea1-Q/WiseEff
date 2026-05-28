import type { PageKey } from "@/appConfig";
import type { AgentGateway } from "@/application/ports/AgentGateway";
import type { AgentContext } from "@/domain/agent/types";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";

export function resolveAgentGateway(mode: WiseEffRuntimeMode, gateway?: AgentGateway) {
  if (mode === "api" && !gateway) {
    throw new Error("Agent gateway is required in api runtime mode.");
  }

  return gateway;
}

export function buildAgentContext(input: { path: string; pageKey: PageKey; projectId?: string; roleId?: string }): AgentContext {
  return {
    path: input.path,
    pageKey: input.pageKey,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.roleId ? { roleId: input.roleId } : {})
  };
}
