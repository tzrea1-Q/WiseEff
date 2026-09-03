import pg from "pg";

import { compileCatalogRelease } from "./compiler/index";
import type { CatalogReleaseBundle } from "./compiler/types";
import {
  type CatalogKernelError,
  type CatalogKernelOperation,
  type CatalogMaterializationFingerprint,
  type CatalogReleaseIdentity,
  type CatalogReleasePin,
  type OptionalValue,
  type Result,
  CatalogAliasId,
  CatalogCanonicalKey,
  CatalogCursor,
  CatalogEventTime,
  CatalogPageLimit,
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogReleaseSequence,
  CatalogSearchText,
  CatalogSubjectId,
  CatalogTimelineFactId,
  DefinitionRevisionId,
  ParameterDefinitionId,
} from "../parameter-catalog-contract/index";
import { loadCurrentCatalogSnapshot } from "./runtime/currentSnapshot";
import { loadPinnedCatalogSnapshot } from "./runtime/pinnedSnapshot";

export type {
  CatalogKernelError,
  CatalogReleaseIdentity,
  CatalogReleasePin,
  OptionalValue,
  Result,
};

type KernelBrand<Name extends string> = string & { readonly __s3RunBrand: Name };

export type DriverCompatible = KernelBrand<"DriverCompatible">;
export type NormalizedNodeTypeName = KernelBrand<"NormalizedNodeTypeName">;
export type PropertyKey = KernelBrand<"PropertyKey">;
export type DefinitionContentDigest = KernelBrand<"DefinitionContentDigest">;

export const DriverCompatible = (value: string): DriverCompatible =>
  value as DriverCompatible;
export const NormalizedNodeTypeName = (value: string): NormalizedNodeTypeName =>
  value as NormalizedNodeTypeName;
export const PropertyKey = (value: string): PropertyKey => value as PropertyKey;

export type CatalogSubjectKind = "driver" | "node-type";
export type SubjectLifecycle = "active" | "retired";
export type DefinitionLifecycle = "active" | "deprecated" | "retired";

export type ParameterValueShape = {
  readonly kind: "json-schema";
  readonly schema: Readonly<Record<string, unknown>>;
};

export type ParameterConstraints = {
  readonly kind: "none";
};

export type UnitDescriptor = {
  readonly kind: "symbol";
  readonly symbol: string;
};

export type ParameterValue = Readonly<Record<string, unknown>> | string | number | boolean | null;

export type DefinitionMatchingMetadata = {
  readonly sourceProperty: string;
  readonly selectorKind: "driver-compatible" | "node-type-name";
  readonly notes: OptionalValue<string>;
};

export interface CatalogReleaseSource {
  readManifest(): Promise<Uint8Array>;
  listEntries(): Promise<readonly string[]>;
  readEntry(path: string): Promise<Uint8Array>;
}

export interface CatalogPageRequest {
  readonly limit: CatalogPageLimit;
  readonly after: OptionalValue<CatalogCursor>;
}

export interface CatalogPage<T> {
  readonly items: readonly T[];
  readonly next: OptionalValue<CatalogCursor>;
  readonly release: CatalogReleaseIdentity;
}

export type CatalogPageFailure = {
  readonly status: "invalid-page";
  readonly reason: "cursor-malformed" | "release-mismatch" | "query-mismatch";
};

export type CatalogIdSelection<Id> =
  | { readonly kind: "all" }
  | {
      readonly kind: "only";
      readonly ids: readonly Id[];
      readonly fingerprint: string;
    };

export type CatalogSubjectSelectorSnapshot =
  | {
      readonly kind: "driver-compatible";
      readonly values: readonly DriverCompatible[];
    }
  | {
      readonly kind: "node-type-name";
      readonly value: NormalizedNodeTypeName;
    };

export interface CatalogTombstoneSummary {
  readonly reason: string;
  readonly successorSubjectId: OptionalValue<CatalogSubjectId>;
}

export interface CatalogSubjectMembershipSnapshot {
  readonly release: CatalogReleaseIdentity;
  readonly lifecycle: SubjectLifecycle;
  readonly selector: CatalogSubjectSelectorSnapshot;
  readonly tombstone: OptionalValue<CatalogTombstoneSummary>;
}

export interface CatalogAliasMembershipSnapshot {
  readonly release: CatalogReleaseIdentity;
  readonly lifecycle: SubjectLifecycle;
  readonly tombstone: OptionalValue<CatalogTombstoneSummary>;
}

export interface SubjectAliasSnapshot {
  readonly id: CatalogAliasId;
  readonly selector:
    | { readonly kind: "driver-compatible"; readonly value: DriverCompatible }
    | { readonly kind: "node-type-name"; readonly value: NormalizedNodeTypeName };
  readonly subjectId: CatalogSubjectId;
  readonly membership: CatalogAliasMembershipSnapshot;
}

