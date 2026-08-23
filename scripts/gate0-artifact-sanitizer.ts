import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
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

export type Gate0ArtifactScanOptions = {
  retirePersistedExactValues?: boolean;
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
const MAX_ZIP_NESTING_DEPTH = 4;
const MAX_ZIP_ENTRY_COUNT = 10_000;
const MAX_ZIP_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_ZIP_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const MAX_ZIP_EXPANSION_RATIO = 1_000;
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
  const zipBudget = createZipTraversalBudget();

  for (const filePath of listRegularFiles(treeRoot)) {
    if (path.basename(filePath) === PERSISTED_EXACT_VALUES_FILE) continue;
    throwIfAborted(signal);
    const relativePath = normalizeRelative(path.relative(treeRoot, filePath));
    report.filesScanned += 1;
    const zipArtifact = isZipArtifactFile(filePath);
    if (zipArtifact && lstatSync(filePath).size > MAX_ZIP_ARCHIVE_BYTES) {
      throw new Error(`Gate0 artifact ZIP ${safeArtifactId(relativePath)} exceeds the archive-size safety limit.`);
    }
    const original = readBuffer(filePath);
    if (zipArtifact) {
      report.archivesScanned += 1;
      const changed = await sanitizeZip(filePath, relativePath, report, signal, exactValues, zipBudget);
      if (changed) report.filesChanged += 1;
      continue;
    }
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
  options: Gate0ArtifactScanOptions = {},
): Promise<Gate0ArtifactScan> {
  const treeRoot = requireSafeTreeRoot(root);
  recoverPersistedExactValueTransactions(treeRoot);
  const files = listRegularFiles(treeRoot);
  const persistedRoots = findPersistedExactValueRoots(treeRoot, files);
  const persistedValues = persistedRoots.flatMap((persistedRoot) => readPersistedExactValues(persistedRoot));
  const exactValues = normalizeInjectedSecretValues([...secretValues, ...persistedValues]);
  const scan: Gate0ArtifactScan = { filesScanned: 0, archivesScanned: 0, violations: [] };
  const zipBudget = createZipTraversalBudget();

  for (const filePath of files) {
    if (path.basename(filePath) === PERSISTED_EXACT_VALUES_FILE) continue;
    throwIfAborted(signal);
    const relativePath = normalizeRelative(path.relative(treeRoot, filePath));
    scan.filesScanned += 1;
    const zipArtifact = isZipArtifactFile(filePath);
    if (zipArtifact && lstatSync(filePath).size > MAX_ZIP_ARCHIVE_BYTES) {
      throw new Error(`Gate0 artifact ZIP ${safeArtifactId(relativePath)} exceeds the archive-size safety limit.`);
    }
    const value = readBuffer(filePath);
    if (zipArtifact) {
      recordViolations(scan, relativePath, Buffer.alloc(0), exactValues);
      scan.archivesScanned += 1;
      await scanZip(filePath, relativePath, scan, signal, exactValues, zipBudget);
      continue;
    }
    recordViolations(scan, relativePath, value, exactValues);
  }
  scan.violations.sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  if (
    scan.violations.length === 0 &&
    persistedValues.length > 0 &&
    options.retirePersistedExactValues !== false
  ) {
    for (const persistedRoot of persistedRoots) removePersistedExactValues(persistedRoot);
  }
  return scan;
}

export function loadGate0PersistedExactValuesForSnapshot(treeRoot: string) {
  const safeTreeRoot = requireSafeTreeRoot(treeRoot);
  recoverPersistedExactValueTransactions(safeTreeRoot);
  return normalizeInjectedSecretValues(
    findPersistedExactValueRoots(safeTreeRoot)
      .flatMap((persistedRoot) => readPersistedExactValues(persistedRoot)),
  );
}

export function retireGate0PersistedExactValuesAfterSnapshot(treeRoot: string) {
  const safeTreeRoot = requireSafeTreeRoot(treeRoot);
  recoverPersistedExactValueTransactions(safeTreeRoot);
  for (const persistedRoot of findPersistedExactValueRoots(safeTreeRoot)) {
    removePersistedExactValues(persistedRoot);
  }
}

async function sanitizeZip(
  archivePath: string,
  relativePath: string,
  report: Gate0ArtifactSanitization,
  signal?: AbortSignal,
  secretValues: readonly string[] = gate0SecretValuesFromEnv(),
  budget: ZipTraversalBudget = createZipTraversalBudget(),
) {
  const sanitized = await sanitizeZipBuffer(
    readBuffer(archivePath),
    relativePath,
    report,
    signal,
    secretValues,
    budget,
    1,
  );
  const changed = sanitized.changed;
  if (changed) {
    writeFileSync(archivePath, sanitized.value);
  }
  return changed;
}

async function scanZip(
  archivePath: string,
  relativePath: string,
  scan: Gate0ArtifactScan,
  signal?: AbortSignal,
  secretValues: readonly string[] = gate0SecretValuesFromEnv(),
  budget: ZipTraversalBudget = createZipTraversalBudget(),
) {
  await scanZipBuffer(
    readBuffer(archivePath),
    relativePath,
    scan,
    signal,
    secretValues,
    budget,
    1,
  );
}

type ZipTraversalBudget = {
  entries: number;
  uncompressedBytes: number;
  expandedBytes: number;
};

function createZipTraversalBudget(): ZipTraversalBudget {
  return { entries: 0, uncompressedBytes: 0, expandedBytes: 0 };
}

async function sanitizeZipBuffer(
  archive: Buffer,
  artifactPath: string,
  report: Gate0ArtifactSanitization,
  signal: AbortSignal | undefined,
  secretValues: readonly string[],
  budget: ZipTraversalBudget,
  depth: number,
): Promise<{ value: Buffer; changed: boolean }> {
  assertZipDepth(depth, artifactPath);
  const { zip, envelope } = await loadZipOrThrow(archive, artifactPath, budget);
  assertZipMetadataContainsNoSecrets(envelope.metadata, artifactPath, secretValues);
  let changed = false;
  for (const entry of Object.values(zip.files)) {
    throwIfAborted(signal);
    assertSafeZipEntry(entry);
    const entryPath = `${artifactPath}!/${entry.name}`;
    if (entry.dir) {
      continue;
    }
    report.filesScanned += 1;
    const expected = envelope.entries.get(entry.name);
    if (!expected) throw new Error(`Gate0 artifact ZIP ${safeArtifactId(artifactPath)} has an inconsistent entry projection.`);
    const original = await readZipEntry(entry, expected, budget, artifactPath);
    if (isZipEntry(entry.name, original)) {
      report.archivesScanned += 1;
      const nested = await sanitizeZipBuffer(
        original,
        entryPath,
        report,
        signal,
        secretValues,
        budget,
        depth + 1,
      );
      if (nested.changed) {
        replaceZipEntry(zip, entry, nested.value);
        changed = true;
      }
      continue;
    }
    const sanitized = sanitizeBuffer(original, entryPath, secretValues);
    report.replacements += sanitized.replacements;
    if (sanitized.replacements > 0) {
      replaceZipEntry(zip, entry, sanitized.value);
      changed = true;
    }
  }
  if (!changed) return { value: archive, changed: false };
  return {
    value: await generateZipOrThrow(zip, artifactPath),
    changed: true,
  };
}

async function scanZipBuffer(
  archive: Buffer,
  artifactPath: string,
  scan: Gate0ArtifactScan,
  signal: AbortSignal | undefined,
  secretValues: readonly string[],
  budget: ZipTraversalBudget,
  depth: number,
) {
  assertZipDepth(depth, artifactPath);
  const { zip, envelope } = await loadZipOrThrow(archive, artifactPath, budget);
  for (const metadata of envelope.metadata) {
    recordViolations(scan, `${artifactPath}!/metadata`, metadata, secretValues);
  }
  for (const entry of Object.values(zip.files)) {
    throwIfAborted(signal);
    assertSafeZipEntry(entry);
    const entryPath = `${artifactPath}!/${entry.name}`;
    if (entry.dir) {
      recordViolations(scan, entryPath, Buffer.alloc(0), secretValues);
      continue;
    }
    scan.filesScanned += 1;
    const expected = envelope.entries.get(entry.name);
    if (!expected) throw new Error(`Gate0 artifact ZIP ${safeArtifactId(artifactPath)} has an inconsistent entry projection.`);
    const value = await readZipEntry(entry, expected, budget, artifactPath);
    if (isZipEntry(entry.name, value)) {
      scan.archivesScanned += 1;
      recordViolations(scan, entryPath, Buffer.alloc(0), secretValues);
      await scanZipBuffer(value, entryPath, scan, signal, secretValues, budget, depth + 1);
      continue;
    }
    recordViolations(scan, entryPath, value, secretValues);
  }
}

async function readZipEntry(
  entry: JSZip.JSZipObject,
  expected: ZipEnvelopeEntry,
  budget: ZipTraversalBudget,
  archivePath: string,
) {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    let crc = 0xffffffff;
    const stream = entry.nodeStream("nodebuffer");
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer | Uint8Array) => {
        const value = Buffer.from(chunk);
        size += value.length;
        budget.expandedBytes += value.length;
        if (
          size > expected.uncompressedSize ||
          size > MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES ||
          budget.expandedBytes > MAX_ZIP_UNCOMPRESSED_BYTES
        ) {
          (stream as NodeJS.ReadableStream & { destroy(error?: Error): void }).destroy(new Error("size-limit"));
          return;
        }
        crc = updateCrc32(crc, value);
        chunks.push(value);
      });
      stream.once("end", resolve);
      stream.once("error", reject);
    });
    if (size !== expected.uncompressedSize || ((crc ^ 0xffffffff) >>> 0) !== expected.crc32) {
      throw new Error("integrity-mismatch");
    }
    return Buffer.concat(chunks, size);
  } catch {
    throw new Error(`Gate0 artifact ZIP ${safeArtifactId(archivePath)} cannot be safely decompressed.`);
  }
}

