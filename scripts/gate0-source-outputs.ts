import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

type CapturedFile = {
  relativePath: string;
  existedBefore: boolean;
  content?: Buffer;
  sha256Before?: string;
};

export type Gate0SourceOutputSnapshot = {
  worktreeRoot: string;
  runRoot: string;
  directFiles: string[];
  recursiveRoots: string[];
  files: Map<string, CapturedFile>;
};

export const gate0SourceOutputDirectFiles = [
  "docs/generated/acceptance-browser-evidence.md",
  "docs/generated/acceptance-operation-evidence.md",
  "docs/generated/acceptance-operation-evidence/index.json",
] as const;

// Gate0 redirects Playwright snapshots into its run root. Recursive source-tree
// cleanup is intentionally disabled because a new file cannot be proven to be
// owned by this run rather than a concurrent user or agent.
export const gate0SourceOutputRecursiveRoots = [] as const;

const visualBaselineRoot = "e2e/quality/visual.quality.spec.ts-snapshots";
const supportedVisualPlatforms = new Set(["darwin", "linux", "win32"]);
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function stageGate0VisualBaselines(input: {
  worktreeRoot: string;
  runRoot: string;
  sourceCommit: string;
  platform?: string;
  signal?: AbortSignal;
}) {
  const worktreeRoot = path.resolve(input.worktreeRoot);
  const runRoot = path.resolve(input.runRoot);
  const platform = input.platform ?? process.platform;
  if (!/^[a-f0-9]{40}$/u.test(input.sourceCommit)) {
    throw new Error("Gate0 visual baseline source commit must be exact.");
  }
  if (!supportedVisualPlatforms.has(platform)) {
    throw new Error(`Gate0 visual baseline platform is unsupported: ${platform}.`);
  }

  const sourceRoot = `${visualBaselineRoot}/${platform}`;
  const snapshotRoot = resolveDescendant(runRoot, "artifacts/visual/snapshots");
  assertNoSymlinkInPath(runRoot, snapshotRoot);
  if (existsSync(snapshotRoot) && readdirSync(snapshotRoot).length > 0) {
    throw new Error("Gate0 run-owned visual snapshot root must be empty before staging.");
  }

  const tree = await execGitBuffer(
    worktreeRoot,
    ["ls-tree", "-r", "-z", input.sourceCommit, "--", sourceRoot],
    input.signal,
  );
  const entries = tree
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const match = /^(\d+)\s+(\w+)\s+([a-f0-9]{40})\t(.+)$/u.exec(line);
      if (!match) throw new Error("Gate0 visual baseline Git tree entry is malformed.");
      return { mode: match[1], type: match[2], objectId: match[3], sourcePath: match[4] };
    });
  if (entries.length === 0) {
    throw new Error(`Gate0 visual baseline source is empty for ${platform}.`);
  }

  const files: Array<{ relativePath: string; sha256: string }> = [];
  for (const entry of entries) {
    if (entry.mode !== "100644" || entry.type !== "blob" || !entry.sourcePath.endsWith(".png")) {
      throw new Error(`Gate0 visual baseline must be a regular PNG blob: ${entry.sourcePath}.`);
    }
    const relativePath = normalizeRelativePath(entry.sourcePath.slice(sourceRoot.length + 1));
    const content = await execGitBuffer(worktreeRoot, ["cat-file", "blob", entry.objectId], input.signal);
    if (content.length < pngSignature.length || !content.subarray(0, pngSignature.length).equals(pngSignature)) {
      throw new Error(`Gate0 visual baseline has an invalid PNG signature: ${entry.sourcePath}.`);
    }
    const target = resolveDescendant(snapshotRoot, `${platform}/${relativePath}`);
    assertNoSymlinkInPath(runRoot, path.dirname(target));
    mkdirSync(path.dirname(target), { recursive: true });
    if (existsSync(target)) throw new Error(`Gate0 visual baseline target already exists: ${relativePath}.`);
    writeFileSync(target, content);
    files.push({ relativePath, sha256: digest(content) });
  }

  const manifestPath = resolveDescendant(runRoot, "visual-baseline-manifest.json");
  if (existsSync(manifestPath)) throw new Error("Gate0 visual baseline manifest already exists.");
  writeFileSync(
    manifestPath,
    `${JSON.stringify({
      version: 1,
      kind: "wiseeff-gate0-visual-baselines",
      sourceCommit: input.sourceCommit,
      platform,
      files,
      recordedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    "utf8",
  );
  return manifestPath;
}

function execGitBuffer(cwd: string, args: string[], signal?: AbortSignal) {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, encoding: "buffer", maxBuffer: 32 * 1024 * 1024, signal },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      },
    );
  });
}

export function captureGate0SourceOutputs(input: {
  worktreeRoot: string;
  runRoot: string;
  directFiles?: readonly string[];
  recursiveRoots?: readonly string[];
}): Gate0SourceOutputSnapshot {
  const worktreeRoot = path.resolve(input.worktreeRoot);
  const runRoot = path.resolve(input.runRoot);
  const directFiles = [...(input.directFiles ?? gate0SourceOutputDirectFiles)];
  const recursiveRoots = [...(input.recursiveRoots ?? gate0SourceOutputRecursiveRoots)];
  const files = new Map<string, CapturedFile>();

  for (const relativePath of directFiles) captureFile(worktreeRoot, relativePath, files);
  for (const relativeRoot of recursiveRoots) {
    const root = resolveDescendant(worktreeRoot, relativeRoot);
    for (const relativePath of listRegularFiles(worktreeRoot, root)) {
      captureFile(worktreeRoot, relativePath, files);
    }
  }

  const snapshot = { worktreeRoot, runRoot, directFiles, recursiveRoots, files };
  writeManifest(snapshot, "captured", []);
  return snapshot;
}

export function restoreAndArchiveGate0SourceOutputs(snapshot: Gate0SourceOutputSnapshot) {
  const currentPaths = new Set(snapshot.directFiles);
  for (const relativeRoot of snapshot.recursiveRoots) {
    const root = resolveDescendant(snapshot.worktreeRoot, relativeRoot);
    for (const relativePath of listRegularFiles(snapshot.worktreeRoot, root)) currentPaths.add(relativePath);
  }
  for (const relativePath of snapshot.files.keys()) currentPaths.add(relativePath);

  const results: Array<Record<string, unknown>> = [];
  const unknownPaths: string[] = [];
  for (const relativePath of [...currentPaths].sort()) {
    const absolutePath = resolveDescendant(snapshot.worktreeRoot, relativePath);
    const captured = snapshot.files.get(relativePath) ?? { relativePath, existedBefore: false };
    const existsAfter = existsSync(absolutePath);
    const contentAfter = existsAfter ? readRegularFile(absolutePath) : undefined;
    const sha256After = contentAfter ? digest(contentAfter) : undefined;
    let action = "unchanged";
    let archivePath: string | undefined;

    if (captured.sha256Before !== sha256After || captured.existedBefore !== existsAfter) {
      if (contentAfter) {
        archivePath = path.join(snapshot.runRoot, "artifacts", "source-worktree-output", relativePath);
        mkdirSync(path.dirname(archivePath), { recursive: true });
        copyFileSync(absolutePath, archivePath);
      }
      if (captured.existedBefore) {
        mkdirSync(path.dirname(absolutePath), { recursive: true });
        writeFileSync(absolutePath, captured.content!);
        action = "restored";
      } else if (existsAfter) {
        action = "retained-unknown";
        unknownPaths.push(relativePath);
      }
    }

    results.push({
      relativePath,
      existedBefore: captured.existedBefore,
      sha256Before: captured.sha256Before,
      existedAfter: existsAfter,
      sha256After,
      action,
      archivePath,
    });
  }

  const manifestPath = writeManifest(snapshot, "restored", results);
  if (unknownPaths.length > 0) {
    throw new Error(
      `Gate0 found ${unknownPaths.length} unknown source-output path(s); retained them and refused broad cleanup.`,
    );
  }
  return manifestPath;
}

function captureFile(root: string, relativePath: string, files: Map<string, CapturedFile>) {
  const normalized = normalizeRelativePath(relativePath);
  const absolutePath = resolveDescendant(root, normalized);
  if (!existsSync(absolutePath)) {
    files.set(normalized, { relativePath: normalized, existedBefore: false });
    return;
  }
  const content = readRegularFile(absolutePath);
  files.set(normalized, {
    relativePath: normalized,
    existedBefore: true,
    content,
    sha256Before: digest(content),
  });
}

function listRegularFiles(worktreeRoot: string, root: string): string[] {
  if (!existsSync(root)) return [];
  const stat = lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Gate0 source-output root must be a regular directory: ${root}`);
  }
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Gate0 source-output path must not be a symlink: ${entryPath}`);
    if (entry.isDirectory()) files.push(...listRegularFiles(worktreeRoot, entryPath));
    else if (entry.isFile()) files.push(normalizeRelativePath(path.relative(worktreeRoot, entryPath)));
    else throw new Error(`Gate0 source-output path must be a regular file: ${entryPath}`);
  }
  return files;
}

function readRegularFile(filePath: string) {
  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Gate0 source output must be a regular file: ${filePath}`);
  }
  return Buffer.from(readFileSync(filePath, "base64"), "base64");
}

