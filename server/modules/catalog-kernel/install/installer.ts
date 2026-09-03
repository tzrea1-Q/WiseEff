import pg from "pg";

import {
  CatalogMaterializationFingerprint,
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogReleaseVersion,
  MaintenanceAttemptId,
  type CatalogKernelError,
  type CatalogReleaseCounts,
  type CatalogReleaseIdentity,
  type CatalogReleasePin,
  type InstallResult,
  type Result,
  type SwitchBackResult,
} from "../../parameter-catalog-contract/index";
import { compileCatalogRelease } from "../compiler/index";
import type { CatalogReleaseBundle, CompiledCatalogRelease } from "../compiler/types";
import type {
  CatalogReleaseSource,
  InstallPublishedReleaseCommand,
  PreTrafficSwitchBackCommand,
} from "../interface";
import {
  advanceCurrentPointer,
  readCurrentCatalogPointer,
  restoreCurrentDefinitionHeads,
  type CatalogPointerState,
} from "./currentPointer";
import {
  acquireCurrentPointerLockExclusive,
  isSynchronizationBusyError,
  SYNCHRONIZATION_BUSY,
} from "./lockProtocol";
import {
  CatalogMaterializationInjectedFailure,
  materializeCompiledRelease,
  unwrapMaterializationKernelError,
  type CatalogMaterializationStage,
  type MaterializeReleaseOptions,
} from "./materializeRelease";

export type ThreatMatrixRow = {
  readonly id: number;
  readonly name: string;
  readonly initialState: string;
  readonly action: string;
  readonly expected: string;
  readonly leftover: string;
};

const freezeRow = (row: ThreatMatrixRow): ThreatMatrixRow => Object.freeze(row);

export const THREAT_MATRIX: readonly ThreatMatrixRow[] = Object.freeze([
  freezeRow({
    id: 1,
    name: "bootstrap-success",
    initialState: "empty catalog_state",
    action: "installPublishedRelease mode=bootstrap with matching expectedTargetDigest",
    expected: "status=installed mode=bootstrap previous=null",
    leftover: "one current pointer, one materialization, complete projection",
  }),
  freezeRow({
    id: 2,
    name: "advance-success",
    initialState: "catalog_state pin equals expectedCurrent and compiled predecessor",
    action: "installPublishedRelease mode=advance",
    expected: "status=installed mode=advance previous=expectedCurrent",
    leftover: "pointer and heads advance together; predecessor projection retained",
  }),
  freezeRow({
    id: 3,
    name: "idempotent-replay",
    initialState: "target digest already current",
    action: "installPublishedRelease of the same source/digest",
    expected: "status=already-current",
    leftover: "no second materialization, revision, head, or pointer row",
  }),
  freezeRow({
    id: 4,
    name: "lost-response-retry",
    initialState: "commit succeeded; caller lost the result",
    action: "retry installPublishedRelease with the same digest",
    expected: "status=already-current",
    leftover: "no second materialization",
  }),
  freezeRow({
    id: 5,
    name: "concurrent-install",
    initialState: "two independent sessions install the same or competing targets",
    action: "exclusive lock serializes writers",
    expected: "winner installed; loser already-current or unsupported-lineage",
    leftover: "one complete projection; no mixed heads",
  }),
  freezeRow({
    id: 6,
    name: "shared-vs-exclusive",
    initialState: "governance session holds acquire_current_pointer_lock_shared via guard",
    action: "installPublishedRelease takes exclusive lock 688004000041",
    expected: "exclusive waiter blocks on advisory lock until shared end or PCA05",
    leftover: "shared holder unchanged while exclusive waits",
  }),
  freezeRow({
    id: 7,
    name: "failure-mid-materialization",
    initialState: "bootstrap or advance in flight",
    action: "fail after a staged relation family before commit",
    expected: "transaction rollback / storage-failure",
    leftover: "zero residue; pointer and heads unchanged",
  }),
  freezeRow({
    id: 8,
    name: "stale-pin",
    initialState: "catalog_state pin differs from expectedCurrent",
    action: "installPublishedRelease mode=advance",
    expected: "unsupported-lineage stale-expected-current or release-mismatch",
    leftover: "pointer unchanged",
  }),
  freezeRow({
    id: 9,
    name: "digest-conflict",
    initialState: "same release id already stored with different digest",
    action: "installPublishedRelease of colliding id/bytes",
    expected: "digest-conflict",
    leftover: "stored digest and pointer unchanged",
  }),
  freezeRow({
    id: 10,
    name: "switch-back-gate",
    initialState: "successor current; previous projection retained",
    action: "switchBackBeforeTraffic before vs after candidate-write/traffic",
    expected: "switched-back or switch-back-forbidden",
    leftover: "forbidden leaves pointer on successor; success restores previous heads",
  }),
  freezeRow({
    id: 11,
    name: "synchronization-busy",
    initialState: "exclusive lock held beyond S2-SCH 2s lock_timeout",
    action: "installPublishedRelease or switchBackBeforeTraffic",
    expected: "synchronization-busy retryable=true",
    leftover: "holder state unchanged; waiter wrote nothing",
  }),
]);

