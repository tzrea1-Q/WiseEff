import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
    expect(await screen.findByRole("alert")).toHaveTextContent("signals.yaml: rules[2].anyOf[0].field: unknown decoded path");
    expect(repository.importSkillPackage).toHaveBeenCalledWith(file, "draft");
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
    expect(repository.importSkillPackage).toHaveBeenCalledWith(expect.any(File), "published");
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
