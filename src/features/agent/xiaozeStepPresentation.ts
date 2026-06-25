import type { XiaozeRunStepSnapshot } from "./xiaozeRunTimingTypes";

export function localizeStepSummary(summary: string | undefined, toolName?: string) {
  if (!summary?.trim()) {
    return undefined;
  }

  const trimmed = summary.trim();
  if (/[\u4e00-\u9fff]/.test(trimmed)) {
    return trimmed;
  }

  const foundParameters = trimmed.match(/Found (\d+) parameters? matching/i);
  if (foundParameters) {
    return `找到 ${foundParameters[1]} 个匹配参数`;
  }

  const parameterCount = trimmed.match(/^(\d+) parameters?$/i);
  if (parameterCount) {
    return `共 ${parameterCount[1]} 个参数`;
  }

  if (/^Reply ready$/i.test(trimmed)) {
    return "回复已生成";
  }

  if (toolName === "perception.searchParameters") {
    return undefined;
  }

  return undefined;
}

export function presentRunStep(step: XiaozeRunStepSnapshot): XiaozeRunStepSnapshot {
  const summary = localizeStepSummary(step.summary, step.toolName);
  return summary ? { ...step, summary } : { ...step, summary: undefined };
}
