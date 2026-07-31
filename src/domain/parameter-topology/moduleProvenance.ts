/**
 * Presentation helpers for parameter governance queues and libraries.
 */

export function paginateItems<T>(items: readonly T[], page: number, pageSize: number): {
  pageItems: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
} {
  const safePageSize = Math.max(1, pageSize);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * safePageSize;
  return {
    pageItems: items.slice(start, start + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages
  };
}
