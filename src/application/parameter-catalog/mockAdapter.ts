import {
  catalogAcceptProposalRequestSchema,
  catalogCreateProposalRequestSchema,
  catalogLegacyIdentifierTypeSchema,
  catalogRegisterSubjectRequestSchema,
  catalogRejectProposalRequestSchema,
  catalogResolveReviewItemRequestSchema,
  catalogRestoreRegistrationRequestSchema,
  catalogRetireRegistrationRequestSchema,
  catalogSubmitProposalRequestSchema,
  catalogUpdatePlacementRequestSchema,
  catalogWithdrawProposalRequestSchema
} from "@wiseeff/dto-schemas";

import type {
  CatalogConditionalWriteContext,
  CatalogIdempotentWriteContext,
  ParameterCatalogGovernanceRepository
} from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type {
  CatalogDefinitionResponse,
  CatalogListQuery,
  CatalogProposalResponse,
  CatalogRegistrationResponse,
  CatalogReviewItemResponse,
  CatalogSubjectResponse
} from "@/infrastructure/http/parameterCatalogDtos";

import { catalogApiFailure } from "./errors";
import {
  CATALOG_PLACEMENT_ID,
  CATALOG_REGISTRATION_ID,
  CATALOG_RELEASE_ID,
  CATALOG_REVIEW_ITEM_ID,
  CATALOG_REVIEWER_PERSON_ID,
  CATALOG_REVISION_ID,
  CATALOG_SUBJECT_ID,
  activeDefinition,
  catalogObservation,
  catalogPlacement,
  catalogProposal,
  catalogRegistration,
  catalogReviewItem,
  catalogRevision,
  catalogTimeline,
  emptyCatalogCollection,
  mappedLegacyIdentifier,
  readyCatalogDocument,
  registeredSubject,
  retiredDefinition,
  retiredSubject,
  unregisteredSubject
} from "./fixtures";
import { requireConditionalWriteContext, requireIdempotentWriteContext } from "./writeContext";

export const catalogMockScenarios = [
  "ready",
  "unregistered",
  "empty-no-registrations",
  "empty-no-definitions",
  "empty-no-review-work",
  "empty-no-filter-match",
  "error",
  "retired",
  "conflict"
] as const;

export type CatalogMockScenario = (typeof catalogMockScenarios)[number];

export type CatalogMockOptions = {
  scenario?: CatalogMockScenario;
  currentPersonId?: string;
};

type IdempotencyRecord = { fingerprint: string; result: unknown };

type MockStore = {
  scenario: CatalogMockScenario;
  currentPersonId: string;
  catalog: typeof readyCatalogDocument;
  subject: CatalogSubjectResponse["item"];
  definition: CatalogDefinitionResponse["item"];
  registration: CatalogRegistrationResponse["item"] | null;
  reviewItem: CatalogReviewItemResponse["item"];
  proposal: CatalogProposalResponse["item"];
  idempotency: Map<string, IdempotencyRecord>;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function collection<T>(items: T[], emptyReason?: Parameters<typeof emptyCatalogCollection>[0]) {
  if (items.length === 0 && emptyReason) {
    return emptyCatalogCollection<T>(emptyReason);
  }
  return {
    items: clone(items),
    nextCursor: null as string | null,
    catalogReleaseId: CATALOG_RELEASE_ID
  };
}

function createStore(options: CatalogMockOptions): MockStore {
  const scenario = options.scenario ?? "ready";
  const subject =
    scenario === "unregistered"
      ? clone(unregisteredSubject)
      : scenario === "retired"
        ? clone(retiredSubject)
        : clone(registeredSubject);
  const definition = scenario === "retired" ? clone(retiredDefinition) : clone(activeDefinition);
  const registration =
    scenario === "unregistered" || scenario === "empty-no-registrations"
      ? null
      : clone(catalogRegistration);
  return {
    scenario,
    currentPersonId: options.currentPersonId ?? CATALOG_REVIEWER_PERSON_ID,
    catalog: clone(readyCatalogDocument),
    subject,
    definition,
    registration,
    reviewItem: clone(catalogReviewItem),
    proposal: clone(catalogProposal),
    idempotency: new Map()
  };
}

function notReady(store: MockStore) {
  return catalogApiFailure("catalog-not-ready", {
    catalogReleaseId: store.catalog.item.catalogReleaseId
  });
}

function assertReadyForWrite(store: MockStore) {
  if (store.scenario === "error") {
    throw notReady(store);
  }
  if (store.scenario === "conflict") {
    throw catalogApiFailure("release-drift", { catalogReleaseId: CATALOG_RELEASE_ID });
  }
  if (store.scenario === "retired") {
    throw catalogApiFailure("subject-retired", { catalogReleaseId: CATALOG_RELEASE_ID });
  }
}

function assertRelease(store: MockStore, catalogReleaseId: string) {
  if (catalogReleaseId !== store.catalog.item.catalogReleaseId) {
    throw catalogApiFailure("release-drift", {
      catalogReleaseId: store.catalog.item.catalogReleaseId
    });
  }
}

function replayOrStore<T>(
  store: MockStore,
  method: string,
  context: CatalogIdempotentWriteContext,
  body: unknown,
  compute: () => T
): T {
  const fingerprint = JSON.stringify(body);
  const key = `${method}:${context.idempotencyKey}`;
  const existing = store.idempotency.get(key);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      throw catalogApiFailure("revision-conflict");
    }
    return clone(existing.result as T);
  }
  const result = compute();
  store.idempotency.set(key, { fingerprint, result: clone(result) });
  return clone(result);
}

