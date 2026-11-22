import { useState } from "react";

export function useWorkbenchPagination(count: number, filterKey: string, focusId: string | null, focusIndex: number) {
  const [pageSize, setPageSize] = useState(100);
  const focusPage = focusIndex < 0 ? null : Math.floor(focusIndex / pageSize) + 1;
  const pageCount = Math.max(1, Math.ceil(count / pageSize));
  const [state, setState] = useState({ page: focusPage ?? 1, filterKey, focusId, focusPage, pageSize });
  const reset = state.filterKey !== filterKey || state.pageSize !== pageSize;
  const focusChanged = state.focusId !== focusId || state.focusPage === null || (!reset && state.focusPage !== focusPage);
  const page = focusPage !== null && focusChanged
    ? focusPage
    : reset ? 1 : Math.min(state.page, pageCount);
  if (page !== state.page || reset || state.focusId !== focusId || state.focusPage !== focusPage) {
    setState({ page, filterKey, focusId, focusPage, pageSize });
  }

  return {
    start: (page - 1) * pageSize,
    end: page * pageSize,
    pager: { page, pageCount, pageSize, onPageSizeChange: setPageSize, onPageChange: (next: number) => setState({ ...state, page: next }) }
  };
}
