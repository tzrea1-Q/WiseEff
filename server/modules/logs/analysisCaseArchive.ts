import { posix } from "node:path";
import JSZip from "jszip";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { logAnalysisCaseExpectationsSchema } from "../contracts/dtoSchemas/logs";
import { compileLogPattern } from "./adminPattern";
import { bundleFileUtf8Bytes, intakeLogBundle } from "./bundleIntake";
import { goldenCaseYamlSchema } from "./eval/goldenCases";
import { validateLogFormatProfile } from "./formatProfile";

export type AnalysisCaseAnnotation = z.infer<typeof logAnalysisCaseExpectationsSchema>;
export type ArchivedAnalysisCase = {
  archivePath: string;
  annotation: AnalysisCaseAnnotation;
  files: Array<{ path: string; bytes: Buffer }>;
  sourceYaml?: Buffer;
};
export const analysisCaseArchiveLimits = {
  maxCases: 20, maxCaseBytes: 10 * 1024 * 1024, maxMetadataBytes: 2 * 1024 * 1024,
  // Each case has original bytes, a normalized eval projection and YAML metadata.
  maxCompressedBytes: 440 * 1024 * 1024, maxUnpackedBytes: 440 * 1024 * 1024,
  maxFiles: 2040, maxFileBytes: 10 * 1024 * 1024
};
export class AnalysisCaseArchiveError extends Error {
  override name = "AnalysisCaseArchiveError";
  constructor(readonly problems: string[]) { super(problems.join("\n")); }
}

export const analysisCaseAnnotationSchema = logAnalysisCaseExpectationsSchema.superRefine((annotation, context) => {
  const golden = goldenCaseYamlSchema.safeParse(annotation);
  if (!golden.success) for (const issue of golden.error.issues) context.addIssue(issue);
  for (const [index, evidence] of (annotation.keyEvidence ?? []).entries()) {
    if (evidence.line === undefined && evidence.pattern === undefined) {
      context.addIssue({ code: "custom", path: ["keyEvidence", index], message: "expected a line anchor or pattern" });
    }
    if (evidence.pattern !== undefined) {
      try { compileLogPattern(evidence.pattern); }
      catch (error) { context.addIssue({ code: "custom", path: ["keyEvidence", index, "pattern"], message: String(error) }); }
    }
  }
});

function safePath(path: string): boolean {
  return path.length > 0 && Buffer.byteLength(path) <= 1024 && !/[\\\0]/.test(path)
    && !path.startsWith("/") && !/^[a-z]:/i.test(path)
    && path.split("/").every((part) => part !== ".." && part !== "." && part !== "")
    && posix.normalize(path) === path;
}

