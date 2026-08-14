import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialParameterAdminState } from "@/application/parameters/parameterAdminState";
import { OrganizationIdentityMappingPanel } from "./OrganizationIdentityMappingPanel";
import { ParameterAdminProvider } from "./ParameterAdminProvider";

const stubTopology = {
  listSpecs: vi.fn(),
  getSpec: vi.fn(),
  listReviewTasks: vi.fn(),
  resolveReviewTask: vi.fn(),
  listMappingTasks: vi.fn(),
  resolveMapping: vi.fn(),
  reopenMapping: vi.fn(),
  activateParameterSpec: vi.fn(),
  updateParameterSpec: vi.fn(),
  deprecateParameterSpec: vi.fn(),
  restoreParameterSpec: vi.fn(),
  reattributeParameterSpec: vi.fn(),
  renameParameterSpecPropertyKey: vi.fn(),
  prepareSpecVersionCutover: vi.fn(),
  finalizeSpecVersionCutover: vi.fn()
};

const stubModules = {
  getRegistry: vi.fn(),
  getDiscoveryHints: vi.fn(),
  dismissCompatible: vi.fn(),
  restoreDismissedCompatible: vi.fn(),
  createModule: vi.fn(),
  updateModule: vi.fn(),
  deleteModule: vi.fn(),
  previewMapping: vi.fn(),
  createMapping: vi.fn(),
  deleteMapping: vi.fn(),
  recomputeBindings: vi.fn(),
  listDriverRegistry: vi.fn(),
  registerOrClaimDriver: vi.fn(),
  updateDriverRegistration: vi.fn(),
  updateDriverRegistrationDefault: vi.fn(),
  replayDriverPlacement: vi.fn(),
  createOrganizationDriverSchema: vi.fn(),
  listOrganizationDriverSchemas: vi.fn(),
  updateOrganizationDriverSchema: vi.fn(),
  activateOrganizationDriverSchema: vi.fn()
};

describe("OrganizationIdentityMappingPanel", () => {
  beforeEach(() => {
    stubTopology.listMappingTasks.mockReset();
  });

  it("maps API failures to product-language copy when task list load fails", async () => {
    const { WiseEffApiError } = await import("@/infrastructure/http/apiClient");
    stubTopology.listMappingTasks.mockRejectedValue(
      new WiseEffApiError("FORBIDDEN", "Forbidden", {}, "req-identity-mapping-list")
    );

    render(
      <ParameterAdminProvider
        topology={stubTopology as never}
        moduleRegistry={stubModules as never}
        initialState={initialParameterAdminState}
      >
        <OrganizationIdentityMappingPanel />
      </ParameterAdminProvider>
    );

    expect(await screen.findByText("没有权限执行该操作。")).toBeInTheDocument();
  });
});
