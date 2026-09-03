import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "../../../testing/parameterCatalog";
import { DISPOSITION_BY_R_CLASS } from "../classifier/index";
import type { OwnerScopeKind, RClass } from "../classifier/types";
import { archiveGraphChecksum, checksumContract } from "./checksum";
import { buildArchiveAad, encryptArchiveObject } from "./crypto";
import {
  createArchiveAdapter,
  createLocalArchiveObjectStore,
} from "./index";
import { THREAT_MATRIX } from "./threatMatrix";
import type {
  ArchiveActor,
  ArchiveFailPoint,
  ArchiveObjectStore,
  ArchiveProtectedReference,
  PersistArchiveCommand,
} from "./types";

const CATALOG_TEST_TIMEOUT_MS = 60_000;
const CATALOG_HOOK_TIMEOUT_MS = 120_000;
const PLAINTEXT_TOKEN = "S7ARC-PLAINTEXT-SOURCE-v1-DO-NOT-PERSIST-IN-OBJECT-OR-METADATA";
const ORG_ID = "s7arc-org";
const RELEASE_ID = "s7arc-crel";
const RELEASE_DIGEST = "sha256:s7arc-release";
const OPERATOR: ArchiveActor = {
  role: "cutover-operator",
  auditRef: "audit-s7arc-restore-operator",
};

const ARCHIVED_CLASSES = ["R1", "R7", "R10"] as const satisfies readonly RClass[];

type SeededIdentity = {
  identityId: string;
  specId: string;
  cutoverRunId: string;
  ownerScopeKind: OwnerScopeKind;
  ownerScopeId: string;
  rClass: RClass;
};

const spyObjectStore = (
  inner: ArchiveObjectStore,
): { store: ArchiveObjectStore; reads: string[] } => {
  const reads: string[] = [];
  return {
    reads,
    store: {
      putExclusive: (ref, bytes) => inner.putExclusive(ref, bytes),
      async get(ref) {
        reads.push(ref);
        return inner.get(ref);
      },
      remove: (ref) => inner.remove(ref),
      exists: (ref) => inner.exists(ref),
      listRefs: () => inner.listRefs(),
    },
  };
};

const sourceGraphFor = (
  identity: SeededIdentity,
): PersistArchiveCommand["sourceGraph"] => ({
  sourcePayload: {
    kind: "legacy-source-row",
    token: PLAINTEXT_TOKEN,
    specId: identity.specId,
    rClass: identity.rClass,
  },
  relationGraph: {
    identityId: identity.identityId,
    edges: [
      {
        from: identity.identityId,
        kind: "source-row",
        to: identity.specId,
      },
    ],
  },
});

const protectedRefsFor = (
  identity: SeededIdentity,
): readonly ArchiveProtectedReference[] => [
  { kind: "legacy-identity", id: identity.identityId },
];

const persistCommand = (
  identity: SeededIdentity,
  overrides: Partial<PersistArchiveCommand> = {},
): PersistArchiveCommand => ({
  actor: OPERATOR,
  legacyIdentityId: identity.identityId,
  ownerScopeKind: identity.ownerScopeKind,
  ownerScopeId: identity.ownerScopeId,
  rClass: identity.rClass,
  reason: `archive-${identity.rClass.toLowerCase()}`,
  sourceGraph: sourceGraphFor(identity),
  protectedReferences: protectedRefsFor(identity),
  cutoverRunId: identity.cutoverRunId,
  catalogReleaseId: RELEASE_ID,
  successAuditRef: `audit-s7arc-write-${identity.identityId}`,
  retainUntil: new Date("2027-09-03T00:00:00.000Z"),
  ...overrides,
});

const metadataContainsNeedle = (row: Record<string, unknown>, needle: string): boolean =>
  Object.values(row).some((value) => {
    if (value == null) return false;
    if (typeof value === "string") return value.includes(needle);
    if (value instanceof Date) return value.toISOString().includes(needle);
    return JSON.stringify(value).includes(needle);
  });

