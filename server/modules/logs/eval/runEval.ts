import { parseLogText } from "../parser";
import { createAgentLoopLogAnalyzer, LOG_ANALYSIS_LOOP_PROMPT_VERSION } from "../analyzer/agentLoop";
import { createLlmLogAnalyzer, LOG_ANALYSIS_PROMPT_VERSION, type LogAnalysisChatMessage, type LogAnalysisChatModel } from "../analyzer/llmAnalyzer";
import { createScriptedLogAnalysisModel } from "../analyzer/scriptedModel";
import { analyzeWithDegradation } from "../worker";
import { evaluateAllLogEvalExpectations, evaluateLogEvalExpectation, type LogEvalExpectation, type LogEvalRunResult } from "./expectations";
import {
  LOG_EVAL_SCENARIOS,
  LOG_LOOP_EVAL_SCENARIOS,
  META_HALLUCINATED_AGENT_RESULT,
  META_OVERCONFIDENT_CONVERGENCE_RESULT,
  META_SILENT_DEGRADATION_RESULT,
  META_SILENT_ILLEGAL_TOOL_RESULT,
  type LogEvalScenario,
  type LogLoopEvalScenario
} from "./scenarios";

export type LogScenarioEvalResult = {
  name: string;
  category: string;
  /** Which kernel the scenario exercised. */
  kernel: "single-shot" | "loop";
  pass: boolean;
  expectations: Array<{ expectation: LogEvalExpectation; pass: boolean; message?: string }>;
  runResult: {
    analysisSource?: string;
    degradedReason?: string;
    promptVersion?: string;
    model?: string;
    evidenceLineNumbers: number[][];
    conclusion: string;
  };
};

export type LogEvalReport = {
  generatedAt: string;
  promptVersion: string;
  loopPromptVersion: string;
  total: number;
  passed: number;
  failed: number;
  scenarios: LogScenarioEvalResult[];
  metaChecks: Array<{ name: string; pass: boolean; message?: string }>;
};

const EVAL_MODEL_LABEL = "eval-fake";
const EVAL_TOKEN_BUDGET = 8000;
const EVAL_MAX_ATTEMPTS = 4;
const EVAL_LOOP_MAX_STEPS = 6;

function capturePrompts(model: LogAnalysisChatModel, captured: LogAnalysisChatMessage[]): LogAnalysisChatModel {
  return {
    async invoke(messages) {
      captured.push(...messages);
      return model.invoke(messages);
    }
  };
}

function toScenarioResult(
  scenario: { name: string; category: string },
  kernel: "single-shot" | "loop",
  runResult: LogEvalRunResult,
  expectations: LogEvalExpectation[]
): LogScenarioEvalResult {
  const evaluated = evaluateAllLogEvalExpectations(expectations, runResult);
  const pass = evaluated.every((entry) => entry.result.pass);
  const output = runResult.output;

  return {
    name: scenario.name,
    category: scenario.category,
    kernel,
    pass,
    expectations: evaluated.map((entry) => ({
      expectation: entry.expectation,
      pass: entry.result.pass,
      message: entry.result.message
    })),
    runResult: {
      analysisSource: output.analysisSource,
      degradedReason: output.degradedReason,
      promptVersion: output.promptVersion,
      model: output.model,
      evidenceLineNumbers: output.evidence.map((item) => item.lineNumbers),
      conclusion: output.conclusion
    }
  };
}

export async function runLogEvalScenario(scenario: LogEvalScenario): Promise<LogScenarioEvalResult> {
  const parsed = parseLogText({ fileName: scenario.fileName, content: scenario.logContent });
  if (!parsed.ok) {
    throw new Error(`Eval scenario ${scenario.name} fixture failed to parse: ${parsed.reason}`);
  }

  const promptMessages: LogAnalysisChatMessage[] = [];
  const analyzer = createLlmLogAnalyzer({
    model: capturePrompts(scenario.model, promptMessages),
    modelLabel: EVAL_MODEL_LABEL,
    tokenBudget: EVAL_TOKEN_BUDGET
  });

  const output = await analyzeWithDegradation({
    analyzer,
    analyzeInput: {
      parsed,
      analysisQuestion: scenario.analysisQuestion,
      logDomain: scenario.logDomain
    },
    job: { attemptCount: scenario.attemptCount ?? 1 },
    maxAttempts: EVAL_MAX_ATTEMPTS,
    retryBaseDelayMs: 1,
    now: () => new Date()
  });

  return toScenarioResult(scenario, "single-shot", {
    output,
    parsedLineNumbers: parsed.entries.map((entry) => entry.lineNumber),
    promptMessages
  }, scenario.expectations);
}

/** Loop scenarios drive the real bounded agent-loop kernel with a scripted model. */
export async function runLogLoopEvalScenario(scenario: LogLoopEvalScenario): Promise<LogScenarioEvalResult> {
  const parsed = parseLogText({ fileName: scenario.fileName, content: scenario.logContent });
  if (!parsed.ok) {
    throw new Error(`Eval scenario ${scenario.name} fixture failed to parse: ${parsed.reason}`);
  }

  const scriptedModel = createScriptedLogAnalysisModel(scenario.script);
  const promptMessages: LogAnalysisChatMessage[] = [];
  const analyzer = createAgentLoopLogAnalyzer({
    model: capturePrompts(scriptedModel, promptMessages),
    modelLabel: EVAL_MODEL_LABEL,
    tokenBudget: scenario.tokenBudget ?? EVAL_TOKEN_BUDGET,
    maxSteps: scenario.maxSteps ?? EVAL_LOOP_MAX_STEPS
  });

  const output = await analyzeWithDegradation({
    analyzer,
    analyzeInput: {
      parsed,
      analysisQuestion: scenario.analysisQuestion,
      logDomain: scenario.logDomain
    },
    job: { attemptCount: 1 },
    maxAttempts: EVAL_MAX_ATTEMPTS,
    retryBaseDelayMs: 1,
    now: () => new Date()
  });

  return toScenarioResult(scenario, "loop", {
    output,
    parsedLineNumbers: parsed.entries.map((entry) => entry.lineNumber),
    promptMessages,
    modelCallCount: scriptedModel.calls.length
  }, scenario.expectations);
}

