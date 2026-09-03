import { createHash, createHmac } from "node:crypto";
import pg from "pg";
import type {
  PrepareVerificationInput,
  ReadReportResult,
} from "../../../server/modules/release-verification/core";

export const RECOVERY_POINT_SCHEMA_VERSION = "s11-rp-v1" as const;

export type StoreKind = "postgres" | "object-store" | "redis";

export type RecoveryPointRefusalKind =
  | "pre-quiesce"
  | "partial-store"
  | "stale-boundary"
  | "checksum-drift"
  | "wrong-target"
  | "token-failure";

export type RecoveryPointRefusal = {
  readonly kind: RecoveryPointRefusalKind;
  readonly detail: string;
};

export type RecoveryPointResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RecoveryPointRefusal };

export type QuiescenceProof = {
  readonly status: "quiesced" | "not-quiesced";
  readonly writersFenced: boolean;
  readonly queueDrained: boolean;
  readonly proxyStopped: boolean;
  readonly observedAt: string;
};

export type RecoveryTargetIdentity = {
  readonly deploymentId: string;
  readonly hostFingerprint: string;
  readonly postgresIdentity: string;
  readonly objectStoreIdentity: string;
  readonly redisIdentity: string;
};

export type StoreSnapshot = {
  readonly kind: StoreKind;
  readonly identity: string;
  readonly checksum: string;
  readonly capturedAt: string;
};

export type StoreSnapshotPort = {
  readonly kind: StoreKind;
  readonly declaredIdentity: string;
  snapshot(now: Date): Promise<StoreSnapshot | null>;
};

export type RecoveryManifestStores = {
  readonly postgres: StoreSnapshot;
  readonly objectStore: StoreSnapshot;
  readonly redis: StoreSnapshot;
};

export type RecoveryManifest = {
  readonly schemaVersion: typeof RECOVERY_POINT_SCHEMA_VERSION;
  readonly recoveryPointId: string;
  readonly recoveryPointDigest: string;
  readonly runId: string;
  readonly target: RecoveryTargetIdentity;
  readonly quiescence: {
    readonly status: "quiesced";
    readonly writersFenced: true;
    readonly queueDrained: true;
    readonly proxyStopped: true;
    readonly observedAt: string;
  };
  readonly stores: RecoveryManifestStores;
  readonly capturedAt: string;
  readonly maximumAgeMs: number;
};

export type RecoveryPointVerification = {
  readonly status: "verified";
  readonly recoveryPointDigest: string;
  readonly storeChecksums: {
    readonly postgres: string;
    readonly objectStore: string;
    readonly redis: string;
  };
};

export type RecoveryPointCapture = {
  readonly manifest: RecoveryManifest;
  readonly verification: RecoveryPointVerification;
  readonly restoreToken: string;
};

export type RestoreCheckSuccess = {
  readonly status: "restore-authorized";
  readonly recoveryPointDigest: string;
  readonly runId: string;
};

export type CaptureRecoveryPointInput = {
  readonly runId: string;
  readonly target: RecoveryTargetIdentity;
  readonly quiescence: QuiescenceProof;
  readonly stores: readonly StoreSnapshotPort[];
  readonly maximumAgeMs: number;
  readonly now?: () => Date;
};

export type VerifyRecoveryPointInput = {
  readonly manifest: RecoveryManifest;
  readonly stores: readonly StoreSnapshotPort[];
  readonly now?: () => Date;
};

export type RestoreCheckTargets = {
  readonly liveDatabaseUrl?: string;
  readonly restoreDatabaseUrl?: string;
  readonly liveBucket?: string;
  readonly restoreBucket?: string;
  readonly restorePrefix?: string;
};

export type RestoreCheckInput = {
  readonly manifest: RecoveryManifest;
  readonly restoreToken: string;
  readonly restoreTargets: RestoreCheckTargets;
  readonly stores: readonly StoreSnapshotPort[];
  readonly now?: () => Date;
};

