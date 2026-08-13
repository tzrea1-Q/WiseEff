import type { PerceptionChatModel, PerceptionModelToolCall } from "../modelTypes";

/** Scripted fake chat model for planning-graph tests and eval scenarios. */
export function fakeModelSequence(
  responses: Array<{ toolCalls?: PerceptionModelToolCall[]; content?: string; reasoning?: string }>
): PerceptionChatModel {
  let index = 0;
  return {
    async invoke() {
      const response = responses[index] ?? responses.at(-1)!;
      index += 1;
      return response;
    },
    async *stream() {
      const response = responses[index] ?? responses.at(-1)!;
      index += 1;
      if (response.toolCalls?.length) {
        yield { toolCalls: response.toolCalls };
        return;
      }
      if (response.reasoning) {
        for (const char of response.reasoning) {
          yield { reasoningDelta: char };
        }
      }
      if (response.content) {
        for (const char of response.content) {
          yield { answerDelta: char };
        }
      }
    }
  };
}

export function toolCall(name: string, args: Record<string, unknown>): PerceptionModelToolCall {
  return { id: `tc-${name}`, name, args };
}
