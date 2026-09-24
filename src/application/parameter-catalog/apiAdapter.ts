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
    getLegacyIdentifier: (legacyType, legacyId) => client.getLegacyIdentifier(legacyType, legacyId),
    createPublicationCandidate: (body, context) => client.createPublicationCandidate(body, context),
    getPublicationCandidate: (candidateId) => client.getPublicationCandidate(candidateId),
    publishPublicationCandidate: (candidateId, body, context) =>
      client.publishPublicationCandidate(candidateId, body, context),
    getPublication: (jobId) => client.getPublication(jobId),
    getPublicationSurface: () => client.getPublicationSurface(),
    listPublications: (query) => client.listPublications(query),
    // Identity correction commands are catalog write routes: the idempotency key
    // and the create/continue If-Match fence must reach the client unchanged, or
    // the root API answers 409 revision-conflict before the command is read.
    previewDefinitionReplacement: (body, context) =>
      client.previewDefinitionReplacement(body, context),
    listDefinitionReplacements: (query) => client.listDefinitionReplacements(query),
    createDefinitionReplacement: (body, context) =>
      client.createDefinitionReplacement(body, context),
    getDefinitionReplacement: (replacementId) =>
      client.getDefinitionReplacement(replacementId),
    continueDefinitionReplacement: (replacementId, body, context) =>
      client.continueDefinitionReplacement(replacementId, body, context),
    listProjectValueDrafts: (projectId) => client.listProjectValueDrafts(projectId),
    deleteProjectValueDraft: (projectId, draftId, context) =>
      client.deleteProjectValueDraft(projectId, draftId, context),
    submitProjectValueDraft: (projectId, draftId, body, context) =>
      client.submitProjectValueDraft(projectId, draftId, body, context),
    listProjectValueChangeRequests: (projectId, query) =>
      client.listProjectValueChangeRequests(projectId, query),
    getProjectValueBatchChangeRequest: (projectId, requestId) =>
      client.getProjectValueBatchChangeRequest(projectId, requestId),
    submitMemberRemovalRequest: (projectId, body, context) =>
      client.submitMemberRemovalRequest(projectId, body, context),
    listMemberRemovalRequests: (projectId, query) =>
      client.listMemberRemovalRequests(projectId, query),
    getMemberRemovalRequest: (projectId, requestId) =>
      client.getMemberRemovalRequest(projectId, requestId),
    reviewMemberRemovalRequest: (projectId, requestId, body, context) =>
      client.reviewMemberRemovalRequest(projectId, requestId, body, context),
    withdrawMemberRemovalRequest: (projectId, requestId, context) =>
      client.withdrawMemberRemovalRequest(projectId, requestId, context),
    reviewProjectValueChangeRequest: (projectId, requestId, body, context) =>
      client.reviewProjectValueChangeRequest(projectId, requestId, body, context),
    withdrawProjectValueChangeRequest: (projectId, requestId, context) =>
      client.withdrawProjectValueChangeRequest(projectId, requestId, context),
    getProjectValueChangeSourceDiff: (projectId, requestId) =>
      client.getProjectValueChangeSourceDiff(projectId, requestId),
    getCanonicalBindingChangeHistory: (projectId, bindingId, limit) =>
      client.getCanonicalBindingChangeHistory(projectId, bindingId, limit),
    getCanonicalBindingExport: (projectId, bindingId, projectValueId) =>
      client.getCanonicalBindingExport(projectId, bindingId, projectValueId)
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
