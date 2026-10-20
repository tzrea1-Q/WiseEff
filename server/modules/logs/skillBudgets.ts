import { ApiError } from "../../shared/http/errors";
import type { LogSkillSpec } from "./skillSpec";

export type LogSkillBudgetCaps = { stepBudget: number; tokenBudget: number };
export const defaultLogSkillBudgetCaps: LogSkillBudgetCaps = { stepBudget: 6, tokenBudget: 8000 };

export function validateLogSkillBudgets(spec: LogSkillSpec, caps: LogSkillBudgetCaps) {
  const issues = (["stepBudget", "tokenBudget"] as const).flatMap((field) => {
    const value = spec[field];
    const minimum = field === "tokenBudget" ? Math.min(4096, caps.tokenBudget) : 1;
    if (value === undefined) return [];
    if (value < minimum) return [{ path: [field], message: `不能小于 ${minimum}。` }];
    return value > caps[field] ? [{ path: [field], message: `不能超过平台上限（${caps[field]}）。` }] : [];
  });
  if (issues.length) throw new ApiError("VALIDATION_FAILED", "技能分析用量限制无效。", { issues });
}
