import type { AnalyzeLogOutput, LogAnalysisDegradedReason, LogAnalysisSource } from "../analyzer";
import type { LogAnalysisChatMessage } from "../analyzer/llmAnalyzer";
import type { LogAnalysisTraceStep } from "../traceTypes";

type SourceLocation = { snapshotId: string; path: string; line: number };

export type LogEvalRunResult = {
  trace?: LogAnalysisTraceStep[];
  output: AnalyzeLogOutput;
  /** Line numbers of the parsed (non-empty) raw lines — the grounding universe. */
  parsedLineNumbers: number[];
  /** Prompt messages the analyzer sent to the (fake) model, captured by the harness. */
  promptMessages: LogAnalysisChatMessage[];
  /** Number of model invocations the kernel made (loop scenarios: budget adherence). */
  modelCallCount?: number;
  /** System prompt captured from the same kernel/input with no skill procedure. */
  platformProtocol?: string;
  /** Source locations actually returned by the bound source tool in this run. */
  returnedSourceLocations?: SourceLocation[];
};

export type LogEvalExpectation =
  | { type: "expectsTrace"; kinds: LogAnalysisTraceStep["kind"][] }
  | { type: "expectsPrivateTrace"; forbidden: string[] }
  | { type: "expectsTraceArguments"; tool: string; arguments: LogAnalysisTraceStep["arguments"] }
  | { type: "expectsAnalysisSource"; source: LogAnalysisSource }
  | { type: "expectsDegradedReason"; reason: LogAnalysisDegradedReason }
  | { type: "expectsNoDegradation" }
  | { type: "expectsGroundedEvidence" }
  | { type: "expectsSourceLocations"; locations: SourceLocation[] }
  | { type: "expectsSourceToolBounds"; tool: "search_source" | "read_source_range"; maxBytes: number;
      maxItems?: number; expectedItems?: number; maxExcerptChars?: number; expectedLines?: number; endLine?: number; truncated: boolean }
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
    case "expectsTrace": {
      const trace = result.trace ?? [];
      const pass = trace.length > 0 && trace.length <= 200 && trace.every((step, index) => step.index === index + 1)
        && trace.every((step) => step.resultBytes >= 0 && step.lines.length <= 50)
        && expectation.kinds.every((kind) => trace.some((step) => step.kind === kind))
        && trace.some((step) => step.lines.length > 0);
      return pass ? { pass: true } : { pass: false, message: "Expected ordered bounded trace with every required step kind" };
    }
    case "expectsPrivateTrace": {
      const serialized = JSON.stringify(result.trace ?? []);
      const pass = Boolean(result.trace?.length) && expectation.forbidden.every((text) => !serialized.includes(text))
        && result.trace!.every((step) => Object.values(step.arguments).every((value) => typeof value !== "string" || value.length <= 120));
      return pass ? { pass: true } : { pass: false, message: "Trace leaked forbidden prompt content or unbounded argument text" };
    }
    case "expectsTraceArguments": {
      const pass = Boolean(result.trace?.some((step) => step.tool === expectation.tool
        && Object.entries(expectation.arguments).every(([key, value]) => step.arguments[key] === value)));
      return pass ? { pass: true } : { pass: false, message: `Expected bounded argument summary for ${expectation.tool}` };
    }
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
      const unseenSource = result.output.evidence.some((item) => item.sourceLocation &&
        !result.returnedSourceLocations?.some((location) => location.snapshotId === item.sourceLocation?.snapshotId &&
          location.path === item.sourceLocation.path && location.line === item.sourceLocation.line));
      if (unseenSource) return { pass: false, message: "Evidence cites a source location not returned by a tool" };
      return invalid.length === 0
        ? { pass: true }
        : { pass: false, message: `Evidence cites nonexistent lines: ${invalid.join(", ")}` };
    }
    case "expectsSourceLocations": {
      const actual = result.output.evidence.flatMap((item) => item.sourceLocation ? [item.sourceLocation] : []);
      const pass = JSON.stringify(actual) === JSON.stringify(expectation.locations);
      return pass ? { pass: true } : { pass: false, message: `Unexpected source locations: ${JSON.stringify(actual)}` };
    }
    case "expectsSourceToolBounds": {
      const prefix = `Tool result for ${expectation.tool}:\n`;
      const content = result.promptMessages.find((message) => message.role === "user" && message.content.startsWith(prefix))?.content.slice(prefix.length);
      if (!content) return { pass: false, message: `No successful ${expectation.tool} result was observed` };
      const output = JSON.parse(content) as { truncated: boolean; startLine?: number; endLine?: number;
        items?: Array<{ excerpt: string }>; lines?: Array<{ line: number }> };
      const pass = Buffer.byteLength(content, "utf8") <= expectation.maxBytes && output.truncated === expectation.truncated
        && (expectation.maxItems === undefined || (output.items?.length ?? Infinity) <= expectation.maxItems)
        && (expectation.expectedItems === undefined || output.items?.length === expectation.expectedItems)
        && (expectation.maxExcerptChars === undefined || !!output.items?.every((item) => item.excerpt.length <= expectation.maxExcerptChars!))
        && (expectation.expectedLines === undefined || output.lines?.length === expectation.expectedLines
          && output.lines.every(({ line }, index) => line === output.startLine! + index))
        && (expectation.endLine === undefined || output.endLine === expectation.endLine && output.lines?.at(-1)?.line === expectation.endLine);
      return pass ? { pass: true } : { pass: false, message: `${expectation.tool} output exceeded its expected bounds or did not report truncation` };
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