export interface CatalogSubjectSnapshot {
  readonly id: CatalogSubjectId;
  readonly kind: CatalogSubjectKind;
  readonly canonicalKey: CatalogCanonicalKey;
  readonly membership: CatalogSubjectMembershipSnapshot;
}

export interface DefinitionLifecycleCounts {
  readonly active: number;
  readonly deprecated: number;
  readonly retired: number;
}

export interface CatalogSubjectDetailSnapshot extends CatalogSubjectSnapshot {
  readonly aliases: readonly SubjectAliasSnapshot[];
  readonly definitionCounts: DefinitionLifecycleCounts;
}

export interface DefinitionContent {
  readonly lifecycle: DefinitionLifecycle;
  readonly displayName: string;
  readonly description: OptionalValue<string>;
  readonly documentation: OptionalValue<string>;
  readonly valueShape: ParameterValueShape;
  readonly constraints: ParameterConstraints;
  readonly unit: OptionalValue<UnitDescriptor>;
  readonly schemaDefault: OptionalValue<ParameterValue>;
  readonly examples: readonly ParameterValue[];
  readonly matching: DefinitionMatchingMetadata;
}

export interface DefinitionRevisionSnapshot {
  readonly id: DefinitionRevisionId;
  readonly definitionId: ParameterDefinitionId;
  readonly revisionNumber: number;
  readonly contentDigest: DefinitionContentDigest;
  readonly publishedIn: CatalogReleaseIdentity;
  readonly content: Readonly<DefinitionContent>;
}

export interface ParameterDefinitionSnapshot {
  readonly id: ParameterDefinitionId;
  readonly subjectId: CatalogSubjectId;
  readonly propertyKey: PropertyKey;
  readonly selectedRevision: DefinitionRevisionSnapshot;
}

export type DefinitionPublicationChange =
  | "introduced"
  | "content"
  | "documentation"
  | "lifecycle";

export interface CatalogDefinitionPublicationFact {
  readonly id: CatalogTimelineFactId;
  readonly definitionId: ParameterDefinitionId;
  readonly revisionId: DefinitionRevisionId;
  readonly revisionNumber: number;
  readonly release: CatalogReleaseIdentity;
  readonly releaseSequence: CatalogReleaseSequence;
  readonly publishedAt: CatalogEventTime;
  readonly previousRevisionId: OptionalValue<DefinitionRevisionId>;
  readonly changes: readonly DefinitionPublicationChange[];
}

export interface SubjectSelector {
  readonly driverCompatibles: readonly DriverCompatible[];
  readonly nodeTypeFallback:
    | { readonly kind: "present"; readonly name: NormalizedNodeTypeName }
    | { readonly kind: "absent" };
}

export interface SubjectListQuery {
  readonly selection: CatalogIdSelection<CatalogSubjectId>;
  readonly kinds: readonly CatalogSubjectKind[];
  readonly lifecycles: readonly SubjectLifecycle[];
  readonly search: OptionalValue<CatalogSearchText>;
  readonly page: CatalogPageRequest;
}

export type DefinitionListScope =
  | { readonly kind: "all" }
  | { readonly kind: "subject"; readonly subjectId: CatalogSubjectId };

export interface DefinitionListQuery {
  readonly selection: CatalogIdSelection<ParameterDefinitionId>;
  readonly scope: DefinitionListScope;
  readonly lifecycles: readonly DefinitionLifecycle[];
  readonly propertyKey: OptionalValue<PropertyKey>;
  readonly search: OptionalValue<CatalogSearchText>;
  readonly page: CatalogPageRequest;
}

export interface DefinitionRevisionListQuery {
  readonly definitionId: ParameterDefinitionId;
  readonly page: CatalogPageRequest;
}

export interface DefinitionTimelineQuery {
  readonly definitionId: ParameterDefinitionId;
  readonly page: CatalogPageRequest;
}

export type MatchResult =
  | {
      readonly status: "matched";
      readonly subject: CatalogSubjectSnapshot;
      readonly matchedBy: "canonical-selector" | "alias";
      readonly alias: SubjectAliasSnapshot | null;
    }
  | { readonly status: "unknown"; readonly reason: "no-candidate" }
  | {
      readonly status: "ambiguous";
      readonly candidates: readonly CatalogSubjectSnapshot[];
    }
  | {
      readonly status: "retired";
      readonly subject: CatalogSubjectSnapshot;
      readonly alias: SubjectAliasSnapshot | null;
    }
  | {
      readonly status: "not-published";
      readonly firstPublishedIn: CatalogReleaseIdentity;
      readonly subjectId: CatalogSubjectId;
    };

