import { ApiError } from "../../../../shared/http/errors";
import type { AgentToolResult } from "../../types";
import { createXiaozeCheckpointer } from "../checkpointer";
import { createPlanningAgent, type PlanningApprovalBridge } from "../planningGraph";
import { XIAOZE_PROMPT_VERSION } from "../xiaozePrompt";
import { evaluateAllExpectations, evaluateExpectation, type EvalExpectation, type EvalRunResult } from "./expectations";
import { buildModelFromScript, EVAL_SCENARIOS, META_HALLUCINATED_WRITE_RESULT, STANDARD_TOOL_LIST, type EvalScenario } from "./scenarios";

export type ScenarioEvalResult = {
  name: string;
  category: string;
  pass: boolean;
  expectations: Array<{ expectation: EvalExpectation; pass: boolean; message?: string }>;
  runResult: EvalRunResult;
};

export type EvalReport = {
  generatedAt: string;
  promptVersion: string;
  total: number;
  passed: number;
  failed: number;
  scenarios: ScenarioEvalResult[];
  metaChecks: Array<{ name: string; pass: boolean; message?: string }>;
};

export async function runScenario(scenario: EvalScenario): Promise<ScenarioEvalResult> {
  const toolCallOrder: string[] = [];
  const executedMutatingTools: string[] = [];

  const runTool = async (name: string, _payload: Record<string, unknown>): Promise<AgentToolResult> => {
    toolCallOrder.push(name);
    const behavior = scenario.toolBehaviors[name];
    if (!behavior) {
      throw new Error(`No tool behavior configured for ${name}`);
    }
    if (behavior.type === "forbidden") {
      throw new ApiError("FORBIDDEN", "Forbidden", 403);
    }
    return {
      summary: behavior.summary,
      data: behavior.data ?? {},
      citations: behavior.citations ?? []
    };
  };

  const approvalBridge: PlanningApprovalBridge | undefined = scenario.needsApprovalBridge
    ? {
        resume: async (input) => {
          if (input.decision === "approve") {
            executedMutatingTools.push("action.submitParameterChange");
            return { text: scenario.approvalSuccessText ?? "Change request created." };
          }
          return { text: "The proposed action was rejected." };
        }
      }
    : undefined;

  const agent = createPlanningAgent({
    model: buildModelFromScript(scenario),
    runTool,
    listTools: () => scenario.tools ?? STANDARD_TOOL_LIST,
    checkpointer: createXiaozeCheckpointer(),
    approvalBridge
  });

  let graphResult = await agent.run({
    message: scenario.userMessage,
    context: scenario.context,
    threadId: scenario.threadId
  });

  if (scenario.resume) {
    graphResult = await agent.run({
      message: "",
      context: scenario.context,
      threadId: scenario.threadId,
      resume: scenario.resume
    });
  }

  const runResult: EvalRunResult = {
    answer: graphResult.text,
    reasoning: graphResult.reasoning,
    toolCallOrder,
    executedMutatingTools,
    interrupt: graphResult.interrupt ? { toolName: graphResult.interrupt.toolName } : undefined,
    citations: graphResult.citations ?? []
  };

  const evaluated = evaluateAllExpectations(scenario.expectations, runResult);
  const pass = evaluated.every((entry) => entry.result.pass);

  return {
    name: scenario.name,
    category: scenario.category,
    pass,
    expectations: evaluated.map((entry) => ({
      expectation: entry.expectation,
      pass: entry.result.pass,
      message: entry.result.message
    })),
    runResult
  };
}

export function runMetaChecks(): EvalReport["metaChecks"] {
  const hallucinationCheck = evaluateExpectation(
    { type: "mustNotClaimWriteWithoutApproval" },
    META_HALLUCINATED_WRITE_RESULT
  );
  return [
    {
      name: "meta-hallucinated-write-detector",
      pass: hallucinationCheck.pass === false,
      message: hallucinationCheck.pass
        ? "Meta check failed: harness did not flag hallucinated write claim"
        : "Harness correctly flags write claims without approved mutating execution"
    }
  ];
}

export async function runAllEvals(scenarios: EvalScenario[] = EVAL_SCENARIOS): Promise<EvalReport> {
  const scenarioResults: ScenarioEvalResult[] = [];
  for (const scenario of scenarios) {
    scenarioResults.push(await runScenario(scenario));
  }
  const metaChecks = runMetaChecks();
  const passed = scenarioResults.filter((result) => result.pass).length;
  const metaPassed = metaChecks.every((check) => check.pass);
  const failed = scenarioResults.length - passed + (metaPassed ? 0 : 1);

  return {
    generatedAt: new Date().toISOString(),
    promptVersion: XIAOZE_PROMPT_VERSION,
    total: scenarioResults.length + metaChecks.length,
    passed: passed + (metaPassed ? metaChecks.length : 0),
    failed,
    scenarios: scenarioResults,
    metaChecks
  };
}

export function formatEvalReportMarkdown(report: EvalReport): string {
  const lines = [
    "# Xiaoze Behavior Eval Report",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Prompt version: \`${report.promptVersion}\``,
    `- Scenarios: ${report.scenarios.length} (${report.scenarios.filter((s) => s.pass).length} passed)`,
    `- Meta checks: ${report.metaChecks.filter((c) => c.pass).length}/${report.metaChecks.length} passed`,
    "",
    "## Scenario Results",
    "",
    "| Scenario | Category | Result |",
    "| --- | --- | --- |"
  ];

  for (const scenario of report.scenarios) {
    lines.push(`| ${scenario.name} | ${scenario.category} | ${scenario.pass ? "PASS" : "FAIL"} |`);
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
