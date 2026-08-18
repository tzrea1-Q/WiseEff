import { describe, expect, it } from "vitest";
import {
  classifyChangedPaths,
  formatGithubOutput,
  readChangedPathsFromText
} from "./ci-changed-paths";

describe("classifyChangedPaths", () => {
  it("treats an empty diff as fail-open L1 + quality + smoke", () => {
    expect(classifyChangedPaths([])).toEqual({
      docsOnly: false,
      ui: true,
      product: true,
      workflow: false,
      runL1: true,
      runQuality: true,
      runSmoke: true
    });
  });

  it("classifies docs, markdown, and non-CI GitHub files as docs-only", () => {
    expect(
      classifyChangedPaths([
        "docs/developer/verification-matrix.md",
        "README.md",
        ".github/ISSUE_TEMPLATE/bug.md"
      ])
    ).toMatchObject({
      docsOnly: true,
      runL1: false,
      runQuality: false,
      runSmoke: false
    });
  });

  it("never treats ci.yml as docs-only", () => {
    expect(classifyChangedPaths([".github/workflows/ci.yml"])).toMatchObject({
      docsOnly: false,
      workflow: true,
      runL1: true,
      runSmoke: true,
      runQuality: false
    });
  });

  it("runs quality without smoke for public-asset-only UI diffs", () => {
    expect(classifyChangedPaths(["public/favicon.svg", "index.html"])).toMatchObject({
      docsOnly: false,
      ui: true,
      product: false,
      runL1: true,
      runQuality: true,
      runSmoke: false
    });
  });

  it("runs L1, quality, and smoke for product paths", () => {
    expect(classifyChangedPaths(["server/modules/auth/routes.ts"])).toMatchObject({
      product: true,
      runL1: true,
      runQuality: true,
      runSmoke: true
    });
  });

  it("treats unrecognized paths as product (fail-open)", () => {
    expect(classifyChangedPaths(["tools/mystery.bin"])).toMatchObject({
      docsOnly: false,
      product: true,
      runL1: true,
      runSmoke: true
    });
  });

  it("does not let a docs file hide a src change", () => {
    expect(classifyChangedPaths(["docs/README.md", "src/pages/HomePage.tsx"])).toMatchObject({
      docsOnly: false,
      ui: true,
      product: true,
      runL1: true,
      runQuality: true,
      runSmoke: true
    });
  });
});

describe("changed-path helpers", () => {
  it("parses newline-separated git diff output", () => {
    expect(readChangedPathsFromText("docs/a.md\n\nsrc/app.tsx\n")).toEqual(["docs/a.md", "src/app.tsx"]);
  });

  it("writes GitHub Actions outputs without a run_l2 flag", () => {
    const output = formatGithubOutput(classifyChangedPaths(["README.md"]));
    expect(output).toBe(["docs_only=true", "run_l1=false", "run_quality=false", "run_smoke=false"].join("\n"));
    expect(output).not.toContain("run_l2");
  });
});
