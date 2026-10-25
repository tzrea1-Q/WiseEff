import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { stripDtsComments } from "./preprocess";
import type { DtsConfigSetInput } from "./configSetResolver";
import { parseDts } from "./parser";
import { parseDtsValue } from "./valueAst";
import type { DtsDocument, DtsNodeCst, DtsPropertyCst } from "./types";
import { dtsDefinesSchema } from "../contracts/dtoSchemas/dtsPreprocessing";

const PREFIX = "__wiseeff_dts_hash_property__";
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_OUTPUT = 32 * 1024 * 1024;
const MAX_STATEMENTS = 100_000;
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
// Match UTF-16 code units so masked astral characters retain their original CST offsets.
const blank = (text: string) => text.replace(/[^\r\n]/g, " ");

/** CPP headers also have character literals; comment delimiters inside them are data. */
function stripCppComments(text: string) {
  return text.replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*/gu,
    token => token.startsWith('"') || token.startsWith("'") ? token : blank(token));
}

export type DtsPreprocessingFailureCode = "preprocess-input" | "preprocess-limit" | "preprocess-origin" | "preprocess-failed" | "preprocess-unavailable" | "preprocess-stale" | "preprocess-busy" | "path-escape";
export class DtsPreprocessingError extends Error {
  constructor(public readonly code: DtsPreprocessingFailureCode, message: string, public readonly fileName: string, public readonly offset = 0) { super(message); }
}
export type DtsPreprocessingReceipt = {
  schemaVersion: "dts-cpp/v1";
  image: string;
  platform: "linux/amd64";
  compilerVersion: "14.2.0";
  language: "c17";
  encoding: "UTF-8";
  locale: "C";
  defines?: Record<string, string>;
  inputDigest: string;
  outputDigest: string;
};
type Segment = { start: number; end: number; sourceName: string; sourceStart: number };
export type PreparedDtsDocument = { text: string; document: DtsDocument; originalDocument: DtsDocument;
  originForSpan: (span: { start: number; end: number }) => { sourceName: string; start: number; end: number } | null };
export type PreparedDtsSources = { receipt: DtsPreprocessingReceipt; documents: Map<string, PreparedDtsDocument>;
  originalDocuments: Map<string, DtsDocument>; sourceFiles: string[]; declaredSourceFiles: string[] };

export function pinnedDtsPreprocessor() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  return (JSON.parse(readFileSync(join(root, "tools/dts-toolchain/versions.json"), "utf8")) as {
    preprocessing: { image: string; version: "14.2.0"; platform: "linux/amd64" }
  }).preprocessing;
}

/** A missing sandbox is unavailable; request handling never pulls images or uses host CPP. */
export async function probeDtsPreprocessor() {
  const pin = pinnedDtsPreprocessor();
  if (!pin) return { available: false, version: null, reason: "Pinned preprocessing capability is unavailable." };
  const probe = await boundedDocker(["image", "inspect", pin.image, "--format", "{{.Os}}/{{.Architecture}}"], 5000, 8192);
  const limits = probe.status === 0 ? await boundedDocker(["info", "--format", "{{.MemoryLimit}} {{.SwapLimit}} {{.PidsLimit}}"], 5000, 8192) : null;
  const available = probe.status === 0 && probe.stdout.trim() === pin.platform && limits?.status === 0 && limits.stdout.trim() === "true true true";
  return { available, version: pin.version,
    reason: available ? null : "受控预处理工具或内存隔离不可用；请联系管理员配置固定工具链，或继续编辑原始源码。" };
}
function dockerEnvironment(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: "C", LANG: "C" };
}

