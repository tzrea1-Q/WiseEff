import type { AgentContext, AgentSession, AgentTurn } from "@/domain/agent/types";

export interface AgentGateway {
  startSession(context: AgentContext): Promise<AgentSession>;
  sendMessage(sessionId: string, message: string): Promise<AgentTurn>;
  runAction(sessionId: string, actionId: string, payload: Record<string, unknown>): Promise<AgentTurn>;
  approveToolCall(sessionId: string, approvalId: string): Promise<AgentTurn>;
}
