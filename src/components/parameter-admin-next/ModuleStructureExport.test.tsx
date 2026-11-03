import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ModuleStructureExport } from "./ModuleStructureExport";
import type { ApiClient } from "@/infrastructure/http/apiClient";

afterEach(() => vi.restoreAllMocks());

it("exports the authorized organization and reports complete counts", async () => {
  const post = vi.fn().mockResolvedValue({ counts: { modules: 12, subjects: 7 } });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:structure");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<ModuleStructureExport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canExport />);
  await userEvent.click(screen.getByRole("button", { name: "导出完整结构" }));
  await waitFor(() => expect(post).toHaveBeenCalledWith("/api/v2/organizations/org-a/module-structure/exports", {}));
  expect(await screen.findByRole("status")).toHaveTextContent("12 个模块，7 个主体");
});

it("keeps the guide available while export is disabled for a reader", () => {
  render(<ModuleStructureExport organizationId="org-a" canExport={false} />);
  expect(screen.getByRole("button", { name: "导出完整结构" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "下载填写说明" })).toBeEnabled();
  expect(screen.getByText(/导出需要组织管理权限/)).toBeInTheDocument();
});
