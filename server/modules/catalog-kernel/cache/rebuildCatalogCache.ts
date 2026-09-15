import { createHash } from "node:crypto";
import pg from "pg";

import {
  CatalogPageLimit,
  serializeContract,
  type CatalogKernelError,
  type CatalogMaterializationFingerprint,
  type CatalogReleaseDigest,
  type CatalogReleaseId,
  type CatalogReleasePin,
  type Result,
} from "../../parameter-catalog-contract/index";
import type { CatalogReleaseSource } from "../interface";
import { loadCurrentCatalogSnapshot, loadProjection } from "../runtime/currentSnapshot";
import { loadPinnedCatalogSnapshot } from "../runtime/pinnedSnapshot";
import { verifyCurrentMaterialization } from "../verification/verifyCurrentMaterialization";

export type CatalogCacheSnapshotKind = "current" | "pinned";

export type CatalogCacheKey = {
  readonly snapshotKind: CatalogCacheSnapshotKind;
  readonly releaseId: CatalogReleaseId;
  readonly digest: CatalogReleaseDigest;
  readonly materializationFingerprint: CatalogMaterializationFingerprint;
};

export type CatalogCacheRecord = {
  readonly status: "rebuilt";
  readonly key: CatalogCacheKey;
  readonly payload: string;
  readonly payloadDigest: string;
};

export type RebuildCatalogCacheCommand =
  | {
      readonly snapshotKind: "current";
      readonly pin: CatalogReleasePin;
      readonly source: CatalogReleaseSource;
    }
  | {
      readonly snapshotKind: "pinned";
      readonly pin: CatalogReleasePin;
    };

const digestPayload = (payload: string): string =>
  `sha256:${createHash("sha256").update(payload).digest("hex")}`;

const encodeKey = (key: CatalogCacheKey): string =>
  `${key.releaseId}\0${key.digest}\0${key.materializationFingerprint}`;

const miss = (
  key: CatalogCacheKey,
  detail: string,
): Result<CatalogCacheRecord, CatalogKernelError> => ({
  ok: false,
  error: {
    kind: "drift",
    scope: key.snapshotKind,
    expected: { id: key.releaseId, digest: key.digest },
    actual: null,
    violations: [
      {
        code: "materialization-fingerprint-mismatch",
        relation: "catalog_snapshot_cache",
        identity: key.releaseId,
        detail,
      },
    ],
  },
});

export class CatalogSnapshotCache {
  private readonly current = new Map<string, CatalogCacheRecord>();
  private readonly pinned = new Map<string, CatalogCacheRecord>();

  private namespace(kind: CatalogCacheSnapshotKind): Map<string, CatalogCacheRecord> {
    return kind === "current" ? this.current : this.pinned;
  }

  put(record: CatalogCacheRecord): void {
    this.namespace(record.key.snapshotKind).set(encodeKey(record.key), {
      status: "rebuilt",
      key: record.key,
      payload: record.payload,
      payloadDigest: record.payloadDigest,
    });
  }

  get(key: CatalogCacheKey): Result<CatalogCacheRecord, CatalogKernelError> {
    const stored = this.namespace(key.snapshotKind).get(encodeKey(key));
    if (!stored) {
      return miss(key, "cache-entry-missing-or-namespace-isolated");
    }
    if (digestPayload(stored.payload) !== stored.payloadDigest) {
      this.namespace(key.snapshotKind).delete(encodeKey(key));
      return miss(key, "poisoned-cache-bytes-rejected");
    }
    if (
      stored.key.releaseId !== key.releaseId ||
      stored.key.digest !== key.digest ||
      stored.key.materializationFingerprint !== key.materializationFingerprint
    ) {
      return miss(key, "cache-key-disagrees-with-stored-record");
    }
    return { ok: true, value: stored };
  }
}

export const createCatalogSnapshotCache = (): CatalogSnapshotCache =>
  new CatalogSnapshotCache();

const snapshotPayload = (
  kind: CatalogCacheSnapshotKind,
  loaded: NonNullable<Awaited<ReturnType<typeof loadProjection>>>,
): string => {
  const subjects = loaded.snapshot.listSubjects({
    selection: { kind: "all" },
    kinds: ["driver", "node-type"],
    lifecycles: ["active", "retired"],
    search: { kind: "absent" },
    page: { limit: CatalogPageLimit(10_000), after: { kind: "absent" } },
  });
  const definitions = loaded.snapshot.listDefinitions({
    selection: { kind: "all" },
    scope: { kind: "all" },
    lifecycles: [],
    propertyKey: { kind: "absent" },
    search: { kind: "absent" },
    page: { limit: CatalogPageLimit(10_000), after: { kind: "absent" } },
  });
  const subjectItems = subjects.status === "found" ? subjects.page.items : [];
  const definitionItems = definitions.status === "found" ? definitions.page.items : [];
  return serializeContract({
    snapshotKind: kind,
    release: {
      id: loaded.identity.id,
      version: loaded.identity.version,
      digest: loaded.identity.digest,
    },
    materializationFingerprint: loaded.materializationFingerprint,
    subjects: subjectItems.map((subject) => ({
      id: subject.id,
      kind: subject.kind,
      canonicalKey: subject.canonicalKey,
      lifecycle: subject.membership.lifecycle,
    })),
    definitions: definitionItems.map((definition) => ({
      id: definition.id,
      subjectId: definition.subjectId,
      propertyKey: definition.propertyKey,
      revisionId: definition.selectedRevision?.id ?? "",
      contentDigest: definition.selectedRevision?.contentDigest ?? "",
    })),
  });
};

export const rebuildCatalogCache = async (
  pool: pg.Pool,
  command: RebuildCatalogCacheCommand,
  cache: CatalogSnapshotCache,
): Promise<Result<CatalogCacheRecord, CatalogKernelError>> => {
  if (command.snapshotKind === "current") {
    const verified = await verifyCurrentMaterialization(pool, {
      source: command.source,
      expected: command.pin,
    });
    if (!verified.ok) {
      return verified;
    }
    const current = await loadCurrentCatalogSnapshot(pool, command.pin);
    if (!current.ok) {
      return current;
    }
  } else {
    const pinned = await loadPinnedCatalogSnapshot(pool, command.pin);
    if (!pinned.ok) {
      return pinned;
    }
  }

  const loaded = await loadProjection(pool, command.pin.id);
  if (!loaded) {
    return {
      ok: false,
      error: { kind: "historical-release-unavailable", pin: command.pin },
    };
  }
  if (
    loaded.identity.id !== command.pin.id ||
    loaded.identity.digest !== command.pin.digest
  ) {
    return {
      ok: false,
      error: {
        kind: "release-mismatch",
        expected: command.pin,
        actual: loaded.identity,
      },
    };
  }

  const payload = snapshotPayload(command.snapshotKind, loaded);
  const record: CatalogCacheRecord = {
    status: "rebuilt",
    key: {
      snapshotKind: command.snapshotKind,
      releaseId: loaded.identity.id,
      digest: loaded.identity.digest,
      materializationFingerprint: loaded.materializationFingerprint,
    },
    payload,
    payloadDigest: digestPayload(payload),
  };
  cache.put(record);
  return { ok: true, value: record };
};
