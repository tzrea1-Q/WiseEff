import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  buildParameterAdminSpecsPath,
  parseParameterAdminSpecsSubView,
  type ParameterAdminSpecsSubView
} from "@/application/parameters/parameterAdminOrganizationPath";
import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import { ViewSwitch } from "@/components/ui/view-switch";
import { presentError } from "@/infrastructure/http/presentError";
import { OrganizationIdentityMappingPanel } from "./OrganizationIdentityMappingPanel";
import { useParameterAdmin } from "./ParameterAdminProvider";

export type OrganizationSpecsAreaProps = {
  pathname: string;
  search: string;
  onNavigate: (path: string) => void;
  /** Live Catalog destination for `/parameter-admin/specs`. Identity-mapping stays nested. */
  catalogLibrary: ReactNode;
};

type MappingCountState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; openCount: number; historyCount: number };

/**
 * Parameter definition management area: library + embedded review queue, with
 * identity mapping nested under `/parameter-admin/specs/identity-mapping` (ADR-0015).
 */
export function OrganizationSpecsArea({
  pathname,
  search,
  onNavigate,
  catalogLibrary
}: OrganizationSpecsAreaProps) {
  const { application, dispatch } = useParameterAdmin();
  const [mappingCounts, setMappingCounts] = useState<MappingCountState>({ status: "loading" });

  const applyMappingCounts = useCallback(
    (openCount: number, historyCount: number) => {
      dispatch({ type: "SET_QUEUE_COUNTS", counts: { identityMapping: openCount } });
      setMappingCounts({ status: "ready", openCount, historyCount });
    },
    [dispatch]
  );

  const handleMappingTasksLoaded = useCallback(
    ({ openCount, historyCount }: { openCount: number; historyCount: number }) => {
      applyMappingCounts(openCount, historyCount);
    },
    [applyMappingCounts]
  );

  useEffect(() => {
    let cancelled = false;
    setMappingCounts({ status: "loading" });
    void application
      .listMappingTasks()
      .then((tasks) => {
        if (cancelled) return;
        const openCount = tasks.filter((task) => task.status === "open" || task.status === "dismissed").length;
        const historyCount = tasks.length - openCount;
        applyMappingCounts(openCount, historyCount);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // IA-R2: do not treat a failed count load as an empty queue.
        setMappingCounts({
          status: "error",
          message: presentError(error, PARAMETER_ADMIN_UI.identityMappingCountError)
        });
      });
    return () => {
      cancelled = true;
    };
  }, [application, applyMappingCounts]);

  const requestedSubView: ParameterAdminSpecsSubView =
    parseParameterAdminSpecsSubView(pathname) ?? "library";
  const hasMappingSurface =
    mappingCounts.status === "error" ||
    (mappingCounts.status === "ready" && mappingCounts.openCount > 0);
  const showSpecsSubNav = mappingCounts.status === "loading" || hasMappingSurface;
  const activeSubView: ParameterAdminSpecsSubView =
    requestedSubView === "identity-mapping" &&
    mappingCounts.status === "ready" &&
    !hasMappingSurface
      ? "library"
      : requestedSubView;

  useEffect(() => {
    if (
      requestedSubView === "identity-mapping" &&
      mappingCounts.status === "ready" &&
      !hasMappingSurface
    ) {
      const params = new URLSearchParams(search);
      params.set("review", "open");
      onNavigate(buildParameterAdminSpecsPath("library", params.toString()));
    }
  }, [hasMappingSurface, mappingCounts.status, onNavigate, requestedSubView, search]);

  const goToSubView = (subView: ParameterAdminSpecsSubView) => {
    onNavigate(buildParameterAdminSpecsPath(subView, search));
  };

  const openCount =
    mappingCounts.status === "ready" ? mappingCounts.openCount : undefined;

  return (
    <>
      {showSpecsSubNav ? (
        <ViewSwitch variant="section" ariaLabel={PARAMETER_ADMIN_UI.specsSubnavAria} value={activeSubView}
          onValueChange={(value) => goToSubView(value as ParameterAdminSpecsSubView)}
          items={[
            { value: "library", label: PARAMETER_ADMIN_UI.specsLibrarySubnav },
            { value: "identity-mapping",
              title: mappingCounts.status === "error" ? mappingCounts.message : undefined, label: <>
            {PARAMETER_ADMIN_UI.identityMapping}
            {mappingCounts.status === "error" ? (
              <span
                className="parameter-admin-specs-subnav__count is-error"
                aria-label={PARAMETER_ADMIN_UI.identityMappingCountError}
              >
                !
              </span>
            ) : openCount !== undefined && openCount > 0 ? (
              <span className="parameter-admin-specs-subnav__count">{openCount}</span>
            ) : mappingCounts.status === "loading" ? (
              <span className="parameter-admin-specs-subnav__count is-loading">…</span>
            ) : null}
              </> }
          ]} />
      ) : null}

      {activeSubView === "identity-mapping" ? (
        <OrganizationIdentityMappingPanel onTasksLoaded={handleMappingTasksLoaded} />
      ) : (
        catalogLibrary
      )}
    </>
  );
}