export type TrafficActivationProof =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason:
        | "traffic-observed"
        | "candidate-write-observed"
        | "previous-projection-invalid"
        | "migration-incompatible";
    };

export type TrafficActivationGuard = {
  provePreTrafficSwitchBack(input: {
    readonly client: pg.PoolClient;
    readonly maintenanceAttemptId: string;
    readonly expectedCurrent: CatalogReleasePin;
    readonly targetPrevious: CatalogReleasePin;
  }): Promise<TrafficActivationProof>;
};

export type CatalogInstallerOptions = MaterializeReleaseOptions & {
  readonly trafficActivationGuard?: TrafficActivationGuard;
};

const absent = { kind: "absent" as const };

const ok = <T>(value: T): Result<T, CatalogKernelError> => ({
  ok: true,
  value,
});

const fail = <T>(error: CatalogKernelError): Result<T, CatalogKernelError> => ({
  ok: false,
  error,
});

class CatalogKernelFailure extends Error {
  readonly kernelError: CatalogKernelError;

  constructor(kernelError: CatalogKernelError) {
    super(kernelError.kind);
    this.name = "CatalogKernelFailure";
    this.kernelError = kernelError;
  }
}

const parseBundle = async (
  source: CatalogReleaseSource,
): Promise<CatalogReleaseBundle> => {
  const manifest = new TextDecoder().decode(await source.readManifest());
  return JSON.parse(manifest) as CatalogReleaseBundle;
};

const compilePublishedRelease = async (
  source: CatalogReleaseSource,
): Promise<Result<CompiledCatalogRelease, CatalogKernelError>> => {
  try {
    const bundle = await parseBundle(source);
    return compileCatalogRelease(bundle);
  } catch (error) {
    return fail({
      kind: "invalid-release",
      phase: "source",
      violations: [
        {
          code: "manifest-unreadable",
          location: { kind: "present", value: "manifest" },
          subjectId: absent,
          detail:
            error instanceof Error ? error.message : "catalog-release-source-unreadable",
        },
      ],
    });
  }
};

const identityFromCompiled = (
  compiled: CompiledCatalogRelease,
): CatalogReleaseIdentity => ({
  id: compiled.release.id,
  version: compiled.release.version,
  digest: compiled.release.digest,
});

const NON_RETRYABLE_STORAGE_CODES = new Set(["23514", "23505", "55000"]);

const storageFailure = (
  operation: "installPublishedRelease" | "switchBackBeforeTraffic",
  retryable: boolean,
): CatalogKernelError => ({
  kind: "storage-failure",
  operation,
  retryable,
});

