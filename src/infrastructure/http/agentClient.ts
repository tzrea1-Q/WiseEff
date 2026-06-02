import type { AgentGateway } from "@/application/ports/AgentGateway";
import { createApiClient } from "./apiClient";
import { agentSessionFromDto, agentTurnFromDto, type AgentTurnDto } from "./agentDtos";
import { createDefaultApiClient } from "./defaultApiClient";

type ApiClient = ReturnType<typeof createApiClient>;

type TurnEnvelope = { turn: AgentTurnDto };

export function createHttpAgentGateway(apiClient: ApiClient = createDefaultApiClient()): AgentGateway {
  return {
    async startSession(context) {
      const response = await apiClient.post<TurnEnvelope>("/api/v1/agent/sessions", { context });
      return agentSessionFromDto(response.turn.session);
    },

    async sendMessage(sessionId, message) {
      const response = await apiClient.post<TurnEnvelope>(`/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/messages`, { message });
      return agentTurnFromDto(response.turn);
    },

    async runAction(sessionId, actionId, payload) {
      const response = await apiClient.post<TurnEnvelope>(
        `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/tool-calls/${encodeURIComponent(actionId)}/run`,
        { payload }
      );
      return agentTurnFromDto(response.turn);
    },

    async approveToolCall(sessionId, approvalId) {
      const response = await apiClient.post<TurnEnvelope>(
        `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}/approve`,
        { expectedToolCallStatus: "pending_approval" }
      );
      return agentTurnFromDto(response.turn);
    },

    async rejectToolCall(sessionId, approvalId, reason) {
      const response = await apiClient.post<TurnEnvelope>(
        `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}/reject`,
        reason ? { reason } : {}
      );
      return agentTurnFromDto(response.turn);
    }
  };
}
