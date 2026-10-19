import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { LogEvidence } from "@/domain/logs/types";
import { SourceEvidence } from "./SourceEvidence";

const evidence: LogEvidence = { id: "evidence-1", stageId: "rootcause", lineNumbers: [1], inference: "thermal foldback", suggestedAction: "cool down",
  sourceLocation: { snapshotId: "snapshot-1", path: "drivers/thermal.c", line: 9 }, sourceVersionLabel: "release-v1" };
const excerpt = { ...evidence.sourceLocation!, versionLabel: "release-v1", startLine: 8, excerpt: 'if (hot) {\n  pr_warn("thermal foldback");\n} // <img src=x onerror=alert(1)>' };
afterEach(cleanup);

it("shows a source citation and loads only its bounded excerpt on expansion", async () => {
  const loadExcerpt = vi.fn(async () => excerpt);
  render(<SourceEvidence evidence={evidence} loadExcerpt={loadExcerpt} />);
  expect(screen.getByText("源码：drivers/thermal.c:9 · release-v1")).toBeVisible();
  expect(loadExcerpt).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "展开源码摘录" }));
  const sourceExcerpt = await screen.findByLabelText("已引用源码摘录");
  const citedLine = screen.getByLabelText("已引用源码行 9");
  expect(citedLine).toHaveTextContent('> 9: pr_warn("thermal foldback");');
  expect(citedLine).toHaveClass("bg-[var(--accent-soft)]", "font-semibold");
  expect(sourceExcerpt.querySelectorAll(".font-semibold")).toHaveLength(1);
  expect(sourceExcerpt).toHaveTextContent("<img src=x onerror=alert(1)>");
  expect(sourceExcerpt.querySelector("img")).toBeNull();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "收起源码摘录" }));
  expect(screen.queryByLabelText("已引用源码摘录")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "展开源码摘录" }));
  expect(loadExcerpt).toHaveBeenCalledTimes(1);
});

it("retains the citation after an excerpt failure and allows retry without leaking backend errors", async () => {
  const loadExcerpt = vi.fn(async () => excerpt).mockRejectedValueOnce(new Error("private storage key"));
  render(<SourceEvidence evidence={evidence} loadExcerpt={loadExcerpt} />);
  await userEvent.click(screen.getByRole("button", { name: "展开源码摘录" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("源码摘录加载失败");
  expect(screen.queryByText("private storage key")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "收起源码摘录" }));
  await userEvent.click(screen.getByRole("button", { name: "展开源码摘录" }));
  expect(await screen.findByLabelText("已引用源码摘录")).toBeVisible();
});

it("keeps historical evidence without a source location unchanged", () => {
  render(<SourceEvidence evidence={{ ...evidence, sourceLocation: undefined }} />);
  expect(screen.queryByRole("region", { name: "源码证据" })).not.toBeInTheDocument();
});