const mapWriteError = (
  error: unknown,
  operation: "installPublishedRelease" | "switchBackBeforeTraffic",
): CatalogKernelError => {
  if (error instanceof CatalogKernelFailure) {
    return error.kernelError;
  }
  const materialized = unwrapMaterializationKernelError(error);
  if (materialized) {
    return materialized;
  }
  if (isSynchronizationBusyError(error)) {
    return SYNCHRONIZATION_BUSY;
  }
  if (error instanceof CatalogMaterializationInjectedFailure) {
    return storageFailure(operation, true);
  }
  if (error instanceof pg.DatabaseError && error.code && NON_RETRYABLE_STORAGE_CODES.has(error.code)) {
    return storageFailure(operation, false);
  }
  return storageFailure(operation, true);
};

const maybeFailPointer = (options: CatalogInstallerOptions | undefined): void => {
  if (options?.failAfter === "pointer") {
    throw new CatalogMaterializationInjectedFailure("pointer");
  }
};

const defaultTrafficActivationGuard: TrafficActivationGuard = {
  async provePreTrafficSwitchBack({ client, maintenanceAttemptId, targetPrevious }) {
    const previous = await client.query<{
      compiled_fingerprint: string;
      head_count: string;
    }>(
      `select
         materialization.compiled_fingerprint,
         (
           select count(*)::text
           from parameter_catalog.catalog_release_definition_heads heads
           where heads.release_id = materialization.release_id
         ) as head_count
       from parameter_catalog.catalog_materializations materialization
       where materialization.release_id = $1`,
      [targetPrevious.id],
    );
    if (!previous.rows[0] || previous.rows[0].head_count === "0") {
      return { allowed: false, reason: "previous-projection-invalid" };
    }

    const candidateWrites = await client.query<{ count: string }>(
      `select count(*)::text as count
         from parameter_catalog.organization_subject_registrations`,
    );
    if (candidateWrites.rows[0]?.count !== "0") {
      return { allowed: false, reason: "candidate-write-observed" };
    }

    const traffic = await client.query<{ count: string }>(
      `select count(*)::text as count
         from parameter_catalog.parameter_observations`,
    );
    if (traffic.rows[0]?.count !== "0") {
      return { allowed: false, reason: "traffic-observed" };
    }

    const cutover = await client.query<{ pointer_rollback_closed_at: string | null }>(
      `select pointer_rollback_closed_at
         from parameter_catalog.parameter_catalog_cutover_runs
        where id = $1`,
      [maintenanceAttemptId],
    );
    if (!cutover.rows[0] || cutover.rows[0].pointer_rollback_closed_at) {
      return { allowed: false, reason: "migration-incompatible" };
    }

    return { allowed: true };
  },
};

const recastPointer = (
  pointer: CatalogPointerState,
): CatalogReleaseIdentity | null =>
  pointer.kind === "installed" ? pointer.current : null;

const assertExpectedDigest = (
  command: InstallPublishedReleaseCommand,
  compiled: CompiledCatalogRelease,
): void => {
  if (command.expectedTargetDigest !== compiled.aggregateDigest) {
    throw new CatalogKernelFailure({
      kind: "invalid-release",
      phase: "install-preflight",
      violations: [
        {
          code: "aggregate-digest-mismatch",
          location: { kind: "present", value: "expectedTargetDigest" },
          subjectId: absent,
          detail: "expected-target-digest-mismatch",
        },
      ],
    });
  }
};