function boundedDocker(args: string[], timeoutMs: number, maxBytes: number): Promise<{
  stdout: string; stderr: string; status: number | null; error?: Error; limited: boolean;
}> {
  return new Promise(resolve => {
    const child = spawn("docker", args, { env: dockerEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let size = 0, limited = false, settled = false;
    const timer = setTimeout(() => { limited = true; child.kill("SIGKILL"); }, timeoutMs);
    const finish = (status: number | null, error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), status, error, limited });
    };
    const consume = (target: Buffer[], chunk: Buffer) => {
      if (settled || limited) return;
      size += chunk.length;
      if (size > maxBytes) { limited = true; child.kill("SIGKILL"); return; }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => consume(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => consume(stderr, chunk));
    child.on("error", error => finish(null, error));
    child.on("close", status => finish(status));
  });
}

function checkedInputs(input: DtsConfigSetInput) {
  const transformed = new Map<string, string>(), directiveLines = new Map<string, Set<number>>();
  const edges = new Map<string, string[]>();
  const includeGraph: Array<{ sourceName: string; target: string; line: number; column: number }> = [];
  let total = 0;
  const defines = normalizeDtsDefines(input.defines ?? input.preprocessing?.defines, input.entryFile);
  for (const [name, value] of Object.entries(defines)) {
    const tokens = stripCppComments(value).replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu, "");
    if (/\b__(?:DATE|TIME|TIMESTAMP|FILE|BASE_FILE|COUNTER|INCLUDE_LEVEL)__\b|\b__has_(?:include|embed|builtin|feature|extension|attribute)\b|\b_Pragma\b|##/u.test(tokens) || tokens.includes(PREFIX))
      throw new DtsPreprocessingError("preprocess-input", `构建宏 ${name} 包含未冻结时间、环境探测或编译器指令；请修改构建设置。`, input.entryFile);
  }
  const fail = (name: string, line: number, message: string): never => {
    const offset = input.files.get(name)!.content.split("\n").slice(0, line - 1).reduce((size, value) => size + value.length + 1, 0);
    throw new DtsPreprocessingError("preprocess-input", `${name}:${line}：${message} 请在原始源码中修正后重新预览。`, name, offset);
  };
  if (input.files.size > 128) throw new DtsPreprocessingError("preprocess-limit", "预处理成员超过 128 个。", input.entryFile);
  const safePath = (name: string) => name !== "." && name === posix.normalize(name) && !name.startsWith("/") && name !== ".."
    && !name.startsWith("../") && !/[:\\\u0000-\u001f\u007f]/u.test(name);
  if (input.includeSearchPaths.some(root => root !== "." && !safePath(root))) throw new DtsPreprocessingError("path-escape", "预处理搜索目录必须在冻结清单内。", input.entryFile);
  const literalTarget = (name: string, target: string, quoted: boolean, line: number) => {
    if (target.startsWith("/") || /[:\\\u0000-\u001f\u007f]/u.test(target)) fail(name, line, "include 不能读取绝对路径或宿主文件。");
    const roots = quoted ? [posix.dirname(name), ...input.includeSearchPaths, "."] : [...input.includeSearchPaths, "."];
    let found: string | undefined;
    for (const [index, root] of roots.entries()) {
      const candidate = posix.join(root, target);
      if (!safePath(candidate)) { if (!found) fail(name, line, "include 搜索会先逃逸冻结清单。"); continue; }
      if (!input.files.has(candidate)) continue;
      if (quoted && index === 0) return candidate;
      if (found && found !== candidate) fail(name, line, `依赖 ${target} 同时匹配多个搜索目录；请使用明确的相对路径或调整构建设置。`);
      found = candidate;
    }
    if (!found) fail(name, line, `缺少冻结依赖 ${target}。`);
    return found!;
  };
  for (const [name, file] of input.files) {
    if (!safePath(name)) throw new DtsPreprocessingError("path-escape", "预处理文件必须使用清单内的相对路径。", name);
    total += Buffer.byteLength(file.content);
    if (total > MAX_BYTES || Buffer.byteLength(file.content) > 2 * 1024 * 1024) fail(name, 1, "预处理原始输入超过文件 2 MiB / 清单 16 MiB 上限。");
    if (Buffer.from(file.content).toString("utf8") !== file.content) fail(name, 1, "源码不是完整 UTF-8 文本。");
    if (file.content.includes(PREFIX) || file.content.includes("??") || file.content.includes("%:") || file.content.includes("\0")) fail(name, 1, "源码含不支持的预处理保留标记、替代指令字符或空字符。");
    const clean = stripCppComments(file.content.replace(/\r\n/gu, "\n").replace(/^\uFEFF/u, " "));
    // Spliced directives are checked as one logical line, including dead conditional branches.
    const lines = clean.split("\n"), originalLines = file.content.replace(/^\uFEFF/u, " ").split("\n");
    const masked = new Set<number>(), dependencies: string[] = [];
    for (let index = 0; index < lines.length; index++) {
      const first = index;
      let line = lines[index]!;
      while (line.endsWith("\\") && index + 1 < lines.length) line = line.slice(0, -1) + lines[++index]!;
      const tokens = line.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu, "");
      if (tokens.includes("##") || tokens.includes(PREFIX)) fail(name, first + 1, "当前冻结合约不支持 token-pasting 或预处理保留标记。");
      if (/\b__(?:DATE|TIME|TIMESTAMP|FILE|BASE_FILE|COUNTER|INCLUDE_LEVEL)__\b/u.test(tokens)) fail(name, first + 1, "时间、路径或环境宏未声明为冻结输入，不能发布。");
      if (/\b__has_(?:include|embed|builtin|feature|extension|attribute)\b/u.test(tokens)) fail(name, first + 1, "当前冻结合约不支持环境探测宏。");
      if (/\b_Pragma\b/u.test(tokens)) fail(name, first + 1, "当前冻结合约不支持计算生成的编译器指令。");
      const directive = /^\s*#\s*([A-Za-z_][A-Za-z_0-9]*|\d+)/u.exec(line);
      if (!directive || /^\s*#[\w-]+\s*=/u.test(line)) continue;
      for (let cursor = first; cursor <= index; cursor++) masked.add(cursor + 1);
      if (!["include", "define", "undef", "if", "ifdef", "ifndef", "elif", "else", "endif", "error", "warning"].includes(directive[1]!)) fail(name, first + 1, `不支持 #${directive[1]} 指令（包括源码位置重映射）。`);
      if (directive[1] === "include") {
        const include = /^\s*#\s*include\s*(?:"([^"\n]+)"|<([^>\n]+)>)\s*$/u.exec(line);
        if (!include) fail(name, first + 1, "include 必须是明确的清单内字面路径；不支持宏计算文件名。");
        const target = include![1] ?? include![2]!;
        const found = literalTarget(name, target, Boolean(include![1]), first + 1);
        dependencies.push(found!);
        includeGraph.push({ sourceName: name, target: found!, line: first + 1, column: line.indexOf("#") + 1 });
      }
    }
    for (let index = 0; index < lines.length; index++) {
      if (masked.has(index + 1)) continue;
      const native = /^\s*\/include\/\s*"([^"\n]+)"\s*;?\s*$/u.exec(lines[index]!);
      if (native) {
        const target = native[1]!;
        const found = literalTarget(name, target, true, index + 1);
        dependencies.push(found!); masked.add(index + 1);
        includeGraph.push({ sourceName: name, target: found!, line: index + 1, column: lines[index]!.indexOf("/include/") + 1 });
        originalLines[index] = `#include "${target}"`;
      } else if (lines[index]!.includes("/include/")) fail(name, index + 1, "启用 C 预处理时，原生 include 必须独占一行。");
      else if (/^\s*#[\w-]+\s*=/u.test(lines[index]!)) originalLines[index] = `${PREFIX} ${originalLines[index]}`;
    }
    transformed.set(name, originalLines.join("\n")); directiveLines.set(name, masked); edges.set(name, dependencies);
  }
  const depths = new Map<string, number>();
  const visit = (name: string, stack: string[]): number => {
    if (stack.includes(name) || stack.length >= 16) fail(name, 1, "include 循环或嵌套超过 16 层。");
    const known = depths.get(name); if (known !== undefined) return known;
    let depth = 1;
    for (const target of edges.get(name) ?? []) depth = Math.max(depth, 1 + visit(target, [...stack, name]));
    if (depth > 16) fail(name, 1, "include 嵌套超过 16 层。");
    depths.set(name, depth); return depth;
  };
  for (const name of input.files.keys()) visit(name, []);
  return { transformed, directiveLines, edges, includeGraph, defines };
}

