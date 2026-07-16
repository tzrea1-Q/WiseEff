import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildDtsParsedIndex } from "./parseIndex";
import { detectUnsupportedDtsConstructs } from "./unsupported";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "dts-teaching-sample.dts");
const sample = readFileSync(fixturePath, "utf8");

describe("DTS parser safety integration (teaching sample)", () => {
  it("buildDtsParsedIndex omits phantom keys that live only inside comments", () => {
    const index = buildDtsParsedIndex(sample);
    const keys = Object.keys(index);

    expect(keys).toContain("board_id");
    expect(keys).toContain("demo_integer/single_value");
    expect(keys).toContain("demo_comment/value_a");

    // Header / section comments mention formats and examples but must not invent keys after strip.
    const commentBodies = [
      ...(sample.match(/\/\*[\s\S]*?\*\//g) ?? []),
      ...(sample.match(/\/\/[^\n]*/g) ?? [])
    ].join("\n");
    const phantomIndex = buildDtsParsedIndex(commentBodies);
    expect(Object.keys(phantomIndex)).toEqual([]);

    // Synthetic regression: commented assignments must not leak.
    const synthetic = buildDtsParsedIndex(`alive = <1>;\n/* phantom_comment_only = <99>; */\n// ghost_line = <7>;\n`);
    expect(Object.keys(synthetic)).toEqual(["alive"]);
  });

  it("detectUnsupportedDtsConstructs does not flag /include/ (resolver owns include diagnostics)", () => {
    expect(sample).toContain("/include/");
    expect(detectUnsupportedDtsConstructs(sample)).toEqual([]);
  });
});
