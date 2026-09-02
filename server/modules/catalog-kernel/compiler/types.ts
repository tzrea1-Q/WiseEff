import type {
  CatalogReleaseCounts,
  CatalogReleaseIdentity,
  CatalogReleasePin,
  Result,
} from "../../parameter-catalog-contract/index";
import type {
  CatalogKernelError,
  CatalogReleaseDigest,
  CatalogMaterializationFingerprint,
  ContractJsonValue,
} from "../../parameter-catalog-contract/index";

export interface CatalogReleaseSourceReference {
  readonly path: string;
  readonly mediaType: "application/yaml";
  readonly digest: string;
}

export interface CatalogReleaseProvenance {
  readonly source: string;
  readonly sourceDigest?: string;
  readonly reviewReference?: string;
}

export interface CatalogReleaseTombstone {
  readonly reason: string;
  readonly withdrawnByReleaseId: string;
  readonly previousSelector: string;
  readonly successorId?: string;
}

export interface CatalogReleaseSubjectDocument {
  readonly source: CatalogReleaseSourceReference;
  readonly kind: "subject";
  readonly normalizedDigest: string;
  readonly content: {
    readonly id: string;
    readonly kind: "driver" | "node-type";
    readonly canonicalKey: string;
    readonly lifecycle: "active" | "retired";
    readonly selector: {
      readonly kind: "driver-compatible" | "node-type-name";
      readonly value: string;
      readonly provenance: CatalogReleaseProvenance;
    };
    readonly subtype:
      | {
          readonly nature: "physical-device" | "logical-service";
          readonly cardinality: {
            readonly kind: "multiple" | "singleton-per-project";
          };
        }
      | Readonly<Record<never, never>>;
    readonly tombstone: CatalogReleaseTombstone | null;
  };
}

export interface CatalogReleaseAliasDocument {
  readonly source: CatalogReleaseSourceReference;
  readonly kind: "alias";
  readonly normalizedDigest: string;
  readonly content: {
    readonly id: string;
    readonly subjectId: string;
    readonly selectorKind: "driver-compatible" | "node-type-name";
    readonly normalizedSelector: string;
    readonly lifecycle: "active" | "retired";
    readonly selectorProvenance: CatalogReleaseProvenance;
    readonly tombstone: CatalogReleaseTombstone | null;
  };
}

export interface CatalogReleaseDefinitionDocument {
  readonly source: CatalogReleaseSourceReference;
  readonly kind: "definition";
  readonly normalizedDigest: string;
  readonly content: {
    readonly id: string;
    readonly subjectId: string;
    readonly propertyKey: string;
    readonly revision: {
      readonly id: string;
      readonly number: number;
      readonly contentDigest: string;
      readonly lifecycle: "active" | "deprecated" | "retired";
      readonly successorDefinitionId?: string;
      readonly displayName: string;
      readonly documentation: string;
      readonly unit?: string;
      readonly valueSchema: Readonly<Record<string, ContractJsonValue>>;
      readonly matching: {
        readonly sourceProperty: string;
        readonly selectorKind: "driver-compatible" | "node-type-name";
        readonly notes?: string;
      };
      readonly examples?: readonly ContractJsonValue[];
    };
  };
}

export type CatalogReleaseDocument =
  | CatalogReleaseSubjectDocument
  | CatalogReleaseAliasDocument
  | CatalogReleaseDefinitionDocument;

export interface CatalogReleaseNode {
  readonly manifest: {
    readonly schemaVersion: string;
    readonly release: {
      readonly id: string;
      readonly version: string;
      readonly sequence: number;
      readonly publishedAt: string;
      readonly digest: string;
      readonly predecessor: null | {
        readonly id: string;
        readonly digest: string;
      };
    };
    readonly toolchain: {
      readonly compiler: string;
      readonly jsonSchemaDialect: string;
      readonly sourceFormat: string;
    };
    readonly files: readonly CatalogReleaseSourceReference[];
    readonly documents: readonly {
      readonly sourcePath: string;
      readonly kind: CatalogReleaseDocument["kind"];
      readonly documentId: string;
      readonly normalizedDigest: string;
    }[];
  };
  readonly sources: readonly {
    readonly path: string;
    readonly mediaType: "application/yaml";
    readonly encoding: "base64";
    readonly bytes: string;
  }[];
  readonly documents: readonly CatalogReleaseDocument[];
}

export interface CatalogReleaseBundle {
  readonly schemaVersion: string;
  readonly targetReleaseId: string;
  readonly releases: readonly CatalogReleaseNode[];
}

export interface CompiledCatalogReleaseModel {
  readonly schemaVersion: "1.0.0";
  readonly compilerContractFingerprint: string;
  readonly targetReleaseId: string;
  readonly toolchainDigest: string;
  readonly releases: readonly {
    readonly release: CatalogReleaseNode["manifest"]["release"];
    readonly toolchain: CatalogReleaseNode["manifest"]["toolchain"];
    readonly files: CatalogReleaseNode["manifest"]["files"];
    readonly documents: CatalogReleaseNode["documents"];
  }[];
}

export interface CompiledCatalogRelease {
  readonly release: CatalogReleaseIdentity;
  readonly predecessor: CatalogReleasePin | null;
  readonly aggregateDigest: CatalogReleaseDigest;
  readonly compiledReleaseDigest: CatalogReleaseDigest;
  readonly toolchainDigest: CatalogReleaseDigest;
  readonly materializationFingerprint: CatalogMaterializationFingerprint;
  readonly counts: CatalogReleaseCounts;
  readonly model: CompiledCatalogReleaseModel;
  readonly bytes: string;
}

export type CompileCatalogReleaseResult = Result<
  CompiledCatalogRelease,
  Extract<CatalogKernelError, { readonly kind: "invalid-release" }>
>;
