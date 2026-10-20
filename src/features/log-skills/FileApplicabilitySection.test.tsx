import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { mockSkillSample } from "@/infrastructure/mock/logSkills";
import { FileApplicabilitySection } from "./FileApplicabilitySection";
import type { SkillSample, SkillSpec } from "./types";

afterEach(cleanup);
const sample: SkillSample = { ...mockSkillSample, fileName: "bundle.zip", contentFilePath: "kernel/dmesg.log", files: [
  { path: "kernel/dmesg.log", sizeBytes: 20, lineCount: 1, encoding: "utf-8", lossy: false, status: "analyzed", skipReason: null },
  { path: "charger/charger.log", sizeBytes: 20, lineCount: 1, encoding: "utf-8", lossy: false, status: "analyzed", skipReason: null },
  { path: "misc/notes.txt", sizeBytes: 20, lineCount: 1, encoding: "utf-8", lossy: false, status: "analyzed", skipReason: null }
] };
function setup(initial: SkillSpec = { schemaVersion: "skill/v1" }, stored: SkillSample | null = sample, disabled = false) {
  function Harness() {
    const [spec, setSpec] = useState(initial);
    return <FileApplicabilitySection spec={spec} onChange={setSpec} disabled={disabled} sample={stored} />;
  }
  return render(<Harness />);
}

describe("skill file applicability", () => {
  it("previews every bundle file immediately and applies the first matching role after reordering", () => {
    setup({ schemaVersion: "skill/v1", files: [{ glob: "charger/**", role: "充电" }, { glob: "**/*.log", role: "主日志" }] });
    const table = screen.getByRole("table", { name: "样例文件匹配结果" });
    expect(table.closest(".data-table-scroll--fluid")).not.toBeNull();
    expect(table).toHaveClass("table-fixed");
    const row = (path: string) => within(table).getByText(path).closest("tr")!;
    expect(row("charger/charger.log")).toHaveTextContent("已匹配 · 充电");
    expect(within(row("charger/charger.log")).getByTitle("匹配规则 1：charger/**")).toBeInTheDocument();
    expect(within(row("charger/charger.log")).getByText("充电")).toHaveAttribute("data-slot", "badge");
    expect(row("kernel/dmesg.log")).toHaveTextContent("已匹配 · 主日志");
    expect(within(row("kernel/dmesg.log")).getByTitle("匹配规则 2：**/*.log")).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "角色" })).not.toBeInTheDocument();
    expect(row("misc/notes.txt")).toHaveTextContent("未匹配 · 仅通用分析");
    fireEvent.click(screen.getByRole("button", { name: "下移文件规则 1" }));
    expect(row("charger/charger.log")).toHaveTextContent("已匹配 · 主日志");
    expect(within(row("charger/charger.log")).getByTitle("匹配规则 1：**/*.log")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "通配模式 1" }), { target: { value: "kernel/**" } });
    expect(row("charger/charger.log")).toHaveTextContent("已匹配 · 充电");
    fireEvent.change(screen.getByRole("textbox", { name: "文件角色 2" }), { target: { value: "自定义" } });
    expect(row("charger/charger.log")).toHaveTextContent("自定义");
    fireEvent.click(screen.getByRole("button", { name: "删除文件规则 2" }));
    expect(row("charger/charger.log")).toHaveTextContent("已匹配 · 自定义");
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: "删除规则" });
    expect(confirm).toHaveClass("danger");
    fireEvent.click(confirm);
    expect(row("charger/charger.log")).toHaveTextContent("未匹配 · 仅通用分析");
    expect(screen.getByRole("button", { name: "上移文件规则 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下移文件规则 1" })).toBeDisabled();
  });
  it("defaults to all files, validates a new row and restores preview after a valid edit", () => {
    setup();
    expect(screen.getAllByRole("cell", { name: "已匹配" })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "添加文件规则" }));
    expect(screen.getByRole("alert")).toHaveTextContent("第 1 条文件规则的通配模式无效");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "通配模式 1" }), { target: { value: "charger/**" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "已匹配" })).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "文件角色 1" })).not.toHaveAttribute("list");
    fireEvent.click(screen.getByRole("button", { name: "文件规则 1 使用角色充电" }));
    expect(screen.getByRole("textbox", { name: "文件角色 1" })).toHaveValue("充电");
    expect(screen.getByRole("button", { name: "文件规则 1 使用角色充电" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTitle("匹配规则 1：charger/**")).toHaveTextContent("已匹配 · 充电");
    expect(screen.getByRole("textbox", { name: "通配模式 1" })).toHaveAttribute("maxlength", "256");
  });
  it("previews a single file and respects read-only access and the empty sample state", () => {
    const { unmount } = setup({ schemaVersion: "skill/v1", files: [{ glob: "*.log" }] }, mockSkillSample, true);
    expect(screen.getByRole("table")).toHaveTextContent("charging.log");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "通配模式 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "添加文件规则" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "文件规则 1 使用角色充电" })).toBeDisabled();
    unmount(); setup(undefined, null);
    expect(screen.getByText(/请在右侧上传样例日志或日志包/)).toBeInTheDocument();
  });
});
