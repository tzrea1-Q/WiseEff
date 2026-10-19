import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ParsingSection } from "./ParsingSection";
import { mockSkillSample } from "@/infrastructure/mock/logSkills";
import type { ParsePreview, SkillWorkspaceRepository } from "./types";

afterEach(cleanup);
const initial = "schemaVersion: parsing/v1\nextractors: []\n";
const preview: ParsePreview = { valid: true, truncated: false, issues: [], counts: { total: 1, byExtractor: { status: 1 }, errors: {} }, unmatchedLineCount: 2,
  events: [{ v: 1, source: "declarative", file: "sample.log", line: 3, extractor: "status", fields: { state: { raw: "2", value: "thermal" } } }] };
function setup(repository: Partial<SkillWorkspaceRepository> = { parsePreview: vi.fn(async () => preview) }) {
  function Harness() { const [yaml, setYaml] = useState(initial); return <ParsingSection skillId="s" yaml={yaml} onChange={setYaml} disabled={false} repository={repository} />; }
  render(<Harness />); return repository;
}
describe("parsing code view", () => {
  it("bounds a stored 2 MiB sample to complete lines within the preview request's 1 MiB limit", async () => {
    const parsePreview = vi.fn(async () => preview);
    const content = "first complete line\n" + "界".repeat(400_000);
    render(<ParsingSection skillId="s" yaml={initial} onChange={() => undefined} disabled={false} repository={{ parsePreview }} sample={{ ...mockSkillSample, content }} />);
    expect(screen.getByText(/仅预览 1 MiB 内的完整行/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "运行预览" }));
    await waitFor(() => expect(parsePreview).toHaveBeenCalledWith("s", { parsing: { schemaVersion: "parsing/v1", extractors: [] }, sampleText: "first complete line", fileName: mockSkillSample.fileName }));
  });
  it("identifies a partial time-limited preview while retaining its decoded rows", async () => {
    setup({ parsePreview: vi.fn(async () => ({ ...preview, truncated: true, reason: "time_cap" as const })) });
    fireEvent.click(screen.getByRole("button", { name: "运行预览" }));
    expect(await screen.findByRole("status")).toHaveTextContent("100 ms");
    expect(screen.getByRole("table", { name: "解析预览结果" })).toHaveTextContent("state = thermal");
  });
  it("shows YAML errors with line numbers and disables preview, then recovers", async () => {
    setup();
    await userEvent.click(screen.getByRole("tab", { name: "代码视图" }));
    fireEvent.change(screen.getByRole("textbox", { name: "代码视图 · YAML" }), { target: { value: "schemaVersion: parsing/v1\nextractors: [\n" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/第 \d+ 行/);
    expect(screen.getByRole("button", { name: "运行预览" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "代码视图 · YAML" }), { target: { value: initial } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "运行预览" })).toBeEnabled();
  });
  it("previews unsaved YAML and displays typed values, counts, unmatched lines and schema issues", async () => {
    const repository = setup();
    fireEvent.change(screen.getByRole("textbox", { name: "样例文本" }), { target: { value: "some sample" } });
    fireEvent.click(screen.getByRole("button", { name: "运行预览" }));
    const table = await screen.findByRole("table", { name: "解析预览结果" });
    expect(within(table).getByText("state = thermal")).toBeInTheDocument();
    expect(within(table).getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/事件 1 · 未匹配行 2/)).toBeInTheDocument();
    expect(repository.parsePreview).toHaveBeenCalledWith("s", { parsing: { schemaVersion: "parsing/v1", extractors: [] }, sampleText: "some sample", fileName: "sample.log" });
    vi.mocked(repository.parsePreview!).mockResolvedValueOnce({ ...preview, valid: false, events: [], issues: [{ path: ["extractors", 0, "fields", "state"], message: "missing group" }] });
    fireEvent.click(screen.getByRole("button", { name: "运行预览" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("extractors.0.fields.state：missing group");
  });
  it("prefills an available runtime sample without replacing text already entered", async () => {
    setup({ parsePreview: vi.fn(async () => preview), getSkillSampleText: vi.fn(async () => ({ text: "stored sample", fileName: "device.log" })) });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "样例文本" })).toHaveValue("stored sample"));
    expect(screen.getByRole("textbox", { name: "文件名" })).toHaveValue("device.log");
  });
  it("keeps user-entered samples and ignores preview responses from before a new edit", async () => {
    let completeSample!: (value: { text: string; fileName: string }) => void;
    let completePreview!: (value: ParsePreview) => void;
    setup({ getSkillSampleText: () => new Promise((resolve) => { completeSample = resolve; }), parsePreview: () => new Promise((resolve) => { completePreview = resolve; }) });
    fireEvent.change(screen.getByRole("textbox", { name: "样例文本" }), { target: { value: "my sample" } });
    await act(async () => completeSample({ text: "old sample", fileName: "old.log" }));
    expect(screen.getByRole("textbox", { name: "样例文本" })).toHaveValue("my sample");
    fireEvent.click(screen.getByRole("button", { name: "运行预览" }));
    fireEvent.change(screen.getByRole("textbox", { name: "样例文本" }), { target: { value: "new sample" } });
    await act(async () => completePreview(preview));
    expect(screen.queryByRole("table", { name: "解析预览结果" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "运行预览" })).toBeEnabled();
  });
});
