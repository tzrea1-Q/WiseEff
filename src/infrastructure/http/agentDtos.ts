import type { AgentApproval, AgentMessage, AgentSession, AgentToolCall, AgentTurn } from "@/domain/agent/types";

export type AgentMessageDto = AgentMessage;
export type AgentSessionDto = AgentSession;
export type AgentToolCallDto = AgentToolCall;
export type AgentApprovalDto = AgentApproval;
export type AgentTurnDto = AgentTurn;

export function agentMessageFromDto(dto: AgentMessageDto): AgentMessage {
  return { ...dto };
}

export function agentSessionFromDto(dto: AgentSessionDto): AgentSession {
  return { ...dto, messages: dto.messages.map(agentMessageFromDto) };
}

export function agentToolCallFromDto(dto: AgentToolCallDto): AgentToolCall {
  return { ...dto };
}

export function agentApprovalFromDto(dto: AgentApprovalDto): AgentApproval {
  return { ...dto };
}

export function agentTurnFromDto(dto: AgentTurnDto): AgentTurn {
  return {
    session: agentSessionFromDto(dto.session),
    messages: dto.messages.map(agentMessageFromDto),
    toolCalls: dto.toolCalls.map(agentToolCallFromDto),
    approvals: dto.approvals.map(agentApprovalFromDto)
  };
}