export type SubjectLookupResult =
  | { readonly status: "found"; readonly subject: CatalogSubjectDetailSnapshot }
  | { readonly status: "unknown"; readonly target: "subject" }
  | {
      readonly status: "retired";
      readonly subject: CatalogSubjectDetailSnapshot;
    }
  | {
      readonly status: "not-published";
      readonly subjectId: CatalogSubjectId;
      readonly firstPublishedIn: CatalogReleaseIdentity;
    };

export type SubjectListResult =
  | { readonly status: "found"; readonly page: CatalogPage<CatalogSubjectSnapshot> }
  | CatalogPageFailure;

export type DefinitionLookupResult =
  | { readonly status: "found"; readonly definition: ParameterDefinitionSnapshot }
  | { readonly status: "unknown"; readonly target: "subject" | "property" | "definition" }
  | {
      readonly status: "retired";
      readonly target: "subject" | "definition";
      readonly definition: ParameterDefinitionSnapshot;
    }
  | {
      readonly status: "not-published";
      readonly target: "subject" | "definition";
      readonly firstPublishedIn: CatalogReleaseIdentity;
    };

export type DefinitionListResult =
  | {
      readonly status: "found";
      readonly scope: DefinitionListScope;
      readonly page: CatalogPage<ParameterDefinitionSnapshot>;
    }
  | { readonly status: "unknown"; readonly target: "subject" }
  | {
      readonly status: "retired";
      readonly subject: CatalogSubjectSnapshot;
      readonly page: CatalogPage<ParameterDefinitionSnapshot>;
    }
  | {
      readonly status: "not-published";
      readonly subjectId: CatalogSubjectId;
      readonly firstPublishedIn: CatalogReleaseIdentity;
    }
  | CatalogPageFailure;

export type DefinitionRevisionLookupResult =
  | { readonly status: "found"; readonly revision: DefinitionRevisionSnapshot }
  | { readonly status: "unknown"; readonly target: "definition" }
  | {
      readonly status: "not-published";
      readonly definitionId: ParameterDefinitionId;
      readonly firstPublishedIn: CatalogReleaseIdentity;
    }
  | {
      readonly status: "revision-unavailable";
      readonly definitionId: ParameterDefinitionId;
      readonly revisionId: DefinitionRevisionId;
      readonly reason: "not-in-snapshot" | "not-owned-by-definition" | "unknown-revision";
    };

export type DefinitionRevisionListResult =
  | {
      readonly status: "found";
      readonly definition: ParameterDefinitionSnapshot;
      readonly page: CatalogPage<DefinitionRevisionSnapshot>;
    }
  | { readonly status: "unknown"; readonly target: "definition" }
  | {
      readonly status: "not-published";
      readonly definitionId: ParameterDefinitionId;
      readonly firstPublishedIn: CatalogReleaseIdentity;
    }
  | CatalogPageFailure;

export type DefinitionTimelineResult =
  | {
      readonly status: "found";
      readonly definition: ParameterDefinitionSnapshot;
      readonly page: CatalogPage<CatalogDefinitionPublicationFact>;
    }
  | { readonly status: "unknown"; readonly target: "definition" }
  | {
      readonly status: "not-published";
      readonly definitionId: ParameterDefinitionId;
      readonly firstPublishedIn: CatalogReleaseIdentity;
    }
  | CatalogPageFailure;

export interface CatalogSnapshot {
  readonly release: CatalogReleaseIdentity;
  getSubject(subjectId: CatalogSubjectId): SubjectLookupResult;
  listSubjects(query: SubjectListQuery): SubjectListResult;
  resolveSubject(selector: SubjectSelector): MatchResult;
  getDefinition(input: {
    readonly subjectId: CatalogSubjectId;
    readonly propertyKey: PropertyKey;
  }): DefinitionLookupResult;
  getDefinitionById(definitionId: ParameterDefinitionId): DefinitionLookupResult;
  listDefinitions(query: DefinitionListQuery): DefinitionListResult;
  getDefinitionRevision(input: {
    readonly definitionId: ParameterDefinitionId;
    readonly revisionId: DefinitionRevisionId;
  }): DefinitionRevisionLookupResult;
  listDefinitionRevisions(query: DefinitionRevisionListQuery): DefinitionRevisionListResult;
  listDefinitionTimelineFacts(query: DefinitionTimelineQuery): DefinitionTimelineResult;
}

export interface CurrentCatalogSnapshot extends CatalogSnapshot {
  readonly snapshotKind: "current";
  readonly materializationFingerprint: CatalogMaterializationFingerprint;
}

