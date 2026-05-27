import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createLocalObjectStore } from "./objectStore";

async function withTempStore<T>(fn: (rootDir: string) => Promise<T>): Promise<T> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "wiseeff-object-store-"));
  try {
    return await fn(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

describe("createLocalObjectStore", () => {
  it("stores and reads an object by storage key", async () => {
    await withTempStore(async (rootDir) => {
      const store = createLocalObjectStore(rootDir);
      const bytes = Buffer.from("thermal foldback log", "utf8");

      const stored = await store.put({
        organizationId: "org-chargelab",
        fileName: "charging foldback.log",
        contentType: "text/plain",
        bytes
      });

      await expect(store.get(stored.storageKey)).resolves.toEqual(bytes);
      expect(stored.storageKey).toContain("org-chargelab/");
      expect(stored.storageKey).toContain("charging-foldback.log");
    });
  });

  it("returns checksum and file size metadata", async () => {
    await withTempStore(async (rootDir) => {
      const store = createLocalObjectStore(rootDir);
      const bytes = Buffer.from("abc123", "utf8");

      const stored = await store.put({
        organizationId: "org-chargelab",
        fileName: "sample.log",
        contentType: "text/plain",
        bytes
      });

      expect(stored.checksumSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(stored.fileSizeBytes).toBe(bytes.byteLength);
      expect(stored.fileName).toBe("sample.log");
      expect(stored.contentType).toBe("text/plain");
    });
  });

  it.each(["../secret.log", "..\\secret.log", "/tmp/secret.log", "C:\\temp\\secret.log"])(
    "rejects path traversal file name %s",
    async (fileName) => {
      await withTempStore(async (rootDir) => {
        const store = createLocalObjectStore(rootDir);

        await expect(
          store.put({
            organizationId: "org-chargelab",
            fileName,
            contentType: "text/plain",
            bytes: Buffer.from("secret")
          })
        ).rejects.toThrow("Unsafe file name");
      });
    }
  );

  it("rejects storage keys that escape the root directory", async () => {
    await withTempStore(async (rootDir) => {
      const store = createLocalObjectStore(rootDir);

      await expect(store.get("../outside.log")).rejects.toThrow("Unsafe storage key");
    });
  });
});
