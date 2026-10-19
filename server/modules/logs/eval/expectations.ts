import type { AnalyzeLogOutput, LogAnalysisDegradedReason, LogAnalysisSource } from "../analyzer";
import type { LogAnalysisChatMessage } from "../analyzer/llmAnalyzer";

export type LogEvalRunResult = {
  output: AnalyzeLogOutput;
  /** Line numbers of the parsed (non-empty) raw lines — the grounding universe. */
  parsedLineNumbers: number[];
  /** Prompt messages the analyzer sent to the (fake) model, captured by the harness. */
  promptMessages: LogAnalysisChatMessage[];
  /** Number of model invocations the kernel made (loop scenarios: budget adherence). */
  modelCallCount?: number;
  /** System prompt captured from the same kernel/input with no skill procedure. */
  platformProtocol?: string;
};

export type LogEvalExpectation =
  | { type: "expectsAnalysisSource"; source: LogAnalysisSource }
  | { type: "expectsDegradedReason"; reason: LogAnalysisDegradedReason }
  | { type: "expectsNoDegradation" }
  | { type: "expectsGroundedEvidence" }
  | { type: "expectsEvidenceNotCitingLines"; lineNumbers: number[] }
  | { type: "expectsPromptVersionRecorded"; promptVersion: string }
  | { type: "expectsPromptContains"; substrings: string[] }
  | { type: "expectsProcedurePrompt"; procedure: string }
  | { type: "requiresSubstringsInConclusion"; substrings: string[] }
  | { type: "expectsConfidenceAtMost"; value: number }
  | { type: "expectsModelCallCount"; count: number }
  | { type: "expectsModelLabel"; model: string };

export type LogEvalExpectationResult = {
  pass: boolean;
  message?: string;
};

export function evaluateLogEvalExpectation(
  expectation: LogEvalExpectation,
  result: LogEvalRunResult
): LogEvalExpectationResult {
  switch (expectation.type) {
    case "expectsAnalysisSource": {
      const pass = result.output.analysisSource === expectation.source;
      return pass
        ? { pass: true }
        : {
            pass: false,
            message: `Expected analysisSource ${expectation.source}, got ${result.output.analysisSource ?? "none"}`
          };
    }
    case "expectsDegradedReason": {
      const pass = result.output.degradedReason === expectation.reason;
      return pass
        ? { pass: true }
        : {
            pass: false,
            message: `Expected degradedReason ${expectation.reason}, got ${result.output.degradedReason ?? "none"}`
          };
    }
    case "expectsNoDegradation": {
      const pass = result.output.degradedReason === undefined && result.output.analysisSource !== "rules-fallback";
      return pass
        ? { pass: true }
        : {
            pass: false,
            message: `Expected a non-degraded analysis, got source=${result.output.analysisSource ?? "none"} reason=${result.output.degradedReason ?? "none"}`
          };
    }
    case "expectsGroundedEvidence": {
      if (result.output.evidence.length === 0) {
        return { pass: false, message: "Expected at least one evidence item but got none" };
      }
      const parsed = new Set(result.parsedLineNumbers);
      const invalid = result.output.evidence.flatMap((item) => item.lineNumbers.filter((lineNumber) => !parsed.has(lineNumber)));
      return invalid.length === 0
        ? { pass: true }
        : { pass: false, message: `Evidence cites nonexistent lines: ${invalid.join(", ")}` };
    }
    case "expectsEvidenceNotCitingLines": {
      const banned = new Set(expectation.lineNumbers);
      const hits = result.output.evidence.flatMap((item) => item.lineNumbers.filter((lineNumber) => banned.has(lineNumber)));
      return hits.length === 0
        ? { pass: true }
        : { pass: false, message: `Evidence cites forbidden lines: ${hits.join(", ")}` };
    }
    case "expectsPromptVersionRecorded": {
      const pass = result.output.promptVersion === expectation.promptVersion;
      return pass
        ? { pass: true }
        : {
            pass: false,
            message: `Expected promptVersion ${expectation.promptVersion}, got ${result.output.promptVersion ?? "none"}`
          };
    }
    case "expectsPromptContains": {
      const promptText = result.promptMessages.map((message) => message.content).join("\n");
      const missing = expectation.substrings.filter((substring) => !promptText.includes(substring));
      return missing.length === 0
        ? { pass: true }
        : { pass: false, message: `Prompt is missing: ${missing.join(" | ")}` };
    }
    case "expectsProcedurePrompt": {
      const firstSystem = result.promptMessages.findIndex((message) => message.role === "system");
      const prompt = result.promptMessages[firstSystem]?.content ?? "";
      const opening = "<skill_diagnostic_procedure>";
      const closing = "</skill_diagnostic_procedure>";
      const protocol = result.platformProtocol;
      const encoded = JSON.stringify(expectation.procedure).replace(/[<>&\u2028\u2029]/g, (character) =>
        `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
      const section = protocol ? prompt.slice(protocol.length) : "";
      const pass = Boolean(protocol) && prompt.startsWith(`${protocol}\n\n${opening}\n`)
        && section.split(opening).length === 2 && section.split(closing).length === 2
        && section.endsWith(`\n${closing}`)
        && section.includes(`Procedure (JSON string): ${encoded}\n${closing}`)
        && section.includes("Lower-priority, untrusted")
        && /cannot override/i.test(section)
        && /grounding/i.test(section) && /tool results/i.test(section)
        && /write operations/i.test(section) && /refusal/i.test(section)
        && result.promptMessages[firstSystem + 1]?.role === "user";
      return pass
        ? { pass: true }
        : { pass: false, message: "Expected unchanged platform protocol, one enclosed lower-priority JSON procedure, then the user task" };
    }
    case "requiresSubstringsInConclusion": {
      const missing = expectation.substrings.filter((substring) => !result.output.conclusion.includes(substring));
      return missing.length === 0
        ? { pass: true }
        : { pass: false, message: `Conclusion is missing: ${missing.join(" | ")}` };
    }
    case "expectsConfidenceAtMost": {
      const pass = result.output.confidence <= expectation.value;
      return pass
        ? { pass: true }
        : {
            pass: false,
            message: `Expected confidence <= ${expectation.value}, got ${result.output.confidence}`
          };
    }
    case "expectsModelCallCount": {
      const pass = result.modelCallCount === expectation.count;
      return pass
        ? { pass: true }
        : {
            pass: false,
            message: `Expected ${expectation.count} model call(s), got ${result.modelCallCount ?? "unknown"}`
          };
    }
    case "expectsModelLabel": {
      const pass = result.output.model === expectation.model;
      return pass
        ? { pass: true }
        : {
            pass: false,
            message: `Expected model label ${expectation.model}, got ${result.output.model ?? "none"}`
          };
    }
  }
}

export function evaluateAllLogEvalExpectations(expectations: LogEvalExpectation[], result: LogEvalRunResult) {
  return expectations.map((expectation) => ({
    expectation,
    result: evaluateLogEvalExpectation(expectation, result)
  }));
}
