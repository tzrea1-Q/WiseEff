import { describe, expect, it } from "vitest";
import { validatePlanDocument } from "./check-doc-governance";

describe("validatePlanDocument", () => {
  it("accepts active implementation plans with both required sections", () => {
    const content = [
      "# M5.1 Plan",
      "",
      "## Documentation Impact Matrix",
      "",
      "## Documentation Update Gate"
    ].join("\n");

    expect(validatePlanDocument("docs/exec-plans/active/m5-1-plan.md", content)).toEqual([]);
  });

  it("rejects active implementation plans missing the Documentation Impact Matrix", () => {
    const content = [
      "# M5.1 Plan",
      "",
      "## Documentation Update Gate"
    ].join("\n");

    expect(validatePlanDocument("docs/exec-plans/active/m5-1-plan.md", content)).toEqual([
      "docs/exec-plans/active/m5-1-plan.md is missing ## Documentation Impact Matrix."
    ]);
  });

  it("rejects required section text that only appears inside fenced code blocks", () => {
    const content = [
      "# M5.1 Plan",
      "",
      "```markdown",
      "## Documentation Impact Matrix",
      "## Documentation Update Gate",
      "```",
      "",
      "## Task 1"
    ].join("\n");

    expect(validatePlanDocument("docs/exec-plans/active/m5-1-plan.md", content)).toEqual([
      "docs/exec-plans/active/m5-1-plan.md is missing ## Documentation Impact Matrix.",
      "docs/exec-plans/active/m5-1-plan.md is missing ## Documentation Update Gate."
    ]);
  });

  it("exempts the active development roadmap", () => {
    expect(validatePlanDocument("docs/exec-plans/active/development-roadmap.md", "# Roadmap")).toEqual([]);
  });
});
