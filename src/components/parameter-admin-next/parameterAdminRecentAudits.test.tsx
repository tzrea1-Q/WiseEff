import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { initialParameterAdminState } from "@/application/parameters/parameterAdminState";
import { ParameterAdminProvider, useParameterAdmin } from "./ParameterAdminProvider";
import { useRefreshParameterAdminRecentAudits } from "./useRefreshParameterAdminRecentAudits";

const listAuditEvents = vi.fn();

vi.mock("@/infrastructure/http/auditClient", () => ({
  createAuditClient: () => ({
    listAuditEvents: (...args: unknown[]) => listAuditEvents(...args)
  })
}));

function Harness() {
  const refresh = useRefreshParameterAdminRecentAudits();
  const { state } = useParameterAdmin();
  return (
    <div>
      <button type="button" onClick={() => void refresh()}>
        refresh
      </button>
      <ul aria-label="recent-audits">
        {state.recentAuditEvents.map((event) => (
          <li key={event.id}>{event.summary}</li>
        ))}
      </ul>
    </div>
  );
}

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

describe("parameter-admin recent audit projection", () => {
  beforeEach(() => {
    listAuditEvents.mockReset();
  });

  it("does not fetch the audit API in mock runtime", async () => {
    render(
      <ParameterAdminProvider
        topology={stubTopology as never}
        moduleRegistry={stubModules as never}
        initialState={initialParameterAdminState}
      >
        <Harness />
      </ParameterAdminProvider>
    );

    screen.getByRole("button", { name: "refresh" }).click();
    await Promise.resolve();

    expect(listAuditEvents).not.toHaveBeenCalled();
    expect(screen.getByLabelText("recent-audits").childElementCount).toBe(0);
  });
});
