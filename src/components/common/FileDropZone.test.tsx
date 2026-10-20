import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { FileDropZone } from "./FileDropZone";

afterEach(cleanup);

it.each([
  { label: "选择日志文件" },
  { label: "样例日志（可选）", id: "create-skill-sample" },
  { label: "技能包 ZIP", id: "skill-package-file" },
  { label: "选择样例日志", browseLabel: "替换样例" },
  { label: "源码压缩包" },
  { label: "Markdown 文件", regionLabel: "拖放 Markdown 文件" },
  { label: "原始日志包" },
  { label: "导入分析用例 ZIP", browseLabel: "导入用例" },
])("names only the visible browse control for $label", (props) => {
  render(<>{props.id ? <label htmlFor={props.id}>{props.label}</label> : null}
    <FileDropZone {...props} onSelect={vi.fn()} onRemove={vi.fn()} /></>);
  const name = props.browseLabel ?? props.label;
  const button = screen.getByRole("button", { name });
  expect(screen.getAllByLabelText(name, { exact: true })).toEqual([button]);
  if (props.label === "选择日志文件") expect(screen.getAllByLabelText(props.label, { exact: false })).toEqual([button]);
  const input = screen.getByTestId<HTMLInputElement>("file-drop-zone-input");
  expect(input).not.toHaveAccessibleName();
  expect(input).not.toHaveAttribute("aria-label");
  expect(input).not.toHaveAttribute("aria-labelledby");
  expect(input.labels).toHaveLength(0);
  expect(input).toHaveAttribute("aria-hidden", "true");
  expect(input).toHaveAttribute("tabindex", "-1");
  expect(input).not.toBeVisible();
});

it("keeps the picker accessible by keyboard and the file input available for automation", async () => {
  const onSelect = vi.fn();
  render(<FileDropZone label="日志文件" accept=".log,text/plain" multiple onSelect={onSelect} onRemove={vi.fn()} hint="支持文本日志。" />);
  const input = screen.getByTestId<HTMLInputElement>("file-drop-zone-input");
  expect(input).toHaveAttribute("type", "file");
  expect(input).toHaveAttribute("accept", ".log,text/plain");
  expect(input).toHaveAttribute("multiple");
  expect(input).not.toBeVisible();
  const click = vi.spyOn(input, "click");
  const user = userEvent.setup();
  await user.tab();
  expect(screen.getByRole("button", { name: "日志文件" })).toHaveFocus();
  expect(screen.getByRole("button", { name: "日志文件" })).toHaveAccessibleDescription("支持文本日志。");
  await user.keyboard("{Enter}");
  await user.keyboard(" ");
  expect(click).toHaveBeenCalledTimes(2);
  const file = new File(["line"], "device.log");
  fireEvent.change(input, { target: { files: [file] } });
  expect(onSelect).toHaveBeenCalledWith([file]);
  expect(input).toHaveValue("");
});

it.each([
  { multiple: false, browseLabel: "选择日志文件", selectedLabel: "更换文件" },
  { multiple: false, browseLabel: "上传样例日志", selectedLabel: "更换文件" },
  { multiple: true, browseLabel: "选择日志文件", selectedLabel: "选择日志文件" },
])("places chosen files before help and uses $selectedLabel when multiple=$multiple ($browseLabel)", ({ multiple, browseLabel, selectedLabel }) => {
  function Selection() {
    const [files, setFiles] = useState<File[]>([]);
    return <FileDropZone label="选择日志文件" browseLabel={browseLabel} multiple={multiple} hint="支持文本日志。" files={files}
      onSelect={setFiles} onRemove={() => setFiles([])} />;
  }
  render(<Selection />);
  expect(screen.getByRole("button", { name: browseLabel })).toBeVisible();
  const input = screen.getByTestId("file-drop-zone-input");
  const click = vi.spyOn(input, "click");
  fireEvent.change(input, { target: { files: [new File(["line"], "device.log")] } });
  const selected = screen.getByRole("list", { name: "已选文件" });
  expect(screen.getByRole("region").nextElementSibling).toBe(selected);
  expect(selected.nextElementSibling).toBe(screen.getByText("支持文本日志。"));
  const browse = screen.getByRole("button", { name: selectedLabel });
  expect(browse).toHaveTextContent(selectedLabel);
  expect(browse).toHaveTextContent("或将文件拖到此处");
  expect(browse).toHaveAccessibleDescription("支持文本日志。");
  expect(screen.getAllByLabelText(selectedLabel, { exact: true })).toEqual([browse]);
  expect(input).not.toHaveAccessibleName();
  expect(input).not.toHaveAttribute("aria-label");
  fireEvent.click(browse);
  expect(click).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "移除 device.log" }));
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: browseLabel })).toBeVisible();
});

it("shows drag state, selected names and adaptive sizes, and removes individual files", () => {
  function Selection() {
    const [files, setFiles] = useState<File[]>([]);
    return <FileDropZone label="日志文件" multiple files={files} onSelect={setFiles}
      onRemove={(index) => setFiles((current) => current.filter((_, at) => at !== index))} />;
  }
  render(<Selection />);
  const target = screen.getByRole("region", { name: "文件拖放区" });
  fireEvent.dragOver(target);
  expect(target).toHaveAttribute("data-dragging", "true");
  fireEvent.dragLeave(target);
  expect(target).not.toHaveAttribute("data-dragging");
  fireEvent.dragOver(target);
  fireEvent.drop(target, { dataTransfer: { files: [new File(["a".repeat(20 * 1024)], "first.log"), new File(["b"], "second.log")] } });
  expect(target).not.toHaveAttribute("data-dragging");
  expect(screen.getByRole("list", { name: "已选文件" })).toHaveTextContent("first.log · 20.0 KB");
  expect(screen.getByRole("list", { name: "已选文件" })).toHaveTextContent("second.log · 1 B");
  fireEvent.click(screen.getByRole("button", { name: "移除 first.log" }));
  expect(screen.getByRole("list")).not.toHaveTextContent("first.log");
  expect(screen.getByRole("list")).toHaveTextContent("second.log");
});

it("limits single-file selection and prevents changes while disabled", () => {
  const onSelect = vi.fn(), onRemove = vi.fn();
  const files = [new File(["a"], "first.zip"), new File(["b"], "second.zip")];
  const { rerender } = render(<FileDropZone label="压缩包" accept=".zip" onSelect={onSelect} onRemove={onRemove} />);
  fireEvent.drop(screen.getByRole("region"), { dataTransfer: { files } });
  expect(onSelect).toHaveBeenCalledWith([files[0]]);
  rerender(<FileDropZone label="压缩包" disabled files={[files[0]]} onSelect={onSelect} onRemove={onRemove} />);
  fireEvent.dragOver(screen.getByRole("region"));
  expect(screen.getByRole("region")).not.toHaveAttribute("data-dragging");
  fireEvent.drop(screen.getByRole("region"), { dataTransfer: { files } });
  fireEvent.change(screen.getByTestId("file-drop-zone-input"), { target: { files } });
  fireEvent.click(screen.getByRole("button", { name: "移除 first.zip" }));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onRemove).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "更换文件" })).toBeDisabled();
});
