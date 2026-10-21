import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { getAuthContext } from "../auth/repository";
import { listCatalogDefinitionsForKnowledge } from "../parameter-catalog-api/productionWire";
import type { KnowledgeIndexEntrySnapshot } from "./indexing/service";

/** Derived evidence only: never creates a binding or writes an audit. */
export async function detectKnowledgeReferenceSuggestions(db: Database, snapshot: KnowledgeIndexEntrySnapshot) {
  if (snapshot.entryStatus === "archived" || !snapshot.headRevisionId || !snapshot.authorUserId) return;
  if (snapshot.contentForm === "file" && snapshot.extractionStatus !== "succeeded") return;
  let auth;
  try {
    auth = await getAuthContext(db, snapshot.authorUserId);
  } catch (error) {
    if (error instanceof ApiError && ["UNAUTHENTICATED", "FORBIDDEN"].includes(error.code)) return;
    throw error;
  }
  if (auth.organization.id !== snapshot.organizationId) return;
  const definitions = await listCatalogDefinitionsForKnowledge(db, auth);
  const text = snapshot.contentForm === "markdown" ? snapshot.contentMarkdown ?? "" : snapshot.extractedText ?? "";
  await db.transaction(async (tx) => {
    // Serialize with reference decisions and refuse stale worker evidence.
    const entry = await tx.query<{ head_revision_id: string; status: string }>(
      "select head_revision_id, status from knowledge_entries where organization_id = $1 and id = $2 for update",
      [snapshot.organizationId, snapshot.entryId]
    );
    if (entry.rows[0]?.head_revision_id !== snapshot.headRevisionId || entry.rows[0]?.status === "archived") return;
    const matchedDefinitionIds: string[] = [];
    // ponytail: linear in definitions × text length; tokenize once if the catalog grows large.
    for (const definition of definitions) {
      const key = definition.propertyKey;
      if (key.length < 4 || definition.lifecycle === "retired") continue;
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = [...text.matchAll(new RegExp(`(?<![A-Za-z0-9_,.+?#-])${escaped}(?![A-Za-z0-9_,.+?#-])`, "g"))];
      const first = matches[0];
      if (!first) continue;
      matchedDefinitionIds.push(definition.id);
      const offset = first.index;
      const page = snapshot.pageOffsets?.reduce<number | null>((found, start, index) => start <= offset ? index + 1 : found, null) ?? null;
      await tx.query(
        `insert into knowledge_reference_suggestions
         (organization_id, entry_id, definition_id, property_key, mention_count, snippet, page, detected_revision_id)
         select $1,$2,$3,$4,$5,$6,$7,$8 where not exists
         (select 1 from knowledge_definition_references where organization_id = $1 and entry_id = $2 and definition_id = $3)
         on conflict (organization_id, entry_id, definition_id) do update
         set status = 'pending', property_key = excluded.property_key, mention_count = excluded.mention_count,
             snippet = excluded.snippet, page = excluded.page, detected_revision_id = excluded.detected_revision_id, updated_at = now()
         where knowledge_reference_suggestions.status in ('pending', 'withdrawn')`,
        [snapshot.organizationId, snapshot.entryId, definition.id, key, matches.length,
          text.slice(Math.max(0, offset - 80), offset + key.length + 120), page, snapshot.headRevisionId]
      );
    }
    await tx.query(
      `update knowledge_reference_suggestions set status = 'withdrawn', updated_at = now()
       where organization_id = $1 and entry_id = $2 and status = 'pending'
         and not (definition_id = any($3::text[]))`,
      [snapshot.organizationId, snapshot.entryId, matchedDefinitionIds]
    );
    await tx.query(
      "update knowledge_entries set reference_suggestions_detected_at = now() where organization_id = $1 and id = $2",
      [snapshot.organizationId, snapshot.entryId]
    );
  });
}
