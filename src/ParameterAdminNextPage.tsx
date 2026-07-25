import { useMemo } from "react";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import { resolveParameterTopologyRepository } from "@/application/parameters/parameterTopologyResolve";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { OrganizationSpecGovernancePanel } from "@/components/parameter-admin-next/OrganizationSpecGovernancePanel";
import { ParameterAdminNextProjectStub } from "@/components/parameter-admin-next/ParameterAdminNextProjectStub";
import { ParameterAdminNextScopeNav } from "@/components/parameter-admin-next/ParameterAdminNextScopeNav";
import { ParameterAdminProvider } from "@/components/parameter-admin-next/ParameterAdminProvider";

export type ParameterAdminNextPageProps = {
  area: "organization" | "projects";
  onNavigate: (path: string) => void;
  search: string;
  runtimeMode?: WiseEffRuntimeMode;
  /** Injected at the port seam for tests; production resolves from runtime mode. */
  parameterTopologyRepository?: ParameterTopologyRepository;
};

/**
 * Temporary construction surface for the redesigned parameter admin (#190).
 * Canonical `/parameter-admin` stays on the legacy tree until ticket 09.
 */
export function ParameterAdminNextPage({
  area,
  onNavigate,
  search,
  runtimeMode = "mock",
  parameterTopologyRepository
}: ParameterAdminNextPageProps) {
  const topology = useMemo(
    () => parameterTopologyRepository ?? resolveParameterTopologyRepository(runtimeMode),
    [parameterTopologyRepository, runtimeMode]
  );
  const pathname = area === "projects" ? "/parameter-admin-next/projects" : "/parameter-admin-next";

  return (
    <ParameterAdminProvider topology={topology}>
      <div className="param-admin-shell">
        <ParameterAdminNextScopeNav active={area} onNavigate={onNavigate} />
        {area === "projects" ? (
          <ParameterAdminNextProjectStub />
        ) : (
          <OrganizationSpecGovernancePanel search={search} pathname={pathname} />
        )}
      </div>
    </ParameterAdminProvider>
  );
}
