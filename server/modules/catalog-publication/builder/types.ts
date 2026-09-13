import type {
  CanonicalIdentityFailureReason,
  CatalogArtifactId,
  CatalogCandidateId,
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogReleaseVersion,
  CatalogKernelError,
  ContractJsonValue,
  DefinitionProposalId,
  DefinitionProposalRevisionId,
  ParameterDefinitionId,
  DefinitionRevisionId,
  Result,
} from "../../parameter-catalog-contract/index";
import type { CatalogReleaseBundle } from "../../catalog-kernel/compiler/types";
import type { Database, Queryable } from "../../../shared/database/client";
import type {
  CatalogPublicationStoreError,
  JsonObject,
  PersistArtifactInput,
  PersistCandidateInput,
  PublicationCandidateRecord,
  ReleaseArtifactRecord,
} from "../persistence/types";

export const CATALOG_CAPABILITY_CONTRACT_REVISION = "catalog-capability/v1" as const;

export const M1_VALUE_SCHEMA_TYPES = ["integer", "number", "string"] as const;
export type M1ValueSchemaType = (typeof M1_VALUE_SCHEMA_TYPES)[number];

export const M1_ALLOWED_UNITS = ["mA", "mV", "ms", "uOhm"] as const;
export type M1AllowedUnit = (typeof M1_ALLOWED_UNITS)[number];

export type SupportedIntegerSchema = {
  readonly type: "integer";
  readonly minimum?: number;
  readonly maximum?: number;
};

export type SupportedNumberSchema = {
  readonly type: "number";
  readonly minimum?: number;
  readonly maximum?: number;
};

export type SupportedStringSchema = {
  readonly type: "string";
};

export type SupportedValueSchema =
  | SupportedIntegerSchema
  | SupportedNumberSchema
  | SupportedStringSchema;

export type SupportedDefinitionContent = {
  readonly displayName: string;
  readonly documentation: string;
  readonly unit?: M1AllowedUnit;
  readonly valueSchema: SupportedValueSchema;
  readonly examples?: readonly (number | string)[];
};

export type CreateDefinitionChange = {
  readonly op: "create-definition";
  readonly subjectId: string;
  readonly propertyKey: string;
  readonly content: SupportedDefinitionContent;
};

export type NestedDefinitionDraft = {
  readonly propertyKey: string;
  readonly content: SupportedDefinitionContent;
};

export type DriverNature = "physical-device" | "logical-service";
export type DriverCardinality = "multiple" | "singleton-per-project";

export type CreateSubjectWithDefinitionsChange = {
  readonly op: "create-subject-with-definitions";
  readonly kind: "driver" | "node-type";
  readonly canonicalKey: string;
  readonly selector: {
    readonly kind: "driver-compatible" | "node-type-name";
    readonly value: string;
  };
  readonly nature?: DriverNature;
  readonly cardinality?: DriverCardinality;
  readonly definitions: readonly NestedDefinitionDraft[];
};

export type ReviseDefinitionChange = {
  readonly op: "revise-definition";
  readonly definitionId: string;
  readonly class: "documentation" | "semantic";
  readonly content: SupportedDefinitionContent;
};

export type CatalogChange =
  | CreateDefinitionChange
  | CreateSubjectWithDefinitionsChange
  | ReviseDefinitionChange;

export type BuilderProductPath = "m1" | "m2-core";

export type FrozenToolchain = {
  readonly compiler: string;
  readonly jsonSchemaDialect: string;
  readonly sourceFormat: string;
};

export type FrozenDefinitionAllocation = {
  readonly subjectId: string;
  readonly propertyKey: string;
  readonly definitionId: string;
  readonly revisionId: string;
};

export type FrozenSubjectAllocation = {
  readonly canonicalKey: string;
  readonly subjectId: string;
};

export type FrozenPublicationIdentity = {
  readonly candidateId: CatalogCandidateId;
  readonly artifactId: CatalogArtifactId;
  readonly releaseId: CatalogReleaseId;
  readonly releaseVersion: CatalogReleaseVersion;
  readonly publishedAt: string;
  readonly toolchain: FrozenToolchain;
  readonly definitions: readonly FrozenDefinitionAllocation[];
  readonly subjects?: readonly FrozenSubjectAllocation[];
};

