import { z } from "zod";

const revisionIdSchema = z.string().uuid();

export type KnowledgeEntryLink = { entryId: string; revisionId?: string | null; page?: number | null };

export function knowledgeEntryHref({ entryId, revisionId, page }: KnowledgeEntryLink): string {
  const params = [`entryId=${encodeURIComponent(entryId)}`];
  if (revisionId) params.push(`revisionId=${encodeURIComponent(revisionId)}`);
  if (page) params.push(`page=${page}`);
  return `/knowledge?${params.join("&")}`;
}

export function parseKnowledgeEntryQuery(query: URLSearchParams) {
  const revision = query.get("revisionId");
  const page = query.get("page");
  return {
    entryId: query.get("entryId"),
    revisionId: revisionIdSchema.safeParse(revision).success ? revision : null,
    page: page && /^[1-9]\d*$/.test(page) && Number.isSafeInteger(Number(page)) ? Number(page) : null
  };
}

export function formatKnowledgePageLabel(start: number | readonly number[], end?: number): string {
  const pages = typeof start === "number" ? `${start}${end != null && end !== start ? `–${end}` : ""}` : start.join("、");
  return `第 ${pages} 页`;
}
