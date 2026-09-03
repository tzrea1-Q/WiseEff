import { randomBytes } from "node:crypto";

import type { ContractJsonValue } from "../../parameter-catalog-contract/index";
import { serializeContract } from "../../parameter-catalog-contract/index";
import { DISPOSITION_BY_R_CLASS } from "../classifier/index";
import type { OwnerScopeKind, RClass } from "../classifier/types";
import { archiveGraphChecksum, checksumContract } from "./checksum";
import {
  ArchiveCryptoError,
  assertArchiveKey,
  buildArchiveAad,
  decryptArchiveObject,
  encryptArchiveObject,
} from "./crypto";
import type {
  ArchiveActor,
  ArchiveAdapter,
  ArchiveAdapterOptions,
  ArchiveFailPoint,
  ArchiveFailure,
  ArchiveFailureCode,
  ArchiveMetadata,
  ArchivePersistResult,
  ArchiveProtectedReference,
  ArchiveQueryable,
  ArchiveRestoreResult,
  ArchiveSourceGraph,
  PersistArchiveCommand,
  PersistArchiveSuccess,
  RestoreArchiveCommand,
} from "./types";

const ARCHIVES_RELATION = "parameter_catalog.parameter_catalog_archives";

class ArchiveInjectedFailure extends Error {
  readonly failAfter: ArchiveFailPoint;

  constructor(failAfter: ArchiveFailPoint) {
    super(`injected archive failure after ${failAfter}`);
    this.name = "ArchiveInjectedFailure";
    this.failAfter = failAfter;
  }
}

class ArchivePlaintextLeak extends Error {
  constructor() {
    super("archive plaintext leak");
    this.name = "ArchivePlaintextLeak";
  }
}

type ArchiveRow = {
  id: string;
  legacy_identity_id: string;
  owner_scope_kind: OwnerScopeKind;
  owner_scope_id: string;
  r_class: RClass;
  reason: string;
  source_checksum: string;
  graph_checksum: string;
  encrypted_object_ref: string;
  protected_references: unknown;
  cutover_run_id: string;
  catalog_release_id: string;
  success_audit_ref: string;
  retain_until: Date;
};

const fail = (code: ArchiveFailureCode, detail: string): ArchivePersistResult | ArchiveRestoreResult => ({
  ok: false,
  error: { code, detail },
});

const persistFail = (code: ArchiveFailureCode, detail: string): ArchivePersistResult =>
  fail(code, detail) as ArchivePersistResult;

const restoreFail = (code: ArchiveFailureCode, detail: string): ArchiveRestoreResult =>
  fail(code, detail) as ArchiveRestoreResult;

const isNonEmptyTrimmed = (value: string): boolean =>
  value.length > 0 && value.trim() === value;

const authorizeOperator = (
  actor: ArchiveActor,
  auditRef: string | undefined,
  action: "persist" | "restore",
): ArchiveFailure | null => {
  if (actor.role !== "cutover-operator") {
    return {
      code: "PCAT-ARC-PERMISSION-DENIED",
      detail: `archive ${action} requires the cutover-operator role`,
    };
  }
  if (!auditRef || !isNonEmptyTrimmed(auditRef)) {
    return {
      code: "PCAT-ARC-PERMISSION-DENIED",
      detail: `archive ${action} requires a trusted audit ref`,
    };
  }
  return null;
};

const collectPlaintextNeedles = (payload: ContractJsonValue): string[] => {
  const needles = new Set<string>();
  needles.add(serializeContract(payload));
  const walk = (value: ContractJsonValue): void => {
    if (typeof value === "string" && value.length >= 16) {
      needles.add(value);
    } else if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
    } else if (value && typeof value === "object") {
      for (const entry of Object.values(value)) walk(entry);
    }
  };
  walk(payload);
  return [...needles];
};

const bufferHasNeedle = (haystack: Buffer, needle: string): boolean =>
  haystack.includes(needle);

const assertNoPlaintext = (haystacks: readonly Buffer[], needles: readonly string[]): void => {
  for (const needle of needles) {
    for (const haystack of haystacks) {
      if (bufferHasNeedle(haystack, needle)) {
        throw new ArchivePlaintextLeak();
      }
    }
  }
};

const asProtectedReferences = (value: unknown): ArchiveProtectedReference[] | null => {
  if (!Array.isArray(value)) return null;
  const refs: ArchiveProtectedReference[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const record = entry as Record<string, unknown>;
    if (typeof record.kind !== "string" || typeof record.id !== "string") return null;
    if (!isNonEmptyTrimmed(record.kind) || !isNonEmptyTrimmed(record.id)) return null;
    refs.push({ kind: record.kind, id: record.id });
  }
  return refs;
};

