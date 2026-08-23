import {
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";

export type Gate0ArtifactViolation = {
  artifactId: string;
  categories: string[];
};

export type Gate0ArtifactScan = {
  filesScanned: number;
  archivesScanned: number;
  violations: Gate0ArtifactViolation[];
};

export type Gate0ArtifactSanitization = {
  filesScanned: number;
  archivesScanned: number;
  filesChanged: number;
  replacements: number;
};

const REDACTED_BEARER = "Bearer [REDACTED]";
const REDACTED_VALUE = "[REDACTED]";
const REDACTED_DATABASE_URL = "[REDACTED_DATABASE_URL]";
const REMOVED_SECRET_DERIVED_VERIFIER = "[REMOVED_SECRET_DERIVED_VERIFIER]";
export const GATE0_CANONICAL_SECRET_ENV_KEYS = [
  "AGENT_API_KEY",
  "AUTH_TOKEN_HMAC_SECRET",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "DATABASE_URL",
  "EMBEDDING_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "LOG_ANALYSIS_API_KEY",
  "LOG_ANALYSIS_JUDGE_API_KEY",
  "M5_SMOKE_AUTHORIZATION",
  "M6_IDENTITY_AUTHORIZATION",
  "M6_IDENTITY_EXPIRED_AUTHORIZATION",
  "M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION",
  "M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION",
  "M6_SELFHOSTED_SMOKE_AUTHORIZATION",
  "MINIO_ROOT_PASSWORD",
  "NPM_TOKEN",
  "OBJECT_STORAGE_ACCESS_KEY_ID",
  "OBJECT_STORAGE_SECRET_ACCESS_KEY",
  "PARAMETER_IDENTITY_MAINTENANCE_TOKEN",
  "POSTGRES_PASSWORD",
  "REDIS_URL",
  "RESTORE_DATABASE_URL",
  "TEST_DATABASE_URL",
  "VITE_WISEEFF_API_AUTHORIZATION",
  "WISEEFF_CAPACITY_AUTHORIZATION",
  "WISEEFF_LAB_ADMIN_PASSWORD",
  "WISEEFF_SMOKE_AUTHORIZATION",
  "XIAOZE_LLM_API_KEY",
] as const;
const CANONICAL_SECRET_KEY_SET = new Set<string>(GATE0_CANONICAL_SECRET_ENV_KEYS);
const CANONICAL_SECRET_KEY_SOURCE = GATE0_CANONICAL_SECRET_ENV_KEYS
  .map(escapeRegExp)
  .join("|");
const CANONICAL_SECRET_ASSIGNMENT_PATTERN = new RegExp(
  `(\\b(?:${CANONICAL_SECRET_KEY_SOURCE})(?:\\\\?["'])?\\s*[:=]\\s*)(?:(\\\\?["'])(?!\\[REDACTED\\])(.*?)(\\2)|(?!\\[REDACTED\\])([^\\\\\\s,}\\]"'\\r\\n]+))`,
  "giu",
);
const MIN_INJECTED_SECRET_LENGTH = 8;
const SANITIZABLE_TEXT_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".har",
  ".html",
  ".js",
  ".json",
  ".jsonl",
  ".log",
  ".map",
  ".md",
  ".network",
  ".svg",
  ".trace",
  ".tsv",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

export async function sanitizeGate0ArtifactTree(
  root: string,
  signal?: AbortSignal,
  secretValues: readonly string[] = gate0SecretValuesFromEnv(),
): Promise<Gate0ArtifactSanitization> {
  const treeRoot = requireSafeTreeRoot(root);
  const report: Gate0ArtifactSanitization = {
    filesScanned: 0,
    archivesScanned: 0,
    filesChanged: 0,
    replacements: 0,
  };

  for (const filePath of listRegularFiles(treeRoot)) {
    throwIfAborted(signal);
    const relativePath = normalizeRelative(path.relative(treeRoot, filePath));
    report.filesScanned += 1;
    if (path.extname(filePath).toLowerCase() === ".zip") {
      report.archivesScanned += 1;
      const changed = await sanitizeZip(filePath, relativePath, report, signal, secretValues);
      if (changed) report.filesChanged += 1;
      continue;
    }
    const original = readBuffer(filePath);
    const sanitized = sanitizeBuffer(original, relativePath, secretValues);
    report.replacements += sanitized.replacements;
    if (sanitized.replacements > 0) {
      writeFileSync(filePath, sanitized.value);
      report.filesChanged += 1;
    }
  }

  return report;
}

export async function scanGate0ArtifactTree(
  root: string,
  signal?: AbortSignal,
  secretValues: readonly string[] = gate0SecretValuesFromEnv(),
): Promise<Gate0ArtifactScan> {
  const treeRoot = requireSafeTreeRoot(root);
  const scan: Gate0ArtifactScan = { filesScanned: 0, archivesScanned: 0, violations: [] };

  for (const filePath of listRegularFiles(treeRoot)) {
    throwIfAborted(signal);
    const relativePath = normalizeRelative(path.relative(treeRoot, filePath));
    scan.filesScanned += 1;
    if (path.extname(filePath).toLowerCase() === ".zip") {
      recordViolations(scan, relativePath, Buffer.alloc(0), secretValues);
      scan.archivesScanned += 1;
      await scanZip(filePath, relativePath, scan, signal, secretValues);
      continue;
    }
    recordViolations(scan, relativePath, readBuffer(filePath), secretValues);
  }
  scan.violations.sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  return scan;
}

async function sanitizeZip(
  archivePath: string,
  relativePath: string,
  report: Gate0ArtifactSanitization,
  signal?: AbortSignal,
  secretValues: readonly string[] = gate0SecretValuesFromEnv(),
) {
  const zip = await JSZip.loadAsync(readBuffer(archivePath));
  let changed = false;
  for (const entry of Object.values(zip.files)) {
    throwIfAborted(signal);
    assertSafeZipEntry(entry);
    if (entry.dir) continue;
    report.filesScanned += 1;
    const original = await entry.async("nodebuffer");
    const sanitized = sanitizeBuffer(original, `${relativePath}!/${entry.name}`, secretValues);
    report.replacements += sanitized.replacements;
    if (sanitized.replacements > 0) {
      zip.file(entry.name, sanitized.value, {
        binary: true,
        date: entry.date,
        unixPermissions: entry.unixPermissions ?? undefined,
        dosPermissions: entry.dosPermissions ?? undefined,
      });
      changed = true;
    }
  }
  if (changed) {
    writeFileSync(
      archivePath,
      await zip.generateAsync({ type: "nodebuffer", platform: process.platform === "win32" ? "DOS" : "UNIX" }),
    );
  }
  return changed;
}

async function scanZip(
  archivePath: string,
  relativePath: string,
  scan: Gate0ArtifactScan,
  signal?: AbortSignal,
  secretValues: readonly string[] = gate0SecretValuesFromEnv(),
) {
  const zip = await JSZip.loadAsync(readBuffer(archivePath));
  for (const entry of Object.values(zip.files)) {
    throwIfAborted(signal);
    assertSafeZipEntry(entry);
    const artifactPath = `${relativePath}!/${entry.name}`;
    if (entry.dir) {
      recordViolations(scan, artifactPath, Buffer.alloc(0), secretValues);
      continue;
    }
    scan.filesScanned += 1;
    recordViolations(scan, artifactPath, await entry.async("nodebuffer"), secretValues);
  }
}

function sanitizeBuffer(value: Buffer, artifactPath: string, secretValues: readonly string[]) {
  const textValue = value.toString("utf8");
  const detected = uniqueCategories(
    secretCategories(artifactPath, secretValues),
    secretCategories(textValue, secretValues),
  );
  const artifactId = safeArtifactId(artifactPath);
  if (detected.length > 0 && isProbablyBinary(value)) {
    throw new Error(`Gate0 binary artifact ${artifactId} contains ${detected.join(", ")}; refusing to corrupt diagnostic evidence.`);
  }
  if (detected.length > 0 && !isSanitizableTextArtifact(artifactPath, value)) {
    throw new Error(`Gate0 unsupported artifact format ${artifactId} contains ${detected.join(", ")}; refusing to rewrite diagnostic evidence.`);
  }
  const sanitized = sanitizeGate0DiagnosticText(textValue, secretValues);
  return { value: Buffer.from(sanitized.value, "utf8"), replacements: sanitized.replacements };
}

export function sanitizeGate0DiagnosticText(
  value: string,
  secretValues: readonly string[] = gate0SecretValuesFromEnv(),
) {
  let text = value;
  let replacements = 0;
  const replace = (pattern: RegExp, replacement: string | ((...args: string[]) => string)) => {
    text = text.replace(pattern, (...args) => {
      replacements += 1;
      return typeof replacement === "string" ? replacement : replacement(...(args as string[]));
    });
  };

  replace(
    CANONICAL_SECRET_ASSIGNMENT_PATTERN,
    (_match, prefix, quote, _quotedValue, closingQuote) =>
      `${prefix}${quote ?? ""}${REDACTED_VALUE}${closingQuote ?? ""}`,
  );
  replace(/\bBearer\s+(?!\[REDACTED\])[-A-Za-z0-9._~+/=]{8,}/giu, REDACTED_BEARER);
  replace(/\bBasic\s+(?!\[REDACTED\])[-A-Za-z0-9+/=]{8,}/giu, `Basic ${REDACTED_VALUE}`);
  replace(/postgres(?:ql)?:\/\/[^\s"'\\]+/giu, REDACTED_DATABASE_URL);
  replace(
    /((?:AUTH_TOKEN_HMAC_SECRET)(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?)(?!\[REDACTED\])([a-f0-9]{32,})/giu,
    (match, prefix) => `${prefix}${REDACTED_VALUE}`,
  );
  replace(
    /((?:secretSha256|connectionSha256)(?:\\?["'])?\s*:\s*(?:\\?["'])?)(?!\[REMOVED_SECRET_DERIVED_VERIFIER\])([a-f0-9]{64})/giu,
    (match, prefix) => `${prefix}${REMOVED_SECRET_DERIVED_VERIFIER}`,
  );
  for (const secretValue of normalizeInjectedSecretValues(secretValues)) {
    const occurrences = text.split(secretValue).length - 1;
    if (occurrences === 0) continue;
    text = text.split(secretValue).join(REDACTED_VALUE);
    replacements += occurrences;
  }
  return { value: text, replacements };
}

function recordViolations(
  scan: Gate0ArtifactScan,
  artifactPath: string,
  value: Buffer,
  secretValues: readonly string[],
) {
  const text = value.toString("utf8");
  const categories = uniqueCategories(
    secretCategories(artifactPath, secretValues),
    secretCategories(text, secretValues),
  );
  if (categories.length > 0) scan.violations.push({ artifactId: safeArtifactId(artifactPath), categories });
}

function uniqueCategories(...groups: string[][]) {
  return [...new Set(groups.flat())].sort();
}

function secretCategories(text: string, secretValues: readonly string[]) {
  const categories: string[] = [];
  CANONICAL_SECRET_ASSIGNMENT_PATTERN.lastIndex = 0;
  if (CANONICAL_SECRET_ASSIGNMENT_PATTERN.test(text)) categories.push("canonical-secret");
  CANONICAL_SECRET_ASSIGNMENT_PATTERN.lastIndex = 0;
  if (normalizeInjectedSecretValues(secretValues).some((secretValue) => text.includes(secretValue))) {
    categories.push("injected-secret");
  }
  if (/\bBearer\s+(?!\[REDACTED\])[-A-Za-z0-9._~+/=]{8,}/iu.test(text)) categories.push("bearer");
  if (/\bBasic\s+(?!\[REDACTED\])[-A-Za-z0-9+/=]{8,}/iu.test(text)) categories.push("basic-authorization");
  if (/postgres(?:ql)?:\/\/[^\s:/"'\\]+:[^\s@"'\\]+@/iu.test(text)) categories.push("database-url");
  if (
    /AUTH_TOKEN_HMAC_SECRET(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?(?!\[REDACTED\])[a-f0-9]{32,}/iu.test(text)
  ) {
    categories.push("hmac-secret");
  }
  if (/(?:secretSha256|connectionSha256)(?:\\?["'])?\s*:\s*(?:\\?["'])?[a-f0-9]{64}/iu.test(text)) {
    categories.push("secret-derived-verifier");
  }
  return categories;
}

export function isGate0SecretEnvKey(key: string) {
  return CANONICAL_SECRET_KEY_SET.has(key)
    || /(?:^|_)(?:API_KEY|ACCESS_KEY_ID|SECRET(?:_ACCESS_KEY)?|PASSWORD|AUTHORIZATION|TOKEN)$/u.test(key)
    || ["AWS_SHARED_CREDENTIALS_FILE", "GOOGLE_APPLICATION_CREDENTIALS", "NETRC", "SSH_AUTH_SOCK"].includes(key);
}

export function gate0SecretValuesFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return normalizeInjectedSecretValues(
    Object.entries(env)
      .filter(([key]) => isGate0SecretEnvKey(key))
      .map(([, value]) => value ?? ""),
  );
}

function normalizeInjectedSecretValues(values: readonly string[]) {
  return [...new Set(values.filter((value) =>
    value.length >= MIN_INJECTED_SECRET_LENGTH
    && value !== REDACTED_VALUE
    && value !== REDACTED_BEARER
    && value !== REDACTED_DATABASE_URL
  ))].sort((left, right) => right.length - left.length || left.localeCompare(right));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isProbablyBinary(value: Buffer) {
  return value.includes(0) || value.toString("utf8").includes("\uFFFD");
}

function isSanitizableTextArtifact(artifactPath: string, value: Buffer) {
  const entryPath = artifactPath.includes("!/") ? artifactPath.slice(artifactPath.indexOf("!/") + 2) : artifactPath;
  if (SANITIZABLE_TEXT_EXTENSIONS.has(path.posix.extname(normalizeRelative(entryPath)).toLowerCase())) return true;
  if (/^(?:resources\/)?[a-f0-9]{20,}$/iu.test(normalizeRelative(entryPath))) {
    try {
      JSON.parse(value.toString("utf8"));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function safeArtifactId(artifactPath: string) {
  return `artifact-${createHash("sha256").update(normalizeRelative(artifactPath)).digest("hex").slice(0, 16)}`;
}

function readBuffer(filePath: string) {
  return Buffer.from(readFileSync(filePath, "base64"), "base64");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason;
}

function requireSafeTreeRoot(root: string) {
  const resolved = path.resolve(root);
  const stat = lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Gate0 artifact root must be a regular directory: ${resolved}`);
  }
  return resolved;
}

function listRegularFiles(root: string, treeRoot = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    const artifactId = safeArtifactId(path.relative(treeRoot, entryPath));
    if (entry.isSymbolicLink()) throw new Error(`Gate0 artifact tree contains symbolic link ${artifactId}.`);
    if (entry.isDirectory()) files.push(...listRegularFiles(entryPath, treeRoot));
    else if (entry.isFile()) files.push(entryPath);
    else throw new Error(`Gate0 artifact tree contains non-regular entry ${artifactId}.`);
  }
  return files.sort();
}

function assertSafeZipEntry(entry: JSZip.JSZipObject) {
  const normalized = normalizeRelative(entry.name);
  const artifactId = safeArtifactId(entry.name);
  if (!normalized || normalized.startsWith("../") || path.isAbsolute(normalized)) {
    throw new Error(`Gate0 artifact ZIP contains unsafe entry ${artifactId}.`);
  }
  if (entry.unsafeOriginalName && normalizeRelative(entry.unsafeOriginalName) !== normalized) {
    throw new Error(`Gate0 artifact ZIP contains rewritten unsafe entry ${artifactId}.`);
  }
  if (typeof entry.unixPermissions === "number" && (entry.unixPermissions & 0o170000) === 0o120000) {
    throw new Error(`Gate0 artifact ZIP contains symbolic link entry ${artifactId}.`);
  }
}

function normalizeRelative(value: string) {
  return value.replace(/\\/gu, "/").replace(/^\.\//u, "");
}

async function main() {
  const rootIndex = process.argv.indexOf("--root");
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined;
  if (!root) throw new Error("acceptance:artifacts:check requires --root <artifact-root>.");
  const scan = await scanGate0ArtifactTree(root);
  console.log(JSON.stringify({
    filesScanned: scan.filesScanned,
    archivesScanned: scan.archivesScanned,
    violationCount: scan.violations.length,
    violations: scan.violations,
  }, null, 2));
  if (scan.violations.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