export type PredecessorArtifactInput =
  | {
      readonly digest: string;
      readonly bytes: Uint8Array;
    }
  | {
      readonly digest: string;
    };

export type BuilderProposalRef = {
  readonly proposalId: DefinitionProposalId;
  readonly proposalRevisionId: DefinitionProposalRevisionId;
};

export type PersistArtifactPort = (
  db: Queryable,
  input: PersistArtifactInput,
) => Promise<Result<ReleaseArtifactRecord, CatalogPublicationStoreError>>;

export type PersistCandidatePort = (
  db: Queryable,
  input: PersistCandidateInput,
) => Promise<Result<PublicationCandidateRecord, CatalogPublicationStoreError>>;

export type GetArtifactByDigestPort = (
  db: Queryable,
  artifactDigest: string,
) => Promise<Result<ReleaseArtifactRecord, CatalogPublicationStoreError>>;

export type BuilderPersistPorts = {
  readonly persistArtifact?: PersistArtifactPort;
  readonly persistCandidate?: PersistCandidatePort;
  readonly getArtifactByDigest?: GetArtifactByDigestPort;
};

export type BuilderPersistRequest = {
  readonly db: Database;
  readonly ports?: BuilderPersistPorts;
};

export type BuildCompleteSuccessorInput = {
  readonly predecessorArtifact: PredecessorArtifactInput;
  readonly changeSet: readonly CatalogChange[];
  readonly frozenIdentity: FrozenPublicationIdentity;
  readonly proposal?: BuilderProposalRef | null;
  readonly productPath?: BuilderProductPath;
  readonly persist?: BuilderPersistRequest;
};

export type CapabilityAllowListIdentity = {
  readonly revision: typeof CATALOG_CAPABILITY_CONTRACT_REVISION;
  readonly id: "page-m1-definition-content";
  readonly valueTypes: readonly M1ValueSchemaType[];
  readonly units: readonly M1AllowedUnit[];
  readonly jsonSchemaKeywords: {
    readonly integer: readonly ["type", "minimum", "maximum"];
    readonly number: readonly ["type", "minimum", "maximum"];
    readonly string: readonly ["type"];
  };
  readonly budgets: {
    readonly maxDisplayNameChars: number;
    readonly maxDocumentationChars: number;
    readonly maxExamples: number;
    readonly maxChangeSetOps: number;
  };
};

export type CapabilityContract = JsonObject & {
  readonly revision: typeof CATALOG_CAPABILITY_CONTRACT_REVISION;
  readonly allowListId: "page-m1-definition-content";
  readonly allowListDigest: string;
  readonly valueTypes: readonly ContractJsonValue[];
  readonly units: readonly ContractJsonValue[];
};

export type DefinitionImpactEntry = {
  readonly definitionId: string;
  readonly subjectId: string;
  readonly propertyKey: string;
  readonly revisionId: string;
};

export type ChangedDefinitionImpactEntry = DefinitionImpactEntry & {
  readonly previousRevisionId: string;
  readonly contentClass: "documentation" | "semantic";
  readonly requestedClass?: "documentation" | "semantic";
};

export type MatcherImpactFacts = {
  readonly existingMatchRulesChanged: boolean;
  readonly fallbackImpact: boolean;
  readonly newMatchableProperties: readonly {
    readonly subjectId: string;
    readonly propertyKey: string;
    readonly sourceProperty: string;
    readonly selectorKind: "driver-compatible" | "node-type-name";
  }[];
};

export type CatalogImpactReport = {
  readonly schemaVersion: "catalog-impact/v1";
  readonly predecessor: {
    readonly releaseId: string;
    readonly digest: string;
  };
  readonly successor: {
    readonly releaseId: string;
    readonly digest: string;
  };
  readonly definitions: {
    readonly added: readonly DefinitionImpactEntry[];
    readonly changed: readonly ChangedDefinitionImpactEntry[];
    readonly unchanged: readonly DefinitionImpactEntry[];
  };
  readonly subjects: {
    readonly added: readonly string[];
    readonly changed: readonly string[];
    readonly unchanged: readonly string[];
  };
  readonly aliases: {
    readonly added: readonly string[];
    readonly changed: readonly string[];
    readonly unchanged: readonly string[];
  };
  readonly selectors: {
    readonly added: readonly string[];
    readonly changed: readonly string[];
    readonly removed: readonly string[];
  };
  readonly matcher: MatcherImpactFacts;
  readonly existingContractsTighten: boolean;
  readonly capabilityContractRevision: typeof CATALOG_CAPABILITY_CONTRACT_REVISION;
};