describe("immutable archive adapter", { timeout: CATALOG_TEST_TIMEOUT_MS }, () => {
  let database: ParameterCatalogDatabase;
  let client: pg.Client;
  let objectRoot: string;
  let encryptionKey: Buffer;
  let seq = 0;

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("s7arc");
    client = new pg.Client({ connectionString: database.url });
    await client.connect();
    objectRoot = await mkdtemp(path.join(os.tmpdir(), "s7arc-objects-"));
    encryptionKey = randomBytes(32);

    await client.query(
      `
      insert into public.organizations (id, name)
      values ($1, 'S7-ARC Organization')
      on conflict (id) do nothing
      `,
      [ORG_ID],
    );
    await client.query("begin");
    try {
      await client.query("set constraints all deferred");
      await client.query(
        `
        insert into parameter_catalog.catalog_releases (
          id, release_sequence, release_version, release_digest,
          compiled_model_digest, toolchain_digest, published_at
        ) values (
          $1, 704000, 's7arc-1', $2,
          'sha256:s7arc-model', 'sha256:s7arc-toolchain', '2026-09-03T00:00:00Z'
        )
        `,
        [RELEASE_ID, RELEASE_DIGEST],
      );
      await client.query(
        `
        insert into parameter_catalog.catalog_subjects (
          id, introduced_release_id, kind, canonical_key
        ) values ($2, $1, 'driver', 's7arc,driver')
        `,
        [RELEASE_ID, "csub-s7arc-driver"],
      );
      await client.query(
        `
        insert into parameter_catalog.catalog_drivers (subject_id, nature, cardinality)
        values ('csub-s7arc-driver', 'physical-device', 'multiple')
        `,
      );
      await client.query(
        `
        insert into parameter_catalog.catalog_release_subjects (
          release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
        ) values ($1, 'csub-s7arc-driver', 'active', '{}', '{}')
        `,
        [RELEASE_ID],
      );
      await client.query(
        `
        insert into parameter_catalog.catalog_materializations (
          release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
        ) values (
          $1, 'sha256:s7arc-compiled-fp', 'sha256:s7arc-database-fp',
          's7arc-attempt', 'audit-s7arc-materialize'
        )
        `,
        [RELEASE_ID],
      );
      await client.query(
        `
        insert into parameter_catalog.catalog_state (singleton, current_catalog_release_id)
        values (true, $1)
        `,
        [RELEASE_ID],
      );
      await client.query("set constraints all immediate");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  }, CATALOG_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    await database?.close();
    if (objectRoot) {
      await rm(objectRoot, { recursive: true, force: true });
    }
  }, CATALOG_HOOK_TIMEOUT_MS);

  const nextToken = (label: string): string => {
    seq += 1;
    return `s7arc-${label}-${seq}`;
  };

  const seedIdentity = async (rClass: RClass): Promise<SeededIdentity> => {
    const ownerScopeKind: OwnerScopeKind = rClass === "R7" ? "organization" : "platform";
    const ownerScopeId = ownerScopeKind === "platform" ? "platform" : ORG_ID;
    const specId = nextToken(`spec-${rClass.toLowerCase()}`);
    const identityId = nextToken(`lid-${rClass.toLowerCase()}`);
    const cutoverRunId = nextToken(`run-${rClass.toLowerCase()}`);
    await client.query(
      `
      insert into public.parameter_specs (
        id, organization_id, source_kind, specification_key, definition_lifecycle
      ) values ($1, $2, 'manual', $3, 'active')
      `,
      [specId, ownerScopeKind === "platform" ? null : ORG_ID, specId],
    );
    await client.query(
      `
      insert into parameter_catalog.legacy_identities (
        id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id
      ) values ($1, 'wiseeff-v1', 'parameter-spec', $2, $3, $4)
      `,
      [identityId, ownerScopeKind, ownerScopeId, specId],
    );
    await client.query(
      `
      insert into parameter_catalog.parameter_catalog_cutover_runs (
        id, source_snapshot_fingerprint, target_artifact_sha,
        target_catalog_release_digest, migration_contract_version,
        plan_digest, current_phase, state
      ) values (
        $1, $2, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        $3, 'v1', $4, 'P10', 'running'
      )
      `,
      [cutoverRunId, `sha256:${cutoverRunId}-snapshot`, RELEASE_DIGEST, `sha256:${cutoverRunId}-plan`],
    );
    return {
      identityId,
      specId,
      cutoverRunId,
      ownerScopeKind,
      ownerScopeId,
      rClass,
    };
  };

  const adapterFor = (store: ArchiveObjectStore, failAfter?: ArchiveFailPoint) =>
    createArchiveAdapter({
      client,
      objectStore: store,
      encryptionKey,
      failAfter,
    });

  const archiveRowCount = async (): Promise<number> => {
    const result = await client.query<{ n: string }>(
      "select count(*)::text as n from parameter_catalog.parameter_catalog_archives",
    );
    return Number(result.rows[0]?.n ?? 0);
  };

  const loadArchiveRow = async (archiveId: string): Promise<Record<string, unknown>> => {
    const result = await client.query<Record<string, unknown>>(
      `
      select
        id, legacy_identity_id, owner_scope_kind, owner_scope_id, r_class, reason,
        source_checksum, graph_checksum, encrypted_object_ref,
        protected_references, cutover_run_id, catalog_release_id,
        success_audit_ref, retain_until::text as retain_until
      from parameter_catalog.parameter_catalog_archives
      where id = $1
      `,
      [archiveId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`missing archive ${archiveId}`);
    return row;
  };

  it("freezes leftover assertions for every threat-matrix row", () => {
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const row of THREAT_MATRIX) {
      expect(row.leftover.length).toBeGreaterThan(0);
    }
  });

  it.each(ARCHIVED_CLASSES)(
    "archives S7-CLS %s disposition with matching checksums and no plaintext leak",
    async (rClass) => {
      expect(DISPOSITION_BY_R_CLASS[rClass]).toBe("archived");
      const identity = await seedIdentity(rClass);
      const store = createLocalArchiveObjectStore(await mkdtemp(path.join(objectRoot, `${rClass}-`)));
      const adapter = adapterFor(store);
      const command = persistCommand(identity);
      const persisted = await adapter.persistArchive(command);
      expect(persisted.ok).toBe(true);
      if (!persisted.ok) return;

      expect(persisted.value.status).toBe("archived");
      expect(persisted.value.archiveId.length).toBeGreaterThan(0);
      expect(persisted.value.sourceChecksum).toBe(
        checksumContract(command.sourceGraph.sourcePayload),
      );
      expect(persisted.value.graphChecksum).toBe(
        archiveGraphChecksum({
          relationGraph: command.sourceGraph.relationGraph,
          protectedReferences: command.protectedReferences,
        }),
      );

      const row = await loadArchiveRow(persisted.value.archiveId);
      expect(row.legacy_identity_id).toBe(identity.identityId);
      expect(row.r_class).toBe(rClass);
      expect(row.cutover_run_id).toBe(identity.cutoverRunId);
      expect(row.catalog_release_id).toBe(RELEASE_ID);
      expect(row.encrypted_object_ref).toBe(persisted.value.encryptedObjectRef);
      expect(metadataContainsNeedle(row, PLAINTEXT_TOKEN)).toBe(false);

      const refs = await store.listRefs();
      expect(refs).toEqual([persisted.value.encryptedObjectRef]);
      const objectBytes = await store.get(persisted.value.encryptedObjectRef);
      expect(objectBytes.includes(PLAINTEXT_TOKEN)).toBe(false);
      expect(objectBytes.toString("utf8")).not.toContain(PLAINTEXT_TOKEN);

      const restored = await adapter.restoreArchive({
        actor: OPERATOR,
        archiveId: persisted.value.archiveId,
      });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      expect(restored.value.sourceGraph).toEqual(command.sourceGraph);
      expect(restored.value.metadata.archiveId).toBe(persisted.value.archiveId);
    },
  );

  it("rejects a mapped R class instead of archiving it as success", async () => {
    const identity = await seedIdentity("R1");
    const store = createLocalArchiveObjectStore(await mkdtemp(path.join(objectRoot, "mapped-")));
    const adapter = adapterFor(store);
    const result = await adapter.persistArchive(persistCommand(identity, { rClass: "R4" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PCAT-ARC-DISPOSITION-NOT-ARCHIVED");
    expect(await store.listRefs()).toEqual([]);
  });

  it("refuses public persist and public restore so plaintext cannot leak through the public seam", async () => {
    const identity = await seedIdentity("R1");
    const spy = spyObjectStore(
      createLocalArchiveObjectStore(await mkdtemp(path.join(objectRoot, "public-"))),
    );
    const adapter = adapterFor(spy.store);
    const publicActor: ArchiveActor = { role: "public" };
    const deniedWrite = await adapter.persistArchive(
      persistCommand(identity, { actor: publicActor }),
    );
    expect(deniedWrite.ok).toBe(false);
    if (!deniedWrite.ok) {
      expect(deniedWrite.error.code).toBe("PCAT-ARC-PERMISSION-DENIED");
    }
    expect(await spy.store.listRefs()).toEqual([]);

    const committed = await adapter.persistArchive(persistCommand(identity));
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    spy.reads.length = 0;
    const deniedRead = await adapter.restoreArchive({
      actor: publicActor,
      archiveId: committed.value.archiveId,
    });
    expect(deniedRead.ok).toBe(false);
    if (!deniedRead.ok) {
      expect(deniedRead.error.code).toBe("PCAT-ARC-PERMISSION-DENIED");
      expect(JSON.stringify(deniedRead)).not.toContain(PLAINTEXT_TOKEN);
    }
    expect(spy.reads).toEqual([]);
  });

  it.each([
    "object-without-metadata",
    "metadata-without-object",
    "before-commit",
  ] as const)("leaves zero residue after %s crash", async (failAfter) => {
    const identity = await seedIdentity("R10");
    const store = createLocalArchiveObjectStore(await mkdtemp(path.join(objectRoot, failAfter)));
    const adapter = adapterFor(store, failAfter);
    const before = await archiveRowCount();
    const result = await adapter.persistArchive(persistCommand(identity));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PCAT-ARC-ATOMICITY");
      expect(JSON.stringify(result)).not.toContain(PLAINTEXT_TOKEN);
    }
    expect(await archiveRowCount()).toBe(before);
    expect(await store.listRefs()).toEqual([]);
  });

  it("returns a typed checksum failure without payload when the object is swapped", async () => {
    const identity = await seedIdentity("R1");
    const other = await seedIdentity("R7");
    const storeRoot = await mkdtemp(path.join(objectRoot, "checksum-"));
    const store = createLocalArchiveObjectStore(storeRoot);
    const adapter = adapterFor(store);
    const first = await adapter.persistArchive(persistCommand(identity));
    const second = await adapter.persistArchive(persistCommand(other));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const forgedPlaintext = Buffer.from(
      JSON.stringify({
        sourcePayload: { token: "FORGED-S7ARC-PAYLOAD-NOT-ORIGINAL", specId: other.specId },
        relationGraph: { identityId: identity.identityId },
      }),
      "utf8",
    );
    const forged = encryptArchiveObject({
      key: encryptionKey,
      aad: buildArchiveAad({
        archiveId: first.value.archiveId,
        legacyIdentityId: identity.identityId,
        cutoverRunId: identity.cutoverRunId,
        sourceChecksum: first.value.sourceChecksum,
        graphChecksum: first.value.graphChecksum,
      }),
      plaintext: forgedPlaintext,
    });
    await writeFile(path.join(storeRoot, first.value.encryptedObjectRef), forged);

    const restored = await adapter.restoreArchive({
      actor: OPERATOR,
      archiveId: first.value.archiveId,
    });
    expect(restored.ok).toBe(false);
    if (restored.ok) return;
    expect(restored.error.code).toBe("PCAT-ARC-CHECKSUM-MISMATCH");
    expect(JSON.stringify(restored)).not.toContain(PLAINTEXT_TOKEN);
    expect(JSON.stringify(restored)).not.toContain("FORGED-S7ARC-PAYLOAD-NOT-ORIGINAL");
    expect("sourceGraph" in restored).toBe(false);
  });

  it.each([
    { role: "verifier" as const, auditRef: "audit-verifier" },
    { role: "governance-writer" as const, auditRef: "audit-gov" },
    { role: "synchronizer" as const, auditRef: "audit-sync" },
    { role: "cutover-operator" as const, auditRef: undefined },
  ])("does not read the object for unauthorized restore ($role)", async (actor) => {
    const identity = await seedIdentity("R1");
    const spy = spyObjectStore(
      createLocalArchiveObjectStore(await mkdtemp(path.join(objectRoot, `unauth-${actor.role}-`))),
    );
    const adapter = adapterFor(spy.store);
    const persisted = await adapter.persistArchive(persistCommand(identity));
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) return;
    spy.reads.length = 0;
    const restored = await adapter.restoreArchive({
      actor,
      archiveId: persisted.value.archiveId,
    });
    expect(restored.ok).toBe(false);
    if (!restored.ok) {
      expect(restored.error.code).toBe("PCAT-ARC-PERMISSION-DENIED");
      expect(JSON.stringify(restored)).not.toContain(PLAINTEXT_TOKEN);
    }
    expect(spy.reads).toEqual([]);
  });

  it("fails closed on a truncated object without returning payload", async () => {
    const identity = await seedIdentity("R1");
    const storeRoot = await mkdtemp(path.join(objectRoot, "trunc-"));
    const store = createLocalArchiveObjectStore(storeRoot);
    const adapter = adapterFor(store);
    const persisted = await adapter.persistArchive(persistCommand(identity));
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) return;
    const objectPath = path.join(storeRoot, persisted.value.encryptedObjectRef);
    const original = await readFile(objectPath);
    await writeFile(objectPath, original.subarray(0, 12));
    const restored = await adapter.restoreArchive({
      actor: OPERATOR,
      archiveId: persisted.value.archiveId,
    });
    expect(restored.ok).toBe(false);
    if (!restored.ok) {
      expect(restored.error.code).toBe("PCAT-ARC-INTEGRITY");
      expect(JSON.stringify(restored)).not.toContain(PLAINTEXT_TOKEN);
    }
    expect("sourceGraph" in restored).toBe(false);
  });

  it("replays the same identity+run+checksum as a no-op and conflicts on a different checksum", async () => {
    const identity = await seedIdentity("R7");
    const store = createLocalArchiveObjectStore(await mkdtemp(path.join(objectRoot, "replay-")));
    const adapter = adapterFor(store);
    const first = await adapter.persistArchive(persistCommand(identity));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const replay = await adapter.persistArchive(persistCommand(identity));
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.status).toBe("already-archived");
    expect(replay.value.archiveId).toBe(first.value.archiveId);
    expect(replay.value.encryptedObjectRef).toBe(first.value.encryptedObjectRef);
    expect(await store.listRefs()).toEqual([first.value.encryptedObjectRef]);

    const drifted = await adapter.persistArchive(
      persistCommand(identity, {
        sourceGraph: {
          sourcePayload: {
            kind: "legacy-source-row",
            token: `${PLAINTEXT_TOKEN}-drift`,
            specId: identity.specId,
          },
          relationGraph: sourceGraphFor(identity).relationGraph,
        },
      }),
    );
    expect(drifted.ok).toBe(false);
    if (!drifted.ok) {
      expect(drifted.error.code).toBe("PCAT-ARC-CONFLICT");
    }
    expect(await store.listRefs()).toEqual([first.value.encryptedObjectRef]);

    const restored = await adapter.restoreArchive({
      actor: OPERATOR,
      archiveId: first.value.archiveId,
      legacyIdentityId: identity.identityId,
      cutoverRunId: identity.cutoverRunId,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.sourceGraph.sourcePayload).toMatchObject({
      token: PLAINTEXT_TOKEN,
    });
  });

  it("returns archiveId for a later mapping caller without importing S7-MAP", async () => {
    const identity = await seedIdentity("R10");
    const store = createLocalArchiveObjectStore(await mkdtemp(path.join(objectRoot, "mapid-")));
    const adapter = adapterFor(store);
    const persisted = await adapter.persistArchive(persistCommand(identity));
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) return;
    const archiveId = persisted.value.archiveId;
    expect(archiveId).toMatch(/^arc_[0-9a-f]+$/u);
    const suppliedToMapping = { archiveId };
    expect(suppliedToMapping.archiveId).toBe(archiveId);
    const entries = await readdir(path.dirname(fileURLToPath(import.meta.url)));
    expect(entries.some((name) => name.includes("mapping"))).toBe(false);
  });
});
