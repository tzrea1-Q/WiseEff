import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateSkillDialog } from "./CreateSkillDialog";
import { mockLogSkills, mockSkillTemplates, mockSkillWorkspace } from "@/infrastructure/mock/logSkills";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";

afterEach(cleanup);
function setup(apiMode = true) {
  const repository = { listSkillTemplates: vi.fn().mockResolvedValue(mockSkillTemplates),
    createLogSkill: vi.fn().mockResolvedValue(mockSkillWorkspace("skill-charging")), replaceSkillSample: vi.fn().mockResolvedValue(undefined) };
  const onNavigate = vi.fn(), onDismiss = vi.fn();
  render(<CreateSkillDialog repository={repository} apiMode={apiMode} skills={mockLogSkills} onNavigate={onNavigate} onDismiss={onDismiss} />);
  return { repository, onNavigate, onDismiss };
}
describe("create skill dialog", () => {
  it("uses shared field labels, compact choices and an inline removable sample", async () => {
    setup();
    await screen.findByRole("radio", { name: /通用文本日志/ });
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    for (const name of ["名称", "描述（可选）", "样例日志（可选）"])
      expect(screen.getByLabelText<HTMLInputElement | HTMLTextAreaElement>(name).labels?.[0]).toHaveAttribute("data-slot", "label");
    expect(screen.getByRole("textbox", { name: "描述（可选）" })).toHaveAttribute("rows", "2");
    const input = screen.getByLabelText("样例日志（可选）");
    expect(input.nextElementSibling).toHaveTextContent("请选择一个文本文件，最大 2 MiB。");
    await userEvent.upload(input, new File(["hello"], "device.log"));
    const name = screen.getByText("device.log");
    await userEvent.click(within(name.parentElement!).getByRole("button", { name: "移除已选样例" }));
    expect(input).toHaveValue("");
    expect(screen.queryByText("device.log")).not.toBeInTheDocument();
  });
  it.each(mockSkillTemplates)("creates from $id and navigates after uploading a chosen sample", async (template) => {
    const { repository, onNavigate } = setup();
    await userEvent.click(await screen.findByRole("radio", { name: new RegExp(template.label) }));
    fireEvent.change(screen.getByRole("textbox", { name: "名称" }), { target: { value: "  Device  " } });
    fireEvent.change(screen.getByRole("textbox", { name: "描述（可选）" }), { target: { value: "Description" } });
    const sample = new File(["hello"], "device.log");
    await userEvent.upload(screen.getByLabelText("样例日志（可选）"), sample);
    await userEvent.click(screen.getByRole("button", { name: "创建技能" }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("/log-admin/skills/skill-charging"));
    expect(repository.createLogSkill).toHaveBeenCalledWith({ name: "Device", description: "Description", startingPoint: { templateId: template.id } });
    expect(repository.replaceSkillSample).toHaveBeenCalledWith("skill-charging", sample);
    expect(repository.replaceSkillSample.mock.invocationCallOrder[0]).toBeLessThan(onNavigate.mock.invocationCallOrder[0]);
  });
  it("validates name and copy selection before copying a skill", async () => {
    const { repository, onNavigate } = setup();
    await screen.findByRole("radio", { name: /复制已有技能/ });
    await userEvent.click(screen.getByRole("button", { name: "创建技能" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请输入名称");
    expect(repository.createLogSkill).not.toHaveBeenCalled();
    await userEvent.type(screen.getByRole("textbox", { name: "名称" }), "Copy");
    await userEvent.click(screen.getByRole("radio", { name: /复制已有技能/ }));
    await userEvent.click(screen.getByRole("button", { name: "创建技能" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请选择要复制的技能");
    await userEvent.click(screen.getByRole("combobox", { name: "来源技能" }));
    await userEvent.click(screen.getByRole("option", { name: "充电诊断" }));
    await userEvent.click(screen.getByRole("button", { name: "创建技能" }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalled());
    expect(repository.createLogSkill).toHaveBeenCalledWith({ name: "Copy", startingPoint: { copyFromSkillId: "skill-charging" } });
  });
  it("shows name conflicts inline and keeps the dialog open", async () => {
    const { repository, onDismiss } = setup();
    repository.createLogSkill.mockRejectedValue(new WiseEffApiError("CONFLICT", "duplicate", {}, "request"));
    await screen.findByRole("radio", { name: /通用文本日志/ });
    await userEvent.type(screen.getByRole("textbox", { name: "名称" }), "Duplicate");
    await userEvent.click(screen.getByRole("button", { name: "创建技能" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("已存在同名技能");
    expect(onDismiss).not.toHaveBeenCalled();
  });
  it("retries a failed sample upload without creating another skill", async () => {
    const { repository, onNavigate } = setup();
    repository.replaceSkillSample.mockRejectedValueOnce(new Error("failed"));
    await screen.findByRole("radio", { name: /通用文本日志/ });
    await userEvent.type(screen.getByRole("textbox", { name: "名称" }), "Sample");
    await userEvent.upload(screen.getByLabelText("样例日志（可选）"), new File(["hello"], "sample.log"));
    await userEvent.click(screen.getByRole("button", { name: "创建技能" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("技能已创建，样例上传失败");
    await userEvent.click(screen.getByRole("button", { name: "打开技能" }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalled());
    expect(repository.createLogSkill).toHaveBeenCalledTimes(1);
    expect(repository.replaceSkillSample).toHaveBeenCalledTimes(2);
  });
  it("keeps mock creation disabled with a reason", async () => {
    const { repository } = setup(false);
    const dialog = screen.getByRole("dialog", { name: "新建技能" });
    expect(await within(dialog).findByRole("radio", { name: /通用文本日志/ })).toBeChecked();
    expect(within(dialog).getByRole("button", { name: "创建技能" })).toBeDisabled();
    expect(dialog).toHaveTextContent("演示模式仅供查看");
    expect(repository.listSkillTemplates).not.toHaveBeenCalled();
  });
});
