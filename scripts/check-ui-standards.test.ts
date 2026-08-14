import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildBaseline,
  collectUiStandardsViolations,
  compareWithBaseline,
  countByRule,
  scanCssContent,
  scanTsContent,
  uiRuleIds,
  type UiStandardsBaseline,
  type UiViolation
} from "./check-ui-standards";

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wiseeff-ui-check-"));
  tempRoots.push(root);
  return root;
}

async function write(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function rules(violations: UiViolation[]): string[] {
  return violations.map((violation) => violation.rule);
}

describe("scanCssContent raw-color", () => {
  it("allows raw literals inside :root, .dark, and @theme token blocks", () => {
    const css = [
      ":root {",
      "  --accent: #0052cc;",
      "  --accent-hover: color-mix(in srgb, var(--accent) 88%, #000);",
      "}",
      "@theme inline {",
      "  --color-ring: oklch(0.708 0 0);",
      "}",
      ".dark {",
      "  --border: oklch(1 0 0 / 10%);",
      "}"
    ].join("\n");

    expect(scanCssContent("src/styles.css", css)).toEqual([]);
  });

  it("flags hex, rgb(), rgba(), hsl(), and oklch() literals outside token blocks", () => {
    const css = [
      ".card {",
      "  color: #111827;",
      "  background: rgba(15, 23, 42, 0.5);",
      "  border-color: hsl(210 40% 96%);",
      "  outline-color: oklch(0.7 0 0);",
      "}"
    ].join("\n");

    const violations = scanCssContent("src/styles.css", css);
    expect(rules(violations)).toEqual(["raw-color", "raw-color", "raw-color", "raw-color"]);
    expect(violations[0]).toMatchObject({ file: "src/styles.css", line: 2 });
  });

  it("allows color-mix over tokens but flags literals inside color-mix", () => {
    const css = [
      ".a { background: color-mix(in srgb, var(--accent) 12%, var(--surface)); }",
      ".b { background: color-mix(in srgb, var(--accent) 88%, #000); }"
    ].join("\n");

    const violations = scanCssContent("src/styles.css", css);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "raw-color", line: 2 });
  });

  it("ignores comments, keyword colors, and string contents such as data URIs", () => {
    const css = [
      "/* #ff0000 rgba(0,0,0,.5) */",
      ".a {",
      "  color: transparent;",
      "  caret-color: currentColor;",
      "  background-color: inherit;",
      '  background-image: url("data:image/svg+xml,%23fff #abcdef");',
      "  /* color: #123456; */",
      "}"
    ].join("\n");

    expect(scanCssContent("src/styles.css", css)).toEqual([]);
  });

  it("reports the starting line of multi-line declarations", () => {
    const css = [".a {", "  background: linear-gradient(", "    #ffffff,", "    var(--bg)", "  );", "}"].join("\n");

    const violations = scanCssContent("src/styles.css", css);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "raw-color", line: 2 });
  });
});

describe("scanCssContent raw-z-index", () => {
  it("flags numeric z-index and calc escape hatches but allows var(--z-*)", () => {
    const css = [
      ".a { z-index: 60; }",
      ".b { z-index: var(--z-toast); }",
      ".c { z-index: calc(var(--z-toast) + 1); }",
      ".d { z-index: auto; }"
    ].join("\n");

    const violations = scanCssContent("src/styles.css", css);
    expect(violations.map((violation) => violation.line)).toEqual([1, 3]);
    expect(rules(violations)).toEqual(["raw-z-index", "raw-z-index"]);
  });
});

describe("scanCssContent raw-font-size", () => {
  it("flags px/rem/em literals outside token blocks and allows var(--text-*)", () => {
    const css = [
      ":root { --text-base: 13px; }",
      ".a { font-size: 14px; }",
      ".b { font-size: 0.875rem; }",
      ".c { font-size: var(--text-sm); }",
      ".d { font-size: 0; }"
    ].join("\n");

    const violations = scanCssContent("src/styles.css", css);
    expect(violations.map((violation) => violation.line)).toEqual([2, 3]);
    expect(rules(violations)).toEqual(["raw-font-size", "raw-font-size"]);
  });
});

describe("scanCssContent raw-shadow", () => {
  it("exempts pure var(--shadow-*)/var(--ring) combinations and none", () => {
    const css = [
      ".a { box-shadow: var(--shadow-1); }",
      ".b { box-shadow: var(--shadow-2), var(--ring); }",
      ".c { box-shadow: inset var(--shadow-1); }",
      ".d { box-shadow: none; }"
    ].join("\n");

    expect(scanCssContent("src/styles.css", css)).toEqual([]);
  });

  it("flags box-shadow declarations containing literal geometry or colors", () => {
    const css = [
      ".a { box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06); }",
      ".b { box-shadow: var(--shadow-1), 0 0 0 1px var(--border); }",
      ":root { --shadow-1: 0 1px 2px rgba(15, 23, 42, 0.06); }"
    ].join("\n");

    const violations = scanCssContent("src/styles.css", css);
    // Line 1 also produces one raw-color violation for the rgba literal.
    expect(violations.filter((violation) => violation.rule === "raw-shadow").map((violation) => violation.line)).toEqual([
      1, 2
    ]);
  });
});

