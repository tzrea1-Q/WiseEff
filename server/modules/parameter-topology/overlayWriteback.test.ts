import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ensureOverlayProperty } from "./overlayWriteback";

describe("exact occurrence source patch", () => {
  it("replaces a pinned root property without inventing a ref, but refuses unlocated insertion", () => {
    const source = "/dts-v1/;\n/ { rate = <1>; untouched = <7>; };\n";
    const input = { propertyKey: "rate", rawText: "<22>", action: "set" as const, targetRef: "",
      expectedChecksum: createHash("sha256").update(source).digest("hex") };
    const start = source.indexOf("<1>");
    expect(ensureOverlayProperty(source, { ...input, occurrenceSpan: { start, end: start + 3 } }))
      .toBe("/dts-v1/;\n/ { rate = <22>; untouched = <7>; };\n");
    expect(() => ensureOverlayProperty(source, input)).toThrow("explicit target ref");
    expect(() => ensureOverlayProperty(source, { ...input, occurrenceSpan: { start: 0, end: 3 } })).toThrow("span is stale");
  });
});
