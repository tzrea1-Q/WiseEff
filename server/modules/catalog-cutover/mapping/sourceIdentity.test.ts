import { describe, expect, it } from "vitest";
import { capturePlannedSourceIdentities, registerPlannedSourceIdentities, SourceIdentityRefusal } from "./sourceIdentity";
import type { MappingSourceIdentity } from "./snapshot";
import type { MappingQueryable } from "./types";

// Query doubles exercise the selection/registration contract only. Real source
// existence, FK enforcement, P0 intent and commit require the owned PG suite.
function database() {
  const rows: MappingSourceIdentity[] = [];
  let fault: (() => void) | undefined;
  const client = { async query(sql: string, values?: unknown[]) {
    if (sql.includes("resolve_legacy_identity_owner")) return { rows: [{ ownerScopeKind: "organization", ownerScopeId: "organization" }] };
    if (sql.startsWith("insert into")) {
      fault?.();
      for (const identity of JSON.parse(values![0] as string) as MappingSourceIdentity[]) {
        if (!rows.some(row => row.legacyIdentityId === identity.legacyIdentityId)) rows.push(identity);
      }
      return { rows: [] };
    }
    return { rows: structuredClone(rows).sort((a, b) => a.legacyIdentityId < b.legacyIdentityId ? -1 : 1) };
  } } as MappingQueryable;
  return { client, rows, onInsert(value: () => void) { fault = value; } };
}
const sources = [{ sourceKind: "parameter-spec" as const, sourceId: "spec-one" },
  { sourceKind: "parameter-spec" as const, sourceId: "spec-two" }];
describe("fixed legacy source identities before their first registry insert", () => {
  it("plans two identities without writes and registers/reuses exactly those IDs", async () => {
    const db = database();
    const selected = await capturePlannedSourceIdentities({ client: db.client, sourceSystem: "explicit-source", sources });
    expect(db.rows).toEqual([]);
    expect(new Set(selected.map(row => row.legacyIdentityId)).size).toBe(2);
    await registerPlannedSourceIdentities({ client: db.client, sourceSystem: "explicit-source", identities: selected, beforeEffect: async () => {} });
    expect(await capturePlannedSourceIdentities({ client: db.client, sourceSystem: "explicit-source", sources })).toEqual(selected);
    await registerPlannedSourceIdentities({ client: db.client, sourceSystem: "explicit-source", identities: selected, beforeEffect: async () => {} });
    expect(db.rows).toHaveLength(2);
  });
  it("retains an existing opaque ID rather than renaming it to the derived ID", async () => {
    const db = database();
    db.rows.push({ legacyIdentityId: "original-record-id", sourceSystem: "explicit-source", sourceKind: "parameter-spec",
      sourceId: "spec-one", ownerScopeKind: "organization", ownerScopeId: "organization" });
    expect((await capturePlannedSourceIdentities({ client: db.client, sourceSystem: "explicit-source", sources: sources.slice(0, 1) }))[0]!.legacyIdentityId).toBe("original-record-id");
  });
  it("refuses a namespace change over an already registered source", async () => {
    const db = database();
    db.rows.push({ legacyIdentityId: "original", sourceSystem: "old-source", sourceKind: "parameter-spec", sourceId: "spec-one",
      ownerScopeKind: "organization", ownerScopeId: "organization" });
    await expect(capturePlannedSourceIdentities({ client: db.client, sourceSystem: "new-source", sources })).rejects.toThrow("NAMESPACE-CONFLICT");
  });
  it("refuses an omitted existing identity and never treats it as a new empty inventory", async () => {
    const db = database();
    db.rows.push({ legacyIdentityId: "original", sourceSystem: "explicit-source", sourceKind: "parameter-spec", sourceId: "other",
      ownerScopeKind: "organization", ownerScopeId: "organization" });
    await expect(capturePlannedSourceIdentities({ client: db.client, sourceSystem: "explicit-source", sources })).rejects.toThrow("INVENTORY-INCOMPLETE");
  });
  it("refuses a caller-replaced planned ID before attempting any insert", async () => {
    const db = database();
    const selected = await capturePlannedSourceIdentities({ client: db.client, sourceSystem: "explicit-source", sources });
    await expect(registerPlannedSourceIdentities({ client: db.client, sourceSystem: "explicit-source",
      identities: selected.map(row => ({ ...row, legacyIdentityId: "caller-changed" })), beforeEffect: async () => {} })).rejects.toThrow("PLAN-DRIFT");
    expect(db.rows).toEqual([]);
  });
  it("does not merge tuple boundaries or trim contract JSON source keys", async () => {
    const db = database();
    const one = await capturePlannedSourceIdentities({ client: db.client, sourceSystem: "a|b", sources: [{ sourceKind: "parameter-spec", sourceId: "c" }] });
    const two = await capturePlannedSourceIdentities({ client: db.client, sourceSystem: "a", sources: [{ sourceKind: "parameter-spec", sourceId: "b|c" }] });
    expect(one[0]!.legacyIdentityId).not.toBe(two[0]!.legacyIdentityId);
    const composite = '{\n  "auditEventId": "event",\n  "semanticId": "spec",\n  "subjectKind": "parameter"\n}\n';
    expect((await capturePlannedSourceIdentities({ client: db.client, sourceSystem: "explicit-source",
      sources: [{ sourceKind: "audit-subject-link", sourceId: composite }] }))[0]!.sourceId).toBe(composite);
  });
  it("sanitizes registration query failures and never reports them as a replay", async () => {
    const db = database();
    const selected = await capturePlannedSourceIdentities({ client: db.client, sourceSystem: "explicit-source", sources });
    db.onInsert(() => { throw new Error("private database error contents"); });
    await expect(registerPlannedSourceIdentities({ client: db.client, sourceSystem: "explicit-source", identities: selected, beforeEffect: async () => {} }))
      .rejects.toEqual(new SourceIdentityRefusal("REGISTRATION-UNAVAILABLE"));
  });
  it("does not write when the original source boundary fails after ownership reads", async () => {
    const db = database();
    const selected = await capturePlannedSourceIdentities({ client: db.client, sourceSystem: "explicit-source", sources });
    const request = { client: db.client, sourceSystem: "explicit-source", identities: selected,
      beforeEffect: async () => { throw new Error("source-boundary-lost"); } };
    await expect(registerPlannedSourceIdentities(request)).rejects.toEqual(new SourceIdentityRefusal("REGISTRATION-UNAVAILABLE"));
    expect(db.rows).toEqual([]);
  });
});
