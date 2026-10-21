import type { KnowledgeEmbeddingClient } from "../../../knowledge/indexing/embeddingClient";
import { searchPublishedKnowledgeForLogAnalysis } from "../../../knowledge/logDomainRetrieval";
import type { Database } from "../../../../shared/database/client";
import type { RelatedParameterRunSnapshot } from "../../relatedParameter";
import type { LogAnalysisToolContext, RelatedParameterContext } from "./toolContext";
import { locateLogStatements } from "../../sourceStatementRepository";
import { readSourceRange, searchSource, type SourceRangeParams, type SourceSearchParams } from "../../sourceSearchRepository";

/**
 * Production worker tool bindings. The related parameter is read only from the
 * immutable run snapshot; this module intentionally has no Catalog/table query.
 */
export function createWorkerLogAnalysisToolBackends(input: {
  db: Database;
  organizationId: string;
  logDomainId?: string;
  knowledgeEntryIds?: string[];
  onKnowledgeRetrieved?: import("../../analyzer").AnalyzeLogInput["onKnowledgeRetrieved"];
  relatedParameterId?: string;
  relatedParameterSnapshot?: RelatedParameterRunSnapshot;
  sourceSnapshot?: import("../../analyzer").AnalyzeLogInput["sourceSnapshot"];
  embeddingClient?: KnowledgeEmbeddingClient;
}): Pick<LogAnalysisToolContext, "searchDomainKnowledge" | "loadRelatedParameterContext" | "locateLogStatement" | "searchSource" | "readSourceRange"> {
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
      }),
      searchSource: (params: SourceSearchParams) => searchSource(input.db, {
        ...params, organizationId: input.organizationId, snapshotId: input.sourceSnapshot!.id
      }),
      readSourceRange: (params: SourceRangeParams) => params.snapshotId === input.sourceSnapshot!.id
        ? readSourceRange(input.db, { ...params, organizationId: input.organizationId }) : Promise.resolve(null)
    } : {}),
    searchDomainKnowledge: async (query: string) => {
      const result = await searchPublishedKnowledgeForLogAnalysis(input.db, {
        organizationId: input.organizationId,
        query,
        linkedEntryIds: input.knowledgeEntryIds,
        embeddingClient: input.embeddingClient
      });
      input.onKnowledgeRetrieved?.(result.items.flatMap((item) => item.revisionId
        ? [{ entryId: item.entryId, revisionId: item.revisionId,
          ...(item.pageStart != null ? { pages: Array.from(
            { length: (item.pageEnd ?? item.pageStart) - item.pageStart + 1 }, (_, index) => item.pageStart! + index
          ) } : {}) }] : []));
      return result;
    },
    ...(relatedParameterContext
      ? {
          loadRelatedParameterContext: async () => relatedParameterContext
        }
      : {})
  };
}
