import { ChatOpenAI } from "@langchain/openai";

import { extractJsonPayload } from "../analyzer/llmAnalyzer";
import {
  createDeterministicQualityJudge,
  qualityJudgeOutputSchema,
  type LogAnalysisQualityJudge
} from "./qualityEval";

export type LogAnalysisJudgeEnv = {
  LOG_ANALYSIS_JUDGE_API_BASE_URL?: string;
  LOG_ANALYSIS_JUDGE_MODEL?: string;
  LOG_ANALYSIS_JUDGE_API_KEY?: string;
  LOG_ANALYSIS_JUDGE_API_TIMEOUT_MS: number;
};

function readNonBlank(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function buildJudgePrompt(input: {
  conclusion: string;
  impact: string;
  suggestedActions: string[];
  evidenceInferences: string[];
  rootCauseCategory: string;
  rootCausePoints: string[];
  expectedActions: string[];
}): string {
  return [
    "You are grading one log-analysis report against an expert annotation. Score honestly; do not reward confident wording.",
    "Rubric:",
    "- rootCauseScore (0..1): fraction of the expert root-cause points the report's conclusion actually covers (semantic match, not word match).",
    `- categoryMatch (boolean): does the conclusion land in the root-cause category "${input.rootCauseCategory}"?`,
    "- actionsScore (0..1): fraction of the expected actions covered by the report's suggested actions.",
    "Respond with a single strict JSON object and nothing else:",
    '{"rootCauseScore": number, "categoryMatch": boolean, "actionsScore": number, "reasoning": string (<= 400 chars)}',
    "",
    "Expert root-cause points:",
    ...input.rootCausePoints.map((point) => `- ${point}`),
    "",
    "Expected actions:",
    ...input.expectedActions.map((action) => `- ${action}`),
    "",
    "Report conclusion:",
    input.conclusion,
    "",
    "Report impact:",
    input.impact,
    "",
    "Report evidence inferences:",
    ...input.evidenceInferences.map((inference) => `- ${inference}`),
    "",
    "Report suggested actions:",
    ...input.suggestedActions.map((action) => `- ${action}`)
  ].join("\n");
}

/** Rubric-guided LLM-as-judge on the `LOG_ANALYSIS_JUDGE_*` env family (OpenAI-compatible). */
export function createHttpQualityJudge(env: LogAnalysisJudgeEnv): LogAnalysisQualityJudge {
  const model = readNonBlank(env.LOG_ANALYSIS_JUDGE_MODEL) ?? "gpt-4o-mini";
  const chat = new ChatOpenAI({
    model,
    apiKey: env.LOG_ANALYSIS_JUDGE_API_KEY,
    temperature: 0,
    timeout: env.LOG_ANALYSIS_JUDGE_API_TIMEOUT_MS,
    maxTokens: 512,
    configuration: { baseURL: env.LOG_ANALYSIS_JUDGE_API_BASE_URL }
  });

  return {
    label: `llm-judge:${model}`,
    async score({ goldenCase, output }) {
      const prompt = buildJudgePrompt({
        conclusion: output.conclusion,
        impact: output.impact,
        suggestedActions: output.suggestedActions,
        evidenceInferences: output.evidence.map((item) => item.inference),
        rootCauseCategory: goldenCase.rootCauseCategory,
        rootCausePoints: goldenCase.rootCausePoints,
        expectedActions: goldenCase.expectedActions
      });
      const response = await chat.invoke([{ role: "user", content: prompt }]);
      const content = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      const parsed = qualityJudgeOutputSchema.safeParse(JSON.parse(extractJsonPayload(content)));
      if (!parsed.success) {
        throw new Error(`Judge returned an invalid score payload: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
      }
      return parsed.data;
    }
  };
}

/**
 * Judge resolution: deterministic analysis mode always uses the deterministic
 * stub (zero API cost); real mode uses the LLM judge when `LOG_ANALYSIS_JUDGE_*`
 * is configured and otherwise falls back to the stub (stated in the report label).
 */
export function resolveQualityJudge(
  env: LogAnalysisJudgeEnv & { LOG_ANALYSIS_DETERMINISTIC: boolean }
): LogAnalysisQualityJudge {
  if (env.LOG_ANALYSIS_DETERMINISTIC) {
    return createDeterministicQualityJudge();
  }
  if (readNonBlank(env.LOG_ANALYSIS_JUDGE_API_BASE_URL) && readNonBlank(env.LOG_ANALYSIS_JUDGE_API_KEY)) {
    return createHttpQualityJudge(env);
  }
  return createDeterministicQualityJudge();
}
