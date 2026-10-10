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
