import type { CatalogInstallMode, CatalogVerificationCheckCode } from "./enums";
import type {
  CatalogMaterializationFingerprint,
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogReleaseVersion,
  MaintenanceAttemptId
} from "./ids";

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export type OptionalValue<T> =
  | { readonly kind: "present"; readonly value: T }
  | { readonly kind: "absent" };

export interface CatalogReleaseIdentity {
  readonly id: CatalogReleaseId;
  readonly version: CatalogReleaseVersion;
  readonly digest: CatalogReleaseDigest;
}

export interface CatalogReleasePin {
  readonly id: CatalogReleaseId;
  readonly digest: CatalogReleaseDigest;
}

export interface CatalogReleaseCounts {
  readonly subjects: number;
  readonly subjectMemberships: number;
  readonly aliases: number;
  readonly aliasMemberships: number;
  readonly definitions: number;
  readonly definitionRevisions: number;
}

export type InstallResult =
  | {
      readonly status: "installed";
      readonly mode: CatalogInstallMode;
      readonly previous: CatalogReleasePin | null;
      readonly current: CatalogReleaseIdentity;
      readonly materializationFingerprint: CatalogMaterializationFingerprint;
      readonly counts: CatalogReleaseCounts;
    }
  | {
      readonly status: "already-current";
      readonly current: CatalogReleaseIdentity;
      readonly materializationFingerprint: CatalogMaterializationFingerprint;
      readonly counts: CatalogReleaseCounts;
    };

export interface SwitchBackResult {
  readonly status: "switched-back";
  readonly maintenanceAttemptId: MaintenanceAttemptId;
  readonly previousCurrent: CatalogReleaseIdentity;
  readonly current: CatalogReleaseIdentity;
  readonly materializationFingerprint: CatalogMaterializationFingerprint;
}

export interface CatalogVerificationCheck {
  readonly code: CatalogVerificationCheckCode;
  readonly status: "passed";
}

export interface VerificationResult {
  readonly status: "verified";
  readonly release: CatalogReleaseIdentity;
  readonly materializationFingerprint: CatalogMaterializationFingerprint;
  readonly verifiedAt: string;
  readonly checks: readonly CatalogVerificationCheck[];
  readonly counts: CatalogReleaseCounts;
}

export type ContractJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ContractJsonValue[]
  | { readonly [key: string]: ContractJsonValue };

const canonicalize = (value: ContractJsonValue): ContractJsonValue => {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Contract serialization requires finite numbers");
    }
    return value;
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  const objectValue = value as { readonly [key: string]: ContractJsonValue };
  const sorted: Record<string, ContractJsonValue> = {};
  for (const key of Object.keys(objectValue).sort()) {
    sorted[key] = canonicalize(objectValue[key]);
  }
  return sorted;
};

export const serializeContract = (value: ContractJsonValue): string =>
  `${JSON.stringify(canonicalize(value), null, 2)}\n`;
