import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AuditWorkspace } from "./AuditWorkspace";
import type { AuditEvent } from "@/domain/prototype/types";
import { collectConsistencyMeasurements } from "../../../e2e/quality/consistency-collector";
import { requireRowActionVisibility } from "../../../e2e/quality/consistency-assertions";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([{ severity: "info", label: "信息" }, { severity: undefined, label: "未记录" }])("keeps audit row status measurable for wire severity $severity", ({ severity, label }) => {
  const { container } = render(<main><AuditWorkspace isApiMode={false}
    query={{ appGroup: "all", severity: "all", search: "", timeWindow: "all" }}
    mockEvents={[{ id: "audit-value", app: "parameter-bindings", kind: "project-value",
      action: "新增项目参数值", actor: "System", severity, time: "刚刚" } as AuditEvent]} /></main>);
  for (const element of container.querySelectorAll("*")) {
    element.getBoundingClientRect = () => new DOMRect(100, 100,
      element.matches("[data-row-status]") && !element.textContent?.trim() ? 0 : 120, 28);
    Object.defineProperty(element, "checkVisibility", { value: () => true });
  }
  const measurements = collectConsistencyMeasurements();
  expect(() => requireRowActionVisibility(measurements.rowActions, "/audit")).not.toThrow();
  expect(within(screen.getByRole("table", { name: "审计事件" })).getByText(label)).toBeVisible();
  expect(measurements.rowActions[0].actions).toHaveLength(2);
  expect(measurements.rowActions[0].statuses).toHaveLength(1);
});

it("opens the selected audit from a table action without changing query state", async () => {
  const onQueryChange = vi.fn();
  render(<AuditWorkspace isApiMode={false} onQueryChange={onQueryChange}
    query={{ appGroup: "all", severity: "all", search: "", timeWindow: "all" }}
    mockEvents={[{ id: "audit-1", app: "parameters", kind: "parameter-topology-governance",
      action: "value-change-applied", actor: "用户", severity: "Medium", time: "刚刚" }]} />);
  const table = screen.getByRole("table", { name: "审计事件" });
  await userEvent.click(within(table).getByRole("button", { name: "查看" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(onQueryChange).not.toHaveBeenCalled();
});

it("exports Chinese labels and untouched event codes in separate CSV columns", async () => {
  const blobs = vi.fn();
  vi.stubGlobal("Blob", class { constructor(parts: unknown[]) { blobs(parts); } });
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:audit"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<AuditWorkspace isApiMode={false} query={{ appGroup: "all", severity: "all", search: "", timeWindow: "all" }}
    mockEvents={[{ id: "audit-1", app: "parameters", kind: "parameter-topology-governance",
      action: "value-change-applied", actor: "用户", severity: "Medium", time: "刚刚" }]} />);
  await userEvent.click(screen.getByRole("button", { name: "导出 CSV" }));
  await waitFor(() => expect(blobs).toHaveBeenCalled());
  const csv = blobs.mock.calls[0][0][0] as string;
  expect(csv).toContain("类型,类型标识,操作,操作标识,操作人");
  expect(csv).toContain('"参数值变更已应用","value-change-applied"');
  expect(csv).toContain('"拓扑治理","parameter-topology-governance"');
});
