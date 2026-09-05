import type {
  CatalogConditionalWriteContext,
  CatalogIdempotentWriteContext,
  ParameterCatalogGovernanceRepository
} from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterCatalogClient } from "@/infrastructure/http/parameterCatalogClient";

import { requireConditionalWriteContext, requireIdempotentWriteContext } from "./writeContext";

export function createApiParameterCatalogRepository(
  client: ParameterCatalogClient
): ParameterCatalogRepository {
  return {
    getCatalog: (query) => client.getCatalog(query),
    listSubjects: (query) => client.listSubjects(query),
    getSubject: (subjectId, query) => client.getSubject(subjectId, query),
    listSubjectDefinitions: (subjectId, query) => client.listSubjectDefinitions(subjectId, query),
    listDefinitions: (query) => client.listDefinitions(query),
    getDefinition: (definitionId, query) => client.getDefinition(definitionId, query),
    listDefinitionRevisions: (definitionId, query) =>
      client.listDefinitionRevisions(definitionId, query),
    getDefinitionRevision: (definitionId, revisionId, query) =>
      client.getDefinitionRevision(definitionId, revisionId, query),
    listDefinitionTimeline: (definitionId, query) =>
      client.listDefinitionTimeline(definitionId, query),
    getLegacyIdentifier: (legacyType, legacyId) => client.getLegacyIdentifier(legacyType, legacyId)
  };
}

function idempotentContext(context: CatalogIdempotentWriteContext) {
  return requireIdempotentWriteContext(context);
}

function conditionalContext(context: CatalogConditionalWriteContext) {
  return requireConditionalWriteContext(context);
}

export function createApiParameterCatalogGovernanceRepository(
  client: ParameterCatalogClient
): ParameterCatalogGovernanceRepository {
  return {
    listRegistrations: (organizationId, query) => client.listRegistrations(organizationId, query),
    createRegistration: async (organizationId, body, context) =>
      client.createRegistration(organizationId, body, idempotentContext(context)),
    getRegistration: (organizationId, registrationId) =>
      client.getRegistration(organizationId, registrationId),
    retireRegistration: async (organizationId, registrationId, body, context) =>
      client.retireRegistration(organizationId, registrationId, body, conditionalContext(context)),
    restoreRegistration: async (organizationId, registrationId, body, context) =>
      client.restoreRegistration(organizationId, registrationId, body, conditionalContext(context)),
    getPlacement: (organizationId, registrationId) =>
      client.getPlacement(organizationId, registrationId),
    updatePlacement: async (organizationId, registrationId, body, context) =>
      client.updatePlacement(organizationId, registrationId, body, conditionalContext(context)),
    listObservations: (organizationId, query) => client.listObservations(organizationId, query),
    getObservation: (organizationId, observationId) =>
      client.getObservation(organizationId, observationId),
    listReviewItems: (organizationId, query) => client.listReviewItems(organizationId, query),
    getReviewItem: (organizationId, reviewItemId) =>
      client.getReviewItem(organizationId, reviewItemId),
    resolveReviewItem: async (organizationId, reviewItemId, body, context) =>
      client.resolveReviewItem(organizationId, reviewItemId, body, conditionalContext(context)),
    listProposals: (query) => client.listProposals(query),
    createProposal: async (body, context) => client.createProposal(body, idempotentContext(context)),
    getProposal: (proposalId) => client.getProposal(proposalId),
    submitProposal: async (proposalId, body, context) =>
      client.submitProposal(proposalId, body, conditionalContext(context)),
    withdrawProposal: async (proposalId, body, context) =>
      client.withdrawProposal(proposalId, body, conditionalContext(context)),
    acceptProposal: async (proposalId, body, context) =>
      client.acceptProposal(proposalId, body, conditionalContext(context)),
    rejectProposal: async (proposalId, body, context) =>
      client.rejectProposal(proposalId, body, conditionalContext(context))
  };
}

export function createApiCatalogPorts(client: ParameterCatalogClient): {
  catalog: ParameterCatalogRepository;
  governance: ParameterCatalogGovernanceRepository;
} {
  return {
    catalog: createApiParameterCatalogRepository(client),
    governance: createApiParameterCatalogGovernanceRepository(client)
  };
}
