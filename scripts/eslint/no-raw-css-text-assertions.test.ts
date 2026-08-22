import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

import { noRawCssTextAssertions } from "./no-raw-css-text-assertions.js";

function lint(source: string) {
  const linter = new Linter();
  return linter.verify(source, [
    {
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module"
      },
      plugins: {
        wiseeff: {
          rules: {
            "no-raw-css-text-assertions": noRawCssTextAssertions
          }
        }
      },
      rules: {
        "wiseeff/no-raw-css-text-assertions": "error"
      }
    }
  ]);
}

describe("no-raw-css-text-assertions", () => {
  it("rejects raw matchers applied to CSS read directly from disk", () => {
    const messages = lint(`
      import { readFileSync } from "node:fs";
      const css = readFileSync("src/styles.css", "utf8");
      expect(css).toMatch(/\\.button\\s*\\{/);
      expect(css).not.toContain(".legacy-button");
    `);

    expect(messages.map((message) => message.messageId)).toEqual([
      "rawCssAssertion",
      "rawCssAssertion"
    ]);
  });

  it("rejects raw assertions over helper reads and concatenated stylesheets", () => {
    const messages = lint(`
      const css = readStylesheet("src/styles.css")
        + readStylesheet("src/features/log-analysis/log-analysis.css");
      expect(css).toContain(".raw-log-viewer");
      expect(fs.readFileSync(resolve(process.cwd(), "src", "styles.css"), "utf8")).toMatch(/z-index/);
    `);

    expect(messages.map((message) => message.messageId)).toEqual([
      "rawCssAssertion",
      "rawCssAssertion"
    ]);
  });

  it("rejects raw matchers when a stylesheet reader receives a static path variable", () => {
    const messages = lint(`
      const featurePath = "src/features/example/example.css";
      const css = readStylesheet(featurePath);
      expect(css).toContain(".raw-example");
    `);

    expect(messages.map((message) => message.messageId)).toEqual([
      "rawCssAssertion"
    ]);
  });

  it("tracks constructed paths and straight-line assignments without crossing shadowed variables", () => {
    const messages = lint(`
      const base = "src";
      const cssPath = resolve(base, "styles.css");
      const css = readStylesheet(cssPath);
      expect(css).toContain(".raw-from-constructed-path");

      let assignedPath;
      assignedPath = resolve(base, "features/example.css");
      let assignedCss;
      assignedCss = readStylesheet(assignedPath);
      expect(assignedCss).toMatch(/raw-from-assignment/);

      function architecturalFixture() {
        const cssPath = "src/app/routes.tsx";
        const css = readFileSync(cssPath, "utf8");
        expect(css).toContain("routes");
      }
    `);

    expect(messages.map((message) => message.messageId)).toEqual([
      "rawCssAssertion",
      "rawCssAssertion"
    ]);
  });

  it("allows structural CSS queries and unrelated source contract tests", () => {
    const messages = lint(`
      const css = readStylesheet("src/styles.css");
      const declarations = declarationsFor(css, ".button");
      expect(declarations.background).toContain("var(--accent)");
      expect(hasRule(css, ".button")).toBe(true);

      const routesSource = readFileSync("src/app/routes.tsx", "utf8");
      expect(routesSource).toContain("NoEntryPage");
      expect(routesSource).not.toMatch(/LegacyDebuggingPage/);

      function architecturalFixture() {
        const css = readFileSync("src/app/routes.tsx", "utf8");
        expect(css).toContain("routes");
      }

      let reassignedPath = "src/styles.css";
      reassignedPath = "src/app/routes.tsx";
      let reassignedSource = readStylesheet("src/styles.css");
      reassignedSource = readFileSync(reassignedPath, "utf8");
      expect(reassignedSource).toContain("routes");
    `);

    expect(messages).toEqual([]);
  });
});