function assertZipDepth(depth: number, artifactPath: string) {
  if (depth > MAX_ZIP_NESTING_DEPTH) {
    throw new Error(`Gate0 artifact ZIP ${safeArtifactId(artifactPath)} exceeds the nesting-depth safety limit.`);
  }
}

function isZipEntry(entryName: string, value: Buffer) {
  const hasZipExtension = path.posix.extname(normalizeRelative(entryName)).toLowerCase() === ".zip";
  return hasZipExtension || hasZipEnvelopeSignature(value);
}

async function loadZipOrThrow(value: Buffer, artifactPath: string, budget: ZipTraversalBudget) {
  const envelope = inspectGate0ZipEnvelope(value, artifactPath, budget);
  try {
    const zip = await JSZip.loadAsync(value, { checkCRC32: false, createFolders: false });
    if (Object.keys(zip.files).length !== envelope.entries.size) {
      throw new Error("projection-mismatch");
    }
    return { zip, envelope };
  } catch {
    throw new Error(`Gate0 artifact ZIP ${safeArtifactId(artifactPath)} is encrypted, malformed, or uses unsupported compression.`);
  }
}

type ZipEnvelopeEntry = {
  name: string;
  flags: number;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
};

type ZipEnvelope = {
  entries: Map<string, ZipEnvelopeEntry>;
  metadata: Buffer[];
};

