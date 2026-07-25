import { describe, expect, it } from "vitest";
import { resolveDtsConfigSet, type DtsConfigSetFile } from "./configSetResolver";
import {
  danglingAnchorLabels,
  synthesizeDanglingAnchorStub,
  withEphemeralDanglingAnchorStub
} from "./danglingAnchorStub";

describe("synthesizeDanglingAnchorStub", () => {
  it("returns empty when there is nothing to stub", () => {
    expect(synthesizeDanglingAnchorStub([])).toBe("");
    expect(synthesizeDanglingAnchorStub(["not a label!"])).toBe("");
  });

  it("defines each unique valid label as an empty node", () => {
    const stub = synthesizeDanglingAnchorStub(["charging_core", "charging_core", "gpio13"]);
    expect(stub).toContain("/dts-v1/;");
    expect(stub).toContain("EPHEMERAL toolchain stub");
    expect(stub).toContain("charging_core: charging_core { };");
    expect(stub).toContain("gpio13: gpio13 { };");
    // Deduplicated.
    expect(stub.match(/charging_core:/g)).toHaveLength(1);
  });

  it("lets a previously-dangling overlay resolve cleanly when prepended as a base", () => {
    const overlay = `/plugin/;\n\n&charging_core {\n\tiin_max = <2300>;\n};\n`;

    // Without the stub: dangling warning, property lands on a synthetic anchor.
    const beforeFiles = new Map<string, DtsConfigSetFile>([
      ["overlay.dtso", { fileVersionId: "v1", content: overlay }],
    ]);
    const before = resolveDtsConfigSet({
      entryFile: "overlay.dtso",
      includeSearchPaths: [],
      overlayOrder: [],
      files: beforeFiles,
    });
    const labels = danglingAnchorLabels(before.diagnostics);
    expect(labels).toEqual(["charging_core"]);

    // Prepend the synthesized stub as the base: the same overlay now resolves with no warning.
    const stub = synthesizeDanglingAnchorStub(labels);
    const afterFiles = new Map<string, DtsConfigSetFile>([
      ["__stub__.dts", { fileVersionId: "stub", content: stub }],
      ["overlay.dtso", { fileVersionId: "v1", content: overlay }],
    ]);
    const after = resolveDtsConfigSet({
      entryFile: "__stub__.dts",
      includeSearchPaths: [],
      overlayOrder: ["overlay.dtso"],
      files: afterFiles,
    });
    expect(after.diagnostics).toEqual([]);
    expect(
      after.effective.nodesByLocator.get("/charging_core")?.properties.get("iin_max")?.normalizedValue,
    ).toContain("2300");
  });
});

describe("withEphemeralDanglingAnchorStub", () => {
  it("returns the source unchanged when every &label is defined locally", () => {
    const source = `/dts-v1/;\n/ {\n\tamba: amba { status = "okay"; };\n};\n`;
    expect(withEphemeralDanglingAnchorStub(source)).toBe(source);
  });

  it("prepends empty-node stubs for undefined &label and phandle targets", () => {
    const source = `/dts-v1/;\n\n&amba {\n\ti2c { gpio_int = <&gpio13 29 0>; };\n};\n`;
    const stubbed = withEphemeralDanglingAnchorStub(source);
    expect(stubbed).toContain("EPHEMERAL toolchain stub");
    expect(stubbed).toContain("amba: amba { };");
    expect(stubbed).toContain("gpio13: gpio13 { };");
    expect(stubbed).toContain("&amba {");
    expect(stubbed.startsWith("/dts-v1/;")).toBe(true);
  });
});
