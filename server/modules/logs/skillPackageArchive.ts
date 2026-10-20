import { logValidationMessage } from "./validationMessages";
import JSZip from "jszip";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { AnalysisCaseArchiveError, analysisCaseArchiveLimits, archiveYamlLimits, parseArchiveYaml, parseAnalysisCaseFiles, readBoundedZipArchive, type ArchivedAnalysisCase } from "./analysisCaseArchive";
import { logSkillSpecSchema, type LogSkillSpec } from "./skillSpec";
import { skillKeySchema } from "./schemas";
import { knowledgeTagsSchema } from "../knowledge/schemas";
import { parsingSpecSchema } from "./parsing/spec";
import { signalRuleSetSchema } from "./signalRules";
import { parseTestsSchema } from "./parseTestSpec";

export type SkillPackageIssue = { path: string; message: string };
export class SkillPackageArchiveError extends AnalysisCaseArchiveError {
  constructor(readonly issues: SkillPackageIssue[], readonly packageName?: string) {
    super(issues.slice(0, archiveYamlLimits.maxIssues).map(({ path, message }) => `${path.replace(" › ", ": ")}: ${message}`));
    this.issues = issues.slice(0, archiveYamlLimits.maxIssues);
  }
}


/** Existing case archives retain their diagnostics; package responses localize them. */
export function skillPackageIssue(problem: string): SkillPackageIssue {
  const match = /^(.*?\.yaml):([^\s:][^:]*):\s*(.*)$/.exec(problem);
  const at = problem.indexOf(": ");
  const path = match ? `${match[1]} › ${match[2].trim()}` : at >= 0 ? problem.slice(0, at) : "archive.zip";
  const rawMessage = match ? match[3] : at >= 0 ? problem.slice(at + 2) : problem;
  const message = /^invalid YAML \(Error: ([\s\S]*)\)$/.exec(rawMessage)?.[1] ?? rawMessage;
  const translated = /invalid YAML/.test(message) ? "YAML 语法无效"
    : /[\u3400-\u9fff]/.test(message) ? message
    : /missing annotation/.test(message) ? "缺少用例说明文件"
    : /no analyzable files/.test(message) ? "没有可分析的日志文件"
    : /normalized case logs exceed/.test(message) ? "规范化后的用例日志超过大小上限"
    : /unsafe|path traversal/.test(message) ? "不安全的归档路径"
    : /missing/.test(message) ? "缺少必需文件或有效的证据行"
    : /size|exceed|limit|ratio|count/.test(message) ? "归档大小、条目数或压缩比超过安全上限"
    : /UTF-8/.test(message) ? "文本必须采用 UTF-8 编码"
    : /ZIP|archive/.test(message) ? "归档格式无效或包含不支持的 ZIP 条目"
    : "用例配置无效，请检查字段值、日志文件和证据行";
  return { path, message: translated };
}

const metadataSchema = z.object({
  name: z.string().trim().min(1).max(120), schemaVersion: z.literal("skill/v1"),
  skillKey: skillKeySchema.optional(), description: z.unknown().optional(),
  stepBudget: z.unknown().optional(), tokenBudget: z.unknown().optional(),
  formatProfile: z.unknown().optional(), modelOverride: z.unknown().optional(), source: z.unknown().optional()
}).strict();
const knowledgeMetadataSchema = z.object({
  title: z.string().trim().min(1).max(200), tags: knowledgeTagsSchema,
  source: z.object({ type: z.enum(["human", "agent"]), entryId: z.string().uuid(),
    revisionId: z.string().uuid(), revisionNumber: z.number().int().positive() }).strict().optional()
}).strict();
export type PackagedKnowledge = z.infer<typeof knowledgeMetadataSchema> & { path: string; body: string };
export type SkillPackage = { name: string; skillKey?: string; spec: LogSkillSpec; knowledge: PackagedKnowledge[]; cases: ArchivedAnalysisCase[] };
const required = ["SKILL.md", "parsing.yaml", "signals.yaml", "tests.yaml"];
const fieldPath = (path: (string | number)[]) => path.reduce<string>((text, part) => typeof part === "number" ? `${text}[${part}]` : `${text}${text ? "." : ""}${part}`, "");
function problem(path: string, message: string): never { throw new SkillPackageArchiveError([{ path, message }]); }
function text(bytes: Buffer, path: string) {
  if (bytes.length > analysisCaseArchiveLimits.maxMetadataBytes) problem(path, "文件超过 2 MiB 元数据上限");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return problem(path, "文本必须采用 UTF-8 编码"); }
}
function yaml(value: string, path: string): unknown {
  try { return parseArchiveYaml(value); }
  catch (error) { return problem(path, error instanceof Error && /[\u3400-\u9fff]/.test(error.message) ? error.message : "YAML 语法无效"); }
}
function markdown(bytes: Buffer, path: string) {
  const value = text(bytes, path);
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(value);
  if (!match) return problem(path, "缺少 YAML 前置信息（frontmatter）");
  return { metadata: yaml(match[1], path), body: value.slice(match[0].length) };
}
function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown, path: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SkillPackageArchiveError(schemaIssues(parsed.error.issues, path));
  return parsed.data;
}

function schemaIssues(issues: z.ZodIssue[], file: string): SkillPackageIssue[] {
  return issues.flatMap((issue) => issue.code === "unrecognized_keys"
    ? issue.keys.map((key) => ({ path: `${file} › ${fieldPath([...issue.path, key])}`, message: "不支持的字段" }))
    : [{ path: `${file}${issue.path.length ? ` › ${fieldPath(issue.path)}` : ""}`, message: logValidationMessage(issue) }]);
}