function inspectGate0ZipEnvelope(
  value: Buffer,
  artifactPath: string,
  budget: ZipTraversalBudget,
): ZipEnvelope {
  const fail = (reason: string): never => {
    throw new Error(`Gate0 artifact ZIP ${safeArtifactId(artifactPath)} ${reason}; refusing upload.`);
  };
  if (value.length > MAX_ZIP_ARCHIVE_BYTES) fail("exceeds the archive-size safety limit");
  const eocdOffset = findZipEndOfCentralDirectory(value);
  if (eocdOffset < 0) fail("has no exact end-of-central-directory record");
  const disk = value.readUInt16LE(eocdOffset + 4);
  const centralDisk = value.readUInt16LE(eocdOffset + 6);
  const diskEntries = value.readUInt16LE(eocdOffset + 8);
  const totalEntries = value.readUInt16LE(eocdOffset + 10);
  const centralSize = value.readUInt32LE(eocdOffset + 12);
  const centralOffset = value.readUInt32LE(eocdOffset + 16);
  const archiveCommentLength = value.readUInt16LE(eocdOffset + 20);
  if (eocdOffset + 22 + archiveCommentLength !== value.length) fail("contains a trailing envelope");
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries || totalEntries === 0xffff) {
    fail("uses unsupported multi-disk or ZIP64 structure");
  }
  if (centralOffset + centralSize !== eocdOffset) fail("has inconsistent central-directory bounds");
  budget.entries += totalEntries;
  if (budget.entries > MAX_ZIP_ENTRY_COUNT) fail("exceeds the entry-count safety limit");
  const metadata: Buffer[] = [value.subarray(eocdOffset + 22, value.length)];
  const entries = new Map<string, ZipEnvelopeEntry>();
  let cursor = centralOffset;
  let totalCompressed = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > eocdOffset || value.readUInt32LE(cursor) !== 0x02014b50) {
      fail("has a malformed central-directory entry");
    }
    const flags = value.readUInt16LE(cursor + 8);
    const method = value.readUInt16LE(cursor + 10);
    const crc32 = value.readUInt32LE(cursor + 16);
    const compressedSize = value.readUInt32LE(cursor + 20);
    const uncompressedSize = value.readUInt32LE(cursor + 24);
    const nameLength = value.readUInt16LE(cursor + 28);
    const extraLength = value.readUInt16LE(cursor + 30);
    const commentLength = value.readUInt16LE(cursor + 32);
    const diskStart = value.readUInt16LE(cursor + 34);
    const externalAttributes = value.readUInt32LE(cursor + 38);
    const localOffset = value.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > eocdOffset || diskStart !== 0) fail("has invalid central-directory metadata");
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) fail("contains an encrypted entry");
    if ((flags & ~0x080e) !== 0) fail("uses unsupported general-purpose flags");
    if (method !== 0 && method !== 8) fail("uses unsupported compression");
    if (uncompressedSize > MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES) fail("exceeds the per-entry size safety limit");
    if (compressedSize === 0 && uncompressedSize > 0) fail("has an unsafe expansion ratio");
    if (compressedSize > 0 && uncompressedSize / compressedSize > MAX_ZIP_EXPANSION_RATIO) {
      fail("exceeds the expansion-ratio safety limit");
    }
    const nameBytes = value.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decodeSafeZipName(nameBytes, flags, artifactPath);
    if (entries.has(name)) fail("contains duplicate entry names");
    assertStrictSafeZipPath(name, artifactPath);
    const unixType = (externalAttributes >>> 16) & 0o170000;
    if (unixType !== 0 && unixType !== 0o100000 && unixType !== 0o040000) {
      fail("contains a non-regular entry");
    }
    const directoryByAttributes = unixType === 0o040000 || (externalAttributes & 0x10) !== 0;
    const directoryByName = name.endsWith("/");
    if (directoryByAttributes !== directoryByName) fail("has inconsistent directory metadata");
    if (directoryByName && (compressedSize !== 0 || uncompressedSize !== 0 || crc32 !== 0)) {
      fail("contains a non-empty directory entry");
    }
    const local = inspectLocalZipEntry(value, {
      nameBytes,
      flags,
      method,
      crc32,
      compressedSize,
      uncompressedSize,
      localOffset,
    }, centralOffset, artifactPath);
    metadata.push(value.subarray(cursor + 46 + nameLength, end), local.metadata);
    entries.set(name, { name, flags, method, crc32, compressedSize, uncompressedSize, localOffset });
    budget.uncompressedBytes += uncompressedSize;
    totalCompressed += compressedSize;
    if (budget.uncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) fail("exceeds the total uncompressed-size safety limit");
    cursor = end;
  }
  if (cursor !== eocdOffset || totalCompressed > MAX_ZIP_ARCHIVE_BYTES) {
    fail("has inconsistent or oversized compressed content");
  }
  const ordered = [...entries.values()].sort((left, right) => left.localOffset - right.localOffset);
  if (ordered.length > 0 && ordered[0]!.localOffset !== 0) fail("contains an unsafe preamble");
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]!;
    const nextOffset = ordered[index + 1]?.localOffset ?? centralOffset;
    const localHeaderLength = 30 + value.readUInt16LE(current.localOffset + 26) + value.readUInt16LE(current.localOffset + 28);
    const dataEnd = current.localOffset + localHeaderLength + current.compressedSize;
    const descriptorLength = nextOffset - dataEnd;
    if ((current.flags & 0x0008) === 0) {
      if (descriptorLength !== 0) fail("contains unexplained bytes between entries");
    } else if (![12, 16].includes(descriptorLength)) {
      fail("contains an invalid data descriptor");
    } else {
      const descriptorOffset = dataEnd + (descriptorLength === 16 ? 4 : 0);
      if (descriptorLength === 16 && value.readUInt32LE(dataEnd) !== 0x08074b50) {
        fail("contains an invalid signed data descriptor");
      }
      if (
        value.readUInt32LE(descriptorOffset) !== current.crc32 ||
        value.readUInt32LE(descriptorOffset + 4) !== current.compressedSize ||
        value.readUInt32LE(descriptorOffset + 8) !== current.uncompressedSize
      ) {
        fail("contains an inconsistent data descriptor");
      }
    }
  }
  if (ordered.length === 0 && centralOffset !== 0) fail("contains an unsafe empty-archive preamble");
  return { entries, metadata };
}

