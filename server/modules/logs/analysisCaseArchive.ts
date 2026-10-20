import { posix } from "node:path";
import { crc32 } from "node:zlib";
import JSZip from "jszip";
import { CST, Lexer, isAlias, isMap, isScalar, isSeq, parseDocument, stringify as stringifyYaml } from "yaml";
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
// Seed charging: 5.7 KiB / 178 lines; largest template: 2.3 KiB / 93 lines.
// Leave room for hundreds of extractors and thousands of register-map cases,
// while bounding synchronous YAML composition independently of ZIP inflation.
export const archiveYamlLimits = { maxBytes: 1024 * 1024, maxLines: 20_000, maxItems: 20_000,
  maxDepth: 32, maxAliasCount: 0, maxIssues: 50 };
export class AnalysisCaseArchiveError extends Error {
  override name = "AnalysisCaseArchiveError";
  constructor(readonly problems: string[]) { super(problems.join("\n")); }
}

/** Lexing skips quoted/block scalar contents; no graph is composed before these bounds. */
export function parseArchiveYaml(value: string): unknown {
  const fail = (message: string): never => { throw new Error(message); };
  if (Buffer.byteLength(value) > archiveYamlLimits.maxBytes) fail("YAML 文档超过 1 MiB 上限");
  if ((value.match(/\r\n|\r|\n/g)?.length ?? 0) + 1 > archiveYamlLimits.maxLines) fail("YAML 文档行数超过 20000 行上限");
  let items = 0, flowDepth = 0, scalar = false, lineStart = true, column = 0, sequences = 0;
  const flow: string[] = [], indents: number[] = [];
  const count = () => { if (++items > archiveYamlLimits.maxItems) fail("YAML 映射键和序列项超过 20000 项上限"); };
  for (const token of new Lexer().lex(value)) {
    if (scalar) { scalar = false; lineStart = /[\r\n]$/.test(token); column = 0; continue; }
    if (token === CST.SCALAR) { scalar = true; }
    const type = CST.tokenType(token);
    if (type === "newline") { lineStart = true; column = 0; sequences = 0; continue; }
    if (type === "space") { column += token.length; continue; }
    if (type === "comment" || type === "doc-mode" || type === "doc-start" || type === "byte-order-mark") continue;
    if (lineStart && !flowDepth) {
      while (indents.length && indents.at(-1)! > column) indents.pop();
      if (!indents.length || indents.at(-1)! < column) indents.push(column);
      if (indents.length > archiveYamlLimits.maxDepth) fail("YAML 嵌套深度超过 32 层上限");
    }
    lineStart = false;
    if (type === "alias") fail("YAML 不允许使用别名");
    if (type === "map-value-ind" && flow.at(-1) !== "{" || type === "seq-item-ind" || type === "comma" && flow.length) count();
    if (type === "seq-item-ind" && ++sequences > archiveYamlLimits.maxDepth) fail("YAML 嵌套深度超过 32 层上限");
    if (type === "flow-map-start" || type === "flow-seq-start") {
      flow.push(token); flowDepth++;
      if (flowDepth + indents.length > archiveYamlLimits.maxDepth) fail("YAML 嵌套深度超过 32 层上限");
      count();
    } else if (type === "flow-map-end" || type === "flow-seq-end") { flow.pop(); flowDepth = Math.max(0, flowDepth - 1); }
  }
  // yaml's default uniqueness check compares each pair with all prior keys.
  // Validate scalar keys with a Set instead, including JS object-key collisions.
  const document = parseDocument(value, { uniqueKeys: false, prettyErrors: false });
  if (document.errors.length) fail("YAML 语法无效");
  const pending: Array<{ node: unknown; depth: number }> = [{ node: document.contents, depth: 0 }];
  items = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (isAlias(node)) fail("YAML 不允许使用别名");
    if (!isMap(node) && !isSeq(node)) continue;
    if (depth >= archiveYamlLimits.maxDepth) fail("YAML 嵌套深度超过 32 层上限");
    items += node.items.length;
    if (items > archiveYamlLimits.maxItems) fail("YAML 映射键和序列项超过 20000 项上限");
    if (isMap(node)) {
      const keys = new Set<string>();
      for (const pair of node.items) {
        if (pair.key !== null && (!isScalar(pair.key) || typeof pair.key.value === "object" && pair.key.value !== null)) fail("YAML 映射键必须是标量");
        const key = isScalar(pair.key) ? pair.key.value : null;
        const name = key === null ? "" : String(key);
        if (keys.has(name)) fail(`YAML 映射键重复：${name.slice(0, 100)}`);
        keys.add(name);
        pending.push({ node: pair.value, depth: depth + 1 });
      }
    } else for (const item of node.items) pending.push({ node: item, depth: depth + 1 });
  }
  return document.toJS({ maxAliasCount: archiveYamlLimits.maxAliasCount });
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

