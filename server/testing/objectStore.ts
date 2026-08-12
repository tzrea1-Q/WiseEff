import { createHash } from "node:crypto";
import type { ObjectStore } from "../modules/logs/objectStore";

export type MemoryObjectStore = ObjectStore & {
  /** Backing map, exposed so suites can assert on stored keys or simulate loss. */
  entries: Map<string, Buffer>;
};

/**
 * In-memory adapter for the `ObjectStore` seam. Mirrors the storage-key and checksum
 * behavior of the local filesystem adapter without touching disk.
 */
export function createMemoryObjectStore(): MemoryObjectStore {
  const entries = new Map<string, Buffer>();

  return {
    entries,
    async put(input) {
      const checksum = createHash("sha256").update(input.bytes).digest("hex");
      const storageKey = `${input.organizationId}/${checksum}-${input.fileName}`;
      entries.set(storageKey, Buffer.from(input.bytes));
      return {
        storageKey,
        fileName: input.fileName,
        contentType: input.contentType,
        fileSizeBytes: input.bytes.byteLength,
        checksumSha256: checksum
      };
    },
    async get(storageKey) {
      const value = entries.get(storageKey);
      if (!value) {
        throw new Error(`Missing object for storage key: ${storageKey}`);
      }
      return Buffer.from(value);
    }
  };
}
