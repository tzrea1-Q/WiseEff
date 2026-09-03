import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { access, constants, link, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ArchiveObjectStore } from "./types";

const SAFE_REF = /^[A-Za-z0-9._-]+$/u;

const assertSafeObjectRef = (ref: string): string => {
  if (!SAFE_REF.test(ref)) {
    throw new Error("Unsafe archive object ref");
  }
  return ref;
};

const resolveInsideRoot = (rootDir: string, ref: string): string => {
  const safe = assertSafeObjectRef(ref);
  const rootPath = path.resolve(rootDir);
  const objectPath = path.resolve(rootPath, safe);
  const relative = path.relative(rootPath, objectPath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new Error("Unsafe archive object ref");
  }
  return objectPath;
};

export const createLocalArchiveObjectStore = (rootDir: string): ArchiveObjectStore => {
  const rootPath = path.resolve(rootDir);
  mkdirSync(rootPath, { recursive: true, mode: 0o700 });
  const stagingDir = path.join(rootPath, ".staging");
  mkdirSync(stagingDir, { recursive: true, mode: 0o700 });

  return {
    async putExclusive(ref, bytes) {
      const objectPath = resolveInsideRoot(rootPath, ref);
      const stagingPath = path.join(
        stagingDir,
        `${assertSafeObjectRef(ref)}.${randomBytes(8).toString("hex")}.tmp`,
      );
      await writeFile(stagingPath, bytes, { flag: "wx", mode: 0o600 });
      try {
        await link(stagingPath, objectPath);
      } catch (error) {
        await rm(stagingPath, { force: true }).catch(() => undefined);
        throw error;
      }
      await rm(stagingPath, { force: true }).catch(() => undefined);
    },

    async get(ref) {
      return readFile(resolveInsideRoot(rootPath, ref));
    },

    async remove(ref) {
      await rm(resolveInsideRoot(rootPath, ref), { force: true });
    },

    async exists(ref) {
      try {
        await access(resolveInsideRoot(rootPath, ref), constants.F_OK);
        return true;
      } catch {
        return false;
      }
    },

    async listRefs() {
      const entries = await readdir(rootPath, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort();
    },
  };
};
