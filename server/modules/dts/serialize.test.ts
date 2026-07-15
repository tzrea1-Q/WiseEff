import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDts } from "./parser";
import { serializeDts } from "./serialize";
import { classifyDtsValue } from "./valueTyping";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../parameter-files/__fixtures__/dts-teaching-sample.dts",
);

describe("serializeDts", () => {
  it("round-trips the teaching fixture byte-for-byte", () => {
    const sample = readFileSync(fixturePath, "utf8");
    expect(serializeDts(parseDts(sample))).toBe(sample);
  });

  it("changes only the edited property rawText; remainder stays byte-identical", () => {
    const sample = readFileSync(fixturePath, "utf8");
    const doc = parseDts(sample);
    const target = findProperty(doc.topLevel, "single_value");
    expect(target).toBeDefined();
    const before = target!.rawText;
    const next = "<99>";
    target!.rawText = next;
    const classified = classifyDtsValue(next, target!.name);
    target!.valueType = classified.valueType;
    target!.normalizedValue = classified.normalizedValue;

    const out = serializeDts(doc);
    expect(out).not.toBe(sample);
    expect(out).toContain("single_value = <99>;");
    expect(out.includes(before)).toBe(false);

    // Strip the edited property line from both — leftover must match after aligning lengths via spans
    const originalWithout = sample.slice(0, target!.span.start) + sample.slice(target!.span.end);
    const outWithout = out.slice(0, target!.span.start) + out.slice(target!.span.start + next.length);
    expect(outWithout).toBe(originalWithout);
    expect(out.slice(target!.span.start, target!.span.start + next.length)).toBe(next);
  });
});

function findProperty(
  nodes: import("./types").DtsNodeCst[],
  name: string,
): import("./types").DtsPropertyCst | undefined {
  for (const node of nodes) {
    for (const child of node.children) {
      if (child.kind === "property" && child.name === name) return child;
      if (child.kind === "node") {
        const found = findProperty([child], name);
        if (found) return found;
      }
    }
  }
  return undefined;
}
