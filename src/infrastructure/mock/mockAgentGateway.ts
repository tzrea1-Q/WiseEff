import { createAgentPlan } from "@/appConfig";
import type { AgentGateway } from "@/application/ports/AgentGateway";
import type {
  AgentApproval,
  AgentContext,
  AgentMessage,
  AgentSession,
  AgentToolCall,
  AgentTurn
} from "@/domain/agent/types";

function nowIso(): string {
  return new Date().toISOString();
}

function createMessage(role: AgentMessage["role"], content: string): AgentMessage {
  return {
    id: `agent-msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    createdAt: nowIso()
  };
}

function toolNameForAction(actionId: string): AgentToolCall["name"] {
  switch (actionId) {
    case "scan-orphans":
      return "parameter.scanOrphans";
    case "draft-cleanup":
      return "parameter.draftCleanupPlan";
    case "summarize-review":
    case "filter-high-risk":
    case "advance-review":
      return "parameter.summarizeReviewQueue";
    case "draft-parameter-change":
      return "parameter.submitChangeDraft";
    case "advance-log":
      return "log.explainRootCause";
    case "make-checklist":
      return "log.generateChecklist";
    case "sync-comparison":
    case "connect-device":
    case "push-debug-value":
      return "debugging.recommendTargetValues";
    case "audit-scan":
    case "summarize-audit":
    case "preview-import":
    case "summarize-comparison":
    case "platform-tour":
    default:
      return "audit.summarizeRecentEvents";
  }
}

function toolCallsForPath(path: string): AgentToolCall[] {
  return createAgentPlan(path).actions.map((action) => ({
    id: `tool-${action.id}`,
    name: toolNameForAction(action.id),
    label: action.label,
    payload: { actionId: action.id, path },
    requiresApproval: action.requiresConfirm
  }));
}

function approvalsForToolCalls(toolCalls: AgentToolCall[]): AgentApproval[] {
  return toolCalls
    .filter((toolCall) => toolCall.requiresApproval)
    .map((toolCall) => ({
      id: `approval-${toolCall.id}`,
      toolCallId: toolCall.id,
      title: "确认执行 Agent 动作",
      message: `${toolCall.label} 会改变当前业务状态，需要人工确认。`
    }));
}

function createTurn(session: AgentSession, userMessage: string): AgentTurn {
  const plan = createAgentPlan(session.context.path);
  const user = createMessage("user", userMessage);
  const assistant = createMessage("assistant", plan.contextSummary);
  const toolCalls = toolCallsForPath(session.context.path);
  const nextSession = {
    ...session,
    messages: [...session.messages, user, assistant]
  };

  return {
    session: nextSession,
    messages: [assistant],
    toolCalls,
    approvals: approvalsForToolCalls(toolCalls)
  };
}

export function createMockAgentGateway(): AgentGateway {
  const sessions = new Map<string, AgentSession>();

  function getSession(sessionId: string): AgentSession {
    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error(`Agent session not found: ${sessionId}`);
    }

    return session;
  }

  return {
    async startSession(context: AgentContext) {
      const session: AgentSession = {
        id: `agent-session-${sessions.size + 1}`,
        context,
        messages: [createMessage("system", createAgentPlan(context.path).contextTitle)]
      };
      sessions.set(session.id, session);

      return session;
    },

    async sendMessage(sessionId: string, message: string) {
      const turn = createTurn(getSession(sessionId), message);
      sessions.set(sessionId, turn.session);

      return turn;
    },

    async runAction(sessionId: string, actionId: string, payload: Record<string, unknown>) {
      const turn = createTurn(getSession(sessionId), `执行 ${actionId}`);
      const matchingToolCall = turn.toolCalls.find((toolCall) => toolCall.payload.actionId === actionId);
      const nextTurn = {
        ...turn,
        toolCalls: matchingToolCall
          ? [
              {
                ...matchingToolCall,
                payload: { ...matchingToolCall.payload, ...payload }
              }
            ]
          : [],
        approvals: matchingToolCall?.requiresApproval
          ? approvalsForToolCalls([
              {
                ...matchingToolCall,
                payload: { ...matchingToolCall.payload, ...payload }
              }
            ])
          : []
      };
      sessions.set(sessionId, nextTurn.session);

      return nextTurn;
    },

    async approveToolCall(sessionId: string, approvalId: string) {
      const turn = createTurn(getSession(sessionId), `已确认 ${approvalId}`);
      sessions.set(sessionId, turn.session);

      return turn;
    }
  };
}
