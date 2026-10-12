import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AuditWorkspace } from "./AuditWorkspace";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