/** Nothing beyond this boundary can reach a database or an object store. */
export async function importSkillPackageArchive(bytes: Buffer): Promise<SkillPackage> {
  // Archive-level failures stop immediately, before any YAML is inspected.
  const files = await readBoundedZipArchive(bytes);
  const issues: SkillPackageIssue[] = [];
  const collect = <T>(read: () => T): T | undefined => {
    try { return read(); }
    catch (error) {
      if (!(error instanceof SkillPackageArchiveError)) throw error;
      issues.push(...error.issues.slice(0, Math.max(0, archiveYamlLimits.maxIssues - issues.length)));
      return undefined;
    }
  };
  for (const path of required) if (!files.has(path)) collect(() => problem(path, "缺少必需文件"));
  const knowledge: PackagedKnowledge[] = [], caseFiles = new Map<string, Buffer>();
  for (const [path, bytes] of files) {
    if (required.includes(path)) continue;
    if (path === "README.md") { collect(() => text(bytes, path)); continue; }
    if (/^knowledge\/[a-z0-9][a-z0-9-]*\.md$/.test(path)) {
      collect(() => {
        const item = markdown(bytes, path);
        const metadata = parse(knowledgeMetadataSchema, item.metadata, path);
        if (item.body.length > 200_000) problem(path, "正文超过 200000 字符上限");
        knowledge.push({ ...metadata, body: item.body, path });
      });
    } else if (path.startsWith("cases/")) caseFiles.set(path.slice(6), bytes);
    else collect(() => problem(path, "不支持的技能包文件"));
  }
  if (knowledge.length > 200) collect(() => problem("knowledge/", "关联知识条目超过 200 条上限"));
  const skill = files.has("SKILL.md") ? collect(() => {
    const item = markdown(files.get("SKILL.md")!, "SKILL.md");
    return { ...parse(metadataSchema, item.metadata, "SKILL.md"), procedure: item.body };
  }) : undefined;
  const read = <T>(file: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, nullable = false) => files.has(file) ? collect(() => {
    const value = yaml(text(files.get(file)!, file), file);
    return nullable && value === null ? undefined : parse(schema, value, file);
  }) : undefined;
  const parsing = read("parsing.yaml", parsingSpecSchema, true);
  const signalRules = read("signals.yaml", signalRuleSetSchema, true);
  const parseTests = read("tests.yaml", parseTestsSchema);
  const { name = "", skillKey, procedure, ...metadata } = skill ?? {};
  const result = logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1", ...metadata, procedure, parsing, signalRules, parseTests });
  if (!result.success) for (const issue of result.error.issues) {
    const [root, ...path] = issue.path;
    const file = root === "signalRules" ? "signals.yaml" : root === "parsing" ? "parsing.yaml" : root === "parseTests" ? "tests.yaml" : "SKILL.md";
    const mapped = schemaIssues([{ ...issue, path: file === "SKILL.md" ? issue.path : path }], file);
    issues.push(...mapped.slice(0, Math.max(0, archiveYamlLimits.maxIssues - issues.length)));
  }
  let cases: ArchivedAnalysisCase[] = [];
  try { if (caseFiles.size) cases = parseAnalysisCaseFiles(caseFiles); }
  catch (error) {
    if (error instanceof AnalysisCaseArchiveError) issues.push(...error.problems.slice(0, Math.max(0, archiveYamlLimits.maxIssues - issues.length)).map((message) => skillPackageIssue(`cases/${message}`)));
    else throw error;
  }
  if (issues.length || !result.success) throw new SkillPackageArchiveError(issues, skill?.name);
  return { name, skillKey, spec: result.data, knowledge: knowledge.sort((a, b) => a.path.localeCompare(b.path)), cases };
}

export function packageMarkdown(metadata: unknown, body: string) { return `---\n${stringifyYaml(metadata, { aliasDuplicateObjects: false })}---\n${body}`; }

/** Sorted paths and a fixed ZIP date make repeat exports byte-for-byte stable. */
export async function exportSkillPackageArchive(name: string, skillKey: string, spec: LogSkillSpec, knowledge: PackagedKnowledge[], cases: Map<string, Buffer>) {
  const { procedure = "", parsing, signalRules, parseTests = [], knowledgeEntryIds: _ids, defaultSourceSnapshotId: _snapshot, ...metadata } = spec;
  const files = new Map<string, Buffer>([
    ["SKILL.md", Buffer.from(packageMarkdown({ name, skillKey, ...metadata }, procedure))],
    ["parsing.yaml", Buffer.from(stringifyYaml(parsing ?? null, { aliasDuplicateObjects: false }))],
    ["signals.yaml", Buffer.from(stringifyYaml(signalRules ?? null, { aliasDuplicateObjects: false }))],
    ["tests.yaml", Buffer.from(stringifyYaml(parseTests, { aliasDuplicateObjects: false }))],
    ["README.md", Buffer.from("# Skill package\n\nSource snapshots are not included. Upload source snapshots separately after import.\n源码快照不随技能包导入，请在导入后单独上传。\n")],
    ...knowledge.map(({ path, body, ...metadata }): [string, Buffer] => [path, Buffer.from(packageMarkdown(metadata, body))]),
    ...[...cases].map(([path, bytes]): [string, Buffer] => [`cases/${path}`, bytes])
  ]);
  const zip = new JSZip();
  for (const [path, bytes] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    zip.file(path, bytes, { createFolders: false, date: new Date("1980-01-01T00:00:00Z") });
  }
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
  await importSkillPackageArchive(bytes);
  return bytes;
}
