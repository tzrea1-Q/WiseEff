import type pg from "pg";

import type {
  LegacyMappingSourceKind,
  Result,
} from "../../parameter-catalog-contract/index";
import type {
  ClassificationResult,
  OwnerScopeKind,
  RClass,
} from "../classifier";

export type MappingQueryable = Pick<pg.Client, "query">;

export const MAPPING_TARGET_KINDS = [
  "catalog-subject",
  "parameter-definition",
  "definition-revision",
  "subject-registration",
  "subject-placement",
  "parameter-binding",
  "project-value",
  "binding-history-event",
  "parameter-observation",
  "observation-match",
  "review-evidence",
  "review-item",
  "review-resolution",
  "definition-proposal",
  "definition-proposal-revision",
  "publication-intent",
  "policy",
  "audit-event",
  "migration-history",
] as const;
export type MappingTargetKind = (typeof MAPPING_TARGET_KINDS)[number];

export const MAPPING_FAILURE_CODES = [
  "PCAT-MAP-BLOCKED",
  "PCAT-MAP-APPEND-ONLY",
  "PCAT-MAP-CONFLICT",
  "PCAT-MAP-UNKNOWN-IDENTITY",
  "PCAT-MAP-CLASSIFICATION-GAP",
  "PCAT-MAP-UNMAPPED",
  "PCAT-MAP-TARGET-MISSING",
  "PCAT-MAP-TARGET-INCOMPATIBLE",
  "PCAT-MAP-WRITE-FAILED",
] as const;
export type MappingFailureCode = (typeof MAPPING_FAILURE_CODES)[number];

export type MappingFailure = {
  readonly code: MappingFailureCode;
  readonly detail: string;
};

export type MappingOutcome =
  | {
      readonly kind: "operational";
      readonly targetKind: MappingTargetKind;
      readonly targetId: string;
      readonly evidenceArchiveId?: string;
    }
  | {
      readonly kind: "archived";
      readonly archiveId: string;
      readonly evidenceArchiveId?: string;
    };

export type MappingHeadExpectation = {
  readonly casVersion: number;
  readonly versionId: string;
};

export type MappingVersion = {
  readonly id: string;
  readonly legacyIdentityId: string;
  readonly cutoverRunId: string;
  readonly versionNumber: number;
  readonly sourceChecksum: string;
  readonly graphFingerprint: string;
  readonly rClass: RClass;
  readonly targetKind: MappingTargetKind | null;
  readonly targetId: string | null;
  readonly archiveId: string | null;
  readonly evidenceArchiveId: string | null;
  readonly supersedesVersionId: string | null;
};

export type MappingHead = {
  readonly legacyIdentityId: string;
  readonly currentVersionId: string;
  readonly casVersion: number;
  readonly version: MappingVersion;
};

export type AppendMappingResult =
  | { readonly status: "appended"; readonly head: MappingHead }
  | { readonly status: "replayed"; readonly head: MappingHead }
  | {
      readonly status: "blocked";
      readonly identityId: string;
      readonly rClass: "R0";
      readonly invariant: string;
    };

export type AppendMappingInput = {
  readonly client: MappingQueryable;
  readonly cutoverRunId: string;
  readonly classification: ClassificationResult;
  readonly identityId: string;
  readonly sourceChecksum: string;
  readonly expectedHead: MappingHeadExpectation | null;
  readonly outcome: MappingOutcome;
};

export type ReadMappingHeadInput = {
  readonly client: MappingQueryable;
  readonly identityId: string;
};

export type ProtectedIdentityKey =
  | { readonly kind: "legacy-identity-id"; readonly id: string }
  | {
      readonly kind: "source-tuple";
      readonly sourceSystem: string;
      readonly sourceKind: LegacyMappingSourceKind;
      readonly ownerScopeKind: OwnerScopeKind;
      readonly ownerScopeId: string;
      readonly sourceId: string;
    };

export type LookupProtectedIdentityInput = {
  readonly client: MappingQueryable;
  readonly identity: ProtectedIdentityKey;
};

export type ProtectedLookupResult =
  | {
      readonly outcome: "mapped";
      readonly head: MappingHead;
      readonly targetKind: MappingTargetKind;
      readonly targetId: string;
    }
  | {
      readonly outcome: "archived";
      readonly head: MappingHead;
      readonly archiveId: string;
    }
  | {
      readonly outcome: "blocked";
      readonly identityId: string;
      readonly rClass: "R0";
    };

export type RewriteMappingVersionInput = {
  readonly client?: MappingQueryable;
  readonly versionId: string;
  readonly patch: {
    readonly targetKind?: MappingTargetKind | null;
    readonly targetId?: string | null;
    readonly archiveId?: string | null;
    readonly rClass?: RClass;
    readonly sourceChecksum?: string;
    readonly graphFingerprint?: string;
  };
};

export type MappingResult<T> = Result<T, MappingFailure>;
