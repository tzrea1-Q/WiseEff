import { ApiError } from "../../../shared/http/errors";
import type { AgentToolResult } from "../types";

export type PerceptionToolDescriptor = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
};

export type PerceptionAgentContext = {
  projectId?: string;
  pageKey?: string;
};

export type PerceptionAgentRunInput = {
  message: string;
  context: PerceptionAgentContext;
};

export type PerceptionAgentRunResult = {
  text: string;
  citations: AgentToolResult["citations"];
};

export type PerceptionModelToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type PerceptionModelResponse = {
  content?: string;
  toolCalls?: PerceptionModelToolCall[];
};

export type PerceptionChatModel = {
  invoke(messages: unknown[]): Promise<PerceptionModelResponse>;
};

const SYSTEM_PROMPT = [
  "You are Xiaoze (小泽), WiseEff's read-only perception assistant.",
  "Use only the provided WiseEff perception tools to ground answers.",
  "Never claim a write, merge, or device action occurred.",
  "Cite sources from tool results when summarizing.",
  "If a tool returns FORBIDDEN or access is denied, answer that the user is not permitted and do not reveal protected data."
].join(" ");

function isForbiddenError(error: unknown) {
  return error instanceof ApiError && error.code === "FORBIDDEN";
}

function mergeToolPayload(
  args: Record<string, unknown>,
  context: PerceptionAgentContext
): Record<string, unknown> {
  return {
    ...args,
    ...(typeof args.projectId === "string" ? {} : context.projectId ? { projectId: context.projectId } : {})
  };
}

export function createPerceptionAgent(options: {
  model: PerceptionChatModel;
  runTool: (name: string, payload: Record<string, unknown>) => Promise<AgentToolResult>;
  listTools: () => PerceptionToolDescriptor[];
}) {
  return {
    async run(input: PerceptionAgentRunInput): Promise<PerceptionAgentRunResult> {
      const messages: unknown[] = [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            input.message,
            input.context.pageKey ? `\nCurrent page: ${input.context.pageKey}` : "",
            input.context.projectId ? `\nCurrent project: ${input.context.projectId}` : ""
          ].join("")
        }
      ];
      const citations: AgentToolResult["citations"] = [];

      for (let turn = 0; turn < 6; turn += 1) {
        const response = await options.model.invoke(messages);
        if (response.toolCalls?.length) {
          messages.push({ role: "assistant", tool_calls: response.toolCalls });
          for (const call of response.toolCalls) {
            const payload = mergeToolPayload(call.args, input.context);
            try {
              const result = await options.runTool(call.name, payload);
              citations.push(...result.citations);
              messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: JSON.stringify({ summary: result.summary, data: result.data, citations: result.citations })
              });
            } catch (error) {
              if (isForbiddenError(error)) {
                messages.push({
                  role: "tool",
                  tool_call_id: call.id,
                  content: JSON.stringify({ error: "FORBIDDEN", message: "You are not permitted to access this data." })
                });
              } else {
                throw error;
              }
            }
          }
          continue;
        }

        return {
          text: response.content ?? "",
          citations
        };
      }

      return {
        text: "I could not complete the request within the allowed tool turns.",
        citations
      };
    },
    listTools: options.listTools
  };
}

export function wrapLangChainChatModel(model: {
  invoke(input: unknown): Promise<{ content?: unknown; tool_calls?: Array<{ id?: string; name: string; args: Record<string, unknown> }> }>;
}): PerceptionChatModel {
  return {
    async invoke(messages) {
      const response = await model.invoke(messages);
      const content = typeof response.content === "string" ? response.content : undefined;
      const toolCalls = response.tool_calls?.map((call, index) => ({
        id: call.id ?? `tool-${index}`,
        name: call.name,
        args: call.args
      }));
      return { content, toolCalls };
    }
  };
}
