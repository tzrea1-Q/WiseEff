import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { mockSkillWorkspace } from "@/infrastructure/mock/logSkills";
import { ExportSkillPackageDialog, ImportSkillPackageDialog } from "./SkillPackageDialogs";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("skill package import", () => {
  it.each([
    { issues: [{ path: "signals.yaml: rules[2].anyOf[0].field", message: "unknown decoded path" }] },
    { problems: ["signals.yaml: rules[2].anyOf[0].field: unknown decoded path"] }
  ])("preserves exact package errors and allows a corrected file to import as a draft", async (details) => {
    const skill = mockSkillWorkspace("skill-charging")!;
    const repository = { importSkillPackage: vi.fn().mockRejectedValueOnce(new WiseEffApiError("VALIDATION_FAILED", "Invalid package", details, "request")).mockResolvedValueOnce(skill) };
    const onNavigate = vi.fn(), onDismiss = vi.fn(), onImported = vi.fn();
    render(<ImportSkillPackageDialog repository={repository} onNavigate={onNavigate} onDismiss={onDismiss} onImported={onImported} />);
    expect(screen.getByRole("button", { name: "校验并导入" })).toBeDisabled();
    const file = new File(["broken"], "skill.zip", { type: "application/zip" });
    await userEvent.upload(screen.getByLabelText("技能包 ZIP"), file);
    await userEvent.click(screen.getByRole("button", { name: "校验并导入" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("signals.yaml: rules[2].anyOf[0].field");
    expect(alert).toHaveTextContent("unknown decoded path");
    expect(repository.importSkillPackage).toHaveBeenCalledWith(file, "draft", undefined);
    expect(onNavigate).not.toHaveBeenCalled(); expect(onImported).not.toHaveBeenCalled();
    await userEvent.upload(screen.getByLabelText("技能包 ZIP"), new File(["valid"], "fixed.zip", { type: "application/zip" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "校验并导入" }));
    expect(await screen.findByRole("status")).toHaveTextContent("技能包校验通过，已导入");
    expect(onImported).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("link", { name: "打开技能工作区" }));
    expect(onNavigate).toHaveBeenCalledWith("/log-admin/skills/skill-charging"); expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("sends an explicit published choice", async () => {
    const repository = { importSkillPackage: vi.fn().mockResolvedValue(mockSkillWorkspace("skill-charging")) };
    render(<ImportSkillPackageDialog repository={repository} onNavigate={vi.fn()} onDismiss={vi.fn()} onImported={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText("技能包 ZIP"), new File(["valid"], "skill.zip", { type: "application/zip" }));
    await userEvent.click(screen.getByRole("combobox", { name: "导入后的技能版本" }));
    await userEvent.click(screen.getByRole("option", { name: /^发布$/ }));
    await userEvent.click(screen.getByRole("button", { name: "校验并导入" }));
    await screen.findByRole("status");
    expect(repository.importSkillPackage).toHaveBeenCalledWith(expect.any(File), "published", undefined);
  });

  it("renders all structured Chinese issues as path and message rows and learns the package name", async () => {
    const issues = [
      { path: "SKILL.md", message: "缺少必需文件" },
      { path: "signals.yaml › rules[2].anyOf[0].field", message: "未知的解码字段路径" }
    ];
    const repository = { importSkillPackage: vi.fn().mockRejectedValue(new WiseEffApiError("VALIDATION_FAILED", "校验失败", { issues, problems: ["legacy error"], packageName: "充电" }, "request")) };
    render(<ImportSkillPackageDialog repository={repository} onNavigate={vi.fn()} onDismiss={vi.fn()} onImported={vi.fn()} />);
    expect(screen.getByLabelText("技能名称")).toHaveValue("");
    expect(screen.getByLabelText("技能名称")).toHaveAttribute("placeholder", "默认使用包内名称");
    await userEvent.upload(screen.getByLabelText("技能包 ZIP"), new File(["broken"], "skill.zip", { type: "application/zip" }));
    await userEvent.click(screen.getByRole("button", { name: "校验并导入" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveClass("skill-package-error");
    const rows = within(alert).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    issues.forEach((issue, index) => {
      expect(within(rows[index]).getByText(issue.path)).toHaveClass("font-mono", "text-muted-foreground");
      expect(within(rows[index]).getByText(issue.message)).toBeInTheDocument();
    });
    expect(screen.queryByText("legacy error")).not.toBeInTheDocument();
    expect(screen.getByLabelText("技能名称")).toHaveAttribute("placeholder", "充电");
  });

  it("focuses the name collision error, prefills a suggestion and imports without editing the ZIP", async () => {
    const file = new File(["valid"], "skill.zip", { type: "application/zip" });
    const repository = { importSkillPackage: vi.fn().mockRejectedValueOnce(new WiseEffApiError("CONFLICT", "同名技能", {
      fieldErrors: { name: "已存在同名技能，请修改技能名称后重试。" }, nameSuggestion: "充电（导入）", packageName: "充电"
    }, "request")).mockResolvedValueOnce(mockSkillWorkspace("skill-charging")) };
    render(<ImportSkillPackageDialog repository={repository} onNavigate={vi.fn()} onDismiss={vi.fn()} onImported={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText("技能包 ZIP"), file);
    await userEvent.click(screen.getByRole("button", { name: "校验并导入" }));
    const name = screen.getByLabelText("技能名称");
    expect(await screen.findByRole("alert")).toHaveTextContent("已存在同名技能，请修改技能名称后重试。");
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveValue("充电（导入）");
    expect(name).toHaveAttribute("placeholder", "充电");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("已存在同名技能，请修改技能名称后重试。");
    await userEvent.click(screen.getByRole("button", { name: "校验并导入" }));
    await screen.findByRole("status");
    expect(repository.importSkillPackage).toHaveBeenLastCalledWith(file, "draft", "充电（导入）");
  });

  it("sends the trimmed optional name and clears field validation when it is edited", async () => {
    const repository = { importSkillPackage: vi.fn().mockRejectedValueOnce(new WiseEffApiError("VALIDATION_FAILED", "名称无效", { fieldErrors: { name: ["名称不能超过 120 个字符"] } }, "request")) };
    render(<ImportSkillPackageDialog repository={repository} onNavigate={vi.fn()} onDismiss={vi.fn()} onImported={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText("技能包 ZIP"), new File(["valid"], "skill.zip", { type: "application/zip" }));
    const name = screen.getByLabelText("技能名称");
    await userEvent.type(name, "  自定义技能  ");
    await userEvent.click(screen.getByRole("button", { name: "校验并导入" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("名称不能超过 120 个字符");
    expect(repository.importSkillPackage).toHaveBeenCalledWith(expect.any(File), "draft", "自定义技能");
    await userEvent.clear(name);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("skill package export", () => {
  it.each(["published", "draft"] as const)("downloads the selected %s revision", async (revision) => {
    const skill = structuredClone(mockSkillWorkspace("skill-charging")!);
    skill.draft = { ...skill.currentRevision, id: "draft", number: 2, status: "draft" };
    const blob = new Blob(["zip"]); const repository = { exportSkillPackage: vi.fn().mockResolvedValue(blob) }; const onDismiss = vi.fn();
    const createObjectURL = vi.fn().mockReturnValue("blob:package"), revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<ExportSkillPackageDialog skill={skill} dirty repository={repository} onDismiss={onDismiss} />);
    expect(screen.getByRole("heading", { name: "导出技能包" }).parentElement).toHaveClass("skill-package-dialog-content");
    expect(screen.getByRole("button", { name: "下载技能包" }).parentElement).toHaveClass("dialog-actions");
    expect(screen.getByText(/未保存的更改不会导出/)).toBeInTheDocument();
    if (revision === "draft") { await userEvent.click(screen.getByRole("combobox", { name: "导出版本" })); await userEvent.click(screen.getByRole("option", { name: "已保存草稿" })); }
    await userEvent.click(screen.getByRole("button", { name: "下载技能包" }));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledOnce());
    expect(repository.exportSkillPackage).toHaveBeenCalledWith(skill.id, revision);
    expect(createObjectURL).toHaveBeenCalledWith(blob); expect(click).toHaveBeenCalledOnce(); expect(revokeObjectURL).toHaveBeenCalledWith("blob:package");
  });

  it("defaults to draft for an unpublished skill and keeps download failures inline", async () => {
    const skill = structuredClone(mockSkillWorkspace("skill-charging")!);
    skill.currentRevision.status = "draft"; skill.draft = skill.currentRevision;
    const repository = { exportSkillPackage: vi.fn().mockRejectedValue(new Error("offline")) };
    render(<ExportSkillPackageDialog skill={skill} dirty={false} repository={repository} onDismiss={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "导出版本" })).toHaveTextContent("已保存草稿");
    await userEvent.click(screen.getByRole("button", { name: "下载技能包" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("导出技能包失败");
    expect(repository.exportSkillPackage).toHaveBeenCalledWith(skill.id, "draft");
  });
});
