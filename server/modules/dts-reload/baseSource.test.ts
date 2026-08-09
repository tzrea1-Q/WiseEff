import { describe, expect, it } from "vitest";

import { buildReloadBaseSource } from "./baseSource";

describe("buildReloadBaseSource", () => {
  it("puts the entry file ahead of overlay members regardless of listing order", () => {
    const source = buildReloadBaseSource([
      { fileName: "overlay.dtsi", role: "overlay", sortOrder: 2, content: "/dts-v1/;\n\n&amba { };\n" },
      { fileName: "board.dts", role: "base", sortOrder: 9, content: "/dts-v1/;\n\n/ { amba: amba { }; };\n" }
    ]);

    expect(source.indexOf("amba: amba")).toBeLessThan(source.indexOf("&amba"));
  });

  it("keeps a single preamble so the folded document compiles", () => {
    const source = buildReloadBaseSource([
      { fileName: "board.dts", role: "base", sortOrder: 0, content: "/dts-v1/;\n\n/ { amba: amba { }; };\n" },
      { fileName: "a.dtsi", role: "overlay", sortOrder: 1, content: "/dts-v1/;\n/plugin/;\n\n&amba { a = <1>; };\n" }
    ]);

    expect(source.match(/\/dts-v1\/;/g)).toHaveLength(1);
    expect(source).not.toContain("/plugin/;");
  });

  it("orders overlay members by manifest sort order", () => {
    const source = buildReloadBaseSource([
      { fileName: "second.dtsi", role: "overlay", sortOrder: 2, content: "&amba { b = <2>; };\n" },
      { fileName: "first.dtsi", role: "overlay", sortOrder: 1, content: "&amba { a = <1>; };\n" },
      { fileName: "board.dts", role: "base", sortOrder: 0, content: "/dts-v1/;\n\n/ { amba: amba { }; };\n" }
    ]);

    expect(source.indexOf("a = <1>")).toBeLessThan(source.indexOf("b = <2>"));
  });

  it("defines labels that no member declares, so an overlay-only project still compiles", () => {
    const source = buildReloadBaseSource([
      { fileName: "board.dts", role: "base", sortOrder: 0, content: "/dts-v1/;\n\n&charger { a = <1>; };\n" }
    ]);

    expect(source).toContain("charger: charger { };");
    expect(source).toContain("EPHEMERAL toolchain stub");
  });

  it("refuses an empty configuration set instead of compiling an empty tree", () => {
    expect(() => buildReloadBaseSource([])).toThrow(/at least one configuration-set member/);
  });
});
