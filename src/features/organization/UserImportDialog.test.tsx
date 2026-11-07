import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import type { UserGovernanceActions } from "@/UserPermissionsPage";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { UserImportDialog } from "./UserImportDialog";

afterEach(() => { cleanup(); sessionStorage.clear(); });

async function openPreview(createUserImport: UserGovernanceActions["createUserImport"], readUserImport: UserGovernanceActions["readUserImport"]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["姓名", "用户名", "初始密码", "职务", "组织角色"], ["张三", "alice", "password-123", "", "访客"]]), "用户数据");
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const file = new File([bytes], "users.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes });
  const previewUserImport = vi.fn().mockResolvedValue({ organization: { id: "org", name: "组织", status: "active" }, rows: [{ row: 2, name: "张三", username: "alice", title: "User", roles: ["guest"] }], errors: [], total: 1, privilegedCount: 0, token: "preview" });
  const actions = { previewUserImport, createUserImport, readUserImport } as unknown as UserGovernanceActions;
  render(<UserImportDialog actorId="actor" organizationId="org" actions={actions} roleLabels={{ guest: "访客", "hardware-user": "硬件开发", "software-user": "软件开发", "hardware-committer": "硬件MDE", "software-committer": "软件MDE", admin: "管理员", "platform-admin": "平台超级管理员" }} canGrantPlatformAdmin={false} onClose={vi.fn()} onCreated={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText("选择填写后的 XLSX 文件")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("选择填写后的 XLSX 文件"), { target: { files: [file] } });
  fireEvent.click(await screen.findByRole("button", { name: "确认创建 1 位成员" }));
}

it("keeps a timed-out batch locator and recovers its committed result without a second creation", async () => {
  const createUserImport = vi.fn().mockRejectedValue(new WiseEffApiError("REQUEST_TIMEOUT", "Gateway timeout", {}, "", 408));
  const readUserImport = vi.fn().mockImplementation(async (importId: string) => ({ importId, organizationId: "org", count: 1, rows: [{ row: 2, userId: "user", name: "张三", username: "alice" }] }));
  await openPreview(createUserImport, readUserImport);
  expect(await screen.findByText("结果尚未确认", { exact: true })).toBeVisible();
  const locator = JSON.parse(sessionStorage.getItem("wiseeff.user-import.pending")!);
  expect(locator).toMatchObject({ actorId: "actor", organizationId: "org", importId: expect.any(String) });
  fireEvent.click(screen.getByRole("button", { name: "使用原批次重试" }));
  expect(await screen.findByRole("heading", { name: "创建完成" })).toBeVisible();
  expect(readUserImport).toHaveBeenCalledWith(locator.importId);
  expect(createUserImport).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem("wiseeff.user-import.pending")).toBeNull();
});

it("clears the locator when the application confirms rollback", async () => {
  const create = vi.fn().mockRejectedValue(new WiseEffApiError("INTERNAL_ERROR", "已确认回滚", { code: "import-rolled-back" }, "", 500));
  await openPreview(create, vi.fn());
  expect(await screen.findByText("未创建任何账号", { exact: true })).toBeVisible();
  expect(sessionStorage.getItem("wiseeff.user-import.pending")).toBeNull();
});

it.each(["import-preview-stale", "import-username-conflict"])("requires a new preflight after the application rejects %s", async (code) => {
  const create = vi.fn().mockRejectedValue(new WiseEffApiError("CONFLICT", "请重新预检。", { code }, "", 409));
  await openPreview(create, vi.fn());
  expect(await screen.findByText("未创建任何账号", { exact: true })).toBeVisible();
  expect(sessionStorage.getItem("wiseeff.user-import.pending")).toBeNull();
  expect(screen.queryByRole("button", { name: "确认创建 1 位成员" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("选择填写后的 XLSX 文件")).toBeEnabled();
});

it("keeps the locator when a retry is rejected after an earlier unknown response", async () => {
  const create = vi.fn()
    .mockRejectedValueOnce(new WiseEffApiError("REQUEST_TIMEOUT", "Gateway timeout", {}, "", 408))
    .mockRejectedValueOnce(new WiseEffApiError("CONFLICT", "预检已失效", { code: "import-preview-stale" }, "", 409));
  const lookup = vi.fn().mockRejectedValue(new WiseEffApiError("NOT_FOUND", "未确认", { code: "import-not-confirmed" }, "", 404));
  await openPreview(create, lookup);
  expect(await screen.findByText("结果尚未确认", { exact: true })).toBeVisible();
  const locator = sessionStorage.getItem("wiseeff.user-import.pending");
  fireEvent.click(screen.getByRole("button", { name: "使用原批次重试" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(sessionStorage.getItem("wiseeff.user-import.pending")).toBe(locator);
  expect(screen.getByText("结果尚未确认", { exact: true })).toBeVisible();
});
