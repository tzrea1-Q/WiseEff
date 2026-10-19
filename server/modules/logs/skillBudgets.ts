import { ApiError } from "../../shared/http/errors";
import type { LogSkillSpec } from "./skillSpec";

export type LogSkillBudgetCaps = { stepBudget: number; tokenBudget: number };
export const defaultLogSkillBudgetCaps: LogSkillBudgetCaps = { stepBudget: 6, tokenBudget: 8000 };

export function validateLogSkillBudgets(spec: LogSkillSpec, caps: LogSkillBudgetCaps) {
  const issues = (["stepBudget", "tokenBudget"] as const).flatMap((field) => {
    const value = spec[field];
    const minimum = field === "tokenBudget" ? Math.min(4096, caps.tokenBudget) : 1;
    if (value === undefined) return [];
    if (value < minimum) return [{ path: [field], message: `Must be at least ${minimum}.` }];
    return value > caps[field] ? [{ path: [field], message: `Must not exceed platform cap (${caps[field]}).` }] : [];
  });
  if (issues.length) throw new ApiError("VALIDATION_FAILED", "Invalid analysis skill budgets.", { issues });
}
