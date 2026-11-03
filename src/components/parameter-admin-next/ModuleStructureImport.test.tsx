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
  expect(await screen.findByText('old')).toBeInTheDocument();
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

it("requires an explicit target mapping before confirming a copy", async () => {
  const suggestion = { ref: "source", selected: null, frozen: false, candidates: [{ id: "target", name: "Power", suggested: true }] };
  const post = vi.fn().mockResolvedValueOnce({ changes: [], conflicts: [{ key: "mapping:source", field: "mapping" }], mappings: [suggestion], targets: [{ id: "target", name: "Power (target)" }], token: "one" })
    .mockResolvedValueOnce({ changes: [], conflicts: [], mappings: [{ ...suggestion, selected: "target" }], targets: [], token: "two" })
    .mockResolvedValueOnce({ id: "copied", organizationId: "target-org", changedModules: 0, changedFields: 0 });
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="target-org" canImport />);
  await user.click(screen.getByRole("button", { name: "导入结构" }));
  await user.click(screen.getByLabelText("导入模式")); await user.click(screen.getByRole("option", { name: "复制到当前组织" }));
  await user.upload(screen.getByLabelText("JSON 文件"), new File(['{"source":{"organizationId":"source-org"},"modules":[{"ref":"source","name":"Power"}]}'], "copy.json", { type: "application/json" }));
  await user.click(screen.getByRole("button", { name: "预览" }));
  expect(await screen.findByText(/来源组织：source-org；目标组织：target-org/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "确认提交" })).toBeDisabled();
  await user.click(screen.getByLabelText("source 的目标模块")); await user.click(screen.getByRole("option", { name: "建议：复用 Power" }));
  await user.type(await screen.findByLabelText("变更原因"), "Reviewed copy");
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  expect(await screen.findByText(/回执 copied/)).toBeInTheDocument();
  expect(post.mock.calls[1][1]).toMatchObject({ mode: "copy", mappings: { source: "target" } });
  expect(post.mock.calls[2][1]).toMatchObject({ mode: "copy", mappings: { source: "target" }, token: "two" });
});

it("shows the full placement path, unset and affected projects", async () => {
  const post = vi.fn().mockResolvedValue({ changes: [{ moduleId: "subject:driver", field: "placement",
    before: { kind: "unset" }, after: { kind: "module", moduleRef: "child" } }], conflicts: [],
    impact: [{ subjectId: "driver", projectId: "project-a", bindingCount: 2, definitions: ["definition-a"] }], token: "preview" });
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport />);
  await user.click(screen.getByRole("button", { name: "导入结构" }));
  await user.upload(screen.getByLabelText("JSON 文件"), new File([JSON.stringify({ modules: [
    { ref: "root", name: "电源", parentRef: null }, { ref: "child", name: "充电", parentRef: "root" },
  ] })], "edit.json", { type: "application/json" }));
  await user.click(screen.getByRole("button", { name: "预览" }));
  expect(await screen.findByText(/未设置归属 → 电源 \/ 充电/)).toBeInTheDocument();
  expect(screen.getByText(/主体 driver · 项目 project-a · 绑定 2 · 定义 definition-a/)).toBeInTheDocument();
});

it("groups subject changes and explains recognition settings field by field", async () => {
  const post = vi.fn().mockResolvedValue({ token: "preview", conflicts: [], changes: [
    { moduleId: "subject:driver", field: "state", before: "active", after: "retired" },
    { moduleId: "driver", field: "recognition", before: { mode: "inherit", effective: { compatibles: ["old"], driverNature: "physical-device" } },
      after: { overridden: true, compatibles: ["new"], driverNature: "physical-device" } },
  ] });
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport />);
  await user.click(screen.getByRole("button", { name: "导入结构" }));
  await user.upload(screen.getByLabelText("JSON 文件"), new File([JSON.stringify({ subjects: [{ subjectId: "driver", displayAlias: "充电驱动", kind: "driver" }] })], "edit.json", { type: "application/json" }));
  await user.click(screen.getByRole("button", { name: "预览" }));
  expect(await screen.findByText("充电驱动")).toBeInTheDocument();
  expect(screen.getByText(/启用 → 停用/)).toBeInTheDocument();
  expect(screen.getByText(/继承目录设置 → 自定义覆盖/)).toBeInTheDocument();
  expect(screen.getByText(/old → new/)).toBeInTheDocument();
});
