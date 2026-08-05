import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { AuditEventListResponse } from "@/domain/audit/types";
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

  it("loads recent audit-center events into admin state after refresh", async () => {
    const response: AuditEventListResponse = {
      items: [
        {
          id: "ae-200",
          organizationId: "org-1",
          projectId: "aurora",
          actorUserId: "u-1",
          actorType: "user",
          actorName: "Riley",
          app: "parameter-admin",
          kind: "project-updated",
          action: "已更新项目「Aurora」",
          severity: "Low",
          targetType: "project",
          targetId: "aurora",
          metadata: {},
          traceId: "t-1",
          createdAt: "2026-08-05T12:00:00.000Z"
        }
      ],
      nextCursor: null
    };
    listAuditEvents.mockResolvedValue(response);

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

    await waitFor(() => {
      expect(screen.getByText("已更新项目「Aurora」")).toBeInTheDocument();
    });
    expect(listAuditEvents).toHaveBeenCalledWith({
      apps: ["parameter-management", "parameter-admin", "parameters"],
      limit: 8
    });
  });
});
