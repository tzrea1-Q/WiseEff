import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { WiseEffApiError, type ApiClient } from "@/infrastructure/http/apiClient";
import { ModuleStructureImport } from "./ModuleStructureImport";

const permissions = ["catalog:author", "catalog:publish"];
const driver = { ref: "fm1230", compatible: "fdw,fm1230_swi", driverNature: "physical-device", instanceCardinality: "multiple",
  displayAlias: "防伪驱动", placement: { kind: "module", moduleRef: "battery" } };
const document = { source: { organizationId: "org-a", exportId: "export-a" }, modules: [
  { ref: "power", name: "电源", parentRef: null }, { ref: "battery", name: "电池防伪", parentRef: "power" },
], subjects: [], newDrivers: [driver] };
const preview = (phase: "required" | "publishing" | "ready" | "blocked", token = phase) => ({
  token, changes: [], conflicts: [], impact: [], driverCreation: { phase, drivers: [
    phase === "ready" ? { ...driver, subjectId: "new-driver" } : driver,
  ], ...(phase === "required" ? {} : { candidateId: "candidate-a", jobId: "job-a" }) },
});
const readyPreview = () => ({ ...preview("ready"), changes: [{ moduleId: "subject:new-driver", field: "placement", before: null,
  after: { kind: "module", moduleRef: "battery" } }] });
const receipt = { id: "created", organizationId: "org-a", changedModules: 2, changedFields: 4 };

async function openFile(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "导入结构" }));
  await user.upload(screen.getByLabelText("JSON 文件"), new File([JSON.stringify(document)], "new-drivers.json", { type: "application/json" }));
  await user.click(screen.getByRole("button", { name: "预览" }));
  await screen.findByRole("region", { name: "新增驱动预览" });
}

async function confirmPublication(user: ReturnType<typeof userEvent.setup>, label = "发布新驱动") {
  await user.click(screen.getByRole("button", { name: label }));
  const dialog = screen.getByRole("dialog", { name: "发布新驱动？" });
  const confirm = within(dialog).getByRole("button", { name: "确认发布新驱动" });
  expect(confirm).toBeDisabled();
  expect(dialog).toHaveTextContent("共享目录");
  await user.click(within(dialog).getByRole("checkbox", { name: "我已核对影响并确认发布到共享目录" }));
  await user.click(confirm);
}

it("publishes declared drivers with an acknowledgement, then requires a separate fresh organization confirmation", async () => {
  const post = vi.fn().mockResolvedValueOnce(preview("required")).mockResolvedValueOnce(preview("publishing"))
    .mockResolvedValueOnce(readyPreview()).mockResolvedValueOnce(receipt);
  const changed = vi.fn();
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport sessionPermissions={permissions} onChanged={changed} />);
  await openFile(user);
  const drivers = screen.getByRole("region", { name: "新增驱动预览" });
  expect(drivers).toHaveTextContent("防伪驱动");
  expect(drivers).toHaveTextContent("fdw,fm1230_swi");
  expect(drivers).toHaveTextContent("电源 / 电池防伪");
  expect(screen.getByRole("button", { name: "发布新驱动" })).toBeDisabled();
  await user.type(screen.getByLabelText("变更原因"), "新增防伪驱动");
  await confirmPublication(user);
  expect(await screen.findByLabelText("驱动创建进度")).toHaveTextContent("正在发布新驱动，模块与组织登记尚未提交");
  expect(screen.getByRole("button", { name: "确认提交" })).toBeDisabled();
  expect(screen.getByLabelText("JSON 文件")).toBeDisabled();
  expect(changed).not.toHaveBeenCalled();
  expect(post.mock.calls[1]).toEqual(["/api/v2/organizations/org-a/module-structure/driver-publications", expect.objectContaining({
    document, token: "required", reason: "新增防伪驱动", idempotencyKey: expect.any(String),
  })]);
  await user.click(screen.getByRole("button", { name: "刷新发布进度" }));
  expect(await screen.findByLabelText("驱动创建进度")).toHaveTextContent("驱动已发布，模块与归属尚未提交");
  expect(changed).not.toHaveBeenCalled();
  expect(post.mock.calls[2][1]).toMatchObject({ document });
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  expect(await screen.findByText(/回执 created/)).toBeInTheDocument();
  expect(post.mock.calls[3]).toEqual(["/api/v2/organizations/org-a/module-structure/applies", expect.objectContaining({ document, token: "ready" })]);
  expect(changed).toHaveBeenCalledTimes(1);
});

