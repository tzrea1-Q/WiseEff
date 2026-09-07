import { beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { createPersistedReviewQueueReader, groupReviewEvidence, reviewItemIdFor } from "./index";
import type { ListReviewQueueQuery, ReviewEvidenceRecord } from "./types";

const kernel = vi.hoisted(() => ({ loadCurrentCatalog: vi.fn() }));
vi.mock("../../catalog-kernel/interface", () => ({ createCatalogKernel: () => kernel }));
const pin = { id: "crel_persisted", digest: `sha256:${"a".repeat(64)}` } as ListReviewQueueQuery["capturedRelease"];
const input = (): ListReviewQueueQuery => ({ organizationId: "org-a", capturedRelease: pin,
  context: { actorKind: "org-admin", organizationId: "org-a", principalId: "admin-a" } });
const evidence: ReviewEvidenceRecord = { id: "evidence-a", organizationId: "org-a", reason: "unknown",
  candidateSafeDigest: "safe-digest", rClass: null, sourceGraphRef: null, evidence: {
    sourceIdentity: "source-a", catalogReleaseId: pin.id, matcherRevision: "matcher-a", matcherOutput: "unknown",
    reason: "unknown", rClass: null, sourceGraphRef: null, payload: { propertyKey: "key-a", secret: "private-marker" },
  } };
const grouped = groupReviewEvidence([evidence], pin);
if (!grouped.ok) throw new Error("invalid synthetic grouping");
const group = grouped.value[0]!;
const item = { id: reviewItemIdFor(group.groupingFingerprint), evidence_fingerprint: group.groupingFingerprint,
  matcher_revision: "matcher-a", catalog_release_id: pin.id, reason: "unknown", status: "open", etag_version: "3" };
function fixture(rows = [item]) {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("select id, organization_id")) return { rows: [{ id: evidence.id, organization_id: evidence.organizationId,
      reason: evidence.reason, candidate_safe_digest: evidence.candidateSafeDigest, r_class: null,
      source_graph_ref: null, evidence: evidence.evidence }] };
    if (sql.startsWith("select id, evidence_fingerprint")) return { rows };
    if (["begin isolation level repeatable read read only", "commit", "rollback"].includes(sql)) return { rows: [] };
    throw new Error("unexpected SQL in read-only projection");
  });
  const client = { query, release: vi.fn() };
  const pool = { connect: vi.fn(async () => client) } as unknown as pg.Pool;
  return { pool, client, query, reader: createPersistedReviewQueueReader(pool) };
}
beforeEach(() => { kernel.loadCurrentCatalog.mockReset().mockResolvedValue({ ok: true, value: {} }); });

describe("persisted Review Queue projection", () => {
  it("reads the existing item identity and ETag without grouping writes or raw evidence", async () => {
    const f = fixture();
    const result = await f.reader.list(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(1);
    expect(result.value.items[0]).toMatchObject({ id: item.id, status: "open", evidenceCount: 1 });
    expect(JSON.stringify(result)).not.toContain("private-marker");
    expect(f.query.mock.calls.map(([sql]) => sql).some(sql => /\b(insert|update|delete)\b/i.test(sql))).toBe(false);
    expect(f.query.mock.calls[0][0]).toBe("begin isolation level repeatable read read only");
    expect(f.client.release).toHaveBeenCalledOnce();
  });
  it("refuses missing persisted groups instead of inventing an item or empty success", async () => {
    const f = fixture([]);
    await expect(f.reader.list(input())).rejects.toThrow("review-queue-projection-unavailable");
    expect(f.query).toHaveBeenCalledWith("rollback");
    expect(f.query).not.toHaveBeenCalledWith("commit");
    expect(f.client.release).toHaveBeenCalledOnce();
  });
  it.each(["matcher_revision", "catalog_release_id", "reason", "etag_version"] as const)("refuses inconsistent persisted %s", async field => {
    const f = fixture([{ ...item, [field]: "wrong" }]);
    await expect(f.reader.list(input())).rejects.toThrow("review-queue-projection-unavailable");
  });
  it("checks organization authorization before opening a connection", async () => {
    const f = fixture();
    const result = await f.reader.list({ ...input(), organizationId: "foreign" });
    expect(result).toMatchObject({ ok: false, error: { kind: "permission-denied" } });
    expect(f.pool.connect).not.toHaveBeenCalled();
    expect(kernel.loadCurrentCatalog).not.toHaveBeenCalled();
  });
  it("refuses an unavailable current pin without opening the projection transaction", async () => {
    kernel.loadCurrentCatalog.mockResolvedValue({ ok: false, error: { kind: "release-mismatch", actual: null } });
    const f = fixture();
    expect(await f.reader.list(input())).toMatchObject({ ok: false, error: { kind: "stale-candidate" } });
    expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it("snapshots selection before its first async read", async () => {
    const f = fixture();
    const selection = input();
    const promise = f.reader.list(selection);
    Object.assign(selection, { organizationId: "foreign", capturedRelease: { ...pin, id: "changed" } });
    expect((await promise).ok).toBe(true);
    expect(kernel.loadCurrentCatalog).toHaveBeenCalledWith(pin);
  });
  it("gets only a persisted identity and retains its ETag across list/detail", async () => {
    const f = fixture();
    const listed = await f.reader.list(input());
    const found = await f.reader.get({ ...input(), reviewItemId: item.id });
    expect(listed.ok && found.ok).toBe(true);
    if (listed.ok && found.ok) expect(found.value).toEqual(listed.value.items[0]);
  });
  it("rejects current-pin drift after returning its transaction checkout", async () => {
    const f = fixture();
    kernel.loadCurrentCatalog.mockResolvedValueOnce({ ok: true, value: {} }).mockImplementationOnce(async () => {
      expect(f.client.release).toHaveBeenCalledOnce();
      return { ok: false, error: { kind: "release-mismatch", actual: null } };
    });
    expect(await f.reader.list(input())).toMatchObject({ ok: false, error: { kind: "stale-candidate" } });
  });
  it("sanitizes query and rollback failures and destroys the broken checkout", async () => {
    const f = fixture();
    f.query.mockRejectedValue(new Error("private-marker postgres://secret"));
    await expect(f.reader.list(input())).rejects.toMatchObject({ message: "review-queue-projection-unavailable" });
    expect(f.client.release).toHaveBeenCalledWith(true);
  });
  it("does not silently skip malformed stored evidence", async () => {
    const f = fixture();
    const original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async sql => sql.startsWith("select id, organization_id")
      ? { rows: [{ evidence: {} }] } as never : original(sql));
    await expect(f.reader.list(input())).rejects.toThrow("review-queue-projection-unavailable");
  });
});
