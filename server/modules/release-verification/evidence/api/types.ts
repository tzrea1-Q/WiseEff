import type {
  TypedEvidenceRef,
  VerificationPins,
  VerificationPlan,
  VerificationSubject,
} from "../../core/types";

export const catalogApiEvidenceRefusalKinds = [
  "mock-runtime",
  "stale-pins",
  "missing-request-id",
  "incomplete-bundle",
  "gate-selection-forbidden",
] as const;

export type CatalogApiEvidenceRefusalKind = (typeof catalogApiEvidenceRefusalKinds)[number];

export type CatalogApiEvidenceRefusal = {
  readonly kind: CatalogApiEvidenceRefusalKind;
  readonly detail: string;
};

export type CatalogApiPrincipalMode = "authorized" | "unauthenticated" | "agent" | "forbidden";

export type CatalogApiRuntimeKind = "candidate" | "mock";

export type CatalogApiDispatchInput = {
  readonly method: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly requestId: string;
  readonly principal: CatalogApiPrincipalMode;
};

export type CatalogApiDispatchOutput = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
};

export type CatalogApiCandidateDriver = {
  readonly kind: "candidate";
  readonly dispatch: (input: CatalogApiDispatchInput) => Promise<CatalogApiDispatchOutput>;
};

export type CatalogApiEvidenceQuery = {
  <Row>(text: string, values?: unknown[]): Promise<{ readonly rows: readonly Row[] }>;
};

export type CatalogApiEvidenceCaptureInput = {
  readonly plan: Pick<VerificationPlan, "purpose" | "subject" | "lineage" | "pins">;
  readonly runtime: {
    readonly kind: CatalogApiRuntimeKind;
    readonly candidateId: string;
  };
  readonly driver: CatalogApiCandidateDriver;
  readonly database: CatalogApiEvidenceQuery;
  readonly principal: {
    readonly principalId: string;
    readonly organizationId: string;
    readonly actorKind: string;
  };
  readonly probeContext?: {
    readonly subjectId?: string;
    readonly definitionId?: string;
    readonly revisionId?: string;
    readonly projectId?: string;
  };
};

export type CatalogApiHttpExchange = {
  readonly exchangeId: string;
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly principal: CatalogApiPrincipalMode;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyDigest: string;
  readonly catalogReleaseId: string | null;
  readonly etag: string | null;
  readonly deprecation: string | null;
  readonly sunset: string | null;
  readonly link: string | null;
  readonly reason: string | null;
};

export type CatalogApiAuditRef = {
  readonly id: string;
  readonly action: string;
};

export type CatalogApiGateEvidence = {
  readonly gateId: string;
  readonly exchanges: readonly CatalogApiHttpExchange[];
  readonly authorizationNegatives: readonly CatalogApiHttpExchange[];
  readonly databaseIdentity: string;
  readonly principalId: string;
  readonly organizationId: string;
  readonly auditRefs: readonly CatalogApiAuditRef[];
  readonly observations: Readonly<Record<string, unknown>>;
  readonly pins: VerificationPins;
  readonly subject: VerificationSubject;
  readonly phaseSnapshot: string;
  readonly purpose: VerificationPlan["purpose"];
};

export type CatalogApiEvidenceBundle = {
  readonly candidateId: string;
  readonly targetIdentity: string;
  readonly runtimeId: string;
  readonly databaseIdentity: string;
  readonly principalId: string;
  readonly organizationId: string;
  readonly records: readonly CatalogApiGateEvidence[];
  readonly evidenceRefs: readonly TypedEvidenceRef[];
};