function inspectLocalZipEntry(
  value: Buffer,
  expected: {
    nameBytes: Buffer;
    flags: number;
    method: number;
    crc32: number;
    compressedSize: number;
    uncompressedSize: number;
    localOffset: number;
  },
  centralOffset: number,
  artifactPath: string,
) {
  const fail = (reason: string): never => {
    throw new Error(`Gate0 artifact ZIP ${safeArtifactId(artifactPath)} ${reason}; refusing upload.`);
  };
  const offset = expected.localOffset;
  if (offset + 30 > centralOffset || value.readUInt32LE(offset) !== 0x04034b50) fail("has a malformed local header");
  const flags = value.readUInt16LE(offset + 6);
  const method = value.readUInt16LE(offset + 8);
  const crc32 = value.readUInt32LE(offset + 14);
  const compressedSize = value.readUInt32LE(offset + 18);
  const uncompressedSize = value.readUInt32LE(offset + 22);
  const nameLength = value.readUInt16LE(offset + 26);
  const extraLength = value.readUInt16LE(offset + 28);
  const end = offset + 30 + nameLength + extraLength;
  if (end + expected.compressedSize > centralOffset) fail("has local data outside the entry region");
  const nameBytes = value.subarray(offset + 30, offset + 30 + nameLength);
  if (!nameBytes.equals(expected.nameBytes) || flags !== expected.flags || method !== expected.method) {
    fail("has mismatched local and central metadata");
  }
  if ((flags & 0x0008) === 0 && (
    crc32 !== expected.crc32 || compressedSize !== expected.compressedSize || uncompressedSize !== expected.uncompressedSize
  )) {
    fail("has mismatched local and central sizes");
  }
  if ((flags & 0x0008) !== 0 && (crc32 !== 0 || compressedSize !== 0 || uncompressedSize !== 0)) {
    fail("has unsupported nonzero local data-descriptor fields");
  }
  return { metadata: value.subarray(offset + 30 + nameLength, end) };
}