it("does not treat organization import permission as publication permission", async () => {
  const post = vi.fn().mockResolvedValue(preview("required"));
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport sessionPermissions={["catalog:author"]} />);
  await openFile(user);
  await user.type(screen.getByLabelText("变更原因"), "新增");
  expect(screen.getByRole("alert")).toHaveTextContent("没有目录编写或发布权限");
  expect(screen.getByRole("button", { name: "发布新驱动" })).toBeDisabled();
  expect(post).toHaveBeenCalledTimes(1);
});

it("keeps a failed publication request key for explicit retry and distinguishes the publish phase", async () => {
  const post = vi.fn().mockResolvedValueOnce(preview("required")).mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce(preview("publishing"));
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport sessionPermissions={permissions} />);
  await openFile(user);
  await user.type(screen.getByLabelText("变更原因"), "新增");
  await confirmPublication(user);
  expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败");
  await user.click(screen.getByText("诊断详情（可提供给编码代理）"));
  expect((screen.getByLabelText("导入诊断信息") as HTMLTextAreaElement).value).toContain('"phase": "publish"');
  await confirmPublication(user);
  expect(await screen.findByLabelText("驱动创建进度")).toHaveTextContent("正在发布新驱动");
  expect(post.mock.calls[1][1].idempotencyKey).toBe(post.mock.calls[2][1].idempotencyKey);
});

it("preserves an in-flight publication when closing and reopening the import dialog", async () => {
  const post = vi.fn().mockResolvedValueOnce(preview("required")).mockResolvedValueOnce(preview("publishing"))
    .mockResolvedValueOnce(readyPreview());
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport sessionPermissions={permissions} />);
  await openFile(user);
  await user.type(screen.getByLabelText("变更原因"), "新增");
  await confirmPublication(user);
  await user.click(screen.getByRole("button", { name: "关闭" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "导入结构" }));
  expect(screen.getByText(/文件：new-drivers.json/)).toBeInTheDocument();
  expect(screen.getByLabelText("驱动创建进度")).toHaveTextContent("正在发布新驱动");
  await user.click(screen.getByRole("button", { name: "刷新发布进度" }));
  expect(await screen.findByLabelText("驱动创建进度")).toHaveTextContent("驱动已发布");
  expect(post.mock.calls.filter(([path]) => String(path).endsWith("/driver-publications"))).toHaveLength(1);
});

it("starts a new acknowledged attempt after a confirmed failed job but preserves that key after transport failure", async () => {
  const post = vi.fn().mockResolvedValueOnce(preview("required")).mockResolvedValueOnce(preview("blocked"))
    .mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(preview("publishing"));
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport sessionPermissions={permissions} />);
  await openFile(user);
  await user.type(screen.getByLabelText("变更原因"), "新增");
  await confirmPublication(user);
  expect(await screen.findByLabelText("驱动创建进度")).toHaveTextContent("暂时无法继续");
  await confirmPublication(user, "重新发布驱动");
  expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败");
  await confirmPublication(user, "重新发布驱动");
  expect(await screen.findByLabelText("驱动创建进度")).toHaveTextContent("正在发布新驱动");
  expect(post.mock.calls[1][1].idempotencyKey).not.toBe(post.mock.calls[2][1].idempotencyKey);
  expect(post.mock.calls[2][1].idempotencyKey).toBe(post.mock.calls[3][1].idempotencyKey);
});

