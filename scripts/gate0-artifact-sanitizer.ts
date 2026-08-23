import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import os from "node:os";
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
const PERSISTED_EXACT_VALUES_FILE = ".gate0-exact-values.v1.enc.json";
const RETIRING_EXACT_VALUES_FILE = `${PERSISTED_EXACT_VALUES_FILE}.retiring`;
const PERSISTED_EXACT_VALUES_KIND = "wiseeff-gate0-encrypted-exact-values";
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
  recoverPersistedExactValueTransactions(treeRoot);
  const persistedRoots = findPersistedExactValueRoots(treeRoot);
  const persistedValues = persistedRoots.flatMap((persistedRoot) => readPersistedExactValues(persistedRoot));
  const exactValues = normalizeInjectedSecretValues([...secretValues, ...persistedValues]);
  if (secretValues.length > 0) persistGate0ExactValuesForRescan(treeRoot, secretValues);
  const report: Gate0ArtifactSanitization = {
    filesScanned: 0,
    archivesScanned: 0,
    filesChanged: 0,
    replacements: 0,
  };

  for (const filePath of listRegularFiles(treeRoot)) {
    if (path.basename(filePath) === PERSISTED_EXACT_VALUES_FILE) continue;
    throwIfAborted(signal);
    const relativePath = normalizeRelative(path.relative(treeRoot, filePath));
    report.filesScanned += 1;
    if (path.extname(filePath).toLowerCase() === ".zip") {
      report.archivesScanned += 1;
      const changed = await sanitizeZip(filePath, relativePath, report, signal, exactValues);
      if (changed) report.filesChanged += 1;
      continue;
    }
    const original = readBuffer(filePath);
    const sanitized = sanitizeBuffer(original, relativePath, exactValues);
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
  recoverPersistedExactValueTransactions(treeRoot);
  const files = listRegularFiles(treeRoot);
  const persistedRoots = findPersistedExactValueRoots(treeRoot, files);
  const persistedValues = persistedRoots.flatMap((persistedRoot) => readPersistedExactValues(persistedRoot));
  const exactValues = normalizeInjectedSecretValues([...secretValues, ...persistedValues]);
  const scan: Gate0ArtifactScan = { filesScanned: 0, archivesScanned: 0, violations: [] };

  for (const filePath of files) {
    if (path.basename(filePath) === PERSISTED_EXACT_VALUES_FILE) continue;
    throwIfAborted(signal);
    const relativePath = normalizeRelative(path.relative(treeRoot, filePath));
    scan.filesScanned += 1;
    if (path.extname(filePath).toLowerCase() === ".zip") {
      recordViolations(scan, relativePath, Buffer.alloc(0), exactValues);
      scan.archivesScanned += 1;
      await scanZip(filePath, relativePath, scan, signal, exactValues);
      continue;
    }
    recordViolations(scan, relativePath, readBuffer(filePath), exactValues);
  }
  scan.violations.sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  if (scan.violations.length === 0 && persistedValues.length > 0) {
    for (const persistedRoot of persistedRoots) removePersistedExactValues(persistedRoot);
  }
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

type PersistedExactValues = {
  version: 1;
  kind: typeof PERSISTED_EXACT_VALUES_KIND;
  algorithm: "aes-256-gcm";
  treeRootSha256: string;
  keyFile: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

export function persistGate0ExactValuesForRescan(treeRoot: string, values: readonly string[]) {
  const safeTreeRoot = requireSafeTreeRoot(treeRoot);
  const registryPath = path.join(safeTreeRoot, PERSISTED_EXACT_VALUES_FILE);
  const existing = readPersistedExactValuesRecord(safeTreeRoot);
  const merged = normalizeInjectedSecretValues([
    ...values,
    ...(existing ? decryptPersistedExactValues(existing) : []),
  ]);
  const keyDirectory = persistedExactValuesKeyDirectory();
  mkdirSync(keyDirectory, { recursive: true, mode: 0o700 });
  const keyDirectoryStat = lstatSync(keyDirectory);
  if (keyDirectoryStat.isSymbolicLink() || !keyDirectoryStat.isDirectory()) {
    throw new Error("Gate0 exact-value registry key directory is unsafe.");
  }
  chmodSync(keyDirectory, 0o700);
  assertSafePersistedKeyDirectory(keyDirectory);
  const keyId = existing ? path.basename(existing.keyFile, ".key") : randomUUID();
  const keyFile = existing?.keyFile ?? path.join(keyDirectory, `${keyId}.key`);
  const key = existing
    ? Buffer.from(readFileSync(existing.keyFile, "base64"), "base64")
    : randomBytes(32);
  const iv = randomBytes(12);
  const treeRootSha256 = createHash("sha256").update(safeTreeRoot).digest("hex");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(treeRootSha256, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ values: merged }), "utf8"),
    cipher.final(),
  ]);
  const record: PersistedExactValues = {
    version: 1,
    kind: PERSISTED_EXACT_VALUES_KIND,
    algorithm: "aes-256-gcm",
    treeRootSha256,
    keyFile,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  const candidatePath = `${registryPath}.${keyId}.tmp`;
  let published = false;
  let recordInstalled = false;
  try {
    if (!existing) {
      writeFileSync(keyFile, key, { flag: "wx", mode: 0o600, flush: true });
      fsyncDirectory(keyDirectory);
    }
    writeFileSync(candidatePath, `${JSON.stringify(record)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
      flush: true,
    });
    renameSync(candidatePath, registryPath);
    recordInstalled = true;
    fsyncDirectory(safeTreeRoot);
    published = true;
  } finally {
    if (!published && !existing && !recordInstalled) unlinkIfPresent(keyFile);
    unlinkIfPresent(candidatePath);
  }
}

function fsyncDirectory(directory: string) {
  if (process.platform === "win32") return;
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function findPersistedExactValueRoots(treeRoot: string, files = listRegularFiles(treeRoot)) {
  return [...new Set(
    files
      .filter((filePath) => path.basename(filePath) === PERSISTED_EXACT_VALUES_FILE)
      .map((filePath) => path.dirname(filePath)),
  )];
}

function recoverPersistedExactValueTransactions(treeRoot: string) {
  const files = listRegularFiles(treeRoot);
  for (const retiringPath of files.filter((filePath) => path.basename(filePath) === RETIRING_EXACT_VALUES_FILE)) {
    resumeRetiringExactValues(retiringPath);
  }
  const candidatePattern = new RegExp(
    `^${escapeRegExp(PERSISTED_EXACT_VALUES_FILE)}\\.([a-f0-9-]{36})\\.tmp$`,
    "iu",
  );
  for (const candidatePath of files) {
    const match = candidatePattern.exec(path.basename(candidatePath));
    if (!match) continue;
    const candidate = readPersistedExactValuesRecordAt(candidatePath);
    if (path.basename(candidate.keyFile, ".key") !== match[1]) {
      throw new Error("Gate0 exact-value registry candidate identity is invalid.");
    }
    decryptPersistedExactValues(candidate);
    const stablePath = path.join(path.dirname(candidatePath), PERSISTED_EXACT_VALUES_FILE);
    if (existsSync(stablePath)) {
      const stable = readPersistedExactValuesRecordAt(stablePath);
      if (stable.keyFile !== candidate.keyFile) {
        throw new Error("Gate0 exact-value registry candidate does not match the stable key identity.");
      }
      unlinkSync(candidatePath);
    } else {
      renameSync(candidatePath, stablePath);
    }
    fsyncDirectory(path.dirname(candidatePath));
  }
}

function resumeRetiringExactValues(retiringPath: string) {
  const record = readPersistedExactValuesRecordAt(retiringPath);
  if (existsSync(record.keyFile)) {
    assertSafePersistedKeyFile(record.keyFile);
    decryptPersistedExactValues(record);
    unlinkSync(record.keyFile);
    fsyncDirectory(persistedExactValuesKeyDirectory());
  }
  unlinkSync(retiringPath);
  fsyncDirectory(path.dirname(retiringPath));
  removeEmptyPersistedKeyDirectory();
}

function readPersistedExactValues(treeRoot: string) {
  const record = readPersistedExactValuesRecord(treeRoot);
  return record ? decryptPersistedExactValues(record) : [];
}

function readPersistedExactValuesRecord(treeRoot: string): PersistedExactValues | undefined {
  const registryPath = path.join(treeRoot, PERSISTED_EXACT_VALUES_FILE);
  try {
    return readPersistedExactValuesRecordAt(registryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) throw new Error("Gate0 exact-value registry is malformed.", { cause: error });
    throw error;
  }
}

function readPersistedExactValuesRecordAt(recordPath: string): PersistedExactValues {
  const registryStat = lstatSync(recordPath);
  if (
    registryStat.isSymbolicLink() || !registryStat.isFile() ||
    (process.platform !== "win32" && (registryStat.mode & 0o077) !== 0)
  ) {
    throw new Error("Gate0 exact-value registry must be a private regular file.");
  }
  let value: Partial<PersistedExactValues>;
  try {
    value = JSON.parse(readFileSync(recordPath, "utf8")) as Partial<PersistedExactValues>;
  } catch {
    throw new Error("Gate0 exact-value registry is malformed.");
  }
  if (
    value.version !== 1 || value.kind !== PERSISTED_EXACT_VALUES_KIND ||
    value.algorithm !== "aes-256-gcm" || !/^[a-f0-9]{64}$/u.test(value.treeRootSha256 ?? "") ||
    typeof value.keyFile !== "string" ||
    typeof value.iv !== "string" || typeof value.tag !== "string" ||
    typeof value.ciphertext !== "string"
  ) {
    throw new Error("Gate0 exact-value registry identity is invalid.");
  }
  const expectedRootSha256 = createHash("sha256").update(path.resolve(path.dirname(recordPath))).digest("hex");
  if (value.treeRootSha256 !== expectedRootSha256) {
    throw new Error("Gate0 exact-value registry root identity is invalid.");
  }
  assertSafePersistedKeyPath(value.keyFile);
  return value as PersistedExactValues;
}

function decryptPersistedExactValues(record: PersistedExactValues) {
  assertSafePersistedKeyFile(record.keyFile);
  const keyStat = lstatSync(record.keyFile);
  if (
    keyStat.isSymbolicLink() || !keyStat.isFile() || keyStat.size !== 32 ||
    (process.getuid && keyStat.uid !== process.getuid())
  ) {
    throw new Error("Gate0 exact-value registry key is unsafe.");
  }
  if (process.platform !== "win32" && (keyStat.mode & 0o077) !== 0) {
    throw new Error("Gate0 exact-value registry key permissions are unsafe.");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(readFileSync(record.keyFile, "base64"), "base64"),
      Buffer.from(record.iv, "base64"),
    );
    decipher.setAAD(Buffer.from(record.treeRootSha256, "utf8"));
    decipher.setAuthTag(Buffer.from(record.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(plaintext) as { values?: unknown };
    if (!Array.isArray(payload.values) || payload.values.some((value) => typeof value !== "string")) {
      throw new Error("Gate0 exact-value registry payload is invalid.");
    }
    return normalizeInjectedSecretValues(payload.values as string[]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Gate0 exact-value")) throw error;
    throw new Error("Gate0 exact-value registry cannot be decrypted.", { cause: error });
  }
}

function removePersistedExactValues(treeRoot: string) {
  const record = readPersistedExactValuesRecord(treeRoot);
  if (!record) return;
  const registryPath = path.join(treeRoot, PERSISTED_EXACT_VALUES_FILE);
  const retiringPath = path.join(treeRoot, RETIRING_EXACT_VALUES_FILE);
  if (existsSync(retiringPath)) throw new Error("Gate0 exact-value registry already has a retiring transaction.");
  renameSync(registryPath, retiringPath);
  fsyncDirectory(treeRoot);
  resumeRetiringExactValues(retiringPath);
}

function removeEmptyPersistedKeyDirectory() {
  try {
    rmdirSync(persistedExactValuesKeyDirectory());
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
  }
}

function assertSafePersistedKeyFile(keyFile: string) {
  const keyDirectory = persistedExactValuesKeyDirectory();
  assertSafePersistedKeyPath(keyFile);
  assertSafePersistedKeyDirectory(keyDirectory);
}

function assertSafePersistedKeyPath(keyFile: string) {
  const keyDirectory = persistedExactValuesKeyDirectory();
  if (!path.isAbsolute(keyFile) || path.dirname(keyFile) !== keyDirectory || !/^[a-f0-9-]{36}\.key$/iu.test(path.basename(keyFile))) {
    throw new Error("Gate0 exact-value registry key path is unsafe.");
  }
}

function assertSafePersistedKeyDirectory(keyDirectory: string) {
  const directoryStat = lstatSync(keyDirectory);
  if (
    directoryStat.isSymbolicLink() || !directoryStat.isDirectory() ||
    (process.platform !== "win32" && (directoryStat.mode & 0o077) !== 0) ||
    (process.getuid && directoryStat.uid !== process.getuid())
  ) {
    throw new Error("Gate0 exact-value registry key directory is unsafe.");
  }
}

function persistedExactValuesKeyDirectory() {
  return path.join(os.tmpdir(), `wiseeff-gate0-artifact-keys-${process.getuid?.() ?? "unknown"}`);
}

function unlinkIfPresent(targetPath: string) {
  try {
    unlinkSync(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
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
  const sanitization = await sanitizeGate0ArtifactTree(root);
  const scan = await scanGate0ArtifactTree(root);
  console.log(JSON.stringify({
    sanitization,
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
