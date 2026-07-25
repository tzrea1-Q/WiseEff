import { useCallback, useEffect, useState } from "react";
import {
  applyParameterAdminSearchToLocation,
  buildParameterAdminSearch,
  parseParameterAdminUrl,
  type ParameterAdminUrlState
} from "@/application/parameters/parameterAdminUrl";

/**
 * URL is the source of truth for admin filters, sort, and selection.
 * Local state mirrors location so pushState updates re-render without a router.
 */
export function useParameterAdminUrl(search: string, pathname: string) {
  const [urlState, setUrlState] = useState<ParameterAdminUrlState>(() => parseParameterAdminUrl(search));

  useEffect(() => {
    setUrlState(parseParameterAdminUrl(search));
  }, [search]);

  useEffect(() => {
    const syncFromHistory = () => {
      setUrlState(parseParameterAdminUrl(window.location.search));
    };
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, []);

  const updateUrl = useCallback(
    (patch: Partial<ParameterAdminUrlState>) => {
      setUrlState((current) => {
        const next = { ...current, ...patch };
        const nextSearch = buildParameterAdminSearch(patch, current);
        applyParameterAdminSearchToLocation(nextSearch, pathname);
        return next;
      });
    },
    [pathname]
  );

  return { urlState, updateUrl };
}
