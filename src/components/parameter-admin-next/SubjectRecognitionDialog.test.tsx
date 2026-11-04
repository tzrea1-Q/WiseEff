import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { createMockParameterCatalogGovernanceRepository } from "@/application/parameter-catalog/mockAdapter";
import { SubjectRecognitionDialog } from "./SubjectRecognitionDialog";

const item = { kind: "driver" as const, recognitionSubjectId: "driver", compatibles: ["vendor,driver"],
  driverNature: "physical-device" as const, instanceCardinality: "multiple" as const, nodeTypeName: null, overridden: false };
function setup(canAdmin = true) {
  const governance = { ...createMockParameterCatalogGovernanceRepository(),
    getRegistrationRecognition: vi.fn().mockResolvedValue({ item, etag: '"rules-1"' }),
    updateRegistrationRecognition: vi.fn().mockResolvedValue({ item: { ...item, overridden: true } }) };
  const onClose = vi.fn();
  render(<SubjectRecognitionDialog governance={governance} organizationId="org" registrationId="registration"
    catalogReleaseId="release" name="vendor,driver" canAdmin={canAdmin} onClose={onClose} />);
  return { governance, onClose };
}

it.each(["关闭", "Escape", "遮罩"])("protects unsaved recognition edits via %s", async (method) => {
  const { onClose } = setup();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("compatible 匹配规则"), "\nvendor,second");
  const dismiss = async () => {
    if (method === "关闭") await user.click(screen.getByRole("button", { name: "关闭" }));
    else if (method === "Escape") await user.keyboard("{Escape}");
    else {
      const backdrop = screen.getByRole("dialog", { name: "识别规则：vendor,driver" }).parentElement!;
      fireEvent.pointerDown(backdrop); fireEvent.pointerUp(backdrop);
    }
  };
  await dismiss();
  expect(onClose).not.toHaveBeenCalled();
  const confirm = screen.getByRole("dialog", { name: "放弃未保存的识别规则？" });
  await user.click(within(confirm).getByRole("button", { name: "继续编辑" }));
  expect(screen.getByLabelText("compatible 匹配规则")).toHaveValue("vendor,driver\nvendor,second");
  await dismiss();
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  expect(onClose).toHaveBeenCalledOnce();
});

it("explains inheritance, multiline input and preserves edits after a failed save", async () => {
  const { governance, onClose } = setup();
  governance.updateRegistrationRecognition.mockRejectedValue(new Error("failure"));
  const user = userEvent.setup();
  expect(await screen.findByText("当前继承目录规则")).toBeVisible();
  expect(screen.getByText(/每行填写一个 compatible/)).toBeVisible();
  await user.type(screen.getByLabelText("compatible 匹配规则"), "\nvendor,second");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("保存识别规则失败");
  expect(screen.getByLabelText("compatible 匹配规则")).toHaveValue("vendor,driver\nvendor,second");
  expect(onClose).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(governance.updateRegistrationRecognition).toHaveBeenCalledTimes(2));
  expect(governance.updateRegistrationRecognition.mock.calls[0]?.[3]).toEqual(governance.updateRegistrationRecognition.mock.calls[1]?.[3]);
});

it("shows recognition rules read-only without save access", async () => {
  setup(false);
  expect(await screen.findByLabelText("compatible 匹配规则")).toHaveAttribute("readonly");
  expect(screen.getByText("当前账号可查看规则，请联系组织管理员修改。")).toBeVisible();
  expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
});

it("retries a failed initial read and closes unchanged rules without prompting", async () => {
  const governance = { ...createMockParameterCatalogGovernanceRepository(), getRegistrationRecognition: vi.fn()
    .mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ item, etag: '"rules-1"' }) };
  const onClose = vi.fn();
  render(<SubjectRecognitionDialog governance={governance} organizationId="org" registrationId="registration"
    catalogReleaseId="release" name="vendor,driver" canAdmin onClose={onClose} />);
  const user = userEvent.setup();
  expect(await screen.findByRole("alert")).toHaveTextContent("无法加载识别规则");
  await user.click(screen.getByRole("button", { name: "重新加载" }));
  expect(await screen.findByLabelText("compatible 匹配规则")).toHaveValue("vendor,driver");
  await user.click(screen.getByRole("button", { name: "关闭" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog", { name: "放弃未保存的识别规则？" })).not.toBeInTheDocument();
});

it("saves node recognition through its versioned organization registration", async () => {
  const governance = { ...createMockParameterCatalogGovernanceRepository(),
    getRegistrationRecognition: vi.fn().mockResolvedValue({ item: { ...item, kind: "node-type", nodeTypeName: "checker", overridden: true }, etag: '"node-rules"' }),
    updateRegistrationRecognition: vi.fn().mockResolvedValue({ item }) };
  const onClose = vi.fn();
  const onChanged = vi.fn();
  render(<SubjectRecognitionDialog governance={governance} organizationId="org" registrationId="node-registration"
    catalogReleaseId="release" name="checker" canAdmin onClose={onClose} onChanged={onChanged} />);
  const user = userEvent.setup();
  const name = await screen.findByLabelText("节点类型名");
  expect(screen.getByText("当前使用组织覆盖规则")).toBeVisible();
  await user.clear(name); await user.type(name, " checker-new ");
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(governance.updateRegistrationRecognition).toHaveBeenCalledWith("org", "node-registration", { nodeTypeName: "checker-new" },
    expect.objectContaining({ catalogReleaseId: "release", ifMatch: '"node-rules"', idempotencyKey: expect.any(String) }));
  expect(onChanged).toHaveBeenCalledOnce();
});
