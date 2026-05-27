import { createHash, randomUUID } from "node:crypto";
import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  rm as fsRm,
  writeFile as fsWriteFile
} from "node:fs/promises";
import path from "node:path";

export type StoredObject = {
  storageKey: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  checksumSha256: string;
};

export type ObjectStoreHealth = {
  ok: boolean;
  status: "ready" | "failed";
  message?: string;
};

export interface ObjectStore {
  put(input: { organizationId: string; fileName: string; contentType: string; bytes: Buffer }): Promise<StoredObject>;
  get(storageKey: string): Promise<Buffer>;
}

export interface ObjectStoreHealthCheck {
  checkHealth(): Promise<ObjectStoreHealth>;
}

type HealthProbeIo = {
  mkdir: typeof fsMkdir;
  writeFile: typeof fsWriteFile;
  readFile: typeof fsReadFile;
  rm: typeof fsRm;
  randomUUID: typeof randomUUID;
};

type LocalObjectStoreOptions = {
  probe?: Partial<HealthProbeIo>;
};

const defaultHealthProbeIo: HealthProbeIo = {
  mkdir: fsMkdir,
  writeFile: fsWriteFile,
  readFile: fsReadFile,
  rm: fsRm,
  randomUUID
};

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

export function createLocalObjectStore(rootDir: string, options: LocalObjectStoreOptions = {}): ObjectStore & ObjectStoreHealthCheck {
  const probe = { ...defaultHealthProbeIo, ...options.probe };

  return {
    async put(input) {
      const organizationId = sanitizePathSegment(input.organizationId, "organization id");
      const fileName = sanitizeFileName(input.fileName);
      const checksumSha256 = createHash("sha256").update(input.bytes).digest("hex");
      const storageKey = path.posix.join(organizationId, `${checksumSha256}-${fileName}`);
      const { rootPath, objectPath } = resolveInsideRoot(rootDir, storageKey);

      await fsMkdir(path.join(rootPath, organizationId), { recursive: true });
      await fsWriteFile(objectPath, input.bytes);

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
      return fsReadFile(objectPath);
    },

    async checkHealth() {
      let probePath: string | undefined;
      try {
        const rootPath = path.resolve(rootDir);
        await probe.mkdir(rootPath, { recursive: true });

        const probeBytes = Buffer.from("wiseeff-object-store-health", "utf8");
        probePath = path.join(rootPath, `.health-${probe.randomUUID()}.tmp`);
        await probe.writeFile(probePath, probeBytes);
        const readBack = await probe.readFile(probePath);
        await probe.rm(probePath, { force: true });
        probePath = undefined;

        if (!readBack.equals(probeBytes)) {
          return {
            ok: false,
            status: "failed",
            message: "Object store health probe read-back mismatch."
          };
        }

        return { ok: true, status: "ready" };
      } catch (error) {
        return {
          ok: false,
          status: "failed",
          message: error instanceof Error ? error.message : "Object store readiness check failed."
        };
      } finally {
        if (probePath) {
          await probe.rm(probePath, { force: true }).catch(() => undefined);
        }
      }
    }
  };
}
