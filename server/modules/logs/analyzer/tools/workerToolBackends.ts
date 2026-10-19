import type { KnowledgeEmbeddingClient } from "../../../knowledge/indexing/embeddingClient";
import { searchPublishedKnowledgeForLogAnalysis } from "../../../knowledge/logDomainRetrieval";
import type { Queryable } from "../../../../shared/database/client";
import { listLogDomainKnowledgeLinkEntryIds } from "../../domainsRepository";
import type { RelatedParameterRunSnapshot } from "../../relatedParameter";
import type { LogAnalysisToolContext, RelatedParameterContext } from "./toolContext";
import { locateLogStatements } from "../../sourceStatementRepository";

/**
 * Production worker tool bindings. The related parameter is read only from the
 * immutable run snapshot; this module intentionally has no Catalog/table query.
 */
export function createWorkerLogAnalysisToolBackends(input: {
  db: Queryable;
  organizationId: string;
  logDomainId?: string;
  relatedParameterId?: string;
  relatedParameterSnapshot?: RelatedParameterRunSnapshot;
  sourceSnapshot?: import("../../analyzer").AnalyzeLogInput["sourceSnapshot"];
  embeddingClient?: KnowledgeEmbeddingClient;
}): Pick<LogAnalysisToolContext, "searchDomainKnowledge" | "loadRelatedParameterContext" | "locateLogStatement"> {
  const snapshot = input.relatedParameterSnapshot;
  if (input.relatedParameterId && !snapshot) {
    throw new Error("Canonical related-parameter run snapshot is unavailable.");
  }
  if (
    (snapshot && !input.relatedParameterId) ||
    (snapshot && (snapshot.pin.organizationId !== input.organizationId || snapshot.pin.bindingId !== input.relatedParameterId))
  ) {
    throw new Error("Canonical related-parameter run snapshot does not match the worker log.");
  }

  const relatedParameterContext: RelatedParameterContext | undefined = snapshot
    ? {
        parameterId: snapshot.pin.bindingId,
        name: snapshot.propertyKey,
        projectId: snapshot.pin.projectId,
        currentValue: JSON.stringify(snapshot.pin.payload.value),
        protectedReference: {
          kind: "canonical-pin",
          bindingId: snapshot.pin.bindingId,
          definitionId: snapshot.pin.definitionId,
          definitionRevisionId: snapshot.pin.definitionRevisionId
        },
        snapshot,
        ...(snapshot.recentChanges ? {
          recentChanges: snapshot.recentChanges.map((change) => ({ ...change, value: JSON.stringify(change.payload.value) }))
        } : {})
      }
    : undefined;

  return {
    ...(input.sourceSnapshot?.status === "ready" ? {
      locateLogStatement: (line: string, limit: number) => locateLogStatements(input.db, {
        organizationId: input.organizationId, snapshotId: input.sourceSnapshot!.id, line, limit
      })
    } : {}),
    searchDomainKnowledge: async (query: string) => {
      const linkedEntryIds = input.logDomainId
        ? await listLogDomainKnowledgeLinkEntryIds(input.db, {
            organizationId: input.organizationId,
            domainId: input.logDomainId
          })
        : [];
      return searchPublishedKnowledgeForLogAnalysis(input.db, {
        organizationId: input.organizationId,
        query,
        linkedEntryIds,
        embeddingClient: input.embeddingClient
      });
    },
    ...(relatedParameterContext
      ? {
          loadRelatedParameterContext: async () => relatedParameterContext
        }
      : {})
  };
}
