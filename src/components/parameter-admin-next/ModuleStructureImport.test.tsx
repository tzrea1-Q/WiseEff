import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { ApiClient } from "@/infrastructure/http/apiClient";
import { ModuleStructureImport } from "./ModuleStructureImport";

it("re-previews conflict choices and preserves the request key for a failed apply retry", async () => {
  const post = vi.fn().mockResolvedValueOnce({ changes: [], conflicts: [{ key: "a:name", moduleId: "a", field: "name", baseline: "old", file: "file", current: "current" }], token: "one" })
    .mockResolvedValueOnce({ changes: [{ moduleId: "a", field: "name", before: "current", after: "file" }], conflicts: [], token: "two" })
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce({ id: "receipt", organizationId: "org-a", changedModules: 1, changedFields: 1 });
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport />);
  await user.click(screen.getByRole("button", { name: "导入结构" }));
  await user.upload(screen.getByLabelText("JSON 文件"), new File(['{"source":{"organizationId":"org-a"}}'], "edit.json", { type: "application/json" }));
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  await user.click(screen.getByRole("button", { name: "预览" }));
  expect(await screen.findByText('"old"')).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "确认提交" })).toBeDisabled();
  await user.click(screen.getByLabelText("a:name 的冲突选择"));
  await user.click(screen.getByRole("option", { name: "采用文件" }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  await user.type(screen.getByLabelText("变更原因"), "reviewed");
  await user.click(await screen.findByRole("button", { name: "确认提交" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败");
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  expect(await screen.findByText(/回执 receipt/)).toBeInTheDocument();
  expect(post.mock.calls[2][1].idempotencyKey).toBe(post.mock.calls[3][1].idempotencyKey);
  const cleanUnload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(cleanUnload);
  expect(cleanUnload.defaultPrevented).toBe(false);
});

it("reports a no-op receipt", async () => {
  const post = vi.fn().mockResolvedValueOnce({ changes: [], conflicts: [], token: "no-op" })
    .mockResolvedValueOnce({ id: "unchanged", organizationId: "org-a", changedModules: 0, changedFields: 0 });
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport />);
  await user.click(screen.getByRole("button", { name: "导入结构" }));
  await user.upload(screen.getByLabelText("JSON 文件"), new File(["{}"], "same.json", { type: "application/json" }));
  await user.click(screen.getByRole("button", { name: "预览" }));
  await user.type(await screen.findByLabelText("变更原因"), "unchanged");
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  expect(await screen.findByRole("status")).toHaveTextContent("没有领域数据变更");
});
