import type {
  CatalogReleaseId,
  ContractJsonValue,
  LegacyRowClass,
  ParameterObservationId,
  Result,
  ReviewEvidenceId,
  ReviewReason,
} from "../../parameter-catalog-contract/index";

export type { Result };

export const observationIngestCommandFamily = "observation-ingest";
export const reviewEvidenceIngestCommandFamily = "review-evidence-ingest";

export type MatcherOutput =
  | { readonly status: "matched" }
  | { readonly status: "unknown" }
  | { readonly status: "ambiguous" }
  | { readonly status: "placement-conflict" }
  | { readonly status: "retired-registration-observed" };

export type SourceLocator = {
  readonly [key: string]: ContractJsonValue;
};

export type SourceProvenance = {
  readonly projectId: string;
  readonly logicalNodeId: string;
  readonly configRevisionId: string;
  readonly sourceLocator: SourceLocator;
};

export type EvidenceClassification = {
  readonly rClass: LegacyRowClass;
  readonly sourceGraphRef?: string;
};

export type IngestEvidenceCommand = {
  readonly organizationId: string;
  readonly sourceIdentity: string;
  readonly catalogReleaseId: CatalogReleaseId;
  readonly matcherRevision: string;
  readonly matcherOutput: MatcherOutput;
  readonly provenance?: SourceProvenance | null;
  readonly classification?: EvidenceClassification | null;
  readonly evidence?: SourceLocator | null;
};

export type IngestEvidenceResult =
  | {
      readonly kind: "observation";
      readonly status: "ingested" | "replayed";
      readonly id: ParameterObservationId;
      readonly fingerprint: string;
      readonly catalogReleaseId: CatalogReleaseId;
    }
  | {
      readonly kind: "review-evidence";
      readonly status: "ingested" | "replayed";
      readonly id: ReviewEvidenceId;
      readonly fingerprint: string;
      readonly reason: ReviewReason;
      readonly rClass: LegacyRowClass | null;
    };

export type IngestEvidenceFailure =
  | {
      readonly kind: "missing-source-provenance";
      readonly missing: readonly string[];
    }
  | {
      readonly kind: "fingerprint-conflict";
      readonly sourceIdentity: string;
      readonly storedId: string;
      readonly storedFingerprint: string;
      readonly attemptedFingerprint: string;
    }
  | {
      readonly kind: "evidence-overwrite-refused";
      readonly sourceIdentity: string;
      readonly storedId: string;
    }
  | {
      readonly kind: "catalog-release-not-found";
      readonly catalogReleaseId: string;
    };

export type EvidenceIngest = {
  ingest(
    command: IngestEvidenceCommand,
  ): Promise<Result<IngestEvidenceResult, IngestEvidenceFailure>>;
};