const recastInstalledRelease = async (
  client: pg.PoolClient,
  releaseId: string,
): Promise<{ identity: CatalogReleaseIdentity; digest: string } | null> => {
  const result = await client.query<{
    id: string;
    release_version: string;
    release_digest: string;
  }>(
    `select id, release_version, release_digest
       from parameter_catalog.catalog_releases
      where id = $1`,
    [releaseId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    identity: {
      id: CatalogReleaseId(row.id),
      version: CatalogReleaseVersion(row.release_version),
      digest: CatalogReleaseDigest(row.release_digest),
    },
    digest: row.release_digest,
  };
};

const loadReleaseCounts = async (
  client: pg.PoolClient,
  releaseId: string,
): Promise<CatalogReleaseCounts> => {
  const result = await client.query<{
    subjects: string;
    subject_memberships: string;
    aliases: string;
    alias_memberships: string;
    definitions: string;
    definition_revisions: string;
  }>(
    `select
       (select count(*)::text
          from parameter_catalog.catalog_release_subjects
         where release_id = $1) as subjects,
       (select count(*)::text
          from parameter_catalog.catalog_release_subjects
         where release_id = $1) as subject_memberships,
       (select count(*)::text
          from parameter_catalog.catalog_release_subject_aliases
         where release_id = $1) as aliases,
       (select count(*)::text
          from parameter_catalog.catalog_release_subject_aliases
         where release_id = $1) as alias_memberships,
       (select count(*)::text
          from parameter_catalog.catalog_release_definition_heads
         where release_id = $1) as definitions,
       (select count(*)::text
          from parameter_catalog.definition_revisions
         where catalog_release_id = $1) as definition_revisions`,
    [releaseId],
  );
  const row = result.rows[0];
  return {
    subjects: Number(row?.subjects ?? 0),
    subjectMemberships: Number(row?.subject_memberships ?? 0),
    aliases: Number(row?.aliases ?? 0),
    aliasMemberships: Number(row?.alias_memberships ?? 0),
    definitions: Number(row?.definitions ?? 0),
    definitionRevisions: Number(row?.definition_revisions ?? 0),
  };
};

const loadVerifiedCurrentInstall = async (
  client: pg.PoolClient,
  compiled: CompiledCatalogRelease,
): Promise<InstallResult> => {
  const result = await client.query<{
    id: string;
    release_version: string;
    release_digest: string;
    compiled_fingerprint: string | null;
  }>(
    `select
       release.id,
       release.release_version,
       release.release_digest,
       materialization.compiled_fingerprint
     from parameter_catalog.catalog_releases release
     left join parameter_catalog.catalog_materializations materialization
       on materialization.release_id = release.id
     where release.id = $1`,
    [compiled.release.id],
  );
  const row = result.rows[0];
  if (!row) {
    throw new CatalogKernelFailure({
      kind: "drift",
      scope: "current",
      expected: { id: compiled.release.id, digest: compiled.release.digest },
      actual: null,
      violations: [
        {
          code: "current-pointer-mismatch",
          relation: "catalog_releases",
          identity: compiled.release.id,
          detail: "current-pointer-release-row-missing",
        },
      ],
    });
  }
  if (row.release_digest !== compiled.release.digest) {
    throw new CatalogKernelFailure({
      kind: "digest-conflict",
      releaseId: compiled.release.id,
      expected: compiled.release.digest,
      actual: CatalogReleaseDigest(row.release_digest),
    });
  }
  if (
    row.compiled_fingerprint === null ||
    row.compiled_fingerprint !== compiled.materializationFingerprint
  ) {
    throw new CatalogKernelFailure({
      kind: "drift",
      scope: "current",
      expected: { id: compiled.release.id, digest: compiled.release.digest },
      actual: {
        id: CatalogReleaseId(row.id),
        version: CatalogReleaseVersion(row.release_version),
        digest: CatalogReleaseDigest(row.release_digest),
      },
      violations: [
        {
          code: "materialization-fingerprint-mismatch",
          relation: "catalog_materializations",
          identity: compiled.release.id,
          detail: "installed-fingerprint-disagrees-with-compiler",
        },
      ],
    });
  }
  return {
    status: "already-current",
    current: {
      id: CatalogReleaseId(row.id),
      version: CatalogReleaseVersion(row.release_version),
      digest: CatalogReleaseDigest(row.release_digest),
    },
    materializationFingerprint: CatalogMaterializationFingerprint(
      row.compiled_fingerprint,
    ),
    counts: await loadReleaseCounts(client, row.id),
  };
};

const evaluateInstallLineage = async (
  client: pg.PoolClient,
  command: InstallPublishedReleaseCommand,
  compiled: CompiledCatalogRelease,
): Promise<"install" | "already-current"> => {
  const pointer = await readCurrentCatalogPointer(client);
  const existing = await recastInstalledRelease(client, compiled.release.id);

  if (existing && existing.digest !== compiled.release.digest) {
    throw new CatalogKernelFailure({
      kind: "digest-conflict",
      releaseId: compiled.release.id,
      expected: compiled.release.digest,
      actual: existing.identity.digest,
    });
  }

  if (pointer.kind === "empty") {
    if (command.mode === "advance") {
      throw new CatalogKernelFailure({
        kind: "unsupported-lineage",
        installed: null,
        target: identityFromCompiled(compiled),
        reason: "stale-expected-current",
      });
    }
    if (compiled.predecessor !== null) {
      throw new CatalogKernelFailure({
        kind: "unsupported-lineage",
        installed: null,
        target: identityFromCompiled(compiled),
        reason: "wrong-predecessor",
      });
    }
    return "install";
  }

  if (
    pointer.current.id === compiled.release.id &&
    pointer.current.digest === compiled.release.digest
  ) {
    return "already-current";
  }

  if (command.mode === "bootstrap") {
    throw new CatalogKernelFailure({
      kind: "unsupported-lineage",
      installed: pointer.current,
      target: identityFromCompiled(compiled),
      reason: "stale-expected-current",
    });
  }

  if (
    pointer.current.id !== command.expectedCurrent.id ||
    pointer.current.digest !== command.expectedCurrent.digest
  ) {
    throw new CatalogKernelFailure({
      kind: "unsupported-lineage",
      installed: pointer.current,
      target: identityFromCompiled(compiled),
      reason: "stale-expected-current",
    });
  }

  if (
    compiled.predecessor === null ||
    compiled.predecessor.id !== pointer.current.id ||
    compiled.predecessor.digest !== pointer.current.digest
  ) {
    throw new CatalogKernelFailure({
      kind: "unsupported-lineage",
      installed: pointer.current,
      target: identityFromCompiled(compiled),
      reason: "wrong-predecessor",
    });
  }

  return "install";
};

const withCatalogWriteTransaction = async <T>(
  pool: pg.Pool,
  operation: "installPublishedRelease" | "switchBackBeforeTraffic",
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<Result<T, CatalogKernelError>> => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    try {
      await client.query("set constraints all deferred");
      await acquireCurrentPointerLockExclusive(client);
      const value = await work(client);
      await client.query("commit");
      return ok(value);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      return fail(mapWriteError(error, operation));
    }
  } finally {
    client.release();
  }
};