describe("scanCssContent raw-spacing", () => {
  it("flags px/rem/em literals on spacing properties outside token blocks and allows var(--space-*)", () => {
    const css = [
      ":root { --space-2: 8px; }",
      ".a { padding: 8px; }",
      ".b { margin: 0.5rem; }",
      ".c { gap: var(--space-3); }",
      ".d { padding: 0; }",
      ".e { margin: auto; }",
      ".f { padding: 50%; }",
      ".g { padding: calc(8px + var(--space-2)); }"
    ].join("\n");

    const violations = scanCssContent("src/styles.css", css);
    expect(violations.map((violation) => violation.line)).toEqual([2, 3, 8]);
    expect(rules(violations)).toEqual(["raw-spacing", "raw-spacing", "raw-spacing"]);
  });

  it("does not flag width, height, inset, or border-width lengths", () => {
    const css = [
      ".a { width: 8px; }",
      ".b { height: 16px; }",
      ".c { top: 4px; }",
      ".d { inset: 8px 16px; }",
      ".e { border-width: 2px; }"
    ].join("\n");

    expect(scanCssContent("src/styles.css", css)).toEqual([]);
  });
});

describe("scanCssContent raw-radius", () => {
  it("flags raw border-radius lengths outside token blocks and allows var(--radius-*)", () => {
    const css = [
      ":root { --radius-md: 8px; }",
      ".a { border-radius: 8px; }",
      ".b { border-top-left-radius: 12px; }",
      ".c { border-radius: var(--radius-lg); }",
      ".d { border-radius: 0; }",
      ".e { border-radius: 0px; }",
      ".f { border-radius: 10px; }"
    ].join("\n");

    const violations = scanCssContent("src/styles.css", css);
    expect(violations.map((violation) => violation.line)).toEqual([2, 3, 7]);
    expect(rules(violations)).toEqual(["raw-radius", "raw-radius", "raw-radius"]);
  });
});

describe("scanCssContent ease-keyword", () => {
  it("flags bare ease/ease-in/ease-out/ease-in-out in transition and animation", () => {
    const css = [
      ".a { transition: all 0.2s ease; }",
      ".b { transition: opacity 120ms ease-in-out; }",
      ".c { animation-timing-function: ease-out; }",
      ".d { transition: opacity var(--duration-fast) var(--ease-out); }",
      ".e { animation: modal-enter var(--duration-slow) var(--ease-in-out); }",
      ".f { animation-name: release-ease; }"
    ].join("\n");

    const violations = scanCssContent("src/styles.css", css);
    expect(violations.map((violation) => violation.line)).toEqual([1, 2, 3]);
    expect(rules(violations)).toEqual(["ease-keyword", "ease-keyword", "ease-keyword"]);
  });
});

describe("scanTsContent", () => {
  it("flags window.confirm and window.alert calls but not comments or strings", () => {
    const source = [
      "export function remove() {",
      "  if (window.confirm(\"确认删除?\")) {",
      "    window.alert(\"done\");",
      "  }",
      "  // never call window.confirm( here",
      "  const hint = \"window.confirm(is forbidden)\";",
      "  return hint;",
      "}"
    ].join("\n");

    const violations = scanTsContent("src/foo.ts", source);
    expect(rules(violations)).toEqual(["window-confirm", "window-confirm"]);
    expect(violations.map((violation) => violation.line)).toEqual([2, 3]);
  });

  it("flags numeric zIndex literals in TSX but not token injection", () => {
    const source = [
      "const style = {",
      "  zIndex: 60,",
      "};",
      "const ok = { zIndex: \"var(--z-dropdown)\" };",
      "interface Props { zIndex: number }"
    ].join("\n");

    const violations = scanTsContent("src/Column.tsx", source);
    expect(rules(violations)).toEqual(["raw-z-index"]);
    expect(violations[0].line).toBe(2);
  });

  it("does not apply TSX-only rules to plain .ts files", () => {
    const violations = scanTsContent("src/foo.ts", "const style = { zIndex: 60 };");
    expect(violations).toEqual([]);
  });

  it("flags hand-rolled modal-backdrop divs outside ModalDialog", () => {
    const offending = '<div className="modal-backdrop wizard-backdrop">';
    const scoped = '<ModalDialog backdropClassName="param-admin-modal-backdrop" />';
    const query = "document.querySelector('.modal-backdrop');";

    expect(rules(scanTsContent("src/Wizard.tsx", offending))).toEqual(["hand-rolled-backdrop"]);
    expect(scanTsContent("src/Wizard.tsx", scoped)).toEqual([]);
    expect(scanTsContent("src/Wizard.tsx", query)).toEqual([]);
    expect(scanTsContent("src/components/common/ModalDialog.tsx", offending)).toEqual([]);
  });

  it("flags fixed english chrome residues in JSX text but not quoted data values", () => {
    const source = [
      "const user = { lastActive: \"just now\", seen: \"2h ago\" };",
      "export const Chrome = () => (",
      "  <div>",
      "    <span>Showing {from} of {total}</span>",
      "    <th>Report ID</th>",
      "    <td>just now</td>",
      "    <td>3h ago</td>",
      "  </div>",
      ");"
    ].join("\n");

    const violations = scanTsContent("src/Chrome.tsx", source);
    expect(rules(violations)).toEqual(["english-chrome", "english-chrome", "english-chrome", "english-chrome"]);
    expect(violations.map((violation) => violation.line)).toEqual([4, 5, 6, 7]);
  });
});

