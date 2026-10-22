import type { CatalogListQuery } from "@/infrastructure/http/parameterCatalogDtos";

type CatalogPage<T> = {
  items: readonly T[];
  nextCursor: string | null;
  hasMore: boolean;
};

/**
 * Read a complete canonical collection without allowing a broken cursor to
 * spin forever.  The API's page size is capped at 100, so this is also the
 * one place where the UI handles organizations larger than one page.
 */
export async function listAllCanonicalPages<T>(
  fetchPage: (query: CatalogListQuery) => Promise<CatalogPage<T>>,
  query: CatalogListQuery = {},
  progress?: { onPage: (items: T[]) => void; isCancelled: () => boolean }
): Promise<T[]> {
  const result: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let pageNumber = 0; pageNumber < 1000; pageNumber += 1) {
    if (progress?.isCancelled()) return result;
    const page = await fetchPage({
      ...query,
      limit: query.limit ?? 100,
      ...(cursor ? { cursor } : {})
    });
    if (progress?.isCancelled()) return result;
    result.push(...page.items);
    progress?.onPage([...result]);
    if (!page.hasMore) return result;
    const nextCursor = page.nextCursor?.trim() ?? "";
    if (!nextCursor || nextCursor === cursor || seenCursors.has(nextCursor)) {
      throw new Error("规范目录返回了无效分页游标，已停止继续读取。");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new Error("规范目录分页超过安全上限，已停止继续读取。");
}
