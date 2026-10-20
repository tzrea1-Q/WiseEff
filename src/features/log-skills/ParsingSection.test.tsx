import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { boundedSamplePreview, ParsingSection } from "./ParsingSection";
import { mockSkillSample } from "@/infrastructure/mock/logSkills";
import type { SkillSpec, SkillWorkspaceRepository } from "./types";

afterEach(cleanup);
const initial = "schemaVersion: parsing/v1\nextractors: []\n";
function setup(repository: Partial<SkillWorkspaceRepository> = {}, sample = mockSkillSample) {
  const filesChanged = vi.fn(), profileChanged = vi.fn(), validity = vi.fn();
  function Harness() {
    const [yaml, setYaml] = useState(initial);
    const [files, setFiles] = useState<SkillSpec["files"]>([]);
    const [profile, setProfile] = useState<SkillSpec["formatProfile"]>({ timestampPattern: "^good" });
    return <ParsingSection skillId="s" yaml={yaml} onChange={setYaml} disabled={false} repository={repository} sample={sample} files={files}
      onFilesChange={(value) => { filesChanged(value); setFiles(value); }} profile={profile}
      onProfileChange={(value) => { profileChanged(value); setProfile(value); }} onProfileValidityChange={validity} />;
  }
  render(<Harness />);
  return { filesChanged, profileChanged, validity };
}

describe("parsing section", () => {
  it("separates file applicability, basic format and extraction with one code toggle and a single shared sample", async () => {
    const parsePreview = vi.fn(), getSkillSampleText = vi.fn();
    const { filesChanged } = setup({ parsePreview, getSkillSampleText });
    expect(screen.getByRole("tab", { name: "适用文件" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tablist", { name: "解析配置" }).closest(".skill-parsing-toolbar")).toBe(screen.getByRole("tablist", { name: "解析视图" }).closest(".skill-parsing-toolbar"));
    expect(screen.queryByRole("heading", { name: "适用文件" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加文件规则" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "时间戳模式" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加文件规则" }));
    fireEvent.change(screen.getByRole("textbox", { name: "通配模式 1" }), { target: { value: "*.log" } });
    expect(filesChanged).toHaveBeenLastCalledWith([{ glob: "*.log" }]);
    await userEvent.click(screen.getByRole("tab", { name: "基础格式" }));
    expect(screen.queryByRole("heading", { name: "基础格式" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "时间戳模式" })).toHaveValue("^good");
    expect(screen.queryByRole("button", { name: "基础格式代码视图" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "基础格式样例" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "抽取规则" }));
    expect(screen.queryByRole("heading", { name: "抽取规则" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "从此行创建抽取规则" })).toBeVisible();
    expect(screen.queryByRole("spinbutton", { name: "样例行号" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "抽取规则列表" })).not.toBeInTheDocument();
    expect(screen.getByText("暂无抽取规则。选择样例行后创建第一条规则。")).toBeVisible();
    expect(screen.queryByRole("region", { name: "预览" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "文件名" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "样例文本" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "运行预览" })).not.toBeInTheDocument();
    expect(parsePreview).not.toHaveBeenCalled();
    expect(getSkillSampleText).not.toHaveBeenCalled();
  });

  it("uses the section code toggle for both formats and parsing while preserving invalid drafts across tabs", async () => {
    const { profileChanged, validity } = setup();
    await userEvent.click(screen.getByRole("tab", { name: "基础格式" }));
    fireEvent.change(screen.getByRole("textbox", { name: "时间戳模式" }), { target: { value: "(?=bad)" } });
    expect(validity).toHaveBeenLastCalledWith(false);
    await userEvent.click(screen.getByRole("tab", { name: "代码视图" }));
    const json = screen.getByRole("textbox", { name: "基础格式 JSON" });
    expect(json).toHaveValue('{\n  "timestampPattern": "(?=bad)"\n}');
    fireEvent.change(json, { target: { value: "{not json" } });
    await userEvent.click(screen.getByRole("tab", { name: "表单" }));
    await userEvent.click(screen.getByRole("tab", { name: "适用文件" }));
    expect(validity).toHaveBeenLastCalledWith(false);
    await userEvent.click(screen.getByRole("tab", { name: "代码视图" }));
    expect(screen.getByRole("textbox", { name: "基础格式 JSON" })).toHaveValue("{not json");
    fireEvent.change(screen.getByRole("textbox", { name: "基础格式 JSON" }), { target: { value: '{"timestampPattern":"^repaired"}' } });
    expect(profileChanged).toHaveBeenLastCalledWith({ timestampPattern: "^repaired" });
    expect(validity).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("textbox", { name: "代码视图 · YAML" })).toHaveValue(initial);
  });

  it("shows line-numbered YAML errors and keeps the unsaved YAML editable", async () => {
    setup();
    await userEvent.click(screen.getByRole("tab", { name: "代码视图" }));
    const yaml = screen.getByRole("textbox", { name: "代码视图 · YAML" });
    fireEvent.change(yaml, { target: { value: "schemaVersion: parsing/v1\nextractors: [\n" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/第 \d+ 行/);
    await userEvent.click(screen.getByRole("tab", { name: "表单" }));
    await userEvent.click(screen.getByRole("tab", { name: "抽取规则" }));
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "从此行创建抽取规则" })).toBeDisabled();
    await userEvent.click(screen.getByRole("tab", { name: "代码视图" }));
    fireEvent.change(screen.getByRole("textbox", { name: "代码视图 · YAML" }), { target: { value: initial } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses the bundle content path for applicability and prevents unmatched basic-format previews", async () => {
    const previewFormat = vi.fn(async () => ({ lines: [], entries: [] }));
    const repository = { previewFormat };
    const sample = { ...mockSkillSample, fileName: "bundle.zip", contentFilePath: "charger/charger.log" };
    const { rerender } = render(<ParsingSection skillId="s" yaml={initial} onChange={() => undefined} disabled={false} repository={repository} sample={sample}
      files={[{ glob: "charger/**" }]} onProfileChange={() => undefined} />);
    await userEvent.click(screen.getByRole("tab", { name: "基础格式" }));
    await waitFor(() => expect(previewFormat).toHaveBeenCalledWith("s", expect.objectContaining({ sampleText: sample.content })));
    previewFormat.mockClear();
    rerender(<ParsingSection skillId="s" yaml={initial} onChange={() => undefined} disabled={false} repository={repository} sample={sample}
      files={[{ glob: "kernel/**" }]} onProfileChange={() => undefined} />);
    expect(screen.getByText(/未匹配技能，不运行基础格式预览/)).toBeInTheDocument();
    expect(previewFormat).not.toHaveBeenCalled();
  });

  it("keeps subtabs keyboard accessible", async () => {
    setup();
    const tabs = within(screen.getByRole("tablist", { name: "解析配置" }));
    tabs.getByRole("tab", { name: "适用文件" }).focus();
    await userEvent.keyboard("{ArrowRight}{Enter}");
    expect(tabs.getByRole("tab", { name: "基础格式" })).toHaveAttribute("aria-selected", "true");
  });

  it("bounds shared 2 MiB samples to complete lines within the 1 MiB request limit", () => {
    expect(boundedSamplePreview("first complete line\n" + "界".repeat(400_000))).toEqual({ content: "first complete line", truncated: true });
    expect(boundedSamplePreview("short line")).toEqual({ content: "short line", truncated: false });
  });
});
