import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalObjectStore, type ObjectStore } from "../logs/objectStore";
import { createCanonicalSourceAttempt } from "./canonicalSourceAttempt";

describe("canonical source attempt objects", () => {
  let storageDirectory: string | undefined;

  afterEach(async () => {
    if (storageDirectory)
      await rm(storageDirectory, { recursive: true, force: true });
    storageDirectory = undefined;
  });

  it("uses distinct UUID filenames and cleans only tracked objects when told rollback is confirmed", async () => {
    storageDirectory = await mkdtemp(
      join(tmpdir(), "wiseeff-canonical-source-attempt-"),
    );
    const baseStore = createLocalObjectStore(storageDirectory);
    const bytes = Buffer.from('{"value":1}\n');
    const existing = await baseStore.put({
      organizationId: "org-attempt-test",
      fileName: "settings.json",
      contentType: "application/json",
      bytes,
    });
    const attempt = createCanonicalSourceAttempt(baseStore);
    const input = {
      organizationId: "org-attempt-test",
      fileName: "settings.json",
      contentType: "application/json",
      bytes,
    };

    const first = await attempt.objectStore.put(input);
    const second = await attempt.objectStore.put(input);

    expect(first.storageKey).not.toBe(second.storageKey);
    expect(first.fileName).toMatch(
      /^canonical-source-attempt-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-settings\.json$/,
    );
    expect(attempt.cleanupDescriptor.storageKeys).toEqual([
      first.storageKey,
      second.storageKey,
    ]);
    expect(await baseStore.get(first.storageKey)).toEqual(bytes);
    expect(await baseStore.get(second.storageKey)).toEqual(bytes);

    // The helper never decides transaction outcome; this explicit call models a confirmed rollback.
    await attempt.cleanupAfterConfirmedRollback();

    await expect(baseStore.get(first.storageKey)).rejects.toThrow();
    await expect(baseStore.get(second.storageKey)).rejects.toThrow();
    expect(await baseStore.get(existing.storageKey)).toEqual(bytes);
  });

  it("allows no-write replay without delete but refuses a put before object creation", async () => {
    const put = vi.fn<ObjectStore["put"]>();
    const noDeleteStore: ObjectStore = {
      put,
      get: vi.fn<ObjectStore["get"]>(),
    };

    const attempt = createCanonicalSourceAttempt(noDeleteStore);
    expect(attempt.objectStore.delete).toBeUndefined();
    await attempt.cleanupAfterConfirmedRollback();
    await expect(attempt.objectStore.put({
      organizationId: "org-attempt-test",
      fileName: "settings.json",
      contentType: "application/json",
      bytes: Buffer.from("{}"),
    })).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      details: { reason: "canonical-source-object-cleanup-unavailable" },
    });
    expect(put).not.toHaveBeenCalled();
  });

  it("does not claim or clean an object when put rejects with an unknown acknowledgement", async () => {
    const deleteObject = vi.fn(async () => undefined);
    const uncertainStore: ObjectStore = {
      async put() {
        throw new Error("PUT acknowledgement was lost");
      },
      async get() {
        throw new Error("unused");
      },
      delete: deleteObject,
    };
    const attempt = createCanonicalSourceAttempt(uncertainStore);

    await expect(
      attempt.objectStore.put({
        organizationId: "org-attempt-test",
        fileName: "settings.json",
        contentType: "application/json",
        bytes: Buffer.from("{}"),
      }),
    ).rejects.toThrow("PUT acknowledgement was lost");
    expect(attempt.cleanupDescriptor.storageKeys).toEqual([]);
    await attempt.cleanupAfterConfirmedRollback();
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
