import { describe, expect, it } from "vitest";
import { requireNavigatorWorkbenchGeometry } from "../e2e/quality/consistency-assertions";

const rect = (left: number, top: number, width: number, height: number) => ({
  left, top, right: left + width, bottom: top + height, width, height
});
const measurement = () => ({
  pageKey: "parameters", collapsed: false,
  root: rect(280, 88, 1136, 700),
  navigator: rect(280, 168, 240, 600),
  task: rect(532, 168, 884, 600),
  toolbar: rect(280, 88, 1136, 68),
  primaryAction: rect(1283, 108, 120, 36),
  noticeCount: 1,
  navigatorCounts: [{ text: "12 个参数", textRect: rect(460, 210, 44, 13), clip: rect(460, 210, 44, 13), clientWidth: 44, scrollWidth: 44 }],
  firstRow: rect(533, 210, 882, 40),
  firstRowClip: rect(533, 210, 882, 40),
  viewport: { width: 1440, height: 900 },
  pageOverflow: 0,
  contract: { navigatorWidth: 240, collapsedWidth: 40, gap: 12, toolbarPadding: 12 }
});

describe("navigator-workbench geometry", () => {
  it("rejects count text clipped by its own box or the navigator edge", () => {
    const count = measurement().navigatorCounts[0];
    for (const navigatorCounts of [
      [],
      [{ ...count, clip: rect(460, 210, 35, 13) }],
      [{ ...count, clip: rect(460, 210, 0, 13) }],
      [{ ...count, scrollWidth: 50 }],
      [{ ...count, textRect: rect(456, 210, 48, 13) }],
      [{ ...count, clientWidth: Number.NaN }]
    ]) {
      expect(() => requireNavigatorWorkbenchGeometry([{ ...measurement(), navigatorCounts }], "/parameters"))
        .toThrow(/navigator.*count/);
    }
    expect(() => requireNavigatorWorkbenchGeometry([{
      ...measurement(), collapsed: true, navigatorCounts: [],
      navigator: rect(280, 168, 40, 600), task: rect(332, 168, 1084, 600)
    }], "/parameters")).not.toThrow();
  });

  it("accepts the expanded and collapsed contract, including a one-pixel tolerance", () => {
    expect(() => requireNavigatorWorkbenchGeometry([measurement()], "/parameters")).not.toThrow();
    const collapsed = { ...measurement(), collapsed: true,
      navigator: rect(280, 168, 40, 600), task: rect(332, 168, 1084, 600) };
    expect(() => requireNavigatorWorkbenchGeometry([collapsed], "/parameters")).not.toThrow();
    expect(() => requireNavigatorWorkbenchGeometry([{ ...measurement(), navigator: rect(281, 168, 241, 600) }], "/parameters")).not.toThrow();
  });

  it("rejects missing measurements, layout drift, stacked notices and invisible first rows", () => {
    expect(() => requireNavigatorWorkbenchGeometry([], "/parameters")).toThrow("missing consistency measurements");
    for (const invalid of [
      { ...measurement(), navigator: null },
      { ...measurement(), navigator: rect(282, 168, 240, 600) },
      { ...measurement(), navigator: rect(280, 168, 242, 600) },
      { ...measurement(), task: rect(534, 168, 882, 600) },
      { ...measurement(), toolbar: rect(280, 168, 1136, 68) },
      { ...measurement(), primaryAction: rect(1280, 108, 120, 36) },
      { ...measurement(), noticeCount: 2 },
      { ...measurement(), pageOverflow: 2 },
      { ...measurement(), firstRow: null },
      { ...measurement(), firstRowClip: null },
      { ...measurement(), firstRow: rect(533, 890, 882, 40) },
      { ...measurement(), firstRowClip: rect(533, 210, 882, 20) }
    ]) {
      expect(() => requireNavigatorWorkbenchGeometry([invalid], "/parameters")).toThrow();
    }
  });

  it("fails closed on nonfinite measurements and actions outside the toolbar", () => {
    for (const invalid of [
      { ...measurement(), toolbar: { ...measurement().toolbar, bottom: Number.NaN } },
      { ...measurement(), contract: { ...measurement().contract, gap: Number.NaN } },
      { ...measurement(), noticeCount: Number.NaN },
      { ...measurement(), pageOverflow: Number.NaN },
      { ...measurement(), primaryAction: rect(1283, 200, 120, 36) },
      { ...measurement(), firstRow: rect(533, 100, 882, 40), firstRowClip: rect(533, 100, 882, 40) }
    ]) {
      expect(() => requireNavigatorWorkbenchGeometry([invalid], "/parameters")).toThrow();
    }
  });
});
