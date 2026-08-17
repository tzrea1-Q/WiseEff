import { ApiError } from "../../../shared/http/errors";
import type { Queryable } from "../../../shared/database/client";
import type { KnowledgeEmbeddingClient } from "../../knowledge/indexing/embeddingClient";
import { getPublishedKnowledgeDocument, searchKnowledge } from "../../knowledge/service";
import type { AgentCitation } from "../types";
import type { AgentToolDefinition } from "../toolRegistry";
import { requireAgentToolMetadata } from "../toolMetadata";

type KnowledgeToolOptions = {
  db: Queryable;
  /** Optional semantic branch; absent keeps knowledge.search in FTS-only mode. */
  knowledgeEmbeddingClient?: KnowledgeEmbeddingClient;
};

const MAX_DOCUMENT_CHARS = 20_000;

export function knowledgeEntryHref(entryId: string) {
  return `/knowledge?entryId=${encodeURIComponent(entryId)}`;
}

/**
 * Read-only Xiaoze knowledge tools (D5/D13): auto-executing, organization-
 * scoped, permission-checked against the calling user's AuthContext through
 * the knowledge service (`knowledge:view` + org isolation), and they only
 * ever surface published entries.
 */
export function createKnowledgeTools(options: KnowledgeToolOptions): AgentToolDefinition[] {
  return [
    {
      ...requireAgentToolMetadata("knowledge.search"),
      run: async (context, payload) => {
        const query = typeof payload.query === "string" ? payload.query.trim() : "";
        if (!query) {
          throw new ApiError("VALIDATION_FAILED", "knowledge.search requires a non-empty query.", {
            toolName: "knowledge.search"
          });
        }
        const limitRaw = typeof payload.limit === "number" ? payload.limit : 5;
        const limit = Math.min(Math.max(Math.trunc(limitRaw), 1), 10);
        const result = await searchKnowledge(options.db, context.auth, { q: query, limit }, {
          embeddingClient: options.knowledgeEmbeddingClient
        });

        const citations: AgentCitation[] = result.items.map((item) => ({
          type: "knowledge" as const,
          id: item.entryId,
          label: item.title,
          href: knowledgeEntryHref(item.entryId),
          snippet: item.excerpt || undefined
        }));

        return {
          summary:
            result.items.length > 0
              ? `Found ${result.items.length} published knowledge entries for "${query}" (${result.retrieval.mode}).`
              : `No published knowledge entries matched "${query}".`,
          data: {
            retrievalMode: result.retrieval.mode,
            results: result.items.map((item) => ({
              entryId: item.entryId,
              title: item.title,
              revisionId: item.revisionId,
              contentForm: item.contentForm,
              tags: item.tags,
              excerpt: item.excerpt,
              updatedAt: item.updatedAt
            }))
          },
          citations
        };
      }
    },
    {
      ...requireAgentToolMetadata("knowledge.getDocument"),
      run: async (context, payload) => {
        const entryId = typeof payload.entryId === "string" ? payload.entryId.trim() : "";
        if (!entryId) {
          throw new ApiError("VALIDATION_FAILED", "knowledge.getDocument requires an entryId.", {
            toolName: "knowledge.getDocument"
          });
        }
        const { entry, contentText } = await getPublishedKnowledgeDocument(options.db, context.auth, entryId);
        const truncated = contentText.length > MAX_DOCUMENT_CHARS;
        const content = truncated ? contentText.slice(0, MAX_DOCUMENT_CHARS) : contentText;

        return {
          summary: `Read published knowledge entry "${entry.title}" (revision #${entry.headRevisionNumber}${truncated ? ", truncated" : ""}).`,
          data: {
            entryId: entry.id,
            title: entry.title,
            revisionId: entry.headRevisionId,
            revisionNumber: entry.headRevisionNumber,
            contentForm: entry.contentForm,
            tags: entry.tags,
            content,
            truncated,
            // Structural definition references so grounding answers can name
            // the parameters; lifecycle is honest (deprecated stays visible).
            referencedParameters: entry.parameterReferences.map((reference) => ({
              specId: reference.specId,
              name: reference.displayName?.trim() || reference.propertyKey,
              lifecycle: reference.lifecycle
            }))
          },
          citations: [
            {
              type: "knowledge" as const,
              id: entry.id,
              label: entry.title,
              href: knowledgeEntryHref(entry.id),
              snippet: content.slice(0, 200) || undefined
            }
          ]
        };
      }
    }
  ];
}
