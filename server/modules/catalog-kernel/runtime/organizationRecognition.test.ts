import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../../shared/database/client";
import {
  CatalogCanonicalKey, CatalogEventTime, CatalogMaterializationFingerprint, CatalogPageLimit,
  CatalogReleaseDigest, CatalogReleaseId, CatalogReleaseSequence, CatalogReleaseVersion, CatalogSubjectId,
} from "../../parameter-catalog-contract";
import { DriverCompatible, NormalizedNodeTypeName, type CatalogSubjectDetailSnapshot } from "../interface";
import { CapturedCatalogSnapshot } from "./currentSnapshot";
import {
  loadOrganizationCatalogSnapshot, readInheritedRegistrationRecognitionSettings, readRegistrationRecognitionSettings,
  validateRegistrationRecognitionSettings, type ModuleRecognitionSettings,
} from "../../parameter-modules/recognitionSettings";

const node: ModuleRecognitionSettings & { kind: "node-type" } = {
  kind: "node-type", recognitionSubjectId: "seed-node", compatibles: [], nodeTypeName: "fm1230_swi",
  driverNature: null, instanceCardinality: null, overridden: false,
};
const identity = { kind: "node-type", owner_subject_id: null, organization_owner_subject_id: null };
const rule = { module_id: "power", canonical_subject_id: "seed-node", compatibles: ["fdw,fm1230_swi"],
  driver_nature: "physical-device", instance_cardinality: "multiple", node_type_name: null };

describe("organization-local node recognition correction", () => {
  it("converts an ownerless node while retaining its identity and filling driver defaults", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [identity] });
    await expect(validateRegistrationRecognitionSettings({ query } satisfies Queryable, "org-one", node,
      { kind: "driver", compatibles: ["fdw,fm1230_swi"] })).resolves.toEqual({ ...node,
      kind: "driver", compatibles: ["fdw,fm1230_swi"], nodeTypeName: null,
      driverNature: "physical-device", instanceCardinality: "multiple", overridden: true });
    expect(query.mock.calls[0]?.[1]).toEqual(["org-one", "seed-node"]);
  });

  it.each([
    { ...identity, owner_subject_id: "published-driver" },
    { ...identity, organization_owner_subject_id: "organization-driver" },
    { ...identity, kind: "configuration-schema" },
  ])("rejects conversion across ownership/type boundaries: %j", async observed => {
    const query = vi.fn().mockResolvedValue({ rows: [observed] });
    await expect(validateRegistrationRecognitionSettings({ query } satisfies Queryable, "org-one", node,
      { kind: "driver", compatibles: ["fdw,fm1230_swi"] })).rejects.toMatchObject({ code: "VALIDATION_FAILED",
      details: { issues: [{ path: "compatibles", code: "recognition-kind-conversion-not-supported" }] } });
  });

  it("requires exact nonempty selectors and keeps ordinary node updates strict", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [identity] }) } satisfies Queryable;
    await expect(validateRegistrationRecognitionSettings(db, "org-one", node,
      { kind: "driver", compatibles: [] })).rejects.toMatchObject({ details: { issues: [
      { path: "compatibles", code: "driver-conversion-requires-compatible" },
    ] } });
    await expect(validateRegistrationRecognitionSettings(db, "org-one", node,
      { kind: "driver", compatibles: ["fdw,*"] })).rejects.toMatchObject({ details: { issues: [
      { path: "compatibles.0", code: "wildcard-forbidden" },
    ] } });
    await expect(validateRegistrationRecognitionSettings(db, "org-one", node,
      { compatibles: ["fdw,fm1230_swi"] })).rejects.toMatchObject({ details: { issues: [
      { path: "compatibles", code: "field-not-supported" },
    ] } });
  });

  it("prevents a corrected driver losing its only selector without restricting canonical drivers", async () => {
    const current = { ...node, kind: "driver" as const, nodeTypeName: null, compatibles: ["fdw,fm1230_swi"],
      driverNature: "physical-device" as const, instanceCardinality: "multiple" as const, overridden: true };
    const query = vi.fn().mockResolvedValueOnce({ rows: [identity] }).mockResolvedValueOnce({ rows: [{ ...identity, kind: "driver" }] });
    await expect(validateRegistrationRecognitionSettings({ query } satisfies Queryable, "org-one", current,
      { compatibles: [] })).rejects.toMatchObject({ details: { issues: [{ code: "driver-conversion-requires-compatible" }] } });
    await expect(validateRegistrationRecognitionSettings({ query } satisfies Queryable, "org-one", current,
      { compatibles: [] })).resolves.toMatchObject({ kind: "driver", compatibles: [] });
  });

  it("does not resurrect the inherited node name when reading a saved driver correction", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ subject_id: "seed-node", kind: "node-type" }] })
      .mockResolvedValueOnce({ rows: [{ available: true }] }).mockResolvedValueOnce({ rows: [rule] })
      .mockResolvedValueOnce({ rows: [{ selector_snapshot: { kind: "node-type-name", value: "fm1230_swi" }, aliases: [] }] });
    await expect(readRegistrationRecognitionSettings({ query } satisfies Queryable, "org-one", "registration-one"))
      .resolves.toMatchObject({ kind: "driver", nodeTypeName: null, compatibles: ["fdw,fm1230_swi"],
        driverNature: "physical-device", instanceCardinality: "multiple" });
  });

  it("restores the canonical node kind when resetting to inherited recognition", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ selector_snapshot: { kind: "node-type-name", value: "fm1230_swi" }, aliases: [] }] });
    await expect(readInheritedRegistrationRecognitionSettings({ query } satisfies Queryable,
      { ...node, kind: "driver", nodeTypeName: null, compatibles: ["fdw,fm1230_swi"],
        driverNature: "physical-device", instanceCardinality: "multiple", overridden: true }, "release"))
      .resolves.toEqual(node);
  });
});

