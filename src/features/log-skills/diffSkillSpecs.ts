import { buildTextDiffLines } from "@/domain/parameters/textDiff";
import type { SkillSpec } from "./types";

// Object key order is not a skill change. Array order remains significant.
export function specJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item, 2) ?? "";
}

function fields(a: Record<string, unknown>, b: Record<string, unknown>) {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap((field) =>
    specJson(a[field]) === specJson(b[field]) ? [] : [{ field, before: a[field], after: b[field] }]);
}

export function diffSkillSpecs(a: SkillSpec, b: SkillSpec) {
  const overview = fields({ description: a.description }, { description: b.description });
  const integration = fields({ modelOverride: a.modelOverride, stepBudget: a.stepBudget, tokenBudget: a.tokenBudget },
    { modelOverride: b.modelOverride, stepBudget: b.stepBudget, tokenBudget: b.tokenBudget });
  const procedure = fields({ procedure: a.procedure }, { procedure: b.procedure });
  const knowledge = fields({ knowledgeEntryIds: a.knowledgeEntryIds ?? [] }, { knowledgeEntryIds: b.knowledgeEntryIds ?? [] });
  const source = fields({ defaultSourceSnapshotId: a.defaultSourceSnapshotId, statementPatterns: a.source?.statementPatterns },
    { defaultSourceSnapshotId: b.defaultSourceSnapshotId, statementPatterns: b.source?.statementPatterns });
  const format = buildTextDiffLines(specJson(a.formatProfile), specJson(b.formatProfile));
  const before = new Map(a.signalRules?.rules.map((rule) => [rule.id, rule]));
  const after = new Map(b.signalRules?.rules.map((rule) => [rule.id, rule]));
  const rules = [...new Set([...before.keys(), ...after.keys()])].flatMap((id) => {
    const left = before.get(id), right = after.get(id);
    const changes = fields(left ?? {}, right ?? {});
    return changes.length ? [{ id, kind: !left ? "added" as const : !right ? "removed" as const : "changed" as const, fields: changes }] : [];
  });
  const signalSettings = fields({ mode: a.signalRules ? "custom" : "default", noHit: a.signalRules?.noHit, hitDefaults: a.signalRules?.hitDefaults, rulesOrder: a.signalRules?.rules.map((r) => r.id) },
    { mode: b.signalRules ? "custom" : "default", noHit: b.signalRules?.noHit, hitDefaults: b.signalRules?.hitDefaults, rulesOrder: b.signalRules?.rules.map((r) => r.id) });
  const parsingBefore = new Map(a.parsing?.extractors?.map((extractor) => [extractor.id, extractor]));
  const parsingAfter = new Map(b.parsing?.extractors?.map((extractor) => [extractor.id, extractor]));
  const parsing = [...new Set([...parsingBefore.keys(), ...parsingAfter.keys()])].flatMap((id) => {
    const left = parsingBefore.get(id), right = parsingAfter.get(id), changes = fields(left ?? {}, right ?? {});
    return changes.length ? [{ id, kind: !left ? "added" as const : !right ? "removed" as const : "changed" as const, fields: changes }] : [];
  });
  return { overview, integration, procedure, knowledge, source, format, rules, signalSettings, parsing, counts: {
    integration: integration.length,
    knowledge: knowledge.length,
    source: source.length, overview: overview.length, procedure: procedure.length, format: format.filter((line) => line.kind !== "equal").length,
    added: rules.filter((rule) => rule.kind === "added").length,
    changed: rules.filter((rule) => rule.kind === "changed").length,
    removed: rules.filter((rule) => rule.kind === "removed").length, signalSettings: signalSettings.length
  } };
}