export function normalizeDtsDefines(value: unknown, entryFile: string): Record<string, string> {
  const parsed = dtsDefinesSchema.safeParse(value ?? {});
  if (!parsed.success) throw new DtsPreprocessingError("preprocess-input", "构建宏必须是最多 32 个 NAME=value；名称不能覆盖保留宏，值不能含控制字符或超过 256 字符。", entryFile);
  return Object.fromEntries(Object.entries(parsed.data).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

export function requiresDtsPreprocessing(files: DtsConfigSetInput["files"], defines?: Readonly<Record<string, string>>) {
  return Boolean(defines && Object.keys(defines).length) || [...files].some(([name, file]) => !/\.(h|hpp)$/u.test(name) && stripCppComments(file.content).split("\n")
    .some(line => /^\s*#/u.test(line) && !/^\s*#[\w-]+\s*=/u.test(line)));
}

export function inspectDtsCppIncludes(input: DtsConfigSetInput) { return checkedInputs(input).includeGraph; }

export function dtsPreprocessingInputDigest(input: DtsConfigSetInput) {
  const defines = normalizeDtsDefines(input.defines ?? input.preprocessing?.defines, input.entryFile);
  return sha(JSON.stringify({ entryFile: input.entryFile, overlayOrder: input.overlayOrder, includeSearchPaths: input.includeSearchPaths,
    ...(Object.keys(defines).length ? { defines } : {}),
    files: [...input.files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, file]) => [name, sha(file.content)]) }));
}

/** Run only the pinned Linux image with a read-only, operation-owned manifest mount. */
async function runCpp(root: string, entry: string, roots: string[], defines: Record<string, string>, directivesOnly: boolean, deadline: number): Promise<string> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new DtsPreprocessingError("preprocess-limit", "完整工程预处理超过 30 秒上限。", entry);
  const pin = pinnedDtsPreprocessor(), name = `wiseeff-cpp-${randomUUID()}`;
  const result = await boundedDocker(["run", "--rm", "--pull=never", "--name", name, "--label", `wiseeff.dts.cpp.owner=${process.pid}`, "--platform", pin.platform,
    "--network=none", "--read-only", "--log-driver=none", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=8", "--memory=512m", "--memory-swap=512m",
    `--user=${process.getuid?.() || 65534}:${process.getgid?.() || 65534}`, "--ulimit=cpu=5:5", "--ulimit=fsize=33554432:33554432", "--workdir=/source", "--env=LC_ALL=C", "--env=LANG=C",
    "--mount", `type=bind,source=${root},target=/source,readonly`, "--entrypoint=/usr/bin/timeout", pin.image,
    "--signal=KILL", "5s", "/usr/local/bin/gcc", "-E", "-x", "c", "-std=c17", "-nostdinc", "-undef", "-Werror", "-D__DTS__=1", "-finput-charset=UTF-8", "-fexec-charset=UTF-8",
    ...Object.entries(defines).flatMap(([name, value]) => ["-D", `${name}=${value}`]),
    "-fmax-include-depth=16", "-ftrack-macro-expansion=0", ...roots.flatMap(path => ["-I", path]), "-I", ".",
    ...(directivesOnly ? ["-fdirectives-only"] : []), `./${entry}`], Math.min(10_000, remaining), MAX_OUTPUT);
  if (result.error || result.limited || result.status !== 0) {
    // Killing a Docker client does not kill its container; explicitly reap that exact owned name.
    await boundedDocker(["rm", "--force", name], 3000, 8192);
    const limited = result.limited || [124, 137, 152].includes(result.status ?? 0)
      || /^gcc: fatal error: Killed signal terminated program cc1$/mu.test(result.stderr ?? "");
    throw new DtsPreprocessingError(limited ? "preprocess-limit" : "preprocess-failed",
      `${entry}：受控预处理失败或超过输出/时间/内存上限。${(result.stderr ?? "").slice(0, 4096)}`, entry);
  }
  return result.stdout;
}

let activeOperation = false;
export function assertDtsPreprocessingAvailable(entryFile:string) {
  if (activeOperation) throw new DtsPreprocessingError("preprocess-busy", "当前有工程正在预处理；请保留输入并稍后重新预览。", entryFile);
}
export async function prepareDtsSources(input: DtsConfigSetInput): Promise<PreparedDtsSources | null> {
  if (!requiresDtsPreprocessing(input.files, input.defines ?? input.preprocessing?.defines)) return null;
  assertDtsPreprocessingAvailable(input.entryFile);
  activeOperation = true;
  try { return await prepareOriginalSources(input); }
  finally { activeOperation = false; }
}

async function prepareOriginalSources(input: DtsConfigSetInput): Promise<PreparedDtsSources> {
  const deadline = Date.now() + 30_000;
  const { transformed, directiveLines, defines, edges } = checkedInputs(input);
  const declared = new Set<string>();
  const visitDeclared = (name: string) => { if (declared.has(name)) return; declared.add(name); for (const child of edges.get(name) ?? []) visitDeclared(child); };
  for (const root of [input.entryFile, ...input.overlayOrder]) visitDeclared(root);
  const probe = await probeDtsPreprocessor();
  if (!probe.available) throw new DtsPreprocessingError("preprocess-unavailable", probe.reason!, input.entryFile);
  const pin = pinnedDtsPreprocessor(), root = mkdtempSync(join(tmpdir(), "wiseeff-cpp-"));
  const documents = new Map<string, PreparedDtsDocument>(), originalDocuments = new Map<string, DtsDocument>();
  const activeLines = new Map<string, Set<number>>(), sourceFiles = new Set<string>();
  const semanticProperties = new Map<string, DtsPropertyCst>();
  let statements = 0, totalOriginalBytes = 0, totalExpandedBytes = 0;
  const fail = (name: string, message: string): never => { throw new DtsPreprocessingError("preprocess-origin", `${name}：${message} 请编辑原始源码，或在项目中添加明确的本地覆盖。`, name); };
  const originals = new Map([...input.files].map(([name, file]) => [name, file.content.split("\n")]));
  const cleanOriginals = new Map([...input.files].map(([name, file]) => [name, stripDtsComments(file.content).split("\n")]));
  const starts = new Map([...originals].map(([name, lines]) => { let offset = 0; return [name, lines.map(line => { const start = offset; offset += line.length + 1; return start; })]; }));
  const outputText = (output: string, original: boolean) => {
    const segments: Segment[] = [];
    let sourceName = "", sourceLine = 0, text = "";
    const clean = stripDtsComments(output).split("\n");
    for (const [index, line] of output.split("\n").entries()) {
      const marker = /^# (\d+) "([^"\\]+)"(?: [1-4])*$/u.exec(line);
      if (marker) {
        sourceName = posix.normalize(marker[2]!); sourceLine = Number(marker[1]);
        if (!sourceName.startsWith("<") && !input.files.has(sourceName)) fail(input.entryFile, "编译器返回清单外的源码位置。");
        if (input.files.has(sourceName)) sourceFiles.add(sourceName);
        continue;
      }
      if (!input.files.has(sourceName)) continue;
      const number = sourceLine++;
      if (/^\s*#\s*(?:define|undef)\b/u.test(line) || directiveLines.get(sourceName)!.has(number)) continue;
      const content = line.replace(new RegExp(`^${PREFIX} `, "u"), "");
      if (!content.trim()) { text += "\n"; continue; }
      if (!original) { text += content + "\n"; continue; }
      const source = originals.get(sourceName)![number - 1];
      if (source === undefined) fail(sourceName, "展开位置超出原始成员。");
      const expected = cleanOriginals.get(sourceName)![number - 1]!.replace(/^\uFEFF/u, " ").trim().replace(/\s+/gu, " ");
      const actual = clean[index]!.replace(new RegExp(`^${PREFIX} `, "u"), "").trim().replace(/\s+/gu, " ");
      if (expected !== actual) fail(sourceName, "活动源码与冻结原始行不一致，无法证明唯一写入位置。");
      if (/\.(h|hpp)$/u.test(sourceName) && actual) fail(sourceName, "头文件只能提供预处理定义；请将设备树声明保留在 .dtsi 原始成员中。");
      let active = activeLines.get(sourceName); if (!active) { active = new Set(); activeLines.set(sourceName, active); } active.add(number);
      const start = text.length;
      text += source!.replace(/^\uFEFF/u, " ") + "\n";
      segments.push({ start, end: text.length - 1, sourceName, sourceStart: starts.get(sourceName)![number - 1]! });
    }
    const segmentAt = (offset: number) => {
      let low = 0, high = segments.length - 1;
      while (low <= high) {
        const middle = (low + high) >>> 1, segment = segments[middle]!;
        if (offset < segment.start) high = middle - 1;
        else if (offset > segment.end) low = middle + 1;
        else return segment;
      }
      return undefined;
    };
    const origin = (span: { start: number; end: number }) => {
      const first = segmentAt(span.start), last = segmentAt(span.end);
      return first && last && first.sourceName === last.sourceName ? { sourceName: first.sourceName,
        start: first.sourceStart + span.start - first.start, end: last.sourceStart + span.end - last.start } : null;
    };
    return { text, origin };
  };
  try {
    for (const [name, content] of transformed) {
      const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content, { mode: 0o444 });
    }
    for (const entry of [input.entryFile, ...input.overlayOrder]) {
      const active = outputText(await runCpp(root, entry, input.includeSearchPaths, defines, true, deadline), true);
      const expanded = outputText(await runCpp(root, entry, input.includeSearchPaths, defines, false, deadline), false);
      totalOriginalBytes += Buffer.byteLength(active.text); totalExpandedBytes += Buffer.byteLength(expanded.text);
      if (totalOriginalBytes > MAX_OUTPUT || totalExpandedBytes > MAX_OUTPUT) throw new DtsPreprocessingError("preprocess-limit", "完整配置展开超过 32 MiB 上限。", entry);
      let document: DtsDocument, originalDocument: DtsDocument;
      try { document = parseDts(expanded.text); originalDocument = parseDts(active.text); }
      catch (error) { return fail(entry, `预处理后仍有不支持的设备树语法：${error instanceof Error ? error.message : "解析失败"}`); }
      const origins = new Map<string, { sourceName: string; start: number; end: number }>();
      if (!document.topLevel.length) fail(entry, "预处理后没有设备树声明，不能将空图视为成功。");
      const compare = (raw: DtsNodeCst[], semantic: DtsNodeCst[]) => {
        if (raw.length !== semantic.length) fail(entry, "宏生成了节点声明，不能猜测其原始写入目标。");
        for (let index = 0; index < raw.length; index++) {
          const before = raw[index]!, after = semantic[index]!;
          const nodeOrigin = active.origin({ start: before.span.start, end: before.span.start });
          if (nodeOrigin) origins.set(JSON.stringify({ start: after.span.start, end: after.span.start }), nodeOrigin);
          if (++statements > MAX_STATEMENTS) fail(entry, "展开声明超过 100000 项上限。");
          if (before.name !== after.name || before.refTarget !== after.refTarget || before.unitAddress !== after.unitAddress || JSON.stringify(before.labels) !== JSON.stringify(after.labels)
            || before.children.length !== after.children.length) fail(entry, "宏改变了节点或属性声明，无法证明唯一原始来源。");
          for (let childIndex = 0; childIndex < before.children.length; childIndex++) {
            const original = before.children[childIndex]!, value = after.children[childIndex]!;
            if (++statements > MAX_STATEMENTS) fail(entry, "展开声明超过 100000 项上限。");
            if (original.kind !== value.kind || original.name !== value.name) fail(entry, "宏生成或改名了声明，不能猜测写入目标。");
            if (original.kind === "node" && value.kind === "node") { compare([original], [value]); continue; }
            const origin = active.origin(original.span);
            if (!origin) fail(entry, "属性跨越不同原始成员，无法证明唯一写入范围。");
            if (original.kind === "property") {
              const exact = input.files.get(origin!.sourceName)!.content.slice(origin!.start, origin!.end);
              if (original.rawText ? exact !== original.rawText : exact.trim() !== original.name) fail(origin!.sourceName, "属性值跨越预处理指令或其他成员，不能猜测原始写入范围。");
            }
            origins.set(JSON.stringify(value.span), origin!);
            origins.set(JSON.stringify({ start: value.span.start, end: value.span.start }), origin!);
            if (value.kind === "property") {
              try { value.value = parseDtsValue(value.name, value.rawText).value; }
              catch { fail(origin!.sourceName, `属性 ${value.name} 的展开值不受支持。`); }
              const key = JSON.stringify([origin!.sourceName, origin!.start, origin!.end, value.name]);
              const previous = semanticProperties.get(key);
              if (previous && JSON.stringify(previous.value) !== JSON.stringify(value.value)) fail(origin!.sourceName, `属性 ${value.name} 在多个宏上下文中产生不同结果，来源不唯一。`);
              semanticProperties.set(key, value);
            }
          }
        }
      };
      compare(originalDocument.topLevel, document.topLevel);
      documents.set(entry, { text: expanded.text, document, originalDocument, originForSpan: span => origins.get(JSON.stringify(span)) ?? null });
    }
    for (const [name, file] of input.files) {
      if (/\.(h|hpp)$/u.test(name)) continue;
      const masked = file.content.split("\n").map((line, index) => activeLines.get(name)?.has(index + 1) ? line : blank(line)).join("\n");
      try {
        const originalDocument = parseDts(masked.replace(/^\uFEFF/u, " "));
        const enrich = (nodes: DtsNodeCst[]) => { for (const node of nodes) for (const child of node.children) {
          if (child.kind === "node") enrich([child]);
          else if (child.kind === "property") {
            const semantic = semanticProperties.get(JSON.stringify([name, child.span.start, child.span.end, child.name]));
            if (!semantic) fail(name, `属性 ${child.name} 缺少展开来源证明。`);
            child.value = semantic!.value; child.valueType = semantic!.valueType; child.normalizedValue = semantic!.normalizedValue;
          }
        } };
        enrich(originalDocument.topLevel); originalDocuments.set(name, originalDocument);
      }
      catch { fail(name, "原始成员不能作为完整语法声明定位；请保留节点和属性声明，宏仅用于值。"); }
    }
    const receipt: DtsPreprocessingReceipt = { schemaVersion: "dts-cpp/v1", image: pin.image, platform: pin.platform, compilerVersion: pin.version,
      language: "c17", encoding: "UTF-8", locale: "C", ...(Object.keys(defines).length ? { defines } : {}), inputDigest: dtsPreprocessingInputDigest(input),
      outputDigest: sha(JSON.stringify([...documents].map(([entry, document]) => [entry, document.text]))) };
    if (Date.now() > deadline) throw new DtsPreprocessingError("preprocess-limit", "完整工程预处理超过 30 秒上限。", input.entryFile);
    return { receipt, documents, originalDocuments, sourceFiles: [...sourceFiles], declaredSourceFiles: [...declared] };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