const release = { id: CatalogReleaseId("release"), digest: CatalogReleaseDigest(`sha256:${"a".repeat(64)}`), version: CatalogReleaseVersion("1") };
const subject = (id: string, kind: "driver" | "node-type", value: string): CatalogSubjectDetailSnapshot => ({
  id: CatalogSubjectId(id), kind, canonicalKey: CatalogCanonicalKey(value), aliases: [],
  definitionCounts: { active: 0, deprecated: 0, retired: 0 },
  membership: { release, lifecycle: "active", tombstone: { kind: "absent" }, selector: kind === "driver"
    ? { kind: "driver-compatible", values: [DriverCompatible(value)] }
    : { kind: "node-type-name", value: NormalizedNodeTypeName(value) } },
});
const snapshot = () => new CapturedCatalogSnapshot({ release, sequence: CatalogReleaseSequence(1),
  publishedAt: CatalogEventTime("2026-11-07T00:00:00Z"), materializedAt: CatalogEventTime("2026-11-07T00:00:00Z"),
  compiledFingerprint: CatalogMaterializationFingerprint("compiled"), databaseFingerprint: CatalogMaterializationFingerprint("database"),
  subjects: [subject("seed-node", "node-type", "fm1230_swi"), subject("unchanged-node", "node-type", "checker"),
    subject("existing-driver", "driver", "vendor,driver")], definitions: [], revisions: [], facts: [] });
const overlayDb = () => ({ query: vi.fn(async (sql: string, params?: unknown[]) => {
  if (sql.includes("to_regclass")) return { rows: [{ available: true }] };
  if (sql.includes("pg_attribute")) return { rows: [{ available: false }] };
  return { rows: params?.[0] === "org-one" ? [rule] : [] };
}) }) as unknown as Queryable;

describe("corrected organization snapshot", () => {
  it("matches compatible as a driver in one organization without changing canonical or foreign snapshots", async () => {
    const canonical = snapshot();
    const local = await loadOrganizationCatalogSnapshot(overlayDb(), "org-one", canonical);
    const foreign = await loadOrganizationCatalogSnapshot(overlayDb(), "org-two", local);
    const selector = { driverCompatibles: [DriverCompatible("fdw,fm1230_swi")], nodeTypeFallback: { kind: "absent" as const } };
    expect(local.resolveSubject(selector)).toMatchObject({ status: "matched", subject: { id: "seed-node", kind: "driver" } });
    expect(local.getSubject(CatalogSubjectId("seed-node"))).toMatchObject({ subject: { kind: "driver", canonicalKind: "node-type" } });
    expect(canonical.getSubject(CatalogSubjectId("seed-node"))).toMatchObject({ subject: { kind: "node-type" } });
    expect(foreign.resolveSubject(selector)).toEqual({ status: "unknown", reason: "no-candidate" });
    expect(foreign.getSubject(CatalogSubjectId("seed-node"))).toMatchObject({ subject: { kind: "node-type" } });
  });

  it("filters corrected kinds before pagination, keeps counts and rejects stale cursor scope", async () => {
    const local = await loadOrganizationCatalogSnapshot(overlayDb(), "org-one", snapshot());
    const query = { selection: { kind: "all" as const }, kinds: ["driver" as const], lifecycles: [], search: { kind: "absent" as const },
      page: { limit: CatalogPageLimit(1), after: { kind: "absent" as const } } };
    const first = local.listSubjects(query);
    expect(first).toMatchObject({ status: "found", page: { items: [{ id: "existing-driver" }], pageInfo: { totalCount: 2, hasMore: true } } });
    if (first.status !== "found" || first.page.next.kind !== "present") throw new Error("expected a next page");
    const second = local.listSubjects({ ...query, page: { ...query.page, after: first.page.next } });
    expect(second).toMatchObject({ status: "found", page: { items: [{ id: "seed-node", kind: "driver" }], pageInfo: { totalCount: 2, hasMore: false } } });
    expect(local.listSubjects({ ...query, kinds: ["node-type"], page: { ...query.page, after: first.page.next } }))
      .toEqual({ status: "invalid-page", reason: "query-mismatch" });
    expect(local.listSubjects({ ...query, kinds: ["node-type"] })).toMatchObject({ status: "found", page: {
      items: [{ id: "unchanged-node" }], pageInfo: { totalCount: 1, hasMore: false },
    } });
    expect(local.listSubjects({ ...query, selection: { kind: "only", ids: [CatalogSubjectId("seed-node")], fingerprint: "authorized-subset" } }))
      .toMatchObject({ status: "found", page: { items: [{ id: "seed-node" }], pageInfo: { totalCount: 1 } } });
  });
});
