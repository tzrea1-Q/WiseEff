import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type StoredObject = {
  storageKey: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  checksumSha256: string;
};

export interface ObjectStore {
  put(input: { organizationId: string; fileName: string; contentType: string; bytes: Buffer }): Promise<StoredObject>;
  get(storageKey: string): Promise<Buffer>;
}

function rejectPathLikeName(fileName: string, label: string) {
  if (
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("..") ||
    path.isAbsolute(fileName) ||
    path.win32.isAbsolute(fileName)
  ) {
    throw new Error(`Unsafe ${label}.`);
  }
}

function sanitizeFileName(fileName: string) {
  rejectPathLikeName(fileName, "file name");
  const sanitized = fileName.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

  if (!sanitized || sanitized === "." || sanitized === "..") {
    throw new Error("Unsafe file name.");
  }

  return sanitized;
}

function sanitizePathSegment(value: string, label: string) {
  rejectPathLikeName(value, label);
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

  if (!sanitized || sanitized === "." || sanitized === "..") {
    throw new Error(`Unsafe ${label}.`);
  }

  return sanitized;
}

function resolveInsideRoot(rootDir: string, storageKey: string) {
  if (path.isAbsolute(storageKey) || path.win32.isAbsolute(storageKey)) {
    throw new Error("Unsafe storage key.");
  }

  const rootPath = path.resolve(rootDir);
  const objectPath = path.resolve(rootPath, storageKey);
  const relative = path.relative(rootPath, objectPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Unsafe storage key.");
  }

  return { rootPath, objectPath };
}

export function createLocalObjectStore(rootDir: string): ObjectStore {
  return {
    async put(input) {
      const organizationId = sanitizePathSegment(input.organizationId, "organization id");
      const fileName = sanitizeFileName(input.fileName);
      const checksumSha256 = createHash("sha256").update(input.bytes).digest("hex");
      const storageKey = path.posix.join(organizationId, `${checksumSha256}-${fileName}`);
      const { rootPath, objectPath } = resolveInsideRoot(rootDir, storageKey);

      await mkdir(path.join(rootPath, organizationId), { recursive: true });
      await writeFile(objectPath, input.bytes);

      return {
        storageKey,
        fileName,
        contentType: input.contentType,
        fileSizeBytes: input.bytes.byteLength,
        checksumSha256
      };
    },

    async get(storageKey) {
      const { objectPath } = resolveInsideRoot(rootDir, storageKey);
      return readFile(objectPath);
    }
  };
}
