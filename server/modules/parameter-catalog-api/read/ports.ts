import type { GovernanceCatalogQueries } from "../../parameter-governance/queries";
import type { UsageQueries } from "../../parameter-bindings/usage";
import type { CatalogReleasePin } from "../../parameter-catalog-contract/index";

import { mapPublicationFact } from "./dto";
import { CatalogProjectionError } from "./errors";
import { fingerprintIdSelection } from "./query";
import type {
  RegistrationProjectionPort,
  TimelineComposerPort,
  UsageProjectionPort,
} from "./types";

const emptySelection = { kind: "only" as const, ids: [] as const, fingerprint: fingerprintIdSelection([]) };

const fallbackPin = (input: { readonly observedRelease?: CatalogReleasePin }): CatalogReleasePin => {
  if (input.observedRelease) {
    return input.observedRelease;
  }
  throw new CatalogProjectionError({ kind: "query-unavailable", operation: "observedRelease" });
};

const requirePrincipal = (principalId: string | undefined, operation: string): string => {
  if (!principalId) {
    throw new CatalogProjectionError({ kind: "invalid-query", reason: "principalId", operation });
  }
  return principalId;
};

/** Test-only unregistered Catalog projection. Must not be the production pool default. */
export const unregisteredProjectionForTests: RegistrationProjectionPort = {
  async projectSubject() {
    return {
      registration: { status: "unregistered" },
      reviewCount: 0,
    };
  },
  async projectDefinition() {
    return { status: "unregistered" };
  },
  async selectSubjectIds({ registration }) {
    if (registration === "active" || registration === "retired") {
      return emptySelection;
    }
    return { kind: "all" };
  },
  async selectDefinitionIds({ registration }) {
    if (registration === "active" || registration === "retired") {
      return emptySelection;
    }
    return { kind: "all" };
  },
};

/** @deprecated Test constructor. Use unregisteredProjectionForTests. */
export const unregisteredProjection = unregisteredProjectionForTests;

/** Test-only zero usage projection. Must not be the production pool default. */
export const zeroUsageProjectionForTests: UsageProjectionPort = {
  async summarize() {
    return { policyCount: 0, projectCount: 0, currentValueCount: 0 };
  },
};

/** @deprecated Test constructor. Use zeroUsageProjectionForTests. */
export const zeroUsageProjection = zeroUsageProjectionForTests;

export const kernelOnlyTimelineComposer: TimelineComposerPort = {
  async compose({ facts, next }) {
    return {
      items: facts.map(mapPublicationFact),
      next,
    };
  },
};

export const unavailableRegistrationProjection: RegistrationProjectionPort = {
  async projectSubject() {
    throw new CatalogProjectionError({ kind: "query-unavailable", operation: "projectSubject" });
  },
  async projectDefinition() {
    throw new CatalogProjectionError({ kind: "query-unavailable", operation: "projectDefinition" });
  },
  async selectSubjectIds() {
    throw new CatalogProjectionError({ kind: "query-unavailable", operation: "selectSubjectIds" });
  },
  async selectDefinitionIds() {
    throw new CatalogProjectionError({ kind: "query-unavailable", operation: "selectDefinitionIds" });
  },
};

export const unavailableUsageProjection: UsageProjectionPort = {
  async summarize() {
    throw new CatalogProjectionError({ kind: "query-unavailable", operation: "summarizeUsage" });
  },
};

export function createRegistrationProjectionFromQueries(
  queries: GovernanceCatalogQueries,
): RegistrationProjectionPort {
  return {
    async projectSubject(input) {
      const principalId = requirePrincipal(input.principalId, "projectSubject");
      const result = await queries.projectRegistrations({
        organizationId: input.organizationId,
        subjectIds: [input.subjectId],
        authScope: { organizationId: input.organizationId, principalId },
        observedRelease: fallbackPin(input),
      });
      if (!result.ok) {
        throw new CatalogProjectionError(result.error);
      }
      const projection = result.value.projections[0];
      return {
        registration: projection?.registration ?? { status: "unregistered" },
        reviewCount: projection?.reviewCount ?? 0,
      };
    },
    async projectDefinition(input) {
      const principalId = requirePrincipal(input.principalId, "projectDefinition");
      const result = await queries.projectRegistrations({
        organizationId: input.organizationId,
        subjectIds: [input.subjectId],
        authScope: { organizationId: input.organizationId, principalId },
        observedRelease: fallbackPin(input),
      });
      if (!result.ok) {
        throw new CatalogProjectionError(result.error);
      }
      return result.value.projections[0]?.registration ?? { status: "unregistered" };
    },
    async selectSubjectIds(input) {
      const principalId = requirePrincipal(input.principalId, "selectSubjectIds");
      const registration =
        input.registration === "active" ||
        input.registration === "retired" ||
        input.registration === "unregistered"
          ? input.registration
          : undefined;
      if (input.registration && !registration) {
        throw new CatalogProjectionError({ kind: "invalid-query", reason: "registration" });
      }
      const result = await queries.selectSubjectIds({
        organizationId: input.organizationId,
        registration,
        catalogSubjectIds: input.catalogSubjectIds,
        authScope: { organizationId: input.organizationId, principalId },
      });
      if (!result.ok) {
        throw new CatalogProjectionError(result.error);
      }
      return result.value;
    },
    async selectDefinitionIds(input) {
      const principalId = requirePrincipal(input.principalId, "selectDefinitionIds");
      const registration =
        input.registration === "active" ||
        input.registration === "retired" ||
        input.registration === "unregistered"
          ? input.registration
          : undefined;
      if (input.registration && !registration) {
        throw new CatalogProjectionError({ kind: "invalid-query", reason: "registration" });
      }
      const result = await queries.selectDefinitionIds({
        organizationId: input.organizationId,
        registration,
        catalogDefinitions: input.catalogDefinitions ?? [],
        authScope: { organizationId: input.organizationId, principalId },
      });
      if (!result.ok) {
        throw new CatalogProjectionError(result.error);
      }
      return result.value;
    },
  };
}

export function createUsageProjectionFromQueries(queries: UsageQueries): UsageProjectionPort {
  return {
    async summarize(input) {
      const principalId = requirePrincipal(input.principalId, "summarizeUsage");
      const result = await queries.summarize({
        organizationId: input.organizationId,
        definitionIds: [input.definitionId],
        projectScope: { kind: "all" },
        authScope: { organizationId: input.organizationId, principalId },
      });
      if (!result.ok) {
        throw new CatalogProjectionError(result.error);
      }
      const summary = result.value.summaries[0];
      return {
        policyCount: summary?.policyCount ?? 0,
        projectCount: summary?.projectCount ?? 0,
        currentValueCount: summary?.currentValueCount ?? 0,
      };
    },
  };
}
