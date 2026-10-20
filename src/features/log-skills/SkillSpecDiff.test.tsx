import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SkillSpecDiff } from "./SkillSpecDiff";
import type { SkillSpec } from "./types";
import { declarationsFor, readStylesheet } from "@/test/cssAssertions";

afterEach(cleanup);
const spec: SkillSpec = { schemaVersion: "skill/v1" };

it("includes ordered file applicability and roles in publication differences", () => {
  render(<SkillSpecDiff before={spec} after={{ ...spec, files: [{ glob: "charger/**", role: "充电" }] }} />);
  expect(screen.getByRole("region", { name: "适用文件差异" })).toHaveTextContent("charger/**");
  expect(screen.getByRole("region", { name: "适用文件差异" })).toHaveTextContent("充电");
  expect(screen.getByLabelText("变更摘要").querySelector("p")).toHaveTextContent("适用文件 1 项");
});

it("makes model and budget changes visible in integration publication review", () => {
  render(<SkillSpecDiff before={{ ...spec, modelOverride: "previous-model", stepBudget: 4, tokenBudget: 4000 }} after={{ ...spec, stepBudget: 5, tokenBudget: 5000 }} />);
  expect(screen.getByLabelText("变更摘要").querySelector("p")).toHaveTextContent(/^集成 3 项$/);
  const integration = screen.getByLabelText("集成差异");
  expect(within(integration).getByRole("row", { name: "模型覆盖 previous-model 未配置" })).toBeVisible();
  expect(within(integration).getByRole("row", { name: "步骤预算 4 5" })).toBeVisible();
  expect(within(integration).getByRole("row", { name: "令牌预算 4000 5000" })).toBeVisible();
  expect(screen.queryByLabelText("概览差异")).not.toBeInTheDocument();
});

it("shows only nonzero change groups and a single identical-content message", () => {
  const { rerender } = render(<SkillSpecDiff before={spec} after={{ ...spec, description: "新描述" }} />);
  const summary = screen.getByLabelText("变更摘要");
  expect(summary.querySelector("p")).toHaveTextContent(/^概览 1 项$/);
  expect(summary).not.toHaveTextContent("基础格式 0");
  expect(summary).not.toHaveTextContent("规则设置 0");
  expect(summary.querySelector("table")).toHaveAttribute("data-slot", "table");
  rerender(<SkillSpecDiff before={spec} after={spec} />);
  expect(screen.getAllByText("两个版本内容相同")).toHaveLength(1);
  expect(summary).not.toHaveTextContent("0 项");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("summarizes added, changed and deleted parse tests with translated facets instead of raw test JSON", () => {
  const original = { id: "changed", name: "2", lines: ["private sample before"], expect: { fields: { field: "private expected before" } } };
  const removed = { ...original, id: "removed", name: "Removed case" };
  const added = { ...original, id: "added", name: "Added case" };
  render(<SkillSpecDiff before={{ ...spec, parseTests: [original, removed] }} after={{ ...spec, parseTests: [
    { ...original, lines: ["private sample after"], expect: { fields: { field: "private expected after" } } }, added
  ] }} />);
  expect(screen.getByLabelText("变更摘要").querySelector("p")).toHaveTextContent("新增解析测试 1 · 修改解析测试 1 · 删除解析测试 1");
  const tests = screen.getByRole("region", { name: "解析测试差异" });
  expect(tests).toHaveTextContent("修改 2：样例行、期望字段");
  expect(tests).toHaveTextContent("新增 Added case");
  expect(tests).toHaveTextContent("删除 Removed case");
  expect(tests).not.toHaveTextContent(/private sample|private expected|"lines"|"expect"/);
  expect(tests.querySelector("pre")).toBeNull();
});

it("keeps facts on the body scale and portal diff styling independent of the workspace", () => {
  const css = readStylesheet("src/features/log-skills/skill-workspace.css");
  expect(declarationsFor(css, ".skill-section .skill-facts dd").font).toContain("var(--text-base) / var(--leading-base)");
  expect(declarationsFor(css, ".skill-diff").font).toContain("var(--text-base) / var(--leading-base)");
});

it("contains the sticky draft bar below app overlays and the shared modal scrim", () => {
  const css = readStylesheet("src/features/log-skills/skill-workspace.css");
  const root = declarationsFor(css, ".skill-workspace");
  expect(root["z-index"]).toBe("var(--z-content-base)");
  expect(declarationsFor(css, ".skill-workspace .navigator-workbench__context")["z-index"]).toBe("var(--z-content-sticky)");
  const shared = readStylesheet("src/styles.css");
  const ladder = declarationsFor(shared, ":root");
  expect(Number(ladder["--z-content-sticky"])).toBeLessThan(Number(ladder["--z-sticky"]));
  expect(Number(ladder["--z-content-base"])).toBeLessThan(Number(ladder["--z-modal-backdrop"]));
  expect(declarationsFor(shared, ".modal-backdrop")["z-index"]).toBe("var(--z-modal-backdrop)");
});