/** Validate the complete archive before callers persist any cases or fixture bytes. */
export async function importAnalysisCaseArchive(
  bytes: Buffer,
  limits = analysisCaseArchiveLimits
): Promise<ArchivedAnalysisCase[]> {
  if (bytes.length > limits.maxCompressedBytes) throw new AnalysisCaseArchiveError(["archive.zip: compressed size limit exceeded"]);
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) throw new AnalysisCaseArchiveError(["archive.zip: expected a ZIP archive"]);
  // JSZip exposes original names before its traversal normalization, without inflating entries.
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); }
  catch { throw new AnalysisCaseArchiveError(["archive.zip: invalid ZIP archive"]); }
  for (const entry of Object.values(zip.files)) {
    const name = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
    if (!safePath(name.replace(/\/$/, ""))) throw new AnalysisCaseArchiveError([`${name}: unsafe archive path`]);
  }
  const unpacked = intakeLogBundle({ fileName: "archive.zip", bytes }, limits, {
    preserveNestedArchives: true, retainOriginalBytes: true
  });
  if (!unpacked.ok) throw new AnalysisCaseArchiveError([`archive.zip: ${unpacked.reason}`]);
  const groups = new Map<string, Map<string, Buffer>>();
  const problems: string[] = [];
  for (const file of unpacked.files) {
    const parts = file.path.split("/");
    // Guides and baseline metadata may accompany the repository's real corpus.
    if (parts.length === 1 && ["README.md", "README.zh-CN.md", "baseline.json"].includes(file.path)) continue;
    if (parts.length < 3 || !/^[a-z0-9][a-z0-9-]*$/.test(parts[0]) || !/^[a-z0-9][a-z0-9-]*$/.test(parts[1])) {
      problems.push(`${file.path}: expected <domain>/<case-id>/<fixture> or case.yaml`); continue;
    }
    const key = parts.slice(0, 2).join("/");
    const group = groups.get(key) ?? new Map<string, Buffer>();
    group.set(parts.slice(2).join("/"), file.bytes!);
    groups.set(key, group);
  }
  if (groups.size > limits.maxCases) problems.push(`archive.zip: case count exceeds ${limits.maxCases}`);
  if (groups.size === 0) problems.push("archive.zip: no analysis cases found");
  const cases: ArchivedAnalysisCase[] = [];
  for (const [archivePath, files] of groups) {
    const yamlPath = `${archivePath}/case.yaml`;
    const sourceYaml = files.get("case.yaml");
    if (!sourceYaml) { problems.push(`${yamlPath}: missing annotation`); continue; }
    if (sourceYaml.length > limits.maxMetadataBytes) { problems.push(`${yamlPath}: annotation size exceeds ${limits.maxMetadataBytes}`); continue; }
    let yaml: unknown;
    try { yaml = parseYaml(new TextDecoder("utf-8", { fatal: true }).decode(sourceYaml), { maxAliasCount: 0 }); }
    catch (error) { problems.push(`${yamlPath}: invalid YAML (${String(error)})`); continue; }
    const source = yaml && typeof yaml === "object" && !Array.isArray(yaml) ? yaml as Record<string, unknown> : {};
    const missing = ["domain", "summary", "realLog", "rootCauseCategory"].filter((field) => !Object.hasOwn(source, field));
    if (missing.length) { problems.push(...missing.map((field) => `${yamlPath}:${field}: required golden-case field`)); continue; }
    const parsed = analysisCaseAnnotationSchema.safeParse(yaml);
    if (!parsed.success) {
      problems.push(...parsed.error.issues.map((issue) => `${yamlPath}:${issue.path.join(".") || "(root)"}: ${issue.message}`));
      continue;
    }
    const annotation = parsed.data;
    if (annotation.domain !== archivePath.split("/")[0]) problems.push(`${yamlPath}:domain: must match parent directory`);
    if (annotation.formatProfile !== undefined) {
      const profile = validateLogFormatProfile(annotation.formatProfile);
      if (!profile.ok) problems.push(`${yamlPath}:formatProfile: ${profile.issues.join("; ")}`);
    }
    const bundleFiles = annotation.bundleFiles ?? ["log.txt"];
    if (bundleFiles.reduce((size, name) => size + (files.get(name)?.length ?? 0), 0) > limits.maxCaseBytes) {
      problems.push(`${archivePath}: case bundle size exceeds ${limits.maxCaseBytes}`); continue;
    }
    if ([...files].reduce((size, [name, bytes]) => size + (name !== "case.yaml" && !bundleFiles.includes(name) ? bytes.length : 0), 0) > limits.maxCaseBytes) {
      problems.push(`${archivePath}: additional eval fixtures exceed ${limits.maxCaseBytes}`); continue;
    }
    if (files.size > 102) problems.push(`${archivePath}: case exceeds 100 original fixtures`);
    if (new Set(bundleFiles).size !== bundleFiles.length) problems.push(`${yamlPath}:bundleFiles: duplicate fixture path`);
    for (const fixture of bundleFiles) {
      if (!safePath(fixture) || fixture === "case.yaml") problems.push(`${yamlPath}:bundleFiles: unsafe fixture path ${fixture}`);
      else if (!files.has(fixture)) problems.push(`${archivePath}/${fixture}: missing fixture`);
    }
    const log = files.get("log.txt");
    if (!log) problems.push(`${archivePath}/log.txt: missing canonical eval projection`);
    else {
      const lines = log.toString("utf8").split(/\r\n|\n|\r/);
      annotation.keyEvidenceLines.forEach((line, index) => {
        if (!lines[line - 1]?.trim()) problems.push(`${yamlPath}:keyEvidenceLines.${index}: ${archivePath}/log.txt:${line} is missing or blank`);
      });
    }
    const originals = bundleFiles.every((name) => safePath(name) && files.has(name))
      ? intakeLogBundle(bundleFiles.map((name) => ({ fileName: name.replace(/^fixtures\//, ""), bytes: files.get(name)! })), {
        maxCompressedBytes: limits.maxCaseBytes, maxUnpackedBytes: limits.maxCaseBytes, maxFileBytes: limits.maxFileBytes, maxFiles: 100
      }) : undefined;
    if (originals && !originals.ok) problems.push(`${yamlPath}:bundleFiles: ${originals.reason}`);
    for (const [index, evidence] of (annotation.keyEvidence ?? []).entries()) {
      const original = originals?.ok ? originals.files.find((file) => file.path === evidence.file || `fixtures/${file.path}` === evidence.file) : undefined;
      const evidenceBytes = original?.status === "analyzed" ? bundleFileUtf8Bytes(original) : undefined;
      if (!safePath(evidence.file) || !evidenceBytes) problems.push(`${yamlPath}:keyEvidence.${index}.file: missing fixture ${evidence.file}`);
      else {
        const lines = evidenceBytes.toString("utf8").split(/\r\n|\n|\r/);
        if (evidence.line !== undefined && !lines[evidence.line - 1]?.trim()) {
          problems.push(`${yamlPath}:keyEvidence.${index}.line: ${archivePath}/${evidence.file}:${evidence.line} is missing or blank`);
        }
        if (evidence.pattern) {
          const pattern = compileLogPattern(evidence.pattern);
          if (!lines.some((line, at) => line.trim() && (evidence.line === undefined || evidence.line === at + 1) && pattern.test(line))) {
            problems.push(`${yamlPath}:keyEvidence.${index}.pattern: pattern matches no non-blank original log line`);
          }
        }
      }
    }
    cases.push({ archivePath, annotation, sourceYaml, files: [...files].filter(([name]) => name !== "case.yaml").map(([path, bytes]) => ({ path, bytes })) });
  }
  if (problems.length) throw new AnalysisCaseArchiveError(problems);
  return cases;
}

/** Imported source YAML and fixture bytes are retained verbatim, including comments and encodings. */
export async function exportAnalysisCaseArchive(cases: ArchivedAnalysisCase[], limits = analysisCaseArchiveLimits): Promise<Buffer> {
  const zip = new JSZip();
  const paths = new Set<string>();
  for (const item of cases) {
    let annotation = item.annotation;
    const files = [...item.files];
    if (!item.sourceYaml && annotation.bundleFiles) {
      const originals = annotation.bundleFiles.map((name) => {
        const file = files.find((file) => file.path === name);
        if (!file) throw new AnalysisCaseArchiveError([`${item.archivePath}/${name}: missing fixture`]);
        return { fileName: name.replace(/^fixtures\//, ""), bytes: file.bytes };
      });
      const bundle = intakeLogBundle(originals, { maxCompressedBytes: limits.maxCaseBytes,
        maxUnpackedBytes: limits.maxCaseBytes, maxFileBytes: limits.maxFileBytes, maxFiles: 100 });
      if (!bundle.ok) throw new AnalysisCaseArchiveError([`${item.archivePath}:bundleFiles: ${bundle.reason}`]);
      let offset = 0;
      const evidence: number[] = [];
      const texts = bundle.files.filter((file) => file.status === "analyzed").map((file) => {
        const text = bundleFileUtf8Bytes(file).toString("utf8").replace(/\r\n|\r/g, "\n").replace(/\n$/, "");
        const lines = text.split("\n");
        for (const expected of annotation.keyEvidence ?? []) {
          if (expected.file !== file.path && expected.file !== `fixtures/${file.path}`) continue;
          if (expected.line !== undefined) evidence.push(offset + expected.line);
          else if (expected.pattern) {
            const pattern = compileLogPattern(expected.pattern);
            lines.forEach((line, index) => { if (line.trim() && pattern.test(line)) evidence.push(offset + index + 1); });
          }
        }
        offset += lines.length;
        return text;
      });
      if (!files.some((file) => file.path === "log.txt")) files.push({ path: "log.txt", bytes: Buffer.from(texts.join("\n")) });
      if (annotation.keyEvidence?.length) annotation = { ...annotation, keyEvidenceLines: [...new Set(evidence)] };
    }
    for (const file of [{ path: "case.yaml", bytes: item.sourceYaml ?? Buffer.from(stringifyYaml(annotation)) }, ...files]) {
      const path = `${item.archivePath}/${file.path}`;
      if (!safePath(path) || paths.has(path)) throw new AnalysisCaseArchiveError([`${path}: unsafe or duplicate archive path`]);
      paths.add(path);
      zip.file(path, file.bytes, { createFolders: false });
    }
  }
  // Stored entries keep repetitive original logs within the same intake compression-ratio budget.
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
  await importAnalysisCaseArchive(bytes, limits);
  return bytes;
}
