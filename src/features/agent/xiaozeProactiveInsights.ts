import type { PageKey } from "@/appConfig";

export const XIAOZE_PROACTIVE_INSIGHT_PAGE_KEYS = new Set<PageKey>([
  "parameters",
  "parameter-review",
  "logs"
]);

export function supportsXiaozeProactiveInsights(pageKey: PageKey): boolean {
  return XIAOZE_PROACTIVE_INSIGHT_PAGE_KEYS.has(pageKey);
}

export function supportsXiaozeProactiveInsightPage(pageKey: string): boolean {
  return supportsXiaozeProactiveInsights(pageKey as PageKey);
}
