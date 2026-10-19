import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillSamplePane } from "./SkillSamplePane";
import { mockSkillSample } from "@/infrastructure/mock/logSkills";

afterEach(cleanup);
describe("skill sample pane", () => {
  it("scrolls a repeated hit request to the already highlighted line", async () => {
    const repository = { getSkillSample: vi.fn().mockResolvedValue(mockSkillSample) };
    const { rerender } = render(<SkillSamplePane skillId="skill-charging" apiMode canEdit repository={repository} highlightedLine={2} highlightRequest={1} />);
    const line = (await screen.findByText("ERROR charging timeout code=E_TIMEOUT")).parentElement!;
    const scrollIntoView = vi.fn();
    Object.defineProperty(line, "scrollIntoView", { value: scrollIntoView });
    rerender(<SkillSamplePane skillId="skill-charging" apiMode canEdit repository={repository} highlightedLine={2} highlightRequest={2} />);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    expect(line).toHaveAttribute("data-highlighted", "true");
  });
  it.each(["one\ntwo\n", "one\r\ntwo\r\n", "one\rtwo\r"])("omits the phantom row after a final newline in %j", async (content) => {
    render(<SkillSamplePane skillId="skill-charging" apiMode canEdit repository={{ getSkillSample: vi.fn().mockResolvedValue({ ...mockSkillSample, content, lineCount: 2 }) }} />);
    const pane = await screen.findByRole("region", { name: "样例内容" });
    expect(pane.children).toHaveLength(2);
    expect(pane.children[1]).toHaveTextContent("two");
  });
  it.each([[0, "0 B"], [13005, "12.7 KiB"], [2097152, "2.0 MiB"]])("formats %s bytes with the shared binary units", async (sizeBytes, size) => {
    render(<SkillSamplePane skillId="skill-charging" apiMode canEdit repository={{
      getSkillSample: vi.fn().mockResolvedValue({ ...mockSkillSample, sizeBytes, lineCount: 400 })
    }} />);
    expect(await screen.findByText(`${size} · 400 行`)).toBeInTheDocument();
  });
  it("offers one upload action for an empty sample", async () => {
    render(<SkillSamplePane skillId="skill-charging" apiMode canEdit repository={{ getSkillSample: vi.fn().mockResolvedValue(null) }} />);
    expect(await screen.findByText("上传样例日志，后续解析与信号规则会用它实时预览。")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "上传样例日志" })).toBeEnabled();
  });
  it("renders numbered text, full metadata, truncation and confirms deletion", async () => {
    const repository = { getSkillSample: vi.fn().mockResolvedValue({ ...mockSkillSample, truncated: true, lineCount: 5001 }), deleteSkillSample: vi.fn().mockResolvedValue(undefined) };
    render(<SkillSamplePane skillId="skill-charging" apiMode canEdit repository={repository} />);
    expect(await screen.findByText("charging.log")).toBeInTheDocument();
    expect(screen.getByText("仅显示前 5000 行")).toBeInTheDocument();
    expect(screen.getByText(/5,001 行/)).toBeInTheDocument();
    const content = screen.getByRole("region", { name: "样例内容" });
    expect(content).toHaveTextContent("INFO charging started");
    expect(content).toHaveAttribute("data-sample-scroll");
    expect(screen.getByText("1")).toHaveAttribute("aria-hidden", "true");
    await userEvent.click(screen.getByRole("button", { name: "删除样例" }));
    expect(repository.deleteSkillSample).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole("dialog", { name: "删除样例日志？" })).getByRole("button", { name: "取消" }));
    expect(repository.deleteSkillSample).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "删除样例" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除样例" }));
    await waitFor(() => expect(repository.deleteSkillSample).toHaveBeenCalledWith("skill-charging"));
    expect(await screen.findByRole("button", { name: "上传样例日志" })).toBeInTheDocument();
  });
  it("shows a seeded sample with disabled writes in mock mode", async () => {
    render(<SkillSamplePane skillId="skill-charging" apiMode={false} canEdit />);
    expect(await screen.findByText("charging.log")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "替换样例" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除样例" })).toBeDisabled();
  });
});
