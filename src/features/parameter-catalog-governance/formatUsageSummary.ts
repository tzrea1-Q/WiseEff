export function formatUsageSummary(usage: { policyCount: number | null; projectCount: number; currentValueCount: number }): string {
  return `${usage.policyCount === null ? "策略使用量暂不可用" : `策略 ${usage.policyCount}`} · 项目 ${usage.projectCount} · 当前值 ${usage.currentValueCount}`;
}