function matchesQuery<T extends { id: string }>(
  items: T[],
  query: CatalogListQuery | undefined,
  extra?: (item: T) => boolean
): T[] {
  if (!query) return items;
  return items.filter((item) => extra?.(item) !== false);
}

export function createMockCatalogPorts(options: CatalogMockOptions = {}): {
  catalog: ParameterCatalogRepository;
  governance: ParameterCatalogGovernanceRepository;
} {
  const store = createStore(options);

  const catalog: ParameterCatalogRepository = {
    async getCatalog() {
      if (store.scenario === "error") {
        throw notReady(store);
      }
      return clone(store.catalog);
    },
    async listSubjects(query) {
      if (store.scenario === "error") {
        throw notReady(store);
      }
      if (store.scenario === "empty-no-registrations") {
        return emptyCatalogCollection("no-registrations");
      }
      if (store.scenario === "empty-no-filter-match") {
        return emptyCatalogCollection("no-filter-match");
      }
      const items = matchesQuery([store.subject], query);
      return collection(items, items.length === 0 ? "no-filter-match" : undefined);
    },
    async getSubject(subjectId) {
      if (store.scenario === "error") {
        throw notReady(store);
      }
      if (subjectId !== store.subject.id) {
        throw catalogApiFailure("subject-not-published");
      }
      return { item: clone(store.subject) };
    },
    async listSubjectDefinitions(subjectId, query) {
      if (subjectId !== store.subject.id) {
        throw catalogApiFailure("subject-not-published");
      }
      return catalog.listDefinitions({ ...query, subjectId });
    },
    async listDefinitions(query) {
      if (store.scenario === "error") {
        throw notReady(store);
      }
      if (store.scenario === "empty-no-definitions") {
        return emptyCatalogCollection("no-definitions");
      }
      if (store.scenario === "empty-no-filter-match") {
        return emptyCatalogCollection("no-filter-match");
      }
      const items =
        query?.search && query.search !== store.definition.propertyKey ? [] : [store.definition];
      return collection(items, items.length === 0 ? "no-filter-match" : undefined);
    },
    async getDefinition(definitionId) {
      if (store.scenario === "error") {
        throw notReady(store);
      }
      if (definitionId !== store.definition.id) {
        throw catalogApiFailure("definition-not-found");
      }
      return { item: clone(store.definition) };
    },
    async listDefinitionRevisions(definitionId) {
      if (definitionId !== store.definition.id) {
        throw catalogApiFailure("definition-not-found");
      }
      return collection([catalogRevision]);
    },
    async getDefinitionRevision(definitionId, revisionId) {
      if (definitionId !== store.definition.id || revisionId !== CATALOG_REVISION_ID) {
        throw catalogApiFailure("definition-not-found");
      }
      return { item: clone(catalogRevision) };
    },
    async listDefinitionTimeline(definitionId) {
      if (definitionId !== store.definition.id) {
        throw catalogApiFailure("definition-not-found");
      }
      return clone(catalogTimeline);
    },
    async getLegacyIdentifier(legacyType, legacyId) {
      catalogLegacyIdentifierTypeSchema.parse(legacyType);
      if (store.scenario === "retired") {
        throw catalogApiFailure("legacy-id-archived", {
          catalogReleaseId: store.catalog.item.catalogReleaseId
        });
      }
      if (store.scenario === "conflict") {
        throw catalogApiFailure("legacy-id-ambiguous", {
          catalogReleaseId: store.catalog.item.catalogReleaseId
        });
      }
      if (
        mappedLegacyIdentifier.item.legacyType === legacyType &&
        mappedLegacyIdentifier.item.legacyId === legacyId
      ) {
        return clone(mappedLegacyIdentifier);
      }
      throw catalogApiFailure("forbidden");
    }
  };

  const governance: ParameterCatalogGovernanceRepository = {
    async listRegistrations() {
      if (store.scenario === "empty-no-registrations" || !store.registration) {
        return emptyCatalogCollection("no-registrations");
      }
      return collection([store.registration]);
    },
    async createRegistration(organizationId, body, context) {
      const write = requireIdempotentWriteContext(context);
      assertReadyForWrite(store);
      assertRelease(store, write.catalogReleaseId);
      const parsed = catalogRegisterSubjectRequestSchema.parse(body);
      return replayOrStore(store, "createRegistration", write, parsed, () => {
        if (store.registration && store.registration.subjectId === parsed.subjectId) {
          throw catalogApiFailure("placement-conflict");
        }
        const created = {
          ...catalogRegistration,
          organizationId,
          subjectId: parsed.subjectId,
          id: CATALOG_REGISTRATION_ID,
          placement:
            parsed.placement.mode === "choose-parent"
              ? {
                  id: CATALOG_PLACEMENT_ID,
                  displayName: parsed.placement.displayName,
                  parentPlacementId: parsed.placement.parentPlacementId
                }
              : clone(catalogPlacement),
          catalogReleaseId: write.catalogReleaseId
        };
        store.registration = created;
        store.subject = {
          ...store.subject,
          registration: {
            status: created.status,
            id: created.id,
            method: created.method,
            placement: created.placement
          }
        };
        return { item: created };
      });
    },
    async getRegistration(_organizationId, registrationId) {
      if (!store.registration || store.registration.id !== registrationId) {
        throw catalogApiFailure("registration-required", { subjectId: CATALOG_SUBJECT_ID });
      }
      return { item: clone(store.registration) };
    },
    async retireRegistration(_organizationId, registrationId, body, context) {
      const write = requireConditionalWriteContext(context);
      assertReadyForWrite(store);
      assertRelease(store, write.catalogReleaseId);
      const parsed = catalogRetireRegistrationRequestSchema.parse(body);
      if (!store.registration || store.registration.id !== registrationId) {
        throw catalogApiFailure("registration-required", { subjectId: CATALOG_SUBJECT_ID });
      }
      if (write.ifMatch !== "etag-reg") {
        throw catalogApiFailure("revision-conflict");
      }
      return replayOrStore(store, "retireRegistration", write, parsed, () => {
        store.registration = { ...store.registration!, status: "retired" };
        return { item: clone(store.registration) };
      });
    },
    async restoreRegistration(_organizationId, registrationId, body, context) {
      const write = requireConditionalWriteContext(context);
      assertReadyForWrite(store);
      assertRelease(store, write.catalogReleaseId);
      const parsed = catalogRestoreRegistrationRequestSchema.parse(body);
      if (!store.registration || store.registration.id !== registrationId) {
        throw catalogApiFailure("registration-required", { subjectId: CATALOG_SUBJECT_ID });
      }
      if (write.ifMatch !== "etag-reg") {
        throw catalogApiFailure("revision-conflict");
      }
      return replayOrStore(store, "restoreRegistration", write, parsed, () => {
        store.registration = {
          ...store.registration!,
          status: "active",
          placement: clone(catalogPlacement)
        };
        return { item: clone(store.registration) };
      });
    },
    async getPlacement(_organizationId, registrationId) {
      if (!store.registration || store.registration.id !== registrationId) {
        throw catalogApiFailure("registration-required", { subjectId: CATALOG_SUBJECT_ID });
      }
      return { item: clone(store.registration.placement) };
    },
    async updatePlacement(_organizationId, registrationId, body, context) {
      const write = requireConditionalWriteContext(context);
      assertReadyForWrite(store);
      assertRelease(store, write.catalogReleaseId);
      const parsed = catalogUpdatePlacementRequestSchema.parse(body);
      if (!store.registration || store.registration.id !== registrationId) {
        throw catalogApiFailure("registration-required", { subjectId: CATALOG_SUBJECT_ID });
      }
      if (write.ifMatch !== "etag-reg") {
        throw catalogApiFailure("revision-conflict");
      }
      if (
        parsed.placement.mode === "choose-parent" &&
        parsed.placement.parentPlacementId === store.registration.placement.id
      ) {
        throw catalogApiFailure("invalid-placement-parent");
      }
      return replayOrStore(store, "updatePlacement", write, parsed, () => {
        const nextPlacement =
          parsed.placement.mode === "choose-parent"
            ? {
                id: CATALOG_PLACEMENT_ID,
                displayName: parsed.placement.displayName,
                parentPlacementId: parsed.placement.parentPlacementId
              }
            : clone(catalogPlacement);
        store.registration = { ...store.registration!, placement: nextPlacement };
        return { item: clone(nextPlacement) };
      });
    },
    async listObservations() {
      return collection([catalogObservation]);
    },
    async getObservation(_organizationId, observationId) {
      if (observationId !== catalogObservation.id) {
        throw catalogApiFailure("forbidden");
      }
      return { item: clone(catalogObservation) };
    },
    async listReviewItems() {
      if (store.scenario === "empty-no-review-work") {
        return emptyCatalogCollection("no-review-work");
      }
      return collection([store.reviewItem]);
    },
    async getReviewItem(_organizationId, reviewItemId) {
      if (reviewItemId !== store.reviewItem.id) {
        throw catalogApiFailure("forbidden");
      }
      return { item: clone(store.reviewItem) };
    },
    async resolveReviewItem(_organizationId, reviewItemId, body, context) {
      const write = requireConditionalWriteContext(context);
      assertReadyForWrite(store);
      assertRelease(store, write.catalogReleaseId);
      const parsed = catalogResolveReviewItemRequestSchema.parse(body);
      if (reviewItemId !== store.reviewItem.id || store.reviewItem.status !== "open") {
        throw catalogApiFailure("revision-conflict");
      }
      if (write.ifMatch !== store.reviewItem.etag) {
        throw catalogApiFailure("revision-conflict");
      }
      if (
        parsed.resolution.type === "register-subject" &&
        parsed.resolution.placement.mode === "choose-parent" &&
        !parsed.resolution.placement.parentPlacementId
      ) {
        throw catalogApiFailure("invalid-placement-parent");
      }
      return replayOrStore(store, "resolveReviewItem", write, parsed, () => {
        store.reviewItem = { ...store.reviewItem, status: "resolved", etag: "etag-2" };
        const resolved = {
          item: {
            reviewItem: { id: CATALOG_REVIEW_ITEM_ID, status: "resolved" as const },
            registration: store.registration
              ? {
                  id: store.registration.id,
                  subjectId: store.registration.subjectId,
                  placement: store.registration.placement
                }
              : {
                  id: CATALOG_REGISTRATION_ID,
                  subjectId: CATALOG_SUBJECT_ID,
                  placement: clone(catalogPlacement)
                },
            catalogReleaseId: write.catalogReleaseId
          }
        };
        if (!store.registration && parsed.resolution.type === "register-subject") {
          store.registration = clone(catalogRegistration);
        }
        return resolved;
      });
    },
    async listProposals() {
      return collection([store.proposal]);
    },
    async createProposal(body, context) {
      const write = requireIdempotentWriteContext(context);
      assertReadyForWrite(store);
      assertRelease(store, write.catalogReleaseId);
      const parsed = catalogCreateProposalRequestSchema.parse(body);
      return replayOrStore(store, "createProposal", write, parsed, () => {
        store.proposal = {
          ...clone(catalogProposal),
          status: "draft",
          submittedByPersonId: store.currentPersonId,
          base: {
            catalogReleaseId: parsed.base.catalogReleaseId,
            definitionId: parsed.base.definitionId ?? null,
            definitionRevisionId: parsed.base.definitionRevisionId ?? null
          },
          requestedChange: parsed.requestedChange
        };
        return { item: clone(store.proposal) };
      });
    },
    async getProposal(proposalId) {
      if (proposalId !== store.proposal.id) {
        throw catalogApiFailure("forbidden");
      }
      return { item: clone(store.proposal) };
    },
    async submitProposal(proposalId, body, context) {
      return transitionProposal(proposalId, body, context, "submitProposal", (parsed) => {
        catalogSubmitProposalRequestSchema.parse(parsed);
        store.proposal = { ...store.proposal, status: "submitted", etag: "etag-p2" };
        return { item: clone(store.proposal) };
      });
    },
    async withdrawProposal(proposalId, body, context) {
      return transitionProposal(proposalId, body, context, "withdrawProposal", (parsed) => {
        catalogWithdrawProposalRequestSchema.parse(parsed);
        store.proposal = { ...store.proposal, status: "withdrawn", etag: "etag-p2" };
        return { item: clone(store.proposal) };
      });
    },
    async acceptProposal(proposalId, body, context) {
      return transitionProposal(proposalId, body, context, "acceptProposal", (parsed) => {
        catalogAcceptProposalRequestSchema.parse(parsed);
        if (store.currentPersonId === store.proposal.submittedByPersonId) {
          throw catalogApiFailure("proposal-self-approval-forbidden");
        }
        store.proposal = {
          ...store.proposal,
          status: "accepted",
          acceptedByPersonId: store.currentPersonId,
          publicationIntentRef: "pint_01K",
          etag: "etag-p2"
        };
        return { item: clone(store.proposal) };
      });
    },
    async rejectProposal(proposalId, body, context) {
      return transitionProposal(proposalId, body, context, "rejectProposal", (parsed) => {
        catalogRejectProposalRequestSchema.parse(parsed);
        store.proposal = { ...store.proposal, status: "rejected", etag: "etag-p2" };
        return { item: clone(store.proposal) };
      });
    }
  };

  function transitionProposal<T>(
    proposalId: string,
    body: unknown,
    context: CatalogConditionalWriteContext,
    method: string,
    compute: (parsed: unknown) => T
  ): T {
    const write = requireConditionalWriteContext(context);
    assertReadyForWrite(store);
    assertRelease(store, write.catalogReleaseId);
    if (proposalId !== store.proposal.id) {
      throw catalogApiFailure("forbidden");
    }
    if (write.ifMatch !== store.proposal.etag) {
      throw catalogApiFailure("revision-conflict");
    }
    if (store.proposal.base.catalogReleaseId !== write.catalogReleaseId) {
      throw catalogApiFailure("proposal-stale");
    }
    return replayOrStore(store, method, write, body, () => compute(body));
  }

  return { catalog, governance };
}

export function createMockParameterCatalogRepository(
  options: CatalogMockOptions = {}
): ParameterCatalogRepository {
  return createMockCatalogPorts(options).catalog;
}

export function createMockParameterCatalogGovernanceRepository(
  options: CatalogMockOptions = {}
): ParameterCatalogGovernanceRepository {
  return createMockCatalogPorts(options).governance;
}
