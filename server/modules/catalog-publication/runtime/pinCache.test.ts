import pg from "pg";
import { describe, expect, it, vi } from "vitest";

import type { CatalogKernel, PinnedCatalogSnapshot } from "../../catalog-kernel/interface";
import { CatalogReleaseDigest, CatalogReleaseId } from "../../parameter-catalog-contract/index";
import { createPinCapturingCatalogRuntime } from "./pinCache";

const { resolvePin } = vi.hoisted(() => ({ resolvePin: vi.fn() }));
vi.mock("../../catalog-kernel/runtime/pinnedSnapshot", () => ({ resolveCatalogReleasePin: resolvePin }));

describe("historical Catalog cache after erasure", () => {
  it("validates the database digest before reusing a cached historical snapshot", async () => {
    const pin = { id: CatalogReleaseId("crel_erasure"), digest: CatalogReleaseDigest(`sha256:${"a".repeat(64)}`) };
    const snapshot = { pin } as PinnedCatalogSnapshot;
    const load = vi.fn(async () => ({ ok: true as const, value: snapshot }));
    const kernel = { loadPinnedCatalog: load } as unknown as CatalogKernel;
    const runtime = createPinCapturingCatalogRuntime({} as pg.Pool, kernel);
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