export interface PinnedCatalogSnapshot extends CatalogSnapshot {
  readonly snapshotKind: "pinned";
  readonly pin: CatalogReleasePin;
}

export type InstallPublishedReleaseCommand =
  | {
      readonly mode: "bootstrap";
      readonly source: CatalogReleaseSource;
      readonly expectedTargetDigest: CatalogReleaseDigest;
    }
  | {
      readonly mode: "advance";
      readonly source: CatalogReleaseSource;
      readonly expectedCurrent: CatalogReleasePin;
      readonly expectedTargetDigest: CatalogReleaseDigest;
    };

export interface PreTrafficSwitchBackCommand {
  readonly maintenanceAttemptId: string;
  readonly expectedCurrent: CatalogReleasePin;
  readonly targetPrevious: CatalogReleasePin;
}

export interface VerifyCurrentMaterializationCommand {
  readonly source: CatalogReleaseSource;
  readonly expected: CatalogReleasePin;
}

export interface CatalogKernel {
  compilePublishedRelease(
    source: CatalogReleaseSource,
  ): Promise<Result<import("./compiler/types").CompiledCatalogRelease, CatalogKernelError>>;
  installPublishedRelease(
    command: InstallPublishedReleaseCommand,
  ): Promise<Result<never, CatalogKernelError>>;
  switchBackBeforeTraffic(
    command: PreTrafficSwitchBackCommand,
  ): Promise<Result<never, CatalogKernelError>>;
  verifyCurrentMaterialization(
    command: VerifyCurrentMaterializationCommand,
  ): Promise<Result<never, CatalogKernelError>>;
  loadCurrentCatalog(
    expected: CatalogReleasePin,
  ): Promise<Result<CurrentCatalogSnapshot, CatalogKernelError>>;
  loadPinnedCatalog(
    pin: CatalogReleasePin,
  ): Promise<Result<PinnedCatalogSnapshot, CatalogKernelError>>;
}

export type CatalogRuntime = Pick<CatalogKernel, "loadCurrentCatalog" | "loadPinnedCatalog">;
export type CatalogMaintainer = Pick<
  CatalogKernel,
  "compilePublishedRelease" | "installPublishedRelease" | "switchBackBeforeTraffic"
>;
export type CatalogVerifier = Pick<
  CatalogKernel,
  "compilePublishedRelease" | "verifyCurrentMaterialization" | "loadPinnedCatalog"
>;

const permissionDenied = (
  operation: CatalogKernelOperation,
): Result<never, CatalogKernelError> => ({
  ok: false,
  error: { kind: "permission-denied", operation },
});

const parseBundle = async (source: CatalogReleaseSource): Promise<CatalogReleaseBundle> => {
  const manifest = new TextDecoder().decode(await source.readManifest());
  return JSON.parse(manifest) as CatalogReleaseBundle;
};

export const jsonCatalogReleaseSource = (
  bundle: CatalogReleaseBundle,
): CatalogReleaseSource => ({
  async readManifest() {
    return new TextEncoder().encode(JSON.stringify(bundle));
  },
  async listEntries() {
    return [];
  },
  async readEntry() {
    throw new Error("jsonCatalogReleaseSource does not expose individual entries");
  },
});

export const createCatalogKernel = (pool: pg.Pool): CatalogKernel => ({
  async compilePublishedRelease(source) {
    try {
      const bundle = await parseBundle(source);
      return compileCatalogRelease(bundle);
    } catch (error) {
      return {
        ok: false,
        error: {
          kind: "invalid-release",
          phase: "source",
          violations: [
            {
              code: "manifest-unreadable",
              location: { kind: "present", value: "manifest" },
              subjectId: { kind: "absent" },
              detail: error instanceof Error ? error.message : "catalog-release-source-unreadable",
            },
          ],
        },
      };
    }
  },
  async installPublishedRelease() {
    return permissionDenied("installPublishedRelease");
  },
  async switchBackBeforeTraffic() {
    return permissionDenied("switchBackBeforeTraffic");
  },
  async verifyCurrentMaterialization() {
    return permissionDenied("verifyCurrentMaterialization");
  },
  async loadCurrentCatalog(expected) {
    return loadCurrentCatalogSnapshot(pool, expected);
  },
  async loadPinnedCatalog(pin) {
    return loadPinnedCatalogSnapshot(pool, pin);
  },
});

export {
  CatalogAliasId,
  CatalogCanonicalKey,
  CatalogCursor,
  CatalogEventTime,
  CatalogPageLimit,
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogReleaseSequence,
  CatalogSearchText,
  CatalogSubjectId,
  CatalogTimelineFactId,
  DefinitionRevisionId,
  ParameterDefinitionId,
};