function checkedZipPath(bytes: Buffer): string {
  if (bytes.length > 1025) throw new AnalysisCaseArchiveError(["archive.zip: entry path exceeds 1024 bytes"]);
  let name: string;
  try { name = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new AnalysisCaseArchiveError(["archive.zip: entry path is not valid UTF-8"]); }
  if (!safePath(name.replace(/\/$/, ""))) throw new AnalysisCaseArchiveError([`${name}: unsafe archive path`]);
  return name;
}

function checkZipPathExtras(extra: Buffer, rawName: Buffer, name: string): void {
  let fields = 0;
  for (let at = 0; at < extra.length;) {
    if (++fields > 32) throw new AnalysisCaseArchiveError([`${name}: more than 32 ZIP extra fields`]);
    if (at + 4 > extra.length) throw new AnalysisCaseArchiveError([`${name}: invalid ZIP extra fields`]);
    const id = extra.readUInt16LE(at), size = extra.readUInt16LE(at + 2), end = at + 4 + size;
    if (end > extra.length) throw new AnalysisCaseArchiveError([`${name}: invalid ZIP extra fields`]);
    if (id === 0x0001) throw new AnalysisCaseArchiveError([`${name}: ZIP64 is unsupported`]);
    if (id === 0x7075) {
      if (size < 5 || size > 1030) throw new AnalysisCaseArchiveError([`${name}: invalid or oversized Unicode ZIP path`]);
      if (extra[at + 4] === 1 && extra.readUInt32LE(at + 5) === crc32(rawName)) {
        // JSZip can override the raw name with this field, while bundle intake uses the raw name.
        const unicodeName = checkedZipPath(extra.subarray(at + 9, end));
        if (unicodeName !== name) throw new AnalysisCaseArchiveError([`${name}: Unicode ZIP path must match the raw entry path`]);
      }
    }
    at = end;
  }
}