const parseSourceGraph = (bytes: Buffer): ArchiveSourceGraph | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (!("sourcePayload" in record) || !("relationGraph" in record)) return null;
  return {
    sourcePayload: record.sourcePayload as ContractJsonValue,
    relationGraph: record.relationGraph as ContractJsonValue,
  };
};

const metadataFromRow = (
  row: ArchiveRow,
  protectedReferences: readonly ArchiveProtectedReference[],
): ArchiveMetadata => ({
  archiveId: row.id,
  legacyIdentityId: row.legacy_identity_id,
  ownerScopeKind: row.owner_scope_kind,
  ownerScopeId: row.owner_scope_id,
  rClass: row.r_class,
  reason: row.reason,
  sourceChecksum: row.source_checksum,
  graphChecksum: row.graph_checksum,
  encryptedObjectRef: row.encrypted_object_ref,
  protectedReferences,
  cutoverRunId: row.cutover_run_id,
  catalogReleaseId: row.catalog_release_id,
  successAuditRef: row.success_audit_ref,
  retainUntil: row.retain_until instanceof Date ? row.retain_until : new Date(row.retain_until),
});

const maybeInject = (failAfter: ArchiveFailPoint | undefined, point: ArchiveFailPoint): void => {
  if (failAfter === point) {
    throw new ArchiveInjectedFailure(point);
  }
};

const newArchiveId = (): string => `arc_${randomBytes(16).toString("hex")}`;

const objectRefFor = (archiveId: string): string => `obj_${archiveId.slice("arc_".length)}`;

