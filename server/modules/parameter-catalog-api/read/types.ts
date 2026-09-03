import type {
  CatalogDefinitionPublicationFact,
  CatalogRuntime,
  CurrentCatalogSnapshot,
  PinnedCatalogSnapshot,
  PropertyKey,
} from "../../catalog-kernel/interface";
import type { parameterCatalogKernelReadByRouteId } from "../../contracts/dtoSchemas/parameterCatalog";
import type {
  CatalogCursor,
  CatalogIdSelection,
  CatalogReleasePin,
  CatalogSubjectId,
  OptionalValue,
  ParameterDefinitionId,
} from "../../parameter-catalog-contract/index";

export type CatalogReadRouteId = keyof typeof parameterCatalogKernelReadByRouteId;

export type CatalogReadRequest = {
  readonly method: "GET";
  readonly path: string;
  readonly params: Record<string, string>;
  readonly query: Record<string, string | string[]>;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly requestId: string;
};

export type CatalogReadResponse = {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
};

export type TrustedCatalogActorKind = "user" | "org-admin" | "platform-admin" | "agent";

export type TrustedCatalogScope = {
  readonly principalId: string;
  readonly organizationId: string;
  readonly actorKind: TrustedCatalogActorKind;
  readonly canReadCatalog: boolean;
  readonly canRegister: boolean;
  readonly subjects: CatalogIdSelection<CatalogSubjectId>;
  readonly definitions: CatalogIdSelection<ParameterDefinitionId>;
};

export type CatalogReadAuthResult =
  | { readonly ok: true; readonly scope: TrustedCatalogScope }
  | { readonly ok: false; readonly status: 401 | 403 };

export type CatalogDocumentFacts = {
  readonly pin: CatalogReleasePin;
  readonly snapshotKind: "current" | "pinned";
  readonly releaseSequence: number;
  readonly publishedAt: string;
  readonly materializedAt: string;
  readonly materializationFingerprint: string;
};

export type CatalogReadinessResult =
  | { readonly status: "ready"; readonly document: CatalogDocumentFacts }
  | { readonly status: "not-ready"; readonly retryAfterSeconds: number }
  | { readonly status: "unknown" };

export type CatalogReadinessPort = {
  current(): Promise<CatalogReadinessResult>;
  named(catalogReleaseId: string): Promise<CatalogReadinessResult>;
};

export type CatalogRegistrationProjection =
  | { readonly status: "unregistered" }
  | {
      readonly status: "active" | "retired";
      readonly id: string;
      readonly method?: "explicit" | "automatic" | "review";
      readonly placement?: {
        readonly id: string;
        readonly displayName: string;
        readonly parentPlacementId: string | null;
      };
    };

export type RegistrationProjectionPort = {
  projectSubject(input: {
    readonly organizationId: string;
    readonly subjectId: CatalogSubjectId;
    readonly canRegister: boolean;
  }): Promise<{
    readonly registration: CatalogRegistrationProjection;
    readonly reviewCount: number;
  }>;
  projectDefinition(input: {
    readonly organizationId: string;
    readonly subjectId: CatalogSubjectId;
  }): Promise<CatalogRegistrationProjection>;
  selectSubjectIds(input: {
    readonly organizationId: string;
    readonly registration?: string;
  }): Promise<CatalogIdSelection<CatalogSubjectId>>;
  selectDefinitionIds(input: {
    readonly organizationId: string;
    readonly registration?: string;
  }): Promise<CatalogIdSelection<ParameterDefinitionId>>;
};

export type CatalogUsageSummary = {
  readonly policyCount: number;
  readonly projectCount: number;
  readonly currentValueCount: number;
};

export type UsageProjectionPort = {
  summarize(input: {
    readonly organizationId: string;
    readonly definitionId: ParameterDefinitionId;
  }): Promise<CatalogUsageSummary>;
};

export type ComposedTimelineFact = {
  readonly id: string;
  readonly kind: "catalog-publication" | "history" | "audit";
  readonly definitionId: string;
  readonly revisionId: string | null;
  readonly revisionNumber: number | null;
  readonly catalogReleaseId: string | null;
  readonly publishedAt: string;
  readonly changes?: ReadonlyArray<"introduced" | "content" | "documentation" | "lifecycle">;
  readonly summary?: string;
};

export type TimelineComposerPort = {
  compose(input: {
    readonly definitionId: ParameterDefinitionId;
    readonly facts: readonly CatalogDefinitionPublicationFact[];
    readonly next: OptionalValue<CatalogCursor>;
    readonly scope: TrustedCatalogScope;
  }): Promise<{
    readonly items: readonly ComposedTimelineFact[];
    readonly next: OptionalValue<CatalogCursor>;
  }>;
};

export type CatalogReadPorts = {
  readonly runtime: CatalogRuntime;
  readonly readiness: CatalogReadinessPort;
  readonly registration: RegistrationProjectionPort;
  readonly usage: UsageProjectionPort;
  readonly timeline: TimelineComposerPort;
  readonly authenticate: (request: CatalogReadRequest) => Promise<CatalogReadAuthResult>;
};

export type LoadedCatalogSnapshot = CurrentCatalogSnapshot | PinnedCatalogSnapshot;

export type CatalogListQuery = {
  readonly cursor: OptionalValue<CatalogCursor>;
  readonly limit: number;
  readonly type?: "driver" | "node-type";
  readonly lifecycle?: string;
  readonly registration?: string;
  readonly search?: string;
  readonly subjectId?: CatalogSubjectId;
  readonly propertyKey?: PropertyKey;
};