export type ConsumedS10PerReadReportResult = ReadReportResult;

const COMPOSE_APP_DATABASE = "wiseeff";
const COMPOSE_APP_PORT = 5432;
const REQUIRED_STORE_KINDS: readonly StoreKind[] = ["postgres", "object-store", "redis"];

class ForbiddenComposeAppError extends Error {
  readonly identity: string;
  constructor(identity: string) {
    super(`Forbidden compose app PostgreSQL target: ${identity}`);
    this.name = "ForbiddenComposeAppError";
    this.identity = identity;
  }
}

const ok = <T>(value: T): RecoveryPointResult<T> => ({ ok: true, value });

const fail = (kind: RecoveryPointRefusalKind, detail: string): RecoveryPointResult<never> => ({
  ok: false,
  error: { kind, detail },
});

const sha256Prefixed = (bytes: string): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError("Recovery-point digest rejected a non-JSON number");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`Recovery-point digest rejected ${typeof value}`);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as { readonly [key: string]: unknown };
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
};

const clockOf = (now?: () => Date): Date => (now ? now() : new Date());

export function postgresIdentityFromUrl(connectionString: string): string {
  const url = new URL(connectionString);
  const host = url.hostname.toLowerCase();
  const port = url.port === "" ? String(COMPOSE_APP_PORT) : url.port;
  const database = url.pathname.replace(/^\//, "").split("/")[0] ?? "";
  return `${host}:${port}/${database}`;
}

export function isForbiddenComposeAppPostgres(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    const host = url.hostname.toLowerCase();
    const port = url.port === "" ? COMPOSE_APP_PORT : Number(url.port);
    const database = url.pathname.replace(/^\//, "").split("/")[0] ?? "";
    const loopback = host === "127.0.0.1" || host === "localhost";
    return loopback && port === COMPOSE_APP_PORT && database === COMPOSE_APP_DATABASE;
  } catch {
    return true;
  }
}

const isQuiesced = (proof: QuiescenceProof): boolean =>
  proof.status === "quiesced" &&
  proof.writersFenced === true &&
  proof.queueDrained === true &&
  proof.proxyStopped === true;

const isRunId = (value: string): boolean => /^[A-Za-z0-9_-]+$/.test(value);

const tokenMac = (runId: string, recoveryPointDigest: string): string =>
  createHmac("sha256", `wiseeff-s11-rp:${runId}`).update(recoveryPointDigest).digest("hex");

export function mintRestoreToken(runId: string, recoveryPointDigest: string): string {
  return `restore-${runId}.${tokenMac(runId, recoveryPointDigest)}`;
}

const digestManifest = (input: {
  readonly recoveryPointId: string;
  readonly runId: string;
  readonly target: RecoveryTargetIdentity;
  readonly quiescence: RecoveryManifest["quiescence"];
  readonly stores: RecoveryManifestStores;
  readonly capturedAt: string;
  readonly maximumAgeMs: number;
}): string =>
  sha256Prefixed(
    canonicalJson({
      schemaVersion: RECOVERY_POINT_SCHEMA_VERSION,
      recoveryPointId: input.recoveryPointId,
      runId: input.runId,
      target: input.target,
      quiescence: input.quiescence,
      stores: {
        postgres: {
          identity: input.stores.postgres.identity,
          checksum: input.stores.postgres.checksum,
        },
        objectStore: {
          identity: input.stores.objectStore.identity,
          checksum: input.stores.objectStore.checksum,
        },
        redis: {
          identity: input.stores.redis.identity,
          checksum: input.stores.redis.checksum,
        },
      },
      capturedAt: input.capturedAt,
      maximumAgeMs: input.maximumAgeMs,
    }),
  );

const snapshotAll = async (
  stores: readonly StoreSnapshotPort[],
  now: Date,
): Promise<RecoveryPointResult<RecoveryManifestStores>> => {
  if (stores.length !== REQUIRED_STORE_KINDS.length) {
    return fail("partial-store", "Recovery point requires exactly one PostgreSQL, object-store, and Redis snapshot.");
  }

  const seen = new Set<StoreKind>();
  const snapshots: Partial<Record<StoreKind, StoreSnapshot>> = {};
  for (const store of stores) {
    if (seen.has(store.kind)) {
      return fail("partial-store", `Recovery point received a duplicate ${store.kind} store.`);
    }
    seen.add(store.kind);
    let snapshot: StoreSnapshot | null;
    try {
      snapshot = await store.snapshot(now);
    } catch (error) {
      if (error instanceof ForbiddenComposeAppError) {
        return fail("wrong-target", error.message);
      }
      const message = error instanceof Error ? error.message : String(error);
      return fail("partial-store", `Failed to snapshot ${store.kind}: ${message}`);
    }
    if (!snapshot) {
      return fail("partial-store", `Missing ${store.kind} snapshot.`);
    }
    if (snapshot.kind !== store.kind) {
      return fail("partial-store", `Store kind mismatch for ${store.kind}.`);
    }
    snapshots[store.kind] = snapshot;
  }

  for (const kind of REQUIRED_STORE_KINDS) {
    if (!snapshots[kind]) {
      return fail("partial-store", `Missing ${kind} snapshot.`);
    }
  }

  return ok({
    postgres: snapshots.postgres as StoreSnapshot,
    objectStore: snapshots["object-store"] as StoreSnapshot,
    redis: snapshots.redis as StoreSnapshot,
  });
};

const identitiesMatch = (
  stores: RecoveryManifestStores,
  target: RecoveryTargetIdentity,
): boolean =>
  stores.postgres.identity === target.postgresIdentity &&
  stores.objectStore.identity === target.objectStoreIdentity &&
  stores.redis.identity === target.redisIdentity;

const checksumsMatch = (
  actual: RecoveryManifestStores,
  expected: RecoveryManifestStores,
): boolean =>
  actual.postgres.checksum === expected.postgres.checksum &&
  actual.objectStore.checksum === expected.objectStore.checksum &&
  actual.redis.checksum === expected.redis.checksum;

export function asPrepareVerificationRecovery(
  capture: RecoveryPointCapture,
): PrepareVerificationInput["pins"]["recovery"] {
  return {
    recoveryPointId: capture.manifest.recoveryPointId,
    recoveryPointDigest: capture.manifest.recoveryPointDigest,
  };
}

export function asEvidenceRequirementRecoveryDigest(
  capture: RecoveryPointCapture,
): PrepareVerificationInput["evidenceRequirements"]["recoveryPointDigest"] {
  return capture.manifest.recoveryPointDigest;
}

export function createMemoryStorePort(
  kind: Exclude<StoreKind, "postgres">,
  identity: string,
  records: Record<string, string>,
): StoreSnapshotPort {
  return {
    kind,
    declaredIdentity: identity,
    async snapshot(now: Date): Promise<StoreSnapshot | null> {
      const entries = Object.keys(records)
        .sort()
        .map((key) => ({ key, value: records[key] ?? "" }));
      return {
        kind,
        identity,
        checksum: sha256Prefixed(canonicalJson({ identity, entries })),
        capturedAt: now.toISOString(),
      };
    },
  };
}

type PostgresFingerprintRow = {
  database_name: string;
  server_port: number | string | null;
  server_addr: string | null;
  has_vector: boolean;
  relations: unknown;
};

type SentinelRow = {
  k: string;
  v: string;
};

export function createPostgresStorePort(connectionString: string): StoreSnapshotPort {
  const identity = (() => {
    try {
      return postgresIdentityFromUrl(connectionString);
    } catch {
      return "";
    }
  })();

  return {
    kind: "postgres",
    declaredIdentity: identity,
    async snapshot(now: Date): Promise<StoreSnapshot | null> {
      if (!connectionString.trim() || !identity) {
        throw new Error("PostgreSQL target identity is not a postgres URL.");
      }
      if (isForbiddenComposeAppPostgres(connectionString)) {
        throw new ForbiddenComposeAppError(identity);
      }
      const client = new pg.Client({
        connectionString,
        connectionTimeoutMillis: 5_000,
      });
      await client.connect();
      try {
        const fingerprint = await client.query<PostgresFingerprintRow>(
          `select
             current_database() as database_name,
             inet_server_port() as server_port,
             coalesce(inet_server_addr()::text, '') as server_addr,
             exists(select 1 from pg_catalog.pg_extension where extname = 'vector') as has_vector,
             (
               select coalesce(
                 json_agg(
                   json_build_object('schema', nspname, 'name', relname, 'kind', relkind)
                   order by nspname, relname
                 ),
                 '[]'::json
               )
               from (
                 select n.nspname, c.relname, c.relkind::text as relkind
                 from pg_catalog.pg_class c
                 join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                 where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
                   and c.relkind in ('r', 'p')
               ) rels
             ) as relations`,
        );
        const row = fingerprint.rows[0];
        if (!row) {
          return null;
        }
        const sentinelPresent = await client.query<{ present: boolean }>(
          `select to_regclass('s11_rp_drill.sentinel') is not null as present`,
        );
        let sentinel: readonly SentinelRow[] = [];
        if (sentinelPresent.rows[0]?.present) {
          const sentinelRows = await client.query<SentinelRow>(
            `select k, v from s11_rp_drill.sentinel order by k`,
          );
          sentinel = sentinelRows.rows;
        }
        return {
          kind: "postgres",
          identity,
          checksum: sha256Prefixed(
            canonicalJson({
              identity,
              databaseName: row.database_name,
              serverPort: row.server_port === null ? null : Number(row.server_port),
              serverAddr: row.server_addr ?? "",
              hasVector: row.has_vector,
              relations: row.relations,
              sentinel,
            }),
          ),
          capturedAt: now.toISOString(),
        };
      } finally {
        await client.end().catch(() => undefined);
      }
    },
  };
}

export async function captureRecoveryPoint(
  input: CaptureRecoveryPointInput,
): Promise<RecoveryPointResult<RecoveryPointCapture>> {
  const now = clockOf(input.now);
  if (!isRunId(input.runId)) {
    return fail("wrong-target", "runId must be a non-empty [A-Za-z0-9_-]+ token.");
  }
  if (!(input.maximumAgeMs > 0)) {
    return fail("wrong-target", "maximumAgeMs must be a positive duration.");
  }
  if (!isQuiesced(input.quiescence)) {
    return fail("pre-quiesce", "Capture is refused until writers, queue, and proxy are quiesced.");
  }

  const postgresStore = input.stores.find((store) => store.kind === "postgres");
  if (postgresStore && isForbiddenComposeAppPostgresIdentity(postgresStore.declaredIdentity)) {
    return fail(
      "wrong-target",
      `PostgreSQL target identity is the forbidden compose app database: ${postgresStore.declaredIdentity}`,
    );
  }

  let stores: RecoveryManifestStores;
  try {
    const snapped = await snapshotAll(input.stores, now);
    if (!snapped.ok) {
      return snapped;
    }
    stores = snapped.value;
  } catch (error) {
    if (error instanceof ForbiddenComposeAppError) {
      return fail("wrong-target", error.message);
    }
    const message = error instanceof Error ? error.message : String(error);
    return fail("partial-store", message);
  }

  if (!identitiesMatch(stores, input.target)) {
    return fail(
      "wrong-target",
      "Captured store identities do not match the declared recovery target.",
    );
  }

  const capturedAt = now.toISOString();
  const quiescence = {
    status: "quiesced" as const,
    writersFenced: true as const,
    queueDrained: true as const,
    proxyStopped: true as const,
    observedAt: input.quiescence.observedAt,
  };
  const recoveryPointId = `rp-${input.runId}`;
  const recoveryPointDigest = digestManifest({
    recoveryPointId,
    runId: input.runId,
    target: input.target,
    quiescence,
    stores,
    capturedAt,
    maximumAgeMs: input.maximumAgeMs,
  });
  const manifest: RecoveryManifest = {
    schemaVersion: RECOVERY_POINT_SCHEMA_VERSION,
    recoveryPointId,
    recoveryPointDigest,
    runId: input.runId,
    target: input.target,
    quiescence,
    stores,
    capturedAt,
    maximumAgeMs: input.maximumAgeMs,
  };
  const restoreToken = mintRestoreToken(input.runId, recoveryPointDigest);
  const verification: RecoveryPointVerification = {
    status: "verified",
    recoveryPointDigest,
    storeChecksums: {
      postgres: stores.postgres.checksum,
      objectStore: stores.objectStore.checksum,
      redis: stores.redis.checksum,
    },
  };
  return ok({ manifest, verification, restoreToken });
}

const isForbiddenComposeAppPostgresIdentity = (identity: string): boolean => {
  const normalized = identity.trim().toLowerCase();
  return (
    normalized === "127.0.0.1:5432/wiseeff" ||
    normalized === "localhost:5432/wiseeff"
  );
};

export async function verifyRecoveryPoint(
  input: VerifyRecoveryPointInput,
): Promise<RecoveryPointResult<RecoveryPointVerification>> {
  const now = clockOf(input.now);
  const ageMs = now.getTime() - Date.parse(input.manifest.capturedAt);
  if (!Number.isFinite(ageMs) || ageMs > input.manifest.maximumAgeMs) {
    return fail("stale-boundary", "Recovery point exceeded the plan maximum age.");
  }

  let stores: RecoveryManifestStores;
  try {
    const snapped = await snapshotAll(input.stores, now);
    if (!snapped.ok) {
      return snapped;
    }
    stores = snapped.value;
  } catch (error) {
    if (error instanceof ForbiddenComposeAppError) {
      return fail("wrong-target", error.message);
    }
    const message = error instanceof Error ? error.message : String(error);
    return fail("partial-store", message);
  }

  if (!identitiesMatch(stores, input.manifest.target)) {
    return fail("stale-boundary", "Live store identities drifted from the recovery-point target.");
  }
  if (!checksumsMatch(stores, input.manifest.stores)) {
    return fail("checksum-drift", "Live store checksums do not match the recovery-point manifest.");
  }

  return ok({
    status: "verified",
    recoveryPointDigest: input.manifest.recoveryPointDigest,
    storeChecksums: {
      postgres: stores.postgres.checksum,
      objectStore: stores.objectStore.checksum,
      redis: stores.redis.checksum,
    },
  });
}

export async function restoreCheck(
  input: RestoreCheckInput,
): Promise<RecoveryPointResult<RestoreCheckSuccess>> {
  const presented = input.restoreToken?.trim() ?? "";
  if (!presented) {
    return fail("token-failure", "restoreCheck requires the run-bound restore token.");
  }
  const expected = mintRestoreToken(input.manifest.runId, input.manifest.recoveryPointDigest);
  if (presented !== expected) {
    return fail("token-failure", "restore token is missing, malformed, or bound to another run.");
  }

  if (
    input.restoreTargets.restoreDatabaseUrl &&
    isForbiddenComposeAppPostgres(input.restoreTargets.restoreDatabaseUrl)
  ) {
    return fail(
      "wrong-target",
      "restoreCheck refuses the default compose 5432/wiseeff database as a restore target.",
    );
  }

  const verified = await verifyRecoveryPoint({
    manifest: input.manifest,
    stores: input.stores,
    now: input.now,
  });
  if (!verified.ok) {
    return verified;
  }

  return ok({
    status: "restore-authorized",
    recoveryPointDigest: input.manifest.recoveryPointDigest,
    runId: input.manifest.runId,
  });
}
