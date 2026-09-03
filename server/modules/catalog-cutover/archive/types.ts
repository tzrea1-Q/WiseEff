import type { QueryResult, QueryResultRow } from "pg";

import type { ContractJsonValue, Result } from "../../parameter-catalog-contract/index";
import type { OwnerScopeKind, RClass } from "../classifier/types";

export type ArchiveQueryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
};

export type ArchiveRole =
  | "cutover-operator"
  | "public"
  | "governance-writer"
  | "verifier"
  | "synchronizer";

export type ArchiveActor = {
  readonly role: ArchiveRole;
  readonly auditRef?: string;
};

export type ArchiveProtectedReference = {
  readonly kind: string;
  readonly id: string;
};

export type ArchiveSourceGraph = {
  readonly sourcePayload: ContractJsonValue;
  readonly relationGraph: ContractJsonValue;
};

export type PersistArchiveCommand = {
  readonly actor: ArchiveActor;
  readonly legacyIdentityId: string;
  readonly ownerScopeKind: OwnerScopeKind;
  readonly ownerScopeId: string;
  readonly rClass: RClass;
  readonly reason: string;
  readonly sourceGraph: ArchiveSourceGraph;
  readonly protectedReferences: readonly ArchiveProtectedReference[];
  readonly cutoverRunId: string;
  readonly catalogReleaseId: string;
  readonly successAuditRef: string;
  readonly retainUntil: Date;
};

export type PersistArchiveSuccess = {
  readonly status: "archived" | "already-archived";
  readonly archiveId: string;
  readonly sourceChecksum: string;
  readonly graphChecksum: string;
  readonly encryptedObjectRef: string;
};

export type RestoreArchiveCommand = {
  readonly actor: ArchiveActor;
  readonly archiveId?: string;
  readonly legacyIdentityId?: string;
  readonly cutoverRunId?: string;
};

export type ArchiveMetadata = {
  readonly archiveId: string;
  readonly legacyIdentityId: string;
  readonly ownerScopeKind: OwnerScopeKind;
  readonly ownerScopeId: string;
  readonly rClass: RClass;
  readonly reason: string;
  readonly sourceChecksum: string;
  readonly graphChecksum: string;
  readonly encryptedObjectRef: string;
  readonly protectedReferences: readonly ArchiveProtectedReference[];
  readonly cutoverRunId: string;
  readonly catalogReleaseId: string;
  readonly successAuditRef: string;
  readonly retainUntil: Date;
};

export type RestoreArchiveSuccess = {
  readonly metadata: ArchiveMetadata;
  readonly sourceGraph: ArchiveSourceGraph;
};

export type ArchiveFailureCode =
  | "PCAT-ARC-PERMISSION-DENIED"
  | "PCAT-ARC-DISPOSITION-NOT-ARCHIVED"
  | "PCAT-ARC-PLAINTEXT-LEAK"
  | "PCAT-ARC-ATOMICITY"
  | "PCAT-ARC-CHECKSUM-MISMATCH"
  | "PCAT-ARC-INTEGRITY"
  | "PCAT-ARC-CONFLICT"
  | "PCAT-ARC-NOT-FOUND"
  | "PCAT-ARC-INVALID-INPUT";

export type ArchiveFailure = {
  readonly code: ArchiveFailureCode;
  readonly detail: string;
};

export type ArchivePersistResult = Result<PersistArchiveSuccess, ArchiveFailure>;
export type ArchiveRestoreResult = Result<RestoreArchiveSuccess, ArchiveFailure>;

export type ArchiveFailPoint =
  | "object-without-metadata"
  | "metadata-without-object"
  | "before-commit";

export type ArchiveObjectStore = {
  putExclusive(ref: string, bytes: Buffer): Promise<void>;
  get(ref: string): Promise<Buffer>;
  remove(ref: string): Promise<void>;
  exists(ref: string): Promise<boolean>;
  listRefs(): Promise<string[]>;
};

export type ArchiveAdapterOptions = {
  readonly client: ArchiveQueryable;
  readonly objectStore: ArchiveObjectStore;
  readonly encryptionKey: Buffer;
  readonly failAfter?: ArchiveFailPoint;
};

export type ArchiveAdapter = {
  persistArchive(command: PersistArchiveCommand): Promise<ArchivePersistResult>;
  restoreArchive(command: RestoreArchiveCommand): Promise<ArchiveRestoreResult>;
};
