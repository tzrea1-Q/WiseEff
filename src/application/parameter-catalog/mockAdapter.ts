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
  CatalogRegisterSubjectRequest,
  CatalogRegistrationResponse,
  CatalogReviewItemResponse,
  CatalogSubjectResponse
} from "@/infrastructure/http/parameterCatalogDtos";

import { catalogApiFailure } from "./errors";
import {
  CATALOG_ORGANIZATION_ID,
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

type CatalogPlacementIntent = CatalogRegisterSubjectRequest["placement"];
type CatalogPlacement = CatalogRegistrationResponse["item"]["placement"];

function notReady(store: MockStore) {
  return catalogApiFailure("catalog-not-ready", {
    catalogReleaseId: store.catalog.item.catalogReleaseId
  });
}

function assertReadyForRead(store: MockStore) {
  if (store.scenario === "error") {
    throw notReady(store);
  }
}

function assertReadyForWrite(store: MockStore) {
  assertReadyForRead(store);
  if (store.scenario === "conflict") {
    throw catalogApiFailure("release-drift", { catalogReleaseId: CATALOG_RELEASE_ID });
  }
  if (store.scenario === "retired") {
    throw catalogApiFailure("subject-retired", { catalogReleaseId: CATALOG_RELEASE_ID });
  }
}

function assertOrganizationScope(organizationId: string) {
  if (organizationId !== CATALOG_ORGANIZATION_ID) {
    throw catalogApiFailure("definition-not-found");
  }
}

function placementFromIntent(intent: CatalogPlacementIntent): CatalogPlacement {
  if (intent.mode === "use-default") {
    return clone(catalogPlacement);
  }
  if (!intent.parentPlacementId.trim() || intent.parentPlacementId !== CATALOG_PLACEMENT_ID) {
    throw catalogApiFailure("invalid-placement-parent");
  }
  return {
    id: CATALOG_PLACEMENT_ID,
    displayName: intent.displayName,
    parentPlacementId: intent.parentPlacementId
  };
}

function samePlacement(left: CatalogPlacement, right: CatalogPlacement): boolean {
  return (
    left.id === right.id &&
    left.displayName === right.displayName &&
    left.parentPlacementId === right.parentPlacementId
  );
}

function projectRegistration(registration: CatalogRegistrationResponse["item"]) {
  return {
    id: registration.id,
    subjectId: registration.subjectId,
    placement: clone(registration.placement)
  };
}

function assertRelease(store: MockStore, catalogReleaseId: string) {
  if (catalogReleaseId !== store.catalog.item.catalogReleaseId) {
    throw catalogApiFailure("release-drift", {
      catalogReleaseId: store.catalog.item.catalogReleaseId
    });
  }
}

function assertPinnedRead(store: MockStore, query?: CatalogListQuery) {
  if (query?.catalogReleaseId) {
    assertRelease(store, query.catalogReleaseId);
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
    async getCatalog(query) {
      assertReadyForRead(store);
      assertPinnedRead(store, query);
      return clone(store.catalog);
    },
    async listSubjects(query) {
      assertReadyForRead(store);
      assertPinnedRead(store, query);
      if (store.scenario === "empty-no-registrations") {
        return emptyCatalogCollection("no-registrations");
      }
      if (store.scenario === "empty-no-filter-match") {
        return emptyCatalogCollection("no-filter-match");
      }
      const items = matchesQuery([store.subject], query);
      return collection(items, items.length === 0 ? "no-filter-match" : undefined);
    },
    async getSubject(subjectId, query) {
      assertReadyForRead(store);
      assertPinnedRead(store, query);
      if (subjectId !== store.subject.id) {
        throw catalogApiFailure("subject-not-published");
      }
      return { item: clone(store.subject) };
    },
    async listSubjectDefinitions(subjectId, query) {
      assertReadyForRead(store);
      assertPinnedRead(store, query);
      if (subjectId !== store.subject.id) {
        throw catalogApiFailure("subject-not-published");
      }
      return catalog.listDefinitions({ ...query, subjectId });
    },
    async listDefinitions(query) {
      assertReadyForRead(store);
      assertPinnedRead(store, query);
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
    async getDefinition(definitionId, query) {
      assertReadyForRead(store);
      assertPinnedRead(store, query);
      if (definitionId !== store.definition.id) {
        throw catalogApiFailure("definition-not-found");
      }
      return { item: clone(store.definition) };
    },
    async listDefinitionRevisions(definitionId, query) {
      assertReadyForRead(store);
      assertPinnedRead(store, query);
      if (definitionId !== store.definition.id) {
        throw catalogApiFailure("definition-not-found");
      }
      return collection([catalogRevision]);
    },
    async getDefinitionRevision(definitionId, revisionId, query) {
      assertReadyForRead(store);
      assertPinnedRead(store, query);
      if (definitionId !== store.definition.id || revisionId !== CATALOG_REVISION_ID) {
        throw catalogApiFailure("definition-not-found");
      }
      return { item: clone(catalogRevision) };
    },
    async listDefinitionTimeline(definitionId, query) {
      assertReadyForRead(store);
      assertPinnedRead(store, query);
      if (definitionId !== store.definition.id) {
        throw catalogApiFailure("definition-not-found");
      }
      return clone(catalogTimeline);
    },
    async getLegacyIdentifier(legacyType, legacyId) {
      assertReadyForRead(store);
      catalogLegacyIdentifierTypeSchema.parse(legacyType);
      const mapped =
        mappedLegacyIdentifier.item.legacyType === legacyType &&
        mappedLegacyIdentifier.item.legacyId === legacyId;
      if (!mapped) {
        throw catalogApiFailure("definition-not-found");
      }
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
      return clone(mappedLegacyIdentifier);
    }
  };

  const governance: ParameterCatalogGovernanceRepository = {
    async listRegistrations(organizationId) {
      assertReadyForRead(store);
      assertOrganizationScope(organizationId);
      if (store.scenario === "empty-no-registrations" || !store.registration) {
        return emptyCatalogCollection("no-registrations");
      }
      return collection([store.registration]);
    },
    async createRegistration(organizationId, body, context) {
      const write = requireIdempotentWriteContext(context);
      assertReadyForWrite(store);
      assertOrganizationScope(organizationId);
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
          placement: placementFromIntent(parsed.placement),
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
    async getRegistration(organizationId, registrationId) {
      assertReadyForRead(store);
      assertOrganizationScope(organizationId);
      if (!store.registration || store.registration.id !== registrationId) {
        throw catalogApiFailure("registration-required", { subjectId: CATALOG_SUBJECT_ID });
      }
      return { item: clone(store.registration) };
    },
    async retireRegistration(organizationId, registrationId, body, context) {
      const write = requireConditionalWriteContext(context);
      assertReadyForWrite(store);
      assertOrganizationScope(organizationId);
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
    async restoreRegistration(organizationId, registrationId, body, context) {
      const write = requireConditionalWriteContext(context);
      assertReadyForWrite(store);
      assertOrganizationScope(organizationId);
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
          status: "active"
        };
        return { item: clone(store.registration) };
      });
    },
    async getPlacement(organizationId, registrationId) {
      assertReadyForRead(store);
      assertOrganizationScope(organizationId);
      if (!store.registration || store.registration.id !== registrationId) {
        throw catalogApiFailure("registration-required", { subjectId: CATALOG_SUBJECT_ID });
      }
      return { item: clone(store.registration.placement) };
    },
    async updatePlacement(organizationId, registrationId, body, context) {
      const write = requireConditionalWriteContext(context);
      assertReadyForWrite(store);
      assertOrganizationScope(organizationId);
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
        const nextPlacement = placementFromIntent(parsed.placement);
        store.registration = { ...store.registration!, placement: nextPlacement };
        return { item: clone(nextPlacement) };
      });
    },
    async listObservations(organizationId) {
      assertReadyForRead(store);
      assertOrganizationScope(organizationId);
      return collection([catalogObservation]);
    },
    async getObservation(organizationId, observationId) {
      assertReadyForRead(store);
      assertOrganizationScope(organizationId);
      if (observationId !== catalogObservation.id) {
        throw catalogApiFailure("forbidden");
      }
      return { item: clone(catalogObservation) };
    },
    async listReviewItems(organizationId) {
      assertReadyForRead(store);
      assertOrganizationScope(organizationId);
      if (store.scenario === "empty-no-review-work") {
        return emptyCatalogCollection("no-review-work");
      }
      return collection([store.reviewItem]);
    },
    async getReviewItem(organizationId, reviewItemId) {
      assertReadyForRead(store);
      assertOrganizationScope(organizationId);
      if (reviewItemId !== store.reviewItem.id) {
        throw catalogApiFailure("forbidden");
      }
      return { item: clone(store.reviewItem) };
    },
    async resolveReviewItem(organizationId, reviewItemId, body, context) {
      const write = requireConditionalWriteContext(context);
      assertReadyForWrite(store);
      assertOrganizationScope(organizationId);
      assertRelease(store, write.catalogReleaseId);
      const parsed = catalogResolveReviewItemRequestSchema.parse(body);
      if (reviewItemId !== store.reviewItem.id || store.reviewItem.status !== "open") {
        throw catalogApiFailure("revision-conflict");
      }
      if (write.ifMatch !== store.reviewItem.etag) {
        throw catalogApiFailure("revision-conflict");
      }
      return replayOrStore(store, "resolveReviewItem", write, parsed, () => {
        if (parsed.resolution.type === "register-subject") {
          if (parsed.resolution.subjectId !== store.subject.id) {
            throw catalogApiFailure("subject-not-published");
          }
          const placement = placementFromIntent(parsed.resolution.placement);
          let registration = store.registration;
          if (registration) {
            if (
              registration.subjectId !== parsed.resolution.subjectId ||
              !samePlacement(registration.placement, placement)
            ) {
              throw catalogApiFailure("placement-conflict");
            }
          } else {
            registration = {
              id: CATALOG_REGISTRATION_ID,
              organizationId,
              subjectId: parsed.resolution.subjectId,
              status: "active",
              method: "review",
              placement,
              catalogReleaseId: write.catalogReleaseId
            };
            store.registration = registration;
            store.subject = {
              ...store.subject,
              registration: {
                status: registration.status,
                id: registration.id,
                method: registration.method,
                placement: registration.placement
              }
            };
          }
          store.reviewItem = { ...store.reviewItem, status: "resolved", etag: "etag-2" };
          return {
            item: {
              reviewItem: { id: CATALOG_REVIEW_ITEM_ID, status: "resolved" as const },
              registration: projectRegistration(registration),
              catalogReleaseId: write.catalogReleaseId
            }
          };
        }

        if (parsed.resolution.type === "restore-registration") {
          if (!store.registration || store.registration.id !== parsed.resolution.registrationId) {
            throw catalogApiFailure("registration-required", { subjectId: CATALOG_SUBJECT_ID });
          }
          store.registration = { ...store.registration, status: "active" };
          store.reviewItem = { ...store.reviewItem, status: "resolved", etag: "etag-2" };
          return {
            item: {
              reviewItem: { id: CATALOG_REVIEW_ITEM_ID, status: "resolved" as const },
              registration: projectRegistration(store.registration),
              catalogReleaseId: write.catalogReleaseId
            }
          };
        }

        if (parsed.resolution.type === "open-definition-proposal") {
          store.reviewItem = { ...store.reviewItem, status: "resolved", etag: "etag-2" };
          return {
            item: {
              reviewItem: { id: CATALOG_REVIEW_ITEM_ID, status: "resolved" as const },
              proposalId: store.proposal.id,
              catalogReleaseId: write.catalogReleaseId
            }
          };
        }

        store.reviewItem = { ...store.reviewItem, status: "out-of-scope", etag: "etag-2" };
        return {
          item: {
            reviewItem: { id: CATALOG_REVIEW_ITEM_ID, status: "out-of-scope" as const },
            catalogReleaseId: write.catalogReleaseId
          }
        };
      });
    },
    async listProposals() {
      assertReadyForRead(store);
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
      assertReadyForRead(store);
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
