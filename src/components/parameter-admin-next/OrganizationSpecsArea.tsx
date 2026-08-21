import { useCallback, useEffect, useState } from "react";
import {
  buildParameterAdminSpecsPath,
  parseParameterAdminSpecsSubView,
  type ParameterAdminSpecsSubView
} from "@/application/parameters/parameterAdminOrganizationPath";
import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import { presentError } from "@/infrastructure/http/presentError";
import { OrganizationIdentityMappingPanel } from "./OrganizationIdentityMappingPanel";
import { OrganizationSpecGovernancePanel } from "./OrganizationSpecGovernancePanel";
import { useParameterAdmin } from "./ParameterAdminProvider";

export type OrganizationSpecsAreaProps = {
  pathname: string;
  search: string;
  onNavigate: (path: string) => void;
  isPlatformSuperAdmin?: boolean;
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
  isPlatformSuperAdmin = false
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
        const openCount = tasks.filter((task) => task.status === "open").length;
        const historyCount = tasks.filter((task) => task.status !== "open").length;
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
    (mappingCounts.status === "ready" &&
      (mappingCounts.openCount > 0 || mappingCounts.historyCount > 0));
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
      onNavigate(buildParameterAdminSpecsPath("library", search));
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
        <nav className="parameter-admin-specs-subnav" aria-label={PARAMETER_ADMIN_UI.specsSubnavAria}>
          <button
            type="button"
            className={`parameter-admin-specs-subnav__tab${
              activeSubView === "library" ? " is-active" : ""
            }`}
            aria-current={activeSubView === "library" ? "page" : undefined}
            onClick={() => goToSubView("library")}
          >
            {PARAMETER_ADMIN_UI.specsLibrarySubnav}
          </button>
          <button
            type="button"
            className={`parameter-admin-specs-subnav__tab${
              activeSubView === "identity-mapping" ? " is-active" : ""
            }`}
            aria-current={activeSubView === "identity-mapping" ? "page" : undefined}
            onClick={() => goToSubView("identity-mapping")}
            aria-invalid={mappingCounts.status === "error" ? true : undefined}
            title={
              mappingCounts.status === "error" ? mappingCounts.message : undefined
            }
          >
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
          </button>
        </nav>
      ) : null}

      {activeSubView === "identity-mapping" ? (
        <OrganizationIdentityMappingPanel onTasksLoaded={handleMappingTasksLoaded} />
      ) : (
        <OrganizationSpecGovernancePanel
          search={search}
          pathname={pathname}
          isPlatformSuperAdmin={isPlatformSuperAdmin}
          onNavigate={onNavigate}
          onOpenIdentityMapping={
            hasMappingSurface ? () => goToSubView("identity-mapping") : undefined
          }
          identityMappingOpenCount={openCount}
          identityMappingCountError={
            mappingCounts.status === "error" ? mappingCounts.message : null
          }
        />
      )}
    </>
  );
}