describe("collectUiStandardsViolations", () => {
  it("walks src css and ts/tsx files and reports repo-relative posix paths", async () => {
    const root = await createTempRoot();
    await write(root, "src/styles.css", ":root { --accent: #0052cc; }\n.a { color: #111827; }\n");
    await write(root, "src/components/Foo.tsx", "const s = { zIndex: 50 };\n");
    await write(root, "src/util.ts", "window.confirm(\"x\");\n");

    const violations = await collectUiStandardsViolations(root);

    expect(violations).toEqual([
      { rule: "raw-z-index", file: "src/components/Foo.tsx", line: 1, detail: "zIndex: 50" },
      { rule: "raw-color", file: "src/styles.css", line: 2, detail: "color: … #111827 …" },
      { rule: "window-confirm", file: "src/util.ts", line: 1, detail: "window.confirm(…)" }
    ]);
  });
});

describe("compareWithBaseline", () => {
  const violation = (rule: UiViolation["rule"], file: string, line: number): UiViolation => ({
    rule,
    file,
    line,
    detail: "x"
  });

  it("fails a rule when its count exceeds the baseline and pinpoints grown files", () => {
    const baseline: UiStandardsBaseline = {
      rules: { "raw-color": { count: 2, files: { "src/styles.css": 2 } } }
    };
    const violations = [
      violation("raw-color", "src/styles.css", 10),
      violation("raw-color", "src/styles.css", 20),
      violation("raw-color", "src/new.css", 3)
    ];

    const comparisons = compareWithBaseline(violations, baseline);
    const rawColor = comparisons.find((comparison) => comparison.rule === "raw-color");

    expect(rawColor).toMatchObject({ current: 3, baseline: 2, status: "exceeded" });
    expect(rawColor?.newViolations).toEqual([violation("raw-color", "src/new.css", 3)]);
  });

  it("treats counts below baseline as improvements and equal counts as ok", () => {
    const baseline: UiStandardsBaseline = {
      rules: {
        "raw-color": { count: 3 },
        "ease-keyword": { count: 1 }
      }
    };
    const violations = [violation("raw-color", "src/styles.css", 1), violation("ease-keyword", "src/styles.css", 2)];

    const comparisons = compareWithBaseline(violations, baseline);

    expect(comparisons.find((comparison) => comparison.rule === "raw-color")?.status).toBe("improved");
    expect(comparisons.find((comparison) => comparison.rule === "ease-keyword")?.status).toBe("ok");
  });

  it("treats missing baseline entries as zero so hard-forbidden rules fail on first violation", () => {
    const comparisons = compareWithBaseline([violation("window-confirm", "src/a.tsx", 1)], { rules: {} });
    const windowConfirm = comparisons.find((comparison) => comparison.rule === "window-confirm");

    expect(windowConfirm).toMatchObject({ current: 1, baseline: 0, status: "exceeded" });
  });
});

describe("buildBaseline", () => {
  it("covers every rule, keeps notes, and records per-file counts for non-zero rules", () => {
    const previous: UiStandardsBaseline = {
      rules: { "window-confirm": { count: 0, note: "Hard-forbidden." } }
    };
    const violations: UiViolation[] = [
      { rule: "raw-color", file: "src/styles.css", line: 1, detail: "x" },
      { rule: "raw-color", file: "src/styles.css", line: 2, detail: "x" }
    ];

    const baseline = buildBaseline(violations, previous);

    expect(Object.keys(baseline.rules)).toEqual(uiRuleIds);
    expect(baseline.rules["raw-color"]).toEqual({ count: 2, files: { "src/styles.css": 2 } });
    expect(baseline.rules["window-confirm"]).toEqual({ count: 0, note: "Hard-forbidden." });
    expect(countByRule(violations)["raw-color"].count).toBe(2);
  });
});
