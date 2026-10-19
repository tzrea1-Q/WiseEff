import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { scanCssContent } from "./check-ui-standards";

describe("overview stylesheet token contract", () => {

  it.each([
    "src/components/layout/overview-page.css",
    "src/features/parameter-home/parameter-home.css",
    "src/features/log-analysis/log-analysis.css",
    "src/features/log-skills/skill-workspace.css"
  ])("has no raw visual declarations in %s", async (file) => {
    const css = await readFile(file, "utf8");
    expect(scanCssContent(file, css)).toEqual([]);
    const declarations = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?:^|[;{}])\s*([\w-]+)\s*:\s*([^;{}]+)(?:;|(?=\}))/g)];
    const rawLengths = declarations.filter((declaration) => /(?:\d|\.\d)[\d.]*(?:px|rem|em)\b/.test(declaration[2]));
    expect(rawLengths.map((declaration) => `${declaration[1]}: ${declaration[2].trim()}`)).toEqual([]);
  });

});
