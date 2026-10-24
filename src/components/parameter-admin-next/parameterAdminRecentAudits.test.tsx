import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { initialParameterAdminState } from "@/application/parameters/parameterAdminState";
import { ParameterAdminProvider, useParameterAdmin } from "./ParameterAdminProvider";
import { useRefreshParameterAdminRecentAudits } from "./useRefreshParameterAdminRecentAudits";
import { createApiClient, type ApiClient } from "@/infrastructure/http/apiClient";

const runtime = vi.hoisted(() => ({ wiseEffRuntimeMode: "mock" }));
vi.mock("@/infrastructure/http/runtimeMode", () => runtime);

function Harness({ apiClient }: { apiClient?: ApiClient }) {
  const refresh = useRefreshParameterAdminRecentAudits(apiClient);
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
  listMappingTasks: vi.fn(),
};

const stubModules = {
  getRegistry: vi.fn(),
  createModule: vi.fn(),
  updateModule: vi.fn(),
  deleteModule: vi.fn(),
  listDriverRegistry: vi.fn()
};

describe("parameter-admin recent audit projection", () => {
  beforeEach(() => {
    runtime.wiseEffRuntimeMode = "mock";
  });

  it("does not fetch the audit API in mock runtime", async () => {
    const fetchImpl = vi.fn();
    render(
      <ParameterAdminProvider
        topology={stubTopology as never}
        moduleRegistry={stubModules as never}
        initialState={initialParameterAdminState}
      >
        <Harness apiClient={createApiClient({ baseUrl: "", fetchImpl })} />
      </ParameterAdminProvider>
    );

    screen.getByRole("button", { name: "refresh" }).click();
    await Promise.resolve();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(screen.getByLabelText("recent-audits").childElementCount).toBe(0);
  });

  it("refreshes the selected Organization's audit projection after a business action", async () => {
    runtime.wiseEffRuntimeMode = "api";
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ items: [{ id: "target-audit", action: "目标项目已更新", kind: "project-updated", createdAt: "2026-10-23T00:00:00Z" }], nextCursor: null }), { status: 200 }));
    render(<ParameterAdminProvider topology={stubTopology as never} moduleRegistry={stubModules as never} initialState={initialParameterAdminState}>
      <Harness apiClient={createApiClient({ baseUrl: "", fetchImpl, organizationId: "target" })} />
    </ParameterAdminProvider>);
    screen.getByRole("button", { name: "refresh" }).click();
    await waitFor(() => expect(screen.getByLabelText("recent-audits")).toHaveTextContent("目标项目已更新"));
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]), "http://localhost");
    expect(url.pathname).toBe("/api/v1/audit-events");
    expect(url.searchParams.get("organizationId")).toBe("target");
  });
});
