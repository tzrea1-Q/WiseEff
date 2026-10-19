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
  const overview = fields({ description: a.description, modelOverride: a.modelOverride },
    { description: b.description, modelOverride: b.modelOverride });
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
  return { overview, format, rules, signalSettings, counts: {
    overview: overview.length, format: format.filter((line) => line.kind !== "equal").length,
    added: rules.filter((rule) => rule.kind === "added").length,
    changed: rules.filter((rule) => rule.kind === "changed").length,
    removed: rules.filter((rule) => rule.kind === "removed").length, signalSettings: signalSettings.length
  } };
}
