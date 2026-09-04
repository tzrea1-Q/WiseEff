import type {
  TypedEvidenceRef,
  VerificationPins,
  VerificationPlan,
  VerificationSubject,
} from "../../core/types";
import type { CatalogBrowserViewportId } from "./probes";

export const catalogBrowserEvidenceRefusalKinds = [
  "mock-runtime",
  "stale-pins",
  "screenshot-only",
  "pre-p13",
  "redaction-failed",
  "incomplete-bundle",
  "gate-selection-forbidden",
] as const;

export type CatalogBrowserEvidenceRefusalKind = (typeof catalogBrowserEvidenceRefusalKinds)[number];

export type CatalogBrowserEvidenceRefusal = {
  readonly kind: CatalogBrowserEvidenceRefusalKind;
  readonly detail: string;
};

export type CatalogBrowserRuntimeKind = "candidate" | "mock";

export type CatalogBrowserNetworkExchange = {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly catalogReleaseId: string | null;
  readonly runtimeKind: CatalogBrowserRuntimeKind;
  readonly summary: string;
};

export type CatalogBrowserInteraction = {
  readonly name: string;
  readonly outcome: string;
};

export type CatalogBrowserRedaction = {
  readonly status: "passed" | "failed";
  readonly policy: string;
  readonly version: string;
};

export type CatalogBrowserViewportObservation = {
  readonly snapshotDigest: string;
  readonly screenshotDigest: string;
  readonly console: {
    readonly errors: readonly string[];
    readonly pageErrors: readonly string[];
  };
  readonly network: {
    readonly exchanges: readonly CatalogBrowserNetworkExchange[];
  };
  readonly interactions: readonly CatalogBrowserInteraction[];
  readonly redaction: CatalogBrowserRedaction;
  readonly browser: {
    readonly name: string;
    readonly version: string;
  };
  readonly catalogPageMounted?: boolean;
  readonly parity?: {
    readonly mockHasExtraPower: boolean;
    readonly apiStates: readonly string[];
    readonly mockStates: readonly string[];
  };
};

export type CatalogBrowserCollectInput = {
  readonly gateId: string;
  readonly viewport: CatalogBrowserViewportId;
};

export type CatalogBrowserCandidateDriver = {
  readonly kind: "candidate";
  readonly collect: (input: CatalogBrowserCollectInput) => Promise<CatalogBrowserViewportObservation>;
};

export type CatalogBrowserEvidenceQuery = {
  <Row>(text: string, values?: unknown[]): Promise<{ readonly rows: readonly Row[] }>;
};

export type CatalogBrowserEvidenceCaptureInput = {
  readonly plan: Pick<VerificationPlan, "purpose" | "subject" | "lineage" | "pins">;
  readonly runtime: {
    readonly kind: CatalogBrowserRuntimeKind;
    readonly candidateId: string;
  };
  readonly driver: CatalogBrowserCandidateDriver;
  readonly database: CatalogBrowserEvidenceQuery;
  readonly principal: {
    readonly principalId: string;
    readonly organizationId: string;
    readonly actorKind: string;
  };
};

export type CatalogBrowserViewportRecord = {
  readonly viewport: CatalogBrowserViewportId;
  readonly width: number;
  readonly height: number;
  readonly observation: CatalogBrowserViewportObservation;
};

export type CatalogBrowserAuditRef = {
  readonly id: string;
  readonly action: string;
};

export type CatalogBrowserGateEvidence = {
  readonly gateId: string;
  readonly operationId: string;
  readonly viewports: readonly CatalogBrowserViewportRecord[];
  readonly databaseIdentity: string;
  readonly principalId: string;
  readonly organizationId: string;
  readonly auditRefs: readonly CatalogBrowserAuditRef[];
  readonly observations: Readonly<Record<string, unknown>>;
  readonly pins: VerificationPins;
  readonly subject: VerificationSubject;
  readonly phaseSnapshot: string;
  readonly purpose: VerificationPlan["purpose"];
};

export type CatalogBrowserEvidenceBundle = {
  readonly candidateId: string;
  readonly targetIdentity: string;
  readonly runtimeId: string;
  readonly databaseIdentity: string;
  readonly principalId: string;
  readonly organizationId: string;
  readonly records: readonly CatalogBrowserGateEvidence[];
  readonly evidenceRefs: readonly TypedEvidenceRef[];
};

export type CatalogBrowserSourceRecord = {
  readonly gateId: string;
  readonly operationId: string;
  readonly viewports: Readonly<Record<CatalogBrowserViewportId, CatalogBrowserViewportObservation>>;
};

export type CatalogBrowserEvidenceSource = {
  readonly producer: "s9-brw";
  readonly runtimeKind: CatalogBrowserRuntimeKind;
  readonly candidateId: string;
  readonly records: readonly CatalogBrowserSourceRecord[];
};
