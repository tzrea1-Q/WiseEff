import { compileFileGlob } from "../../../src/domain/logs/fileApplicability";
import { compileFileGlob as compileExtractorGlob, compileLogPattern, createLogPatternCache, type LogPattern } from "./adminPattern";
import type { LogSkillSpec } from "./skillSpec";

export const LOG_SKILL_RECOMMENDATION_LIMITS = {
  files: 200, headLines: 64, lineBytes: 2048, pathChars: 1024, skills: 100,
  patternsPerSkill: 512, reasons: 24, detailChars: 512, evaluations: 200_000, maxMs: 100, threshold: 8
} as const;

export type LogSkillRecommendationFile = { path: string; head: string[] };
export type LogSkillRecommendationReason = {
  kind: "file" | "pattern"; file: string; detail: string;
  source?: "skill-glob" | "extractor-glob" | "extractor" | "signal" | "format-timestamp" | "format-severity";
  ref?: string; role?: string;
};
export type LogSkillRecommendation = { skillId: string; score: number; reasons: LogSkillRecommendationReason[] };
export type LogSkillRecommendationResult = { recommendations: LogSkillRecommendation[]; recommendedSkillId?: string };

/**
 * A complete, bounded ranking, never a winner from an arbitrary candidate prefix.
 * Each applicable file scores: first skill glob 4 (+2 for any author-defined role),
 * extractor glob 4, each distinct extractor pattern 8, each text-signal rule 4.
 * Signal aliases count once per rule/file, including window text as a feature only.
 * Format timestamp/severity matches add at most 2 across the whole skill, so
 * generic INFO/ERROR or timestamp matches alone cannot reach the threshold of 8.
 * Equal top scores are generic. Reasons retain the first 24 deterministic hits.
 * Only the first 64 lines are examined; lines exceeding 2 KiB UTF-8 are ignored
 * entirely (truncation could invent an anchored match). No input is mutated.
 */