export const installPublishedRelease = async (
  pool: pg.Pool,
  command: InstallPublishedReleaseCommand,
  options?: CatalogInstallerOptions,
): Promise<Result<InstallResult, CatalogKernelError>> => {
  const compiled = await compilePublishedRelease(command.source);
  if (!compiled.ok) {
    return compiled;
  }
  try {
    assertExpectedDigest(command, compiled.value);
  } catch (error) {
    return fail(mapWriteError(error, "installPublishedRelease"));
  }

  return withCatalogWriteTransaction(
    pool,
    "installPublishedRelease",
    async (client) => {
      const lineage = await evaluateInstallLineage(client, command, compiled.value);
      if (lineage === "already-current") {
        return loadVerifiedCurrentInstall(client, compiled.value);
      }
      const pointer = await readCurrentCatalogPointer(client);
      const previous = recastPointer(pointer);
      await materializeCompiledRelease(client, compiled.value, options);
      await client.query("set constraints all immediate");
      await restoreCurrentDefinitionHeads(client, compiled.value.release.id);
      maybeFailPointer(options);
      await advanceCurrentPointer(client, compiled.value.release.id);
      return {
        status: "installed",
        mode: command.mode,
        previous,
        current: identityFromCompiled(compiled.value),
        materializationFingerprint: compiled.value.materializationFingerprint,
        counts: compiled.value.counts,
      } satisfies InstallResult;
    },
  );
};

