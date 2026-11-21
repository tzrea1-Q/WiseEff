import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listAllCanonicalPages } from "@/application/parameter-catalog/listAllCanonicalPages";
import { withCatalogReleasePin } from "@/application/parameter-catalog/urlAnchor";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import type { CatalogDocumentResponse, CatalogListQuery, CatalogSubjectListResponse } from "@/infrastructure/http/parameterCatalogDtos";

type NavigatorData =
  | { document: Extract<CatalogDocumentResponse, { item: null }>; subjects?: undefined; modules?: undefined }
  | {
    document: Exclude<CatalogDocumentResponse, { item: null }>;
    subjects: CatalogSubjectListResponse;
    modules: ParameterModule[];
  };

export function useCatalogNavigator({
  repository, moduleRegistry, organizationId, releaseId, refreshEpoch, libraryMode = false, enabled = true
}: {
  repository: ParameterCatalogRepository;
  moduleRegistry?: Pick<ParameterModuleRegistryRepository, "getRegistry">;
  organizationId?: string;
  releaseId: string | null;
  refreshEpoch: number;
  libraryMode?: boolean;
  enabled?: boolean;
}) {
  const scope = useMemo(() => ({ repository, moduleRegistry, organizationId, libraryMode }),
    [repository, moduleRegistry, organizationId, libraryMode]);
  const [state, setState] = useState<{
    scope: typeof scope;
    releaseId: string | null;
    refreshEpoch: number;
    data?: NavigatorData;
    pending: boolean;
    error?: unknown;
    registryFailed?: boolean;
  }>();
  const current = state?.scope === scope ? state : undefined;
  // Writing the release we just resolved into the URL keeps the same read.
  const pin = current?.releaseId === null && current.refreshEpoch === refreshEpoch &&
    current.data?.document.item?.catalogReleaseId === releaseId ? null : releaseId;
  const generation = useRef(0);
  const reload = useCallback(async (expectedCurrentRelease?: string) => {
    const request = ++generation.current;
    let failed = false;
    let registryFailed = false;
    const isCancelled = () => failed || request !== generation.current;
    const key = { scope, releaseId: pin, refreshEpoch };
    if (!expectedCurrentRelease) {
      setState(previous => ({ ...key, pending: true, data: previous?.scope === scope ? previous.data : undefined }));
    }
    try {
      await Promise.resolve();
      if (isCancelled()) return;
      const document = await repository.getCatalog(libraryMode ? { view: "library" } :
        withCatalogReleasePin(undefined, expectedCurrentRelease ? null : pin));
      if (isCancelled()) return;
      if (expectedCurrentRelease && document.item?.catalogReleaseId !== expectedCurrentRelease) throw new Error("目录发布已变化");
      let data: NavigatorData;
      if (!document.item) {
        data = { document };
      } else {
        const query: CatalogListQuery = { catalogReleaseId: document.item.catalogReleaseId, limit: 100,
          ...(libraryMode ? { view: "library" } : {}) };
        let firstPage: CatalogSubjectListResponse | undefined;
        const [active, retired, registry] = await Promise.all([
          listAllCanonicalPages(async params => {
            const page = await repository.listSubjects(params);
            firstPage ??= page;
            return page;
          }, query, { isCancelled }),
          libraryMode ? [] : listAllCanonicalPages(params => repository.listSubjects(params),
            { ...query, lifecycle: "retired" }, { isCancelled }),
          moduleRegistry?.getRegistry().catch(error => {
            registryFailed = true;
            throw error;
          })
        ]);
        if (isCancelled()) return;
        const items = [...new Map([...active, ...retired].map(item => [item.id, item])).values()];
        data = { document, modules: registry?.modules ?? [], subjects: {
          ...firstPage!, items, totalCount: items.length, hasMore: false, nextCursor: null
        } };
      }
      setState({ ...key, data, pending: false });
      return data;
    } catch (error) {
      if (!isCancelled() && !expectedCurrentRelease) {
        setState(previous => ({ ...key, data: previous?.data, pending: false, error, registryFailed }));
      }
      failed = true;
    }
  }, [scope, pin, refreshEpoch, repository, moduleRegistry, libraryMode]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
    return () => { generation.current += 1; };
  }, [enabled, reload]);
  const settled = current?.releaseId === pin && current.refreshEpoch === refreshEpoch && !current.pending;
  return {
    data: current?.data, pending: !settled, error: settled ? current.error : undefined,
    registryFailed: settled && current.registryFailed === true, reload
  };
}

export type CatalogNavigatorRead = ReturnType<typeof useCatalogNavigator>;
