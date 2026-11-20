import type { LogAnalysisChatMessage, LogAnalysisChatModel, LogAnalysisChatResponse, LogAnalysisNativeCall } from "./llmAnalyzer";

/** Let both offline models drive the same decisions through either wire protocol. */
export function asNativeModelResponse(payload: unknown, response: LogAnalysisChatResponse, id: string) {
  if (!payload || typeof payload !== "object" || !("action" in payload)) return response;
  const { action, ...fields } = payload as Record<string, unknown>;
  if (action === "final") {
    return { ...response, content: "", toolCalls: [{ id, name: "final_report", arguments: JSON.stringify(fields) }] };
  }
  if (action === "tool" && typeof fields.tool === "string") {
    return { ...response, content: "", toolCalls: [{ id, name: fields.tool, arguments: JSON.stringify(fields.notes === undefined
      ? fields.args ?? {} : { ...(fields.args as object), notes: fields.notes }) }] };
  }
  return response;
}

/**
 * Deterministic scripted fake for the loop kernel's eval seam: each invoke pops
 * the next scripted response (a tool call, a final report, malformed text, or a
 * thrown error), so behavior-layer scenarios can drive exact tool-call sequences
 * plus the final conclusion with zero API cost. Captured calls let expectations
 * inspect the prompts the kernel actually sent.
 */
export type ScriptedModelResponse =
  | ({
      /** Objects are JSON-stringified; strings are sent verbatim (to script malformed output). */
      usage?: { inputTokens?: number; outputTokens?: number };
    } & ({ content: unknown; toolCalls?: never } | { content?: string; toolCalls: LogAnalysisNativeCall[] }))
  | { error: Error };

export type ScriptedLogAnalysisModel = LogAnalysisChatModel & {
  invokeTools: NonNullable<LogAnalysisChatModel["invokeTools"]>;
  /** One entry per invoke: the full message array the kernel sent. */
  calls: LogAnalysisChatMessage[][];
};

export function createScriptedLogAnalysisModel(script: ScriptedModelResponse[]): ScriptedLogAnalysisModel {
  let cursor = 0;
  const calls: LogAnalysisChatMessage[][] = [];

  function next(messages: LogAnalysisChatMessage[]) {
    calls.push([...messages]);
    const response = script[Math.min(cursor, script.length - 1)];
    cursor += 1;
    if (!response) throw new Error("Scripted log-analysis model ran out of responses.");
    if ("error" in response) throw response.error;
    return response;
  }

  function asText(response: Exclude<ScriptedModelResponse, { error: Error }>): LogAnalysisChatResponse {
    return { content: typeof response.content === "string" ? response.content : JSON.stringify(response.content ?? {}),
      ...(response.usage ? { usage: response.usage } : {}) };
  }

  return {
    calls,
    async invoke(messages) {
      return asText(next(messages));
    },
    async invokeTools(messages) {
      const response = next(messages);
      return response.toolCalls ? { ...asText(response), content: response.content ?? "", toolCalls: response.toolCalls }
        : asNativeModelResponse(response.content, asText(response), `script-${cursor}`);
    }
  };
}
