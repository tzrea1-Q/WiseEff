import type { Database } from "../../../shared/database/client";
import type { AuthContext } from "../../auth/types";
import { createAgentOrchestrator } from "../orchestrator";
import {
  createAgentSession,
  getAgentSession,
  getAgentToolCall,
  updateAgentToolCall
} from "../repository";
import { createAgentToolRegistry } from "../toolRegistry";
import type { AgentCitation, AgentToolName } from "../types";

export type ApprovalBridgeOrchestrator = {
  createApproval(input: {
    auth: AuthContext;
    requestId: string;
    sessionId: string;
    toolName: AgentToolName;
    payload: Record<string, unknown>;
    pageKey?: string;
    projectId?: string;
  }): Promise<{ approvalId: string; toolCallId: string }>;
  approveToolCall(input: { auth: AuthContext; requestId: string; approvalId: string; reason: string }): Promise<{
    messages: Array<{ content: string }>;
  }>;
  rejectToolCall(input: { auth: AuthContext; requestId: string; approvalId: string; reason: string }): Promise<{
    messages: Array<{ content: string }>;
  }>;
  updateToolCallPayload?(input: {
    auth: AuthContext;
    toolCallId: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
};

export type ApprovalBridgeBeginInput = {
  auth: AuthContext;
  requestId: string;
  sessionId: string;
  toolName: AgentToolName;
  payload: Record<string, unknown>;
  citations: AgentCitation[];
  pageKey?: string;
  projectId?: string;
};

export type ApprovalBridgeBeginResult = {
  approvalId: string;
  toolCallId: string;
  toolName: AgentToolName;
  payload: Record<string, unknown>;
  citations: AgentCitation[];
};

export type ApprovalBridgeResumeInput = {
  auth: AuthContext;
  requestId: string;
  approvalId: string;
  decision: "approve" | "reject";
  editedArgs?: Record<string, unknown>;
  reason?: string;
};

export type ApprovalBridgeResumeResult = {
  text: string;
};

export function createApprovalBridge(options: { orchestrator: ApprovalBridgeOrchestrator }) {
  const pendingToolCalls = new Map<string, string>();

  return {
    async begin(input: ApprovalBridgeBeginInput): Promise<ApprovalBridgeBeginResult> {
      const created = await options.orchestrator.createApproval({
        auth: input.auth,
        requestId: input.requestId,
        sessionId: input.sessionId,
        toolName: input.toolName,
        payload: input.payload,
        pageKey: input.pageKey,
        projectId: input.projectId
      });
      pendingToolCalls.set(created.approvalId, created.toolCallId);
      return {
        approvalId: created.approvalId,
        toolCallId: created.toolCallId,
        toolName: input.toolName,
        payload: input.payload,
        citations: input.citations
      };
    },
    async resume(input: ApprovalBridgeResumeInput): Promise<ApprovalBridgeResumeResult> {
      if (input.decision === "reject") {
        const turn = await options.orchestrator.rejectToolCall({
          auth: input.auth,
          requestId: input.requestId,
          approvalId: input.approvalId,
          reason: input.reason ?? "Rejected from Xiaoze chat."
        });
        return { text: turn.messages.at(-1)?.content ?? "The proposed action was rejected." };
      }

      const toolCallId = pendingToolCalls.get(input.approvalId);
      if (input.editedArgs && toolCallId && options.orchestrator.updateToolCallPayload) {
        await options.orchestrator.updateToolCallPayload({
          auth: input.auth,
          toolCallId,
          payload: input.editedArgs
        });
      }

      const turn = await options.orchestrator.approveToolCall({
        auth: input.auth,
        requestId: input.requestId,
        approvalId: input.approvalId,
        reason: input.reason ?? "Approved from Xiaoze chat."
      });
      return { text: turn.messages.at(-1)?.content ?? "The proposed action was approved and executed." };
    }
  };
}

export function createOrchestratorApprovalBridge(options: {
  db: Database;
  toolRegistry?: ReturnType<typeof createAgentToolRegistry>;
}) {
  const registry = options.toolRegistry ?? createAgentToolRegistry({ db: options.db });
  const orchestrator = createAgentOrchestrator({ db: options.db, toolRegistry: registry });

  return createApprovalBridge({
    orchestrator: {
      async createApproval(input) {
        const existingSession = await getAgentSession(options.db, input.auth.organization.id, input.sessionId);
        if (!existingSession) {
          await createAgentSession(options.db, {
            id: input.sessionId,
            organizationId: input.auth.organization.id,
            projectId: input.projectId,
            actorUserId: input.auth.user.id,
            pageKey: input.pageKey ?? "xiaoze",
            roleId: input.auth.roles[0]?.roleId,
            context: {
              path: "/",
              pageKey: input.pageKey ?? "xiaoze",
              projectId: input.projectId,
              roleId: input.auth.roles[0]?.roleId
            },
            title: "Xiaoze Agent Session"
          });
        }

        const definition = registry.require(input.toolName);
        const toolCall = await orchestrator.recordToolRequestForTest({
          auth: input.auth,
          requestId: input.requestId,
          sessionId: input.sessionId,
          request: {
            name: input.toolName,
            label: definition.label,
            payload: input.payload
          }
        });

        const persisted = await getAgentToolCall(options.db, input.auth.organization.id, toolCall.id);
        const approvalId = persisted?.approvalId;
        if (!approvalId) {
          throw new Error(`Agent approval was not created for tool call ${toolCall.id}.`);
        }
        return { approvalId, toolCallId: toolCall.id };
      },
      approveToolCall(input) {
        return orchestrator.approveToolCall(input);
      },
      rejectToolCall(input) {
        return orchestrator.rejectToolCall(input);
      },
      async updateToolCallPayload(input) {
        const updated = await updateAgentToolCall(options.db, input.auth.organization.id, input.toolCallId, {
          payload: input.payload
        });
        if (!updated) {
          throw new Error("Agent tool call payload could not be updated.");
        }
      }
    }
  });
}
