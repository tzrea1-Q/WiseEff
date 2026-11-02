import pg from "pg";
import { describe, expect, it, vi } from "vitest";

import type { CatalogKernel, CurrentCatalogSnapshot, PinnedCatalogSnapshot } from "../../catalog-kernel/interface";
import { CatalogReleaseDigest, CatalogReleaseId } from "../../parameter-catalog-contract/index";
import { createPinCapturingCatalogRuntime, DigestKeyedCatalogRuntimeCache } from "./pinCache";

const { resolvePin, readPointer } = vi.hoisted(() => ({ resolvePin: vi.fn(), readPointer: vi.fn() }));
vi.mock("../../catalog-kernel/runtime/pinnedSnapshot", () => ({ resolveCatalogReleasePin: resolvePin }));
vi.mock("../../catalog-kernel/install/currentPointer", () => ({ readCurrentCatalogPointer: readPointer }));

describe("historical Catalog cache after erasure", () => {
  it("does not cache an in-flight snapshot captured before an owner claim", async () => {
    const pin = { id: CatalogReleaseId("crel_owner"), digest: CatalogReleaseDigest(`sha256:${"c".repeat(64)}`) };
    const oldSnapshot = { pin, marker: "old" } as unknown as PinnedCatalogSnapshot;
    const newSnapshot = { pin, marker: "new" } as unknown as PinnedCatalogSnapshot;
    let finishOld!: (value: { ok: true; value: PinnedCatalogSnapshot }) => void;
    const oldRead = new Promise<{ ok: true; value: PinnedCatalogSnapshot }>((resolve) => { finishOld = resolve; });
    const load = vi.fn().mockReturnValueOnce(oldRead).mockResolvedValue({ ok: true, value: newSnapshot });
    const runtime = createPinCapturingCatalogRuntime({} as pg.Pool, { loadPinnedCatalog: load } as unknown as CatalogKernel);
    resolvePin.mockResolvedValue({ ok: true, value: pin });
    readPointer.mockResolvedValueOnce({ kind: "installed", subjectOwnerEpoch: "0" })
      .mockResolvedValue({ kind: "installed", subjectOwnerEpoch: "1" });
    const staleRead = runtime.loadPinnedCatalog(pin);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(await runtime.loadPinnedCatalog(pin)).toEqual({ ok: true, value: newSnapshot });
    finishOld({ ok: true, value: oldSnapshot });
    expect(await staleRead).toEqual({ ok: true, value: newSnapshot });
    expect(await runtime.loadPinnedCatalog(pin)).toEqual({ ok: true, value: newSnapshot });
  });

  it("does not regress its owner epoch when pointer reads complete out of order", () => {
    const cache = new DigestKeyedCatalogRuntimeCache();
    const pin = { id: CatalogReleaseId("crel_epoch"), digest: CatalogReleaseDigest(`sha256:${"d".repeat(64)}`) };
    const snapshot = { pin } as PinnedCatalogSnapshot;
    cache.observeSubjectOwnerEpoch("2");
    cache.putPinned(pin.digest, snapshot, "2");
    cache.observeSubjectOwnerEpoch("1");
    expect(cache.getPinned(pin.digest)).toBe(snapshot);
    cache.putPinned(pin.digest, { pin, stale: true } as unknown as PinnedCatalogSnapshot, "1");
    expect(cache.getPinned(pin.digest)).toBe(snapshot);
  });

  it("retries a load when the database epoch changes without another cache reader", async () => {
    const pin = { id: CatalogReleaseId("crel_retry"), digest: CatalogReleaseDigest(`sha256:${"e".repeat(64)}`) };
    const oldSnapshot = { pin, marker: "old" } as unknown as PinnedCatalogSnapshot;
    const newSnapshot = { pin, marker: "new" } as unknown as PinnedCatalogSnapshot;
    const load = vi.fn().mockResolvedValueOnce({ ok: true, value: oldSnapshot }).mockResolvedValue({ ok: true, value: newSnapshot });
    const runtime = createPinCapturingCatalogRuntime({} as pg.Pool, { loadPinnedCatalog: load } as unknown as CatalogKernel);
    resolvePin.mockResolvedValue({ ok: true, value: pin });
    readPointer.mockResolvedValueOnce({ kind: "installed", subjectOwnerEpoch: "3" })
      .mockResolvedValue({ kind: "installed", subjectOwnerEpoch: "4" });
    expect(await runtime.loadPinnedCatalog(pin)).toEqual({ ok: true, value: newSnapshot });
    expect(load).toHaveBeenCalledTimes(2);
    expect(runtime.cache.getPinned(pin.digest)).toBe(newSnapshot);
  });

  it("fails retryably when the epoch changes on both attempts", async () => {
    const pin = { id: CatalogReleaseId("crel_busy"), digest: CatalogReleaseDigest(`sha256:${"f".repeat(64)}`) };
    const load = vi.fn().mockResolvedValue({ ok: true, value: { pin } });
    const runtime = createPinCapturingCatalogRuntime({} as pg.Pool, { loadPinnedCatalog: load } as unknown as CatalogKernel);
    resolvePin.mockResolvedValue({ ok: true, value: pin });
    readPointer.mockResolvedValueOnce({ kind: "installed", subjectOwnerEpoch: "5" })
      .mockResolvedValueOnce({ kind: "installed", subjectOwnerEpoch: "6" })
      .mockResolvedValueOnce({ kind: "installed", subjectOwnerEpoch: "6" })
      .mockResolvedValueOnce({ kind: "installed", subjectOwnerEpoch: "7" });
    expect(await runtime.loadPinnedCatalog(pin)).toEqual({ ok: false,
      error: { kind: "storage-failure", operation: "loadPinnedCatalog", retryable: true } });
    expect(runtime.cache.getPinned(pin.digest)).toBeUndefined();
  });

  it("retries a current snapshot load if the owner epoch changes", async () => {
    const pin = { id: CatalogReleaseId("crel_current"), digest: CatalogReleaseDigest(`sha256:${"1".repeat(64)}`) };
    const oldSnapshot = { release: pin, marker: "old" } as unknown as CurrentCatalogSnapshot;
    const newSnapshot = { release: pin, marker: "new" } as unknown as CurrentCatalogSnapshot;
    const load = vi.fn().mockResolvedValueOnce({ ok: true, value: oldSnapshot }).mockResolvedValue({ ok: true, value: newSnapshot });
    const runtime = createPinCapturingCatalogRuntime({} as pg.Pool, { loadCurrentCatalog: load } as unknown as CatalogKernel);
    readPointer.mockResolvedValueOnce({ kind: "installed", current: pin, subjectOwnerEpoch: "8" })
      .mockResolvedValue({ kind: "installed", current: pin, subjectOwnerEpoch: "9" });
    expect(await runtime.loadCurrentCatalog(pin)).toEqual({ ok: true, value: newSnapshot });
    expect(load).toHaveBeenCalledTimes(2);
    expect(runtime.cache.getCurrent(pin.digest)).toBe(newSnapshot);
  });

  it("validates the database digest before reusing a cached historical snapshot", async () => {
    const pin = { id: CatalogReleaseId("crel_erasure"), digest: CatalogReleaseDigest(`sha256:${"a".repeat(64)}`) };
    const snapshot = { pin } as PinnedCatalogSnapshot;
    const load = vi.fn(async () => ({ ok: true as const, value: snapshot }));
    const kernel = { loadPinnedCatalog: load } as unknown as CatalogKernel;
    const runtime = createPinCapturingCatalogRuntime({} as pg.Pool, kernel);
    readPointer.mockResolvedValue({ kind: "empty" });
    resolvePin.mockResolvedValue({ ok: true, value: pin });
    expect(await runtime.loadPinnedCatalog(pin)).toEqual({ ok: true, value: snapshot });
    expect(await runtime.loadPinnedCatalog(pin)).toEqual({ ok: true, value: snapshot });
    expect(load).toHaveBeenCalledTimes(1);
    const rewritten = { ...pin, digest: CatalogReleaseDigest(`sha256:${"b".repeat(64)}`) };
    resolvePin.mockResolvedValue({ ok: true, value: rewritten });
    expect(await runtime.loadPinnedCatalog(pin)).toEqual({
      ok: false,
      error: { kind: "digest-conflict", releaseId: pin.id, expected: pin.digest, actual: rewritten.digest },
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(runtime.cache.getPinned(pin.digest)).toBeUndefined();
  });
});