function resolveDescendant(root: string, relativePath: string) {
  const normalized = normalizeRelativePath(relativePath);
  const resolved = path.resolve(root, normalized);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Gate0 source-output path escapes the worktree: ${relativePath}`);
  }
  return resolved;
}

function assertNoSymlinkInPath(root: string, target: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Gate0 visual baseline target escapes its run root: ${target}.`);
  }
  let candidate = resolvedRoot;
  for (const segment of ["", ...relative.split(path.sep).filter(Boolean)]) {
    if (segment) candidate = path.join(candidate, segment);
    if (!existsSync(candidate)) continue;
    if (lstatSync(candidate).isSymbolicLink()) {
      throw new Error(`Gate0 visual baseline target must not contain a symlink: ${candidate}.`);
    }
  }
}

function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//u, "");
}

function digest(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function writeManifest(
  snapshot: Gate0SourceOutputSnapshot,
  state: "captured" | "restored",
  files: Array<Record<string, unknown>>,
) {
  const manifestPath = path.join(snapshot.runRoot, "source-worktree-output-manifest.json");
  writeFileSync(
    manifestPath,
    `${JSON.stringify({
      version: 1,
      kind: "wiseeff-gate0-source-worktree-output",
      state,
      worktreeRoot: snapshot.worktreeRoot,
      watched: {
        directFiles: snapshot.directFiles,
        recursiveRoots: snapshot.recursiveRoots,
      },
      files: state === "captured"
        ? [...snapshot.files.values()].map(({ content: _content, ...file }) => file)
        : files,
      recordedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    "utf8",
  );
  return manifestPath;
}
