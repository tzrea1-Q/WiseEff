import JSZip from "jszip";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { AnalysisCaseArchiveError, analysisCaseArchiveLimits, parseAnalysisCaseFiles, readBoundedZipArchive, type ArchivedAnalysisCase } from "./analysisCaseArchive";
import { logSkillSpecSchema, type LogSkillSpec } from "./skillSpec";
import { skillKeySchema } from "./schemas";
import { knowledgeTagsSchema } from "../knowledge/schemas";

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
function problem(path: string, message: string): never { throw new AnalysisCaseArchiveError([`${path}: ${message}`]); }
function text(bytes: Buffer, path: string) {
  if (bytes.length > analysisCaseArchiveLimits.maxMetadataBytes) problem(path, "metadata exceeds 2 MiB");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return problem(path, "expected UTF-8 text"); }
}
function yaml(value: string, path: string): unknown {
  try { return parseYaml(value, { maxAliasCount: 0, uniqueKeys: true }); }
  catch (error) { return problem(path, `invalid YAML (${error instanceof Error ? error.message : String(error)})`); }
}
function markdown(bytes: Buffer, path: string) {
  const value = text(bytes, path);
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(value);
  if (!match) return problem(path, "YAML frontmatter is required");
  return { metadata: yaml(match[1], path), body: value.slice(match[0].length) };
}
function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown, path: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AnalysisCaseArchiveError(parsed.error.issues.map((issue) => `${path}: ${fieldPath(issue.path) || "(root)"}: ${issue.message}`));
  return parsed.data;
}

/** Nothing beyond this boundary can reach a database or an object store. */
export async function importSkillPackageArchive(bytes: Buffer): Promise<SkillPackage> {
  const files = await readBoundedZipArchive(bytes);
  for (const path of required) if (!files.has(path)) problem(path, "required file is missing");
  const knowledge: PackagedKnowledge[] = [], caseFiles = new Map<string, Buffer>();
  for (const [path, bytes] of files) {
    if (required.includes(path)) continue;
    if (path === "README.md") { text(bytes, path); continue; }
    if (/^knowledge\/[a-z0-9][a-z0-9-]*\.md$/.test(path)) {
      const item = markdown(bytes, path);
      const metadata = parse(knowledgeMetadataSchema, item.metadata, path);
      if (item.body.length > 200_000) problem(path, "body exceeds 200000 characters");
      knowledge.push({ ...metadata, body: item.body, path });
    } else if (path.startsWith("cases/")) caseFiles.set(path.slice(6), bytes);
    else problem(path, "unsupported package file");
  }
  if (knowledge.length > 200) problem("knowledge/", "at most 200 linked entries");
  const skill = markdown(files.get("SKILL.md")!, "SKILL.md");
  const { name, skillKey, ...metadata } = parse(metadataSchema, skill.metadata, "SKILL.md");
  const parsing = yaml(text(files.get("parsing.yaml")!, "parsing.yaml"), "parsing.yaml");
  const signalRules = yaml(text(files.get("signals.yaml")!, "signals.yaml"), "signals.yaml");
  const parseTests = yaml(text(files.get("tests.yaml")!, "tests.yaml"), "tests.yaml");
  const result = logSkillSpecSchema.safeParse({ ...metadata, procedure: skill.body,
    ...(parsing === null ? {} : { parsing }), ...(signalRules === null ? {} : { signalRules }), parseTests });
  if (!result.success) throw new AnalysisCaseArchiveError(result.error.issues.map((issue) => {
    const [root, ...path] = issue.path;
    const file = root === "signalRules" ? "signals.yaml" : root === "parsing" ? "parsing.yaml" : root === "parseTests" ? "tests.yaml" : "SKILL.md";
    return `${file}: ${fieldPath(file === "SKILL.md" ? issue.path : path) || "(root)"}: ${issue.message}`;
  }));
  let cases: ArchivedAnalysisCase[] = [];
  try { if (caseFiles.size) cases = parseAnalysisCaseFiles(caseFiles); }
  catch (error) {
    if (error instanceof AnalysisCaseArchiveError) throw new AnalysisCaseArchiveError(error.problems.map((message) => `cases/${message}`));
    throw error;
  }
  return { name, skillKey, spec: result.data, knowledge: knowledge.sort((a, b) => a.path.localeCompare(b.path)), cases };
}

export function packageMarkdown(metadata: unknown, body: string) { return `---\n${stringifyYaml(metadata)}---\n${body}`; }

/** Sorted paths and a fixed ZIP date make repeat exports byte-for-byte stable. */
export async function exportSkillPackageArchive(name: string, skillKey: string, spec: LogSkillSpec, knowledge: PackagedKnowledge[], cases: Map<string, Buffer>) {
  const { procedure = "", parsing, signalRules, parseTests = [], knowledgeEntryIds: _ids, defaultSourceSnapshotId: _snapshot, ...metadata } = spec;
  const files = new Map<string, Buffer>([
    ["SKILL.md", Buffer.from(packageMarkdown({ name, skillKey, ...metadata }, procedure))],
    ["parsing.yaml", Buffer.from(stringifyYaml(parsing ?? null))],
    ["signals.yaml", Buffer.from(stringifyYaml(signalRules ?? null))],
    ["tests.yaml", Buffer.from(stringifyYaml(parseTests))],
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