function findZipEndOfCentralDirectory(value: Buffer) {
  const minimum = Math.max(0, value.length - 65_557);
  for (let offset = value.length - 22; offset >= minimum; offset -= 1) {
    if (value.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function decodeSafeZipName(value: Buffer, flags: number, artifactPath: string) {
  if ((flags & 0x0800) === 0 && value.some((byte) => byte >= 0x80)) {
    throw new Error(`Gate0 artifact ZIP ${safeArtifactId(artifactPath)} uses an unsupported filename encoding.`);
  }
  const name = value.toString("utf8");
  if (name.includes("\uFFFD") || Buffer.from(name, "utf8").compare(value) !== 0) {
    throw new Error(`Gate0 artifact ZIP ${safeArtifactId(artifactPath)} has an invalid UTF-8 filename.`);
  }
  return name;
}

function assertStrictSafeZipPath(name: string, artifactPath: string) {
  const pathValue = name.endsWith("/") ? name.slice(0, -1) : name;
  const unsafe = !pathValue || /[\0-\x1f\x7f\\]/u.test(name) || name.startsWith("/") ||
    /^[A-Za-z]:/u.test(name) || pathValue.split("/").some((part) => part === ".." || part === "");
  if (unsafe) {
    throw new Error(`Gate0 artifact ZIP ${safeArtifactId(artifactPath)} contains an unsafe entry path.`);
  }
}

function assertZipMetadataContainsNoSecrets(
  metadata: readonly Buffer[],
  artifactPath: string,
  secretValues: readonly string[],
) {
  if (metadata.some((value) => secretCategories(value.toString("utf8"), secretValues).length > 0)) {
    throw new Error(`Gate0 artifact ZIP ${safeArtifactId(artifactPath)} contains credentials in immutable metadata.`);
  }
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function updateCrc32(current: number, value: Buffer) {
  let crc = current >>> 0;
  for (const byte of value) crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return crc >>> 0;
}

function hasZipSignature(value: Buffer) {
  return value.length >= 4 && (
    value.readUInt32LE(0) === 0x04034b50 ||
    value.readUInt32LE(0) === 0x06054b50 ||
    value.readUInt32LE(0) === 0x08074b50
  );
}

function hasZipEnvelopeSignature(value: Buffer) {
  return hasZipSignature(value) || findZipEndOfCentralDirectory(value) >= 0;
}

function isZipArtifactFile(filePath: string) {
  if (path.extname(filePath).toLowerCase() === ".zip") return true;
  const stat = lstatSync(filePath);
  const descriptor = openSync(filePath, "r");
  try {
    const first = Buffer.alloc(Math.min(4, stat.size));
    if (first.length > 0) readSync(descriptor, first, 0, first.length, 0);
    if (hasZipSignature(first)) return true;
    const tailSize = Math.min(65_557, stat.size);
    if (tailSize < 22) return false;
    const tail = Buffer.alloc(tailSize);
    readSync(descriptor, tail, 0, tailSize, stat.size - tailSize);
    return findZipEndOfCentralDirectory(tail) >= 0;
  } finally {
    closeSync(descriptor);
  }
}

async function generateZipOrThrow(zip: JSZip, artifactPath: string) {
  try {
    return await zip.generateAsync({
      type: "nodebuffer",
      platform: process.platform === "win32" ? "DOS" : "UNIX",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
  } catch {
    throw new Error(`Gate0 artifact ZIP ${safeArtifactId(artifactPath)} cannot be safely regenerated.`);
  }
}

function replaceZipEntry(zip: JSZip, entry: JSZip.JSZipObject, value: Buffer) {
  zip.file(entry.name, value, {
    binary: true,
    date: entry.date,
    unixPermissions: entry.unixPermissions ?? undefined,
    dosPermissions: entry.dosPermissions ?? undefined,
  });
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
  const normalizedArtifactPath = normalizeRelative(artifactPath);
  const entryPath = normalizedArtifactPath.includes("!/")
    ? normalizedArtifactPath.slice(normalizedArtifactPath.lastIndexOf("!/") + 2)
    : normalizedArtifactPath;
  const normalizedEntryPath = normalizeRelative(entryPath);
  if (SANITIZABLE_TEXT_EXTENSIONS.has(path.posix.extname(normalizedEntryPath).toLowerCase())) return true;
  if (isPrintablePlaywrightReportResource(normalizedArtifactPath, value)) return true;
  if (/^(?:resources\/)?[a-f0-9]{20,}$/iu.test(normalizedEntryPath)) {
    try {
      JSON.parse(value.toString("utf8"));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function isPrintablePlaywrightReportResource(entryPath: string, value: Buffer) {
  const isDirectResource = /(?:^|\/)playwright-report\/resources\/[a-f0-9]{20,}$/iu.test(entryPath);
  const isDataArchiveResource = /(?:^|\/)playwright-report\/data\/[a-f0-9]{20,}\.zip!\/resources\/[a-f0-9]{20,}$/iu.test(entryPath);
  if (!isDirectResource && !isDataArchiveResource) return false;
  const text = value.toString("utf8");
  const hasUnsupportedControl = Array.from(text).some((character) =>
    character !== "\t" && character !== "\n" && character !== "\r" && /\p{C}/u.test(character));
  return Buffer.from(text, "utf8").equals(value) && !hasUnsupportedControl;
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