/** Known-bad results must fail the harness, or the harness itself is broken. */
export function runLogEvalMetaChecks(): LogEvalReport["metaChecks"] {
  const hallucinationCheck = evaluateLogEvalExpectation({ type: "expectsGroundedEvidence" }, META_HALLUCINATED_AGENT_RESULT);
  const silentDegradationCheck = evaluateLogEvalExpectation(
    { type: "expectsDegradedReason", reason: "provider-unavailable" },
    META_SILENT_DEGRADATION_RESULT
  );
  const overconfidentConvergenceCheck = evaluateLogEvalExpectation(
    { type: "expectsConfidenceAtMost", value: 0.5 },
    META_OVERCONFIDENT_CONVERGENCE_RESULT
  );
  const silentIllegalToolCheck = evaluateLogEvalExpectation(
    { type: "expectsPromptContains", substrings: ["Tool call rejected"] },
    META_SILENT_ILLEGAL_TOOL_RESULT
  );

  return [
    {
      name: "meta-hallucinated-citation-detector",
      pass: hallucinationCheck.pass === false,
      message: hallucinationCheck.pass
        ? "Meta check failed: harness did not flag evidence citing a nonexistent line"
        : "Harness correctly flags evidence citing nonexistent lines"
    },
    {
      name: "meta-silent-degradation-detector",
      pass: silentDegradationCheck.pass === false,
      message: silentDegradationCheck.pass
        ? "Meta check failed: harness did not flag a fallback report without a degraded reason"
        : "Harness correctly flags degraded output missing its degraded reason"
    },
    {
      name: "meta-loop-overconfident-convergence-detector",
      pass: overconfidentConvergenceCheck.pass === false,
      message: overconfidentConvergenceCheck.pass
        ? "Meta check failed: harness did not flag an early-converged conclusion that kept high confidence"
        : "Harness correctly flags overconfident early convergence"
    },
    {
      name: "meta-loop-silent-illegal-tool-detector",
      pass: silentIllegalToolCheck.pass === false,
      message: silentIllegalToolCheck.pass
        ? "Meta check failed: harness did not flag a kernel that accepted an illegal tool without correction"
        : "Harness correctly flags a silently accepted illegal tool call"
    }
  ];
}

export async function runAllLogEvals(
  scenarios: LogEvalScenario[] = LOG_EVAL_SCENARIOS,
  loopScenarios: LogLoopEvalScenario[] = LOG_LOOP_EVAL_SCENARIOS
): Promise<LogEvalReport> {
  const scenarioResults: LogScenarioEvalResult[] = [];
  for (const scenario of scenarios) {
    scenarioResults.push(await runLogEvalScenario(scenario));
  }
  for (const scenario of loopScenarios) {
    scenarioResults.push(await runLogLoopEvalScenario(scenario));
  }
  const metaChecks = runLogEvalMetaChecks();
  const passed = scenarioResults.filter((result) => result.pass).length;
  const metaPassed = metaChecks.filter((check) => check.pass).length;

  return {
    generatedAt: new Date().toISOString(),
    promptVersion: LOG_ANALYSIS_PROMPT_VERSION,
    loopPromptVersion: LOG_ANALYSIS_LOOP_PROMPT_VERSION,
    total: scenarioResults.length + metaChecks.length,
    passed: passed + metaPassed,
    failed: scenarioResults.length - passed + (metaChecks.length - metaPassed),
    scenarios: scenarioResults,
    metaChecks
  };
}

export function formatLogEvalReportMarkdown(report: LogEvalReport): string {
  const lines = [
    "# Log Analysis Behavior Eval Report",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Single-shot prompt version: \`${report.promptVersion}\``,
    `- Loop prompt version: \`${report.loopPromptVersion}\``,
    `- Scenarios: ${report.scenarios.length} (${report.scenarios.filter((s) => s.pass).length} passed)`,
    `- Meta checks: ${report.metaChecks.filter((c) => c.pass).length}/${report.metaChecks.length} passed`,
    "",
    "## Scenario Results",
    "",
    "| Scenario | Category | Kernel | Source | Degraded | Result |",
    "| --- | --- | --- | --- | --- | --- |"
  ];

  for (const scenario of report.scenarios) {
    lines.push(
      `| ${scenario.name} | ${scenario.category} | ${scenario.kernel} | ${scenario.runResult.analysisSource ?? "-"} | ${scenario.runResult.degradedReason ?? "-"} | ${scenario.pass ? "PASS" : "FAIL"} |`
    );
  }

  lines.push("", "## Meta Checks", "");
  for (const check of report.metaChecks) {
    lines.push(`- **${check.name}**: ${check.pass ? "PASS" : "FAIL"}${check.message ? ` — ${check.message}` : ""}`);
  }

  const failures = report.scenarios.filter((scenario) => !scenario.pass);
  if (failures.length > 0) {
    lines.push("", "## Failures", "");
    for (const failure of failures) {
      lines.push(`### ${failure.name}`);
      for (const expectation of failure.expectations.filter((entry) => !entry.pass)) {
        lines.push(`- \`${expectation.expectation.type}\`: ${expectation.message ?? "failed"}`);
      }
    }
  }

  return lines.join("\n");
}
