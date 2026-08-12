import type { LogAnalysisChatMessage, LogAnalysisChatModel } from "./llmAnalyzer";

/**
 * Deterministic scripted fake for the loop kernel's eval seam: each invoke pops
 * the next scripted response (a tool call, a final report, malformed text, or a
 * thrown error), so behavior-layer scenarios can drive exact tool-call sequences
 * plus the final conclusion with zero API cost. Captured calls let expectations
 * inspect the prompts the kernel actually sent.
 */
export type ScriptedModelResponse =
  | {
      /** Objects are JSON-stringified; strings are sent verbatim (to script malformed output). */
      content: unknown;
      usage?: { inputTokens?: number; outputTokens?: number };
    }
  | { error: Error };

export type ScriptedLogAnalysisModel = LogAnalysisChatModel & {
  /** One entry per invoke: the full message array the kernel sent. */
  calls: LogAnalysisChatMessage[][];
};

export function createScriptedLogAnalysisModel(script: ScriptedModelResponse[]): ScriptedLogAnalysisModel {
  let cursor = 0;
  const calls: LogAnalysisChatMessage[][] = [];

  return {
    calls,
    async invoke(messages) {
      calls.push([...messages]);
      const response = script[Math.min(cursor, script.length - 1)];
      cursor += 1;
      if (!response) {
        throw new Error("Scripted log-analysis model ran out of responses.");
      }
      if ("error" in response) {
        throw response.error;
      }
      const content = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      return {
        content,
        ...(response.usage ? { usage: response.usage } : {})
      };
    }
  };
}
