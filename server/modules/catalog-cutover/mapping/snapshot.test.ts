import { expect, it } from "vitest";
import { digestOf } from "../../release-verification/core/digest";
import * as mapping from "./index";
const { readMappingInventory } = mapping;
import type { MappingQueryable } from "./types";

function snapshotPort(drift = false) {
  const identities = [1, 2].map(n => ({ id: `identity-${n}`, source_system: `source-${n}`,
    source_kind: "parameter-spec", owner_scope_kind: "organization", owner_scope_id: "organization", source_id: "same-source-id" }));
  const versions = identities.map((identity, index) => ({ id: `version-${index}`, identity,
    version: { id: `version-${index}`, legacy_identity_id: identity.id, cutover_run_id: "run",
      version_number: index + 2, source_checksum: "source", graph_fingerprint: "graph", r_class: "R7",
      target_kind: null, target_id: null, archive_id: `archive-${index}`, evidence_archive_id: null, supersedes_version_id: null } }));
  const heads = versions.map((row, index) => ({ legacy_identity_id: row.identity.id,
    current_version_id: row.id, cas_version: String(index + 3), version: row.version, identity: row.identity }));
  const responses: unknown[][] = [heads, versions, identities];
  const tuples: unknown[] = [];
  for (let index = 0; index < identities.length; index++) {
    responses.push([identities[index]], [identities[index]], [{ n: "1" }], [{ ...heads[index], ...versions[index]!.version }]);
  }
  const finalHeads = structuredClone(heads);
  if (drift) finalHeads[1]!.cas_version = "99";
  responses.push(finalHeads, versions, identities);
  const client = { query: async (sql: string, parameters: unknown[]) => {
    if (sql.includes("where source_system = $1")) tuples.push(parameters);
    const rows = responses.shift();
    if (!rows) throw new Error("unexpected query");
    return { rows };
  } } as unknown as MappingQueryable;
  return { client, heads, tuples, responses };
}

it("projects two complete source tuples through the public lookup and preserves both digest domains", async () => {
  const port = snapshotPort();
  const actual = await mapping.readMappingSnapshot(port.client);
  expect(port.responses).toEqual([]);
  expect(port.tuples).toEqual([1, 2].map(n => [`source-${n}`, "parameter-spec", "organization", "organization", "same-source-id"]));
  expect(actual.headDigest).toBe(digestOf(port.heads));
  expect(actual.members.map(member => member.head.casVersion)).toEqual([3, 4]);
  expect(actual.members.map(member => member.head.version.versionNumber)).toEqual([2, 3]);
  for (const member of actual.members) expect(member.headDigest).toBe(digestOf(member.head));
});

it("rejects drift of an inventory head after the per-identity reads", async () => {
  await expect(mapping.readMappingSnapshot(snapshotPort(true).client)).rejects.toThrow("PCAT-MAP-INVENTORY-INCOMPLETE");
});

it("retains the exact activation inventory bytes while exposing two independent identity heads", async () => {
  // Query-port double: this checks the existing epoch codec, not a PG snapshot
  // or an approval. The owned integration exercises the real transaction.
  const identities = [{ id: "identity-a" }, { id: "identity-b" }];
  const versions = identities.map((identity, index) => ({ id: `version-${index}`,
    version: { id: `version-${index}`, legacy_identity_id: identity.id }, identity }));
  const heads = versions.map((row, index) => ({ legacy_identity_id: row.identity.id,
    current_version_id: row.id, cas_version: String(index + 1), version: row.version, identity: row.identity }));
  const responses = [heads, versions, identities];
  const client = { query: async () => ({ rows: responses.shift() }) } as unknown as MappingQueryable;
  const inventory = await readMappingInventory(client);
  expect(inventory.heads).toEqual(heads);
  expect(inventory.headDigest).toBe(digestOf(heads));
  expect(inventory.versionInventoryDigest).toBe(digestOf(versions));
  expect(inventory.heads.map(row => row.current_version_id)).toEqual(["version-0", "version-1"]);
});

it("exposes an exact typed head digest without relabelling it as the activation set digest", () => {
  const head = { legacyIdentityId: "identity", currentVersionId: "version", casVersion: 3,
    version: { id: "version", legacyIdentityId: "identity", cutoverRunId: "run", versionNumber: 2,
      sourceChecksum: "source", graphFingerprint: "graph", rClass: "R7" as const,
      targetKind: null, targetId: null, archiveId: "archive", evidenceArchiveId: "evidence",
      supersedesVersionId: "prior" } };
  const actual = mapping.mappingHeadDigest(head);
  expect(actual).toBe(digestOf(head));
  expect(actual).not.toBe(digestOf([head]));
  expect(mapping.mappingHeadDigest({ ...head, casVersion: 4 })).not.toBe(actual);
  expect(mapping.mappingHeadDigest({ ...head, version: { ...head.version, evidenceArchiveId: "other" } })).not.toBe(actual);
});