const loadReleaseIdentity = async (
  client: pg.PoolClient,
  pin: CatalogReleasePin,
): Promise<CatalogReleaseIdentity> => {
  const loaded = await recastInstalledRelease(client, pin.id);
  if (!loaded) {
    throw new CatalogKernelFailure({
      kind: "historical-release-unavailable",
      pin,
    });
  }
  if (loaded.identity.digest !== pin.digest) {
    throw new CatalogKernelFailure({
      kind: "digest-conflict",
      releaseId: pin.id,
      expected: pin.digest,
      actual: loaded.identity.digest,
    });
  }
  return loaded.identity;
};

const loadMaterializationFingerprint = async (
  client: pg.PoolClient,
  releaseId: string,
): Promise<CatalogMaterializationFingerprint> => {
  const result = await client.query<{ compiled_fingerprint: string }>(
    `select compiled_fingerprint
       from parameter_catalog.catalog_materializations
      where release_id = $1`,
    [releaseId],
  );
  const fingerprint = result.rows[0]?.compiled_fingerprint;
  if (!fingerprint) {
    throw new CatalogKernelFailure({
      kind: "switch-back-forbidden",
      reason: "previous-projection-invalid",
    });
  }
  return CatalogMaterializationFingerprint(fingerprint);
};

export const switchBackBeforeTraffic = async (
  pool: pg.Pool,
  command: PreTrafficSwitchBackCommand,
  options?: CatalogInstallerOptions,
): Promise<Result<SwitchBackResult, CatalogKernelError>> =>
  withCatalogWriteTransaction(pool, "switchBackBeforeTraffic", async (client) => {
    const pointer = await readCurrentCatalogPointer(client);
    if (pointer.kind === "empty") {
      throw new CatalogKernelFailure({
        kind: "release-mismatch",
        expected: command.expectedCurrent,
        actual: null,
      });
    }
    if (
      pointer.current.id !== command.expectedCurrent.id ||
      pointer.current.digest !== command.expectedCurrent.digest
    ) {
      throw new CatalogKernelFailure({
        kind: "release-mismatch",
        expected: command.expectedCurrent,
        actual: pointer.current,
      });
    }
    if (pointer.predecessorReleaseId !== command.targetPrevious.id) {
      throw new CatalogKernelFailure({
        kind: "switch-back-forbidden",
        reason: "previous-projection-invalid",
      });
    }

    const previousCurrent = pointer.current;
    const previous = await loadReleaseIdentity(client, command.targetPrevious);
    const guard = options?.trafficActivationGuard ?? defaultTrafficActivationGuard;
    const proof = await guard.provePreTrafficSwitchBack({
      client,
      maintenanceAttemptId: command.maintenanceAttemptId,
      expectedCurrent: command.expectedCurrent,
      targetPrevious: command.targetPrevious,
    });
    if (!proof.allowed) {
      throw new CatalogKernelFailure({
        kind: "switch-back-forbidden",
        reason: proof.reason,
      });
    }

    const fingerprint = await loadMaterializationFingerprint(
      client,
      command.targetPrevious.id,
    );
    await restoreCurrentDefinitionHeads(client, command.targetPrevious.id);
    maybeFailPointer(options);
    await advanceCurrentPointer(client, command.targetPrevious.id);
    return {
      status: "switched-back",
      maintenanceAttemptId: MaintenanceAttemptId(command.maintenanceAttemptId),
      previousCurrent,
      current: previous,
      materializationFingerprint: fingerprint,
    } satisfies SwitchBackResult;
  });

export type CatalogInstaller = {
  installPublishedRelease(
    command: InstallPublishedReleaseCommand,
  ): Promise<Result<InstallResult, CatalogKernelError>>;
  switchBackBeforeTraffic(
    command: PreTrafficSwitchBackCommand,
  ): Promise<Result<SwitchBackResult, CatalogKernelError>>;
};

export const createCatalogInstaller = (
  pool: pg.Pool,
  options?: CatalogInstallerOptions,
): CatalogInstaller => ({
  installPublishedRelease: (command) =>
    installPublishedRelease(pool, command, options),
  switchBackBeforeTraffic: (command) =>
    switchBackBeforeTraffic(pool, command, options),
});

export type { CatalogMaterializationStage };