it("resumes published drivers from a reuploaded original file without another publication", async () => {
  const post = vi.fn().mockResolvedValueOnce(readyPreview()).mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce(receipt);
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport sessionPermissions={permissions} />);
  await openFile(user);
  expect(screen.queryByRole("button", { name: "发布新驱动" })).not.toBeInTheDocument();
  expect(screen.getByText(/重新上传同一份 JSON/)).toBeInTheDocument();
  await user.type(screen.getByLabelText("变更原因"), "继续登记");
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败");
  await user.click(screen.getByRole("button", { name: "确认提交" }));
  expect(await screen.findByText(/回执 created/)).toBeInTheDocument();
  expect(post.mock.calls[1][1].idempotencyKey).toBe(post.mock.calls[2][1].idempotencyKey);
  expect(post.mock.calls.some(([path]) => String(path).endsWith("/driver-publications"))).toBe(false);
});

it("polls publication progress without silently applying the organization changes", async () => {
  const post = vi.fn().mockResolvedValueOnce(preview("publishing")).mockResolvedValueOnce(readyPreview());
  const changed = vi.fn();
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport sessionPermissions={permissions} onChanged={changed} />);
  await openFile(user);
  await waitFor(() => expect(screen.getByLabelText("驱动创建进度")).toHaveTextContent("驱动已发布"), { timeout: 3000 });
  expect(post).toHaveBeenCalledTimes(2);
  expect(post.mock.calls.every(([path]) => String(path).endsWith("/previews"))).toBe(true);
  expect(changed).not.toHaveBeenCalled();
});

it("shows blocked publication status and requires an explicit acknowledged retry", async () => {
  const blocked = preview("blocked");
  const post = vi.fn().mockResolvedValueOnce({ ...blocked, driverCreation: { ...blocked.driverCreation, message: "目录发布已冻结，请联系管理员处理后重新预览。" } })
    .mockResolvedValueOnce(preview("publishing"));
  const user = userEvent.setup();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport sessionPermissions={permissions} />);
  await openFile(user);
  await user.type(screen.getByLabelText("变更原因"), "新增");
  expect(screen.getByText("目录发布已冻结，请联系管理员处理后重新预览。")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "确认提交" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "预览" })).toBeEnabled();
  expect(post).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "重新发布驱动" }));
  expect(screen.getByRole("button", { name: "确认发布新驱动" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: "我已核对影响并确认发布到共享目录" }));
  await user.click(screen.getByRole("button", { name: "确认发布新驱动" }));
  expect(await screen.findByLabelText("驱动创建进度")).toHaveTextContent("正在发布新驱动");
});

it("copies the new-driver declaration identity and exact field diagnostic", async () => {
  const issue = { path: "document.newDrivers.0.compatible", jsonPointer: "/newDrivers/0/compatible", code: "invalid-compatible",
    message: "compatible 必须为精确标识。", received: "fdw,*", rule: "不支持通配符。", hint: "填写 DTS 中的精确 compatible。",
    newDriver: { ref: "fm1230", compatible: "fdw,*", displayAlias: "防伪驱动", index: 0 } };
  const post = vi.fn().mockRejectedValue(new WiseEffApiError("VALIDATION_FAILED", "新驱动校验失败。", { issues: [issue] }, "driver-request", 400));
  const user = userEvent.setup();
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  render(<ModuleStructureImport apiClient={{ post } as unknown as ApiClient} organizationId="org-a" canImport sessionPermissions={permissions} />);
  await user.click(screen.getByRole("button", { name: "导入结构" }));
  await user.upload(screen.getByLabelText("JSON 文件"), new File([JSON.stringify(document)], "new-drivers.json", { type: "application/json" }));
  await user.click(screen.getByRole("button", { name: "预览" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("新驱动：防伪驱动 · fm1230 · fdw,* · newDrivers[0]");
  expect(alert).toHaveTextContent("/newDrivers/0/compatible");
  expect(alert).toHaveTextContent("填写 DTS 中的精确 compatible");
  await user.click(screen.getByRole("button", { name: "复制诊断信息" }));
  expect(JSON.parse(String(copy.mock.calls[0][0]))).toMatchObject({ issues: [expect.objectContaining({ newDriver: issue.newDriver })] });
});