export const createArchiveAdapter = (options: ArchiveAdapterOptions): ArchiveAdapter => {
  const encryptionKey = assertArchiveKey(options.encryptionKey);
  const client: ArchiveQueryable = options.client;
  const objectStore = options.objectStore;

  const persistArchive = async (
    command: PersistArchiveCommand,
  ): Promise<ArchivePersistResult> => {
    const auth = authorizeOperator(command.actor, command.successAuditRef, "persist");
    if (auth) return persistFail(auth.code, auth.detail);
    if (DISPOSITION_BY_R_CLASS[command.rClass] !== "archived") {
      return persistFail(
        "PCAT-ARC-DISPOSITION-NOT-ARCHIVED",
        `R class ${command.rClass} is not an archived classifier disposition`,
      );
    }
    if (!isNonEmptyTrimmed(command.legacyIdentityId) || !isNonEmptyTrimmed(command.cutoverRunId)) {
      return persistFail("PCAT-ARC-INVALID-INPUT", "legacy identity and cutover run are required");
    }
    if (!isNonEmptyTrimmed(command.reason) || !isNonEmptyTrimmed(command.catalogReleaseId)) {
      return persistFail("PCAT-ARC-INVALID-INPUT", "reason and catalog release are required");
    }
    if (!(command.retainUntil instanceof Date) || Number.isNaN(command.retainUntil.getTime())) {
      return persistFail("PCAT-ARC-INVALID-INPUT", "retainUntil must be a valid date");
    }

    const sourceChecksum = checksumContract(command.sourceGraph.sourcePayload);
    const graphChecksum = archiveGraphChecksum({
      relationGraph: command.sourceGraph.relationGraph,
      protectedReferences: command.protectedReferences,
    });
    const needles = collectPlaintextNeedles(command.sourceGraph.sourcePayload);
    const archiveId = newArchiveId();
    const encryptedObjectRef = objectRefFor(archiveId);
    const plaintext = Buffer.from(
      JSON.stringify({
        sourcePayload: command.sourceGraph.sourcePayload,
        relationGraph: command.sourceGraph.relationGraph,
      }),
      "utf8",
    );
    const envelope = encryptArchiveObject({
      key: encryptionKey,
      aad: buildArchiveAad({
        archiveId,
        legacyIdentityId: command.legacyIdentityId,
        cutoverRunId: command.cutoverRunId,
        sourceChecksum,
        graphChecksum,
      }),
      plaintext,
    });

    const metadataHaystacks = [
      command.legacyIdentityId,
      command.ownerScopeId,
      command.reason,
      sourceChecksum,
      graphChecksum,
      encryptedObjectRef,
      command.cutoverRunId,
      command.catalogReleaseId,
      command.successAuditRef,
      JSON.stringify(command.protectedReferences),
    ].map((value) => Buffer.from(value, "utf8"));

    try {
      assertNoPlaintext([envelope, ...metadataHaystacks], needles);
    } catch {
      return persistFail("PCAT-ARC-PLAINTEXT-LEAK", "refusing to persist plaintext archive bytes");
    }

    let objectWritten = false;
    await client.query("begin");
    try {
      await client.query("select pg_catalog.pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
        `s7-arc:${command.legacyIdentityId}`,
        command.cutoverRunId,
      ]);

      const identity = await client.query<{
        id: string;
        owner_scope_kind: OwnerScopeKind;
        owner_scope_id: string;
      }>(
        `
        select id, owner_scope_kind, owner_scope_id
        from parameter_catalog.legacy_identities
        where id = $1
        `,
        [command.legacyIdentityId],
      );
      const identityRow = identity.rows[0];
      if (!identityRow) {
        await client.query("rollback");
        return persistFail("PCAT-ARC-INVALID-INPUT", "legacy identity does not exist");
      }
      if (
        identityRow.owner_scope_kind !== command.ownerScopeKind ||
        identityRow.owner_scope_id !== command.ownerScopeId
      ) {
        await client.query("rollback");
        return persistFail("PCAT-ARC-INVALID-INPUT", "archive owner scope does not match the legacy identity");
      }

      const run = await client.query<{ id: string }>(
        "select id from parameter_catalog.parameter_catalog_cutover_runs where id = $1",
        [command.cutoverRunId],
      );
      if (!run.rows[0]) {
        await client.query("rollback");
        return persistFail("PCAT-ARC-INVALID-INPUT", "cutover run does not exist");
      }

      const current = await client.query<{ current_catalog_release_id: string }>(
        "select current_catalog_release_id from parameter_catalog.catalog_state where singleton",
      );
      if (current.rows[0]?.current_catalog_release_id !== command.catalogReleaseId) {
        await client.query("rollback");
        return persistFail("PCAT-ARC-INVALID-INPUT", "catalog release is not the current catalog release");
      }

      const existing = await client.query<ArchiveRow>(
        `
        select
          id, legacy_identity_id, owner_scope_kind, owner_scope_id, r_class, reason,
          source_checksum, graph_checksum, encrypted_object_ref, protected_references,
          cutover_run_id, catalog_release_id, success_audit_ref, retain_until
        from ${ARCHIVES_RELATION}
        where legacy_identity_id = $1 and cutover_run_id = $2
        for update
        `,
        [command.legacyIdentityId, command.cutoverRunId],
      );

      if (existing.rows.length > 1) {
        await client.query("rollback");
        return persistFail("PCAT-ARC-CONFLICT", "multiple archives already exist for this identity and run");
      }

      const currentRow = existing.rows[0];
      if (currentRow) {
        const sameChecksums =
          currentRow.source_checksum === sourceChecksum && currentRow.graph_checksum === graphChecksum;
        if (
          sameChecksums &&
          currentRow.r_class === command.rClass &&
          currentRow.owner_scope_kind === command.ownerScopeKind &&
          currentRow.owner_scope_id === command.ownerScopeId &&
          currentRow.catalog_release_id === command.catalogReleaseId
        ) {
          const present = await objectStore.exists(currentRow.encrypted_object_ref);
          await client.query("commit");
          if (!present) {
            return persistFail("PCAT-ARC-ATOMICITY", "committed archive metadata is missing its encrypted object");
          }
          const success: PersistArchiveSuccess = {
            status: "already-archived",
            archiveId: currentRow.id,
            sourceChecksum: currentRow.source_checksum,
            graphChecksum: currentRow.graph_checksum,
            encryptedObjectRef: currentRow.encrypted_object_ref,
          };
          return { ok: true, value: success };
        }
        await client.query("rollback");
        return persistFail(
          "PCAT-ARC-CONFLICT",
          "archive already exists for this identity and run with a different digest",
        );
      }

      if (options.failAfter === "object-without-metadata") {
        await objectStore.putExclusive(encryptedObjectRef, envelope);
        objectWritten = true;
        throw new ArchiveInjectedFailure("object-without-metadata");
      }

      await client.query(
        `
        insert into ${ARCHIVES_RELATION} (
          id, legacy_identity_id, owner_scope_kind, owner_scope_id, r_class, reason,
          source_checksum, graph_checksum, encrypted_object_ref, protected_references,
          cutover_run_id, catalog_release_id, success_audit_ref, retain_until
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14
        )
        `,
        [
          archiveId,
          command.legacyIdentityId,
          command.ownerScopeKind,
          command.ownerScopeId,
          command.rClass,
          command.reason,
          sourceChecksum,
          graphChecksum,
          encryptedObjectRef,
          JSON.stringify(command.protectedReferences),
          command.cutoverRunId,
          command.catalogReleaseId,
          command.successAuditRef,
          command.retainUntil,
        ],
      );

      maybeInject(options.failAfter, "metadata-without-object");

      await objectStore.putExclusive(encryptedObjectRef, envelope);
      objectWritten = true;

      maybeInject(options.failAfter, "before-commit");

      await client.query("commit");
      const success: PersistArchiveSuccess = {
        status: "archived",
        archiveId,
        sourceChecksum,
        graphChecksum,
        encryptedObjectRef,
      };
      return { ok: true, value: success };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      if (objectWritten) {
        await objectStore.remove(encryptedObjectRef).catch(() => undefined);
      }
      if (error instanceof ArchivePlaintextLeak) {
        return persistFail("PCAT-ARC-PLAINTEXT-LEAK", "refusing to persist plaintext archive bytes");
      }
      if (error instanceof ArchiveInjectedFailure) {
        return persistFail("PCAT-ARC-ATOMICITY", error.message);
      }
      if (error instanceof ArchiveCryptoError) {
        return persistFail("PCAT-ARC-INTEGRITY", error.message);
      }
      const detail = error instanceof Error ? error.message : "archive persist failed";
      return persistFail("PCAT-ARC-ATOMICITY", detail);
    }
  };

  const restoreArchive = async (
    command: RestoreArchiveCommand,
  ): Promise<ArchiveRestoreResult> => {
    const auth = authorizeOperator(command.actor, command.actor.auditRef, "restore");
    if (auth) return restoreFail(auth.code, auth.detail);

    const archiveId = command.archiveId?.trim();
    const legacyIdentityId = command.legacyIdentityId?.trim();
    const cutoverRunId = command.cutoverRunId?.trim();
    if (!archiveId && !(legacyIdentityId && cutoverRunId)) {
      return restoreFail("PCAT-ARC-INVALID-INPUT", "restore requires archive id or identity+run");
    }

    const loaded = archiveId
      ? await client.query<ArchiveRow>(
          `
          select
            id, legacy_identity_id, owner_scope_kind, owner_scope_id, r_class, reason,
            source_checksum, graph_checksum, encrypted_object_ref, protected_references,
            cutover_run_id, catalog_release_id, success_audit_ref, retain_until
          from ${ARCHIVES_RELATION}
          where id = $1
          `,
          [archiveId],
        )
      : await client.query<ArchiveRow>(
          `
          select
            id, legacy_identity_id, owner_scope_kind, owner_scope_id, r_class, reason,
            source_checksum, graph_checksum, encrypted_object_ref, protected_references,
            cutover_run_id, catalog_release_id, success_audit_ref, retain_until
          from ${ARCHIVES_RELATION}
          where legacy_identity_id = $1 and cutover_run_id = $2
          `,
          [legacyIdentityId, cutoverRunId],
        );

    const row = loaded.rows[0];
    if (!row || loaded.rows.length !== 1) {
      return restoreFail("PCAT-ARC-NOT-FOUND", "archive metadata was not found");
    }
    if (legacyIdentityId && row.legacy_identity_id !== legacyIdentityId) {
      return restoreFail("PCAT-ARC-NOT-FOUND", "archive identity does not match the restore request");
    }
    if (cutoverRunId && row.cutover_run_id !== cutoverRunId) {
      return restoreFail("PCAT-ARC-NOT-FOUND", "archive run does not match the restore request");
    }

    const protectedReferences = asProtectedReferences(row.protected_references);
    if (!protectedReferences) {
      return restoreFail("PCAT-ARC-INTEGRITY", "archive protected references are not a typed array");
    }

    let envelope: Buffer;
    try {
      envelope = await objectStore.get(row.encrypted_object_ref);
    } catch {
      return restoreFail("PCAT-ARC-INTEGRITY", "encrypted archive object is missing or unreadable");
    }

    let plaintext: Buffer;
    try {
      plaintext = decryptArchiveObject({
        key: encryptionKey,
        aad: buildArchiveAad({
          archiveId: row.id,
          legacyIdentityId: row.legacy_identity_id,
          cutoverRunId: row.cutover_run_id,
          sourceChecksum: row.source_checksum,
          graphChecksum: row.graph_checksum,
        }),
        envelope,
      });
    } catch (error) {
      if (error instanceof ArchiveCryptoError && error.kind === "truncated") {
        return restoreFail("PCAT-ARC-INTEGRITY", "truncated archive object");
      }
      return restoreFail("PCAT-ARC-INTEGRITY", "archive object integrity failure");
    }

    const sourceGraph = parseSourceGraph(plaintext);
    if (!sourceGraph) {
      return restoreFail("PCAT-ARC-INTEGRITY", "archive object payload is not a source graph");
    }

    const sourceChecksum = checksumContract(sourceGraph.sourcePayload);
    const graphChecksum = archiveGraphChecksum({
      relationGraph: sourceGraph.relationGraph,
      protectedReferences,
    });
    if (sourceChecksum !== row.source_checksum || graphChecksum !== row.graph_checksum) {
      return restoreFail("PCAT-ARC-CHECKSUM-MISMATCH", "archive checksums do not match the restored graph");
    }

    return {
      ok: true,
      value: {
        metadata: metadataFromRow(row, protectedReferences),
        sourceGraph,
      },
    };
  };

  return { persistArchive, restoreArchive };
};
