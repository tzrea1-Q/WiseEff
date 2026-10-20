import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FormatProfileForm } from "./FormatProfileForm";
import { formatProfileCode, parseFormatProfileCode } from "./formatProfileFields";
import { mockSkillSample, mockSkillWorkspace } from "@/infrastructure/mock/logSkills";
import { logSkillTemplates } from "../../../server/modules/logs/skillTemplates";
import { parseLogText } from "../../../server/modules/logs/parser";
import type { FormatPreview, SkillSpec } from "./types";

afterEach(cleanup);
const sampleText = '[12.34] <3> charger vbus=9012\n  detail temp=71\n06-14 12:34:56.789 123 456 W Charger: hot\n{"level":"error"}';
const preview: FormatPreview = {
  lines: [{ line: 1, text: "[12.34] <3> charger", timestamp: "12.34", severity: "error" }, { line: 2, text: "  detail", severity: "info" }],
  entries: [{ lineNumbers: [1, 2], text: "<3> charger\ndetail", timestamp: "12.34", severity: "error" }]
};
function setup(initial?: SkillSpec["formatProfile"], repository = { previewFormat: vi.fn(async () => preview) }) {
  const changed = vi.fn(), validity = vi.fn();
  function Harness() {
    const [profile, setProfile] = useState(initial);
    return <FormatProfileForm skillId="s" profile={profile} onChange={(next) => { changed(next); setProfile(next); }} repository={repository}
      sample={{ ...mockSkillSample, content: sampleText }} onValidityChange={validity} />;
  }
  render(<Harness />);
  return { changed, validity, repository };
}
describe("basic format form", () => {
  it("keeps format editing available while applicability disables the stored-sample preview", async () => {
    const previewFormat = vi.fn(async () => preview);
    const repository = { previewFormat };
    const { rerender } = render(<FormatProfileForm skillId="s" profile={{}} onChange={() => undefined} repository={repository}
      sample={mockSkillSample} previewEnabled />);
    await waitFor(() => expect(previewFormat).toHaveBeenCalled());
    expect(screen.getByRole("table", { name: "基础格式逐行预览" })).toBeInTheDocument();
    previewFormat.mockClear();
    rerender(<FormatProfileForm skillId="s" profile={{}} onChange={() => undefined} repository={repository}
      sample={mockSkillSample} previewEnabled={false} />);
    expect(screen.getByText(/未匹配技能，不运行基础格式预览/)).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "基础格式逐行预览" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "时间戳模式" })).toBeEnabled();
    expect(previewFormat).not.toHaveBeenCalled();
  });
  it.each([...logSkillTemplates.map((template) => ({ id: template.id, profile: template.spec.formatProfile })), {
    id: "seeded charging skill", profile: mockSkillWorkspace("skill-charging")!.currentRevision.spec.formatProfile
  }])("round trips the $id profile without changing its object or parsed output", ({ profile }) => {
    const { changed } = setup(profile);
    fireEvent.click(screen.getByRole("button", { name: "基础格式代码视图" }));
    const input = screen.getByRole("textbox", { name: "基础格式 JSON" });
    expect(input).toHaveValue(formatProfileCode(profile));
    fireEvent.change(input, { target: { value: `${formatProfileCode(profile)}\n` } });
    expect(changed).toHaveBeenLastCalledWith(profile);
    fireEvent.click(screen.getByRole("button", { name: "返回格式表单" }));
    expect(screen.getByRole("textbox", { name: "时间戳模式" })).toHaveValue(profile?.timestampPattern ?? "");
    const produced = parseFormatProfileCode(`${formatProfileCode(profile)}\n`).profile;
    expect(produced).toEqual(profile);
    expect(parseLogText({ fileName: "sample.log", content: sampleText }, { profile: produced })).toEqual(parseLogText({ fileName: "sample.log", content: sampleText }, { profile }));
  });
  it("previews unsaved timestamps, severity and raw-line entry grouping", async () => {
    const { changed, repository } = setup({ multiline: { mode: "indent" } });
    fireEvent.change(screen.getByRole("textbox", { name: "时间戳模式" }), { target: { value: "^\\[(\\d+\\.\\d+)\\]" } });
    fireEvent.click(screen.getByRole("button", { name: "添加错误模式" }));
    fireEvent.change(screen.getByRole("textbox", { name: "error 模式 1" }), { target: { value: "<3>" } });
    await waitFor(() => expect(repository.previewFormat).toHaveBeenCalledWith("s", { formatProfile: { timestampPattern: "^\\[(\\d+\\.\\d+)\\]", multiline: { mode: "indent" }, severityMap: { error: ["<3>"] } }, sampleText }));
    const lines = await screen.findByRole("table", { name: "基础格式逐行预览" });
    expect(within(lines).getByText("12.34")).toBeInTheDocument();
    expect(within(lines).getByText("错误")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "基础格式条目分组" })).toHaveTextContent("1, 2");
    expect(changed).toHaveBeenLastCalledWith({ timestampPattern: "^\\[(\\d+\\.\\d+)\\]", multiline: { mode: "indent" }, severityMap: { error: ["<3>"] } });
    fireEvent.click(screen.getByRole("button", { name: "删除 error 模式 1" }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: "删除模式" });
    expect(confirm).toHaveClass("danger");
    fireEvent.click(confirm);
    expect(changed).toHaveBeenLastCalledWith({ timestampPattern: "^\\[(\\d+\\.\\d+)\\]", multiline: { mode: "indent" }, severityMap: { error: [] } });
  });
  it("keeps invalid form patterns and malformed code editable while blocking stale saves", () => {
    const { changed, validity } = setup({ timestampPattern: "^good" });
    fireEvent.change(screen.getByRole("textbox", { name: "时间戳模式" }), { target: { value: "(?=bad)" } });
    expect(screen.getByRole("alert")).toHaveTextContent("基础格式配置无效");
    expect(screen.getByRole("textbox", { name: "时间戳模式" })).toHaveValue("(?=bad)");
    expect(validity).toHaveBeenLastCalledWith(false);
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "基础格式代码视图" }));
    fireEvent.change(screen.getByRole("textbox", { name: "基础格式 JSON" }), { target: { value: "{not json" } });
    expect(screen.getByRole("button", { name: "返回格式表单" })).toBeDisabled();
    expect(validity).toHaveBeenLastCalledWith(false);
    fireEvent.change(screen.getByRole("textbox", { name: "基础格式 JSON" }), { target: { value: '{"timestampPattern":"^repaired"}' } });
    expect(validity).toHaveBeenLastCalledWith(true);
    expect(changed).toHaveBeenLastCalledWith({ timestampPattern: "^repaired" });
  });
  it("ignores a preview completed after the draft changes", async () => {
    let complete!: (result: FormatPreview) => void;
    const repository = { previewFormat: vi.fn(() => new Promise<FormatPreview>((resolve) => { complete = resolve; })) };
    setup({}, repository);
    await waitFor(() => expect(repository.previewFormat).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("textbox", { name: "时间戳模式" }), { target: { value: "[" } });
    await act(async () => complete(preview));
    expect(screen.queryByRole("table", { name: "基础格式逐行预览" })).not.toBeInTheDocument();
  });
  it("shows empty preview lines without rendering empty table headers", async () => {
    setup({}, { previewFormat: vi.fn(async () => ({ lines: [], entries: [] })) });
    expect(await screen.findByText("样例没有可解析的非空行。")).toBeInTheDocument();
    expect(screen.getByText("暂无合并条目。")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