export function recommendLogSkills(
  skills: { skillId: string; spec: LogSkillSpec }[],
  files: LogSkillRecommendationFile[],
  options: { now?: () => number; maxMs?: number; maxEvaluations?: number } = {}
): LogSkillRecommendationResult {
  const limits = LOG_SKILL_RECOMMENDATION_LIMITS, empty = { recommendations: [] };
  if (skills.length > limits.skills || files.length > limits.files) return empty;
  const now = options.now ?? (() => performance.now());
  const deadline = now() + Math.min(options.maxMs ?? limits.maxMs, limits.maxMs);
  let remaining = Math.min(options.maxEvaluations ?? limits.evaluations, limits.evaluations);
  const check = () => {
    if (now() >= deadline || --remaining < 0) throw new Error("Recommendation budget exhausted");
  };
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const cache = createLogPatternCache();
  try {
    check();
    if (new Set(skills.map(({ skillId }) => skillId)).size !== skills.length
      || new Set(files.map(({ path }) => path)).size !== files.length) return empty;
    const heads = files.map(({ path, head }) => {
      check();
      if (!path || path.length > limits.pathChars || /[\x00-\x1f\x7f]/.test(path)) throw new Error("Invalid file path");
      return { path, head: head.slice(0, limits.headLines).filter((line) =>
        line.length <= limits.lineBytes && Buffer.byteLength(line, "utf8") <= limits.lineBytes) };
    }).sort((a, b) => compare(a.path, b.path));
    const recommendations = [...skills].sort((a, b) => compare(a.skillId, b.skillId)).map(({ skillId, spec }) => {
      let declarations = 0;
      const compile = (source: string, kind: "skill-glob" | "extractor-glob" | "pattern", flags = "") => {
        check();
        if (++declarations > limits.patternsPerSkill) throw new Error("Too many recommendation patterns");
        return kind === "skill-glob" ? compileFileGlob(source, cache)
          : kind === "extractor-glob" ? compileExtractorGlob(source, cache)
            : compileLogPattern(source, flags, limits.lineBytes, cache);
      };
      const fileRules = spec.files?.map((rule) => ({ ...rule, pattern: compile(rule.glob, "skill-glob") })) ?? [];
      const extractors = [...(spec.parsing?.extractors ?? [])].sort((a, b) => compare(a.id, b.id)).map((extractor) => ({
        id: extractor.id, source: extractor.pattern, pattern: compile(extractor.pattern, "pattern", "s"),
        files: extractor.files?.map((glob) => ({ glob, pattern: compile(glob, "extractor-glob") }))
      }));
      const signals = [...(spec.signalRules?.rules ?? [])].sort((a, b) => compare(a.id, b.id)).map((rule) => ({
        id: rule.id, ref: rule.name || rule.id,
        patterns: rule.anyOf.flatMap((input) => {
          const condition = input.type === "window" ? input.condition : input;
          return condition.type === "text" ? [{ source: condition.pattern, pattern: compile(condition.pattern, "pattern", condition.flags) }] : [];
        })
      }));
      const format = [
        ...(spec.formatProfile?.timestampPattern ? [{ detail: "日志时间格式与技能配置一致", source: spec.formatProfile.timestampPattern,
          reasonSource: "format-timestamp" as const, ref: spec.formatProfile.timestampPattern }] : []),
        ...(["error", "warn", "info"] as const).flatMap((severity) =>
          (spec.formatProfile?.severityMap?.[severity] ?? []).map((source) => ({ detail: `日志严重程度 ${severity} 与技能配置一致`, source,
            reasonSource: "format-severity" as const, ref: severity })))
      ].map((feature) => ({ ...feature, pattern: compile(feature.source, "pattern") }));
      let score = 0, formatScore = 0;
      const reasons: LogSkillRecommendationReason[] = [];
      const add = (points: number, kind: LogSkillRecommendationReason["kind"], file: string, detail: string,
        source: NonNullable<LogSkillRecommendationReason["source"]>, ref: string, role?: string) => {
        score += points;
        if (reasons.length < limits.reasons) reasons.push({ kind, file, detail: detail.slice(0, limits.detailChars),
          source, ref: ref.slice(0, limits.detailChars), ...(role ? { role } : {}) });
      };
      const test = (pattern: LogPattern, text: string) => { check(); return pattern.test(text); };
      for (const file of heads) {
        check();
        // Rule order is meaningful: use the same first role as compileSkillFiles.
        const rule = fileRules.find(({ pattern }) => test(pattern, file.path));
        if (fileRules.length && !rule) continue;
        if (rule) add(4 + (rule.role?.trim() ? 2 : 0), "file", file.path,
          `文件匹配技能路径规则 ${rule.glob}${rule.role?.trim() ? `（${rule.role.trim()}）` : ""}`, "skill-glob", rule.glob, rule.role?.trim());
        let extractorFileScored = false;
        const matchedExtractors = new Set<string>();
        for (const extractor of extractors) {
          const glob = extractor.files?.find(({ pattern }) => test(pattern, file.path));
          if (extractor.files && !glob) continue;
          if (glob && !extractorFileScored) {
            add(4, "file", file.path, `文件匹配字段解析路径规则 ${glob.glob}`, "extractor-glob", glob.glob);
            extractorFileScored = true;
          }
          if (!matchedExtractors.has(extractor.source) && file.head.some((line) => test(extractor.pattern, line))) {
            matchedExtractors.add(extractor.source);
            add(8, "pattern", file.path, `日志内容匹配字段解析规则 ${extractor.id}：${extractor.source}`, "extractor", extractor.id);
          }
        }
        for (const signal of signals) {
          const match = signal.patterns.find(({ pattern }) => file.head.some((line) => test(pattern, line)));
          if (match) add(4, "pattern", file.path, `日志内容匹配技能信号规则 ${signal.id}：${match.source}`, "signal", signal.ref);
        }
        for (const feature of format) {
          if (formatScore >= 2) break;
          if (file.head.some((line) => test(feature.pattern, line))) {
            add(1, "pattern", file.path, `${feature.detail}：${feature.source}`, feature.reasonSource, feature.ref);
            formatScore++;
          }
        }
      }
      return { skillId, score, reasons };
    }).sort((a, b) => b.score - a.score || compare(a.skillId, b.skillId));
    check();
    const best = recommendations[0];
    return { recommendations, ...(best && best.score >= limits.threshold && best.score > (recommendations[1]?.score ?? -1)
      ? { recommendedSkillId: best.skillId } : {}) };
  } catch {
    // Invalid stored patterns and shared cache exhaustion are fail-open routing,
    // never a partial ranking that silently favors candidates evaluated first.
    return empty;
  }
}
