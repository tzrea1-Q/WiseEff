import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SkillSpecDiff } from "./SkillSpecDiff";
import type { SkillSpec } from "./types";
import { declarationsFor, readStylesheet } from "@/test/cssAssertions";

afterEach(cleanup);
const spec: SkillSpec = { schemaVersion: "skill/v1" };

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
