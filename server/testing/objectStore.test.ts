import { describe, expect, it } from "vitest";

import { createMemoryObjectStore } from "./objectStore";

describe("createMemoryObjectStore.delete", () => {
  it("removes a stored object and is a no-op for a missing key", async () => {
    const store = createMemoryObjectStore();
    const stored = await store.put({
      organizationId: "org-1",
      fileName: "overlay.dtbo",
      contentType: "application/octet-stream",
      bytes: Buffer.from("dtbo")
    });

    await expect(store.get(stored.storageKey)).resolves.toEqual(Buffer.from("dtbo"));
    await store.delete!(stored.storageKey);
    await expect(store.get(stored.storageKey)).rejects.toThrow(/Missing object/);
    await expect(store.delete!(stored.storageKey)).resolves.toBeUndefined();
    expect(store.entries.has(stored.storageKey)).toBe(false);
  });
});
