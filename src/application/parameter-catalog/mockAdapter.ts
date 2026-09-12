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
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { CatalogActorKind } from "./authority";
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
  getSession?: () => CatalogMockSession;
};

export type CatalogMockSession = { personId: string; organizationId: string; actorKind: CatalogActorKind; isActive: boolean };

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
  proposals: Map<string, CatalogProposalResponse["item"]>;
  idempotency: Map<string, IdempotencyRecord>;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function proposalToken(value: string): boolean {
  return value.length > 0 && value.trim() === value && !/[\u0000-\u001F\u007F-\u009F]/u.test(value);
}

function invalidProposal(field: string): never {
  throw new WiseEffApiError("VALIDATION_FAILED", "Invalid catalog governance request.", { retryable: false, field }, "catalog");
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
    proposals: new Map([[catalogProposal.id, clone(catalogProposal)]]),
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
      const session = proposalSession();
      assertReadyForRead(store);
      return collection([...store.proposals.values()].filter((proposal) => proposal.organizationId === session.organizationId));
    },
    async createProposal(body, context) {
      const session = authorizeProposal("createProposal");
      const write = requireIdempotentWriteContext(context);
      assertReadyForWrite(store);
      assertRelease(store, write.catalogReleaseId);
      const parsed = catalogCreateProposalRequestSchema.parse(body);
      const definitionId = parsed.base.definitionId || null;
      const revisionId = parsed.base.definitionRevisionId || null;
      if (Boolean(definitionId) !== Boolean(revisionId)) invalidProposal(definitionId ? "base.definitionRevisionId" : "base.definitionId");
      if (!proposalToken(parsed.base.catalogReleaseId)) invalidProposal("claimedBaseReleaseId");
      if (parsed.base.catalogReleaseId !== write.catalogReleaseId) throw catalogApiFailure("proposal-stale");
      if (!proposalToken(parsed.reason)) invalidProposal("reason");
      const evidenceRefs = parsed.evidenceRefs ?? [];
      if (evidenceRefs.some((ref) => !proposalToken(ref))) invalidProposal("evidenceRefs");
      // Match the HTTP command's defaults; retain the raw payload in its fingerprint.
      const semanticBody = { ...parsed, base: { ...parsed.base, definitionId, definitionRevisionId: revisionId }, evidenceRefs };
      return replayProposal("createProposal", null, write, semanticBody, () => {
        if (revisionId !== null) {
          if (revisionId !== catalogRevision.id) invalidProposal("baseDefinitionRevisionId");
          if (definitionId !== catalogRevision.definitionId) invalidProposal("baseDefinitionId");
        }
        const id = `dprop_${crypto.randomUUID()}`;
        store.proposal = {
          ...clone(catalogProposal),
          id,
          organizationId: session.organizationId,
          etag: `"${crypto.randomUUID()}"`,
          version: 1,
          status: "draft",
          submittedByPersonId: session.personId,
          base: {
            catalogReleaseId: parsed.base.catalogReleaseId,
            definitionId,
            definitionRevisionId: revisionId
          },
          requestedChange: { ...clone(parsed.requestedChange), kind: proposalToken(parsed.requestedChange.kind) ? parsed.requestedChange.kind : "definition-proposal" }
        };
        store.proposals.set(id, store.proposal);
        return { item: clone(store.proposal) };
      });
    },
    async getProposal(proposalId) {
      const session = proposalSession();
      assertReadyForRead(store);
      const proposal = store.proposals.get(proposalId);
      if (!proposal || proposal.organizationId !== session.organizationId) {
        throw new WiseEffApiError("NOT_FOUND", "Proposal not found.", {}, "catalog");
      }
      return { item: clone(proposal) };
    },
    async submitProposal(proposalId, body, context) {
      return transitionProposal(proposalId, body, context, "submitProposal", (parsed, proposal) => {
        catalogSubmitProposalRequestSchema.parse(parsed);
        if (proposal.status !== "draft") throw catalogApiFailure("revision-conflict");
        return commitProposal(proposal, { status: "submitted" });
      });
    },
    async withdrawProposal(proposalId, body, context) {
      return transitionProposal(proposalId, body, context, "withdrawProposal", (parsed, proposal) => {
        catalogWithdrawProposalRequestSchema.parse(parsed);
        if (proposal.status !== "draft" && proposal.status !== "submitted") throw catalogApiFailure("revision-conflict");
        return commitProposal(proposal, { status: "withdrawn" });
      });
    },
    async acceptProposal(proposalId, body, context) {
      return transitionProposal(proposalId, body, context, "acceptProposal", (parsed, proposal) => {
        const request = catalogAcceptProposalRequestSchema.parse(parsed);
        if (request.publicationReference?.kind === "candidate") {
          if (request.repositoryReference !== undefined) invalidProposal("repositoryReference");
          if (!proposalToken(request.publicationReference.candidateId)) invalidProposal("publicationReference");
        } else {
          const repositoryReference =
            request.publicationReference?.kind === "repository"
              ? request.publicationReference.repositoryReference
              : request.repositoryReference;
          if (repositoryReference === undefined || !proposalToken(repositoryReference)) {
            invalidProposal("repositoryReference");
          }
        }
        const session = proposalSession();
        if (session.personId === proposal.submittedByPersonId) {
          throw catalogApiFailure("proposal-self-approval-forbidden");
        }
        if (proposal.status !== "submitted") throw catalogApiFailure("revision-conflict");
        return commitProposal(proposal, {
          status: "accepted",
          acceptedByPersonId: session.personId,
          publicationIntentRef: `cpint_${crypto.randomUUID()}`
        });
      });
    },
    async rejectProposal(proposalId, body, context) {
      return transitionProposal(proposalId, body, context, "rejectProposal", (parsed, proposal) => {
        const request = catalogRejectProposalRequestSchema.parse(parsed);
        if (!proposalToken(request.reason)) invalidProposal("reason");
        if (proposalSession().personId === proposal.submittedByPersonId) throw catalogApiFailure("proposal-self-approval-forbidden");
        if (proposal.status !== "submitted") throw catalogApiFailure("revision-conflict");
        return commitProposal(proposal, { status: "rejected" });
      });
    }
  };

  function proposalSession(): CatalogMockSession {
    const session = options.getSession?.() ?? { personId: store.currentPersonId, organizationId: CATALOG_ORGANIZATION_ID, actorKind: "platform-admin", isActive: true };
    if (!session.personId || !session.organizationId) throw new WiseEffApiError("UNAUTHENTICATED", "Authentication is required.", {}, "catalog");
    if (!session.isActive) throw catalogApiFailure("forbidden");
    return { ...session };
  }

  function authorizeProposal(method: string): CatalogMockSession {
    const session = proposalSession();
    const review = method === "acceptProposal" || method === "rejectProposal";
    if (session.actorKind !== (review ? "platform-admin" : "org-admin")) throw catalogApiFailure("forbidden");
    return session;
  }

  function commitProposal(proposal: CatalogProposalResponse["item"], change: Partial<CatalogProposalResponse["item"]>) {
    const updated = { ...proposal, ...change, etag: `"${crypto.randomUUID()}"`, version: proposal.version + 1 };
    store.proposals.set(updated.id, updated);
    store.proposal = updated;
    return { item: clone(updated) };
  }

  function replayProposal<T>(method: string, proposalId: string | null, write: CatalogIdempotentWriteContext, body: unknown, compute: () => T): T {
    const session = proposalSession();
    const key = JSON.stringify([session.organizationId, method, proposalId, write.idempotencyKey]);
    const fingerprint = JSON.stringify([session.personId, session.actorKind, method === "withdrawProposal" ? null : write.catalogReleaseId, "ifMatch" in write ? write.ifMatch : null, canonicalJson(body)]);
    const existing = store.idempotency.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw catalogApiFailure("revision-conflict");
      return clone(existing.result as T);
    }
    const result = compute();
    store.idempotency.set(key, { fingerprint, result: clone(result) });
    return clone(result);
  }

  function transitionProposal<T>(
    proposalId: string,
    body: unknown,
    context: CatalogConditionalWriteContext,
    method: string,
    compute: (parsed: unknown, proposal: CatalogProposalResponse["item"]) => T
  ): T {
    const session = authorizeProposal(method);
    const write = requireConditionalWriteContext(context);
    assertReadyForWrite(store);
    assertRelease(store, write.catalogReleaseId);
    const proposal = store.proposals.get(proposalId);
    if (!proposal || proposal.organizationId !== session.organizationId) {
      throw new WiseEffApiError("NOT_FOUND", "Proposal not found.", {}, "catalog");
    }
    return replayProposal(method, proposalId, write, body, () => {
      if (write.ifMatch !== proposal.etag) throw catalogApiFailure("revision-conflict");
      if ((method === "submitProposal" || method === "withdrawProposal") && proposal.submittedByPersonId !== session.personId) throw catalogApiFailure("forbidden");
      if (method !== "withdrawProposal" && proposal.base.catalogReleaseId !== write.catalogReleaseId) throw catalogApiFailure("proposal-stale");
      return compute(body, proposal);
    });
  }

  return { catalog, governance };
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalJson(item)]));
  return value;
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