export type BuiltReleaseArtifact = {
  readonly id: CatalogArtifactId;
  readonly artifactDigest: string;
  readonly artifactBytes: Uint8Array;
  readonly bytesChecksum: string;
  readonly sourceKind: "typed-changeset";
  readonly targetReleaseId: CatalogReleaseId;
  readonly targetReleaseDigest: CatalogReleaseDigest;
  readonly predecessorReleaseId: CatalogReleaseId;
  readonly predecessorReleaseDigest: CatalogReleaseDigest;
  readonly toolchain: JsonObject;
  readonly bundle: CatalogReleaseBundle;
};

export type BuiltPublicationCandidate = {
  readonly id: CatalogCandidateId;
  readonly artifactId: CatalogArtifactId;
  readonly artifactDigest: string;
  readonly expectedBaseReleaseId: CatalogReleaseId;
  readonly expectedBaseReleaseDigest: CatalogReleaseDigest;
  readonly proposalId: DefinitionProposalId | null;
  readonly proposalRevisionId: DefinitionProposalRevisionId | null;
  readonly identityAllocation: JsonObject;
  readonly impactReportDigest: string;
  readonly capabilityContract: CapabilityContract;
};

export type SuccessorBuildValue = {
  readonly kind: "successor";
  readonly artifact: BuiltReleaseArtifact;
  readonly candidate: BuiltPublicationCandidate;
  readonly impact: CatalogImpactReport;
  readonly capabilityContract: CapabilityContract;
  readonly persistence:
    | { readonly kind: "not-requested" }
    | {
        readonly kind: "persisted";
        readonly artifact: ReleaseArtifactRecord;
        readonly candidate: PublicationCandidateRecord;
      };
};

export type NoopReviseValue = {
  readonly kind: "noop-revise";
  readonly definitionId: ParameterDefinitionId;
  readonly revisionId: DefinitionRevisionId;
  readonly predecessor: {
    readonly releaseId: CatalogReleaseId;
    readonly digest: string;
  };
};

export type BuildCompleteSuccessorValue = SuccessorBuildValue | NoopReviseValue;

export type BuildCompleteSuccessorError =
  | { readonly kind: "artifact-missing" }
  | {
      readonly kind: "artifact-digest-mismatch";
      readonly expected: string;
      readonly actual: string;
    }
  | {
      readonly kind: "predecessor-incomplete";
      readonly cause: CatalogKernelError | { readonly detail: string };
    }
  | {
      readonly kind: "invalid-property-key";
      readonly propertyKey: string;
      readonly reason: CanonicalIdentityFailureReason;
    }
  | {
      readonly kind: "conflict";
      readonly reason:
        | "duplicate-natural-key"
        | "duplicate-canonical-key"
        | "duplicate-selector"
        | "duplicate-alias";
      readonly subjectId?: string;
      readonly propertyKey?: string;
      readonly canonicalKey?: string;
      readonly selector?: string;
    }
  | {
      readonly kind: "unsupported-catalog-capability";
      readonly detail: string;
      readonly path: string;
    }
  | { readonly kind: "unsupported-change-op"; readonly op: string }
  | { readonly kind: "subject-not-found"; readonly subjectId: string }
  | { readonly kind: "subject-not-active"; readonly subjectId: string }
  | {
      readonly kind: "identity-allocation-missing";
      readonly naturalKey: string;
    }
  | { readonly kind: "invalid-input"; readonly reason: string }
  | {
      readonly kind: "invalid-release";
      readonly phase: Extract<CatalogKernelError, { kind: "invalid-release" }>["phase"];
      readonly violations: Extract<
        CatalogKernelError,
        { kind: "invalid-release" }
      >["violations"];
    }
  | {
      readonly kind: "persist-failed";
      readonly stage: "artifact" | "candidate" | "transaction";
      readonly cause?: CatalogPublicationStoreError | { readonly detail: string };
    };

export type BuildCompleteSuccessorResult = Result<
  BuildCompleteSuccessorValue,
  BuildCompleteSuccessorError
>;