/** Bound metadata allocation before JSZip constructs an object for every directory entry. */
function preflightZipDirectory(bytes: Buffer, limits: typeof analysisCaseArchiveLimits): void {
  // Match the bounded EOCD search and non-ZIP64 layout accepted by bundle intake.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) { end = at; break; }
  }
  if (end < 0) throw new AnalysisCaseArchiveError(["archive.zip: missing ZIP end-of-central-directory record"]);
  // JSZip selects the last signature even inside a comment; both readers must use this EOCD.
  if (bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) !== end) throw new AnalysisCaseArchiveError(["archive.zip: ambiguous ZIP end-of-central-directory record"]);
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) throw new AnalysisCaseArchiveError(["archive.zip: ZIP64 is unsupported"]);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count || start + size !== end) {
    throw new AnalysisCaseArchiveError(["archive.zip: invalid ZIP central directory"]);
  }
  const maxEntries = 2 * limits.maxFiles;
  if (count > maxEntries) throw new AnalysisCaseArchiveError([`archive.zip: entry count exceeds ${maxEntries} including directories`]);
  let entries = 0, files = 0, totalBytes = 0, at = start;
  const paths = new Set<string>();
  // Count actual records too: an attacker can underreport the EOCD entry count.
  while (at < end) {
    if (++entries > maxEntries) throw new AnalysisCaseArchiveError([`archive.zip: entry count exceeds ${maxEntries} including directories`]);
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) throw new AnalysisCaseArchiveError(["archive.zip: invalid ZIP central directory"]);
    const nameLength = bytes.readUInt16LE(at + 28), extraLength = bytes.readUInt16LE(at + 30);
    const next = at + 46 + nameLength + extraLength + bytes.readUInt16LE(at + 32);
    if (next > end) throw new AnalysisCaseArchiveError(["archive.zip: invalid ZIP central directory"]);
    const rawName = bytes.subarray(at + 46, at + 46 + nameLength), name = checkedZipPath(rawName);
    const path = name.replace(/\/$/, "");
    if (paths.has(path)) throw new AnalysisCaseArchiveError([`${path}: duplicate archive path`]);
    paths.add(path);
    const compressed = bytes.readUInt32LE(at + 20), unpacked = bytes.readUInt32LE(at + 24), local = bytes.readUInt32LE(at + 42);
    if (compressed === 0xffffffff || unpacked === 0xffffffff || local === 0xffffffff) throw new AnalysisCaseArchiveError([`${name}: ZIP64 is unsupported`]);
    if (unpacked > limits.maxFileBytes) throw new AnalysisCaseArchiveError([`${name}: declared file size exceeds ${limits.maxFileBytes}`]);
    totalBytes += unpacked;
    if (totalBytes > limits.maxUnpackedBytes) throw new AnalysisCaseArchiveError([`${name}: declared unpacked size exceeds ${limits.maxUnpackedBytes}`]);
    const flags = bytes.readUInt16LE(at + 8), method = bytes.readUInt16LE(at + 10);
    if (flags & 0x41) throw new AnalysisCaseArchiveError([`${name}: encrypted ZIP entries are unsupported`]);
    if (method !== 0 && method !== 8) throw new AnalysisCaseArchiveError([`${name}: unsupported ZIP compression`]);
    if (local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50) throw new AnalysisCaseArchiveError([`${name}: invalid ZIP local header`]);
    const localNameLength = bytes.readUInt16LE(local + 26), localExtraLength = bytes.readUInt16LE(local + 28);
    const data = local + 30 + localNameLength + localExtraLength;
    if (localNameLength !== nameLength || data + compressed > start || bytes.readUInt16LE(local + 6) !== flags
      || bytes.readUInt16LE(local + 8) !== method || !bytes.subarray(local + 30, local + 30 + localNameLength).equals(rawName)) {
      throw new AnalysisCaseArchiveError([`${name}: local ZIP entry does not match its central directory`]);
    }
    checkZipPathExtras(bytes.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength), rawName, name);
    checkZipPathExtras(bytes.subarray(local + 30 + localNameLength, data), rawName, name);
    const directory = nameLength > 0 && bytes[at + 46 + nameLength - 1] === 0x2f
      || (bytes.readUInt32LE(at + 38) >>> 16 & 0xf000) === 0x4000;
    if (!directory && ++files > limits.maxFiles) throw new AnalysisCaseArchiveError([`archive.zip: file count exceeds ${limits.maxFiles}`]);
    at = next;
  }
  if (entries !== count) throw new AnalysisCaseArchiveError(["archive.zip: central directory entry count does not match EOCD"]);
}

/** Validate the complete archive before callers persist any cases or fixture bytes. */
export async function readBoundedZipArchive(
  bytes: Buffer,
  limits = analysisCaseArchiveLimits
): Promise<Map<string, Buffer>> {
  if (bytes.length > limits.maxCompressedBytes) throw new AnalysisCaseArchiveError(["archive.zip: compressed size limit exceeded"]);
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) throw new AnalysisCaseArchiveError(["archive.zip: expected a ZIP archive"]);
  preflightZipDirectory(bytes, limits);
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
  return new Map(unpacked.files.map((file) => [file.path, file.bytes!]));
}

export async function importAnalysisCaseArchive(bytes: Buffer, limits = analysisCaseArchiveLimits): Promise<ArchivedAnalysisCase[]> {
  return parseAnalysisCaseFiles(await readBoundedZipArchive(bytes, limits), limits);
}

/** Also used by skill packages, after the shared ZIP reader has bounded every entry. */
export function parseAnalysisCaseFiles(entries: Map<string, Buffer>, limits = analysisCaseArchiveLimits): ArchivedAnalysisCase[] {
  const groups = new Map<string, Map<string, Buffer>>();
  const problems: string[] = [];
  for (const [path, bytes] of entries) {
    const file = { path, bytes };
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
    try { yaml = parseArchiveYaml(new TextDecoder("utf-8", { fatal: true }).decode(sourceYaml)); }
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
    if (originals?.ok) {
      const analyzed = originals.files.filter((file) => file.status === "analyzed");
      if (!analyzed.length) problems.push(`${yamlPath}:bundleFiles: no analyzable files`);
      if (analyzed.reduce((size, file) => size + bundleFileUtf8Bytes(file).length, 0) > limits.maxCaseBytes) {
        problems.push(`${yamlPath}:bundleFiles: normalized case logs exceed ${limits.maxCaseBytes}`);
      }
    }
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
