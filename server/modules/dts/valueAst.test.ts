import { describe, expect, it } from "vitest";
import { parseDtsValue, renderDtsValue } from "./valueAst";

describe("parseDtsValue / renderDtsValue", () => {
  it.each([
    ["weak_source_sleep_enabled", "", { kind: "boolean", present: true }],
    ["ranges", "", { kind: "empty" }],
    ["sc_err_tx", "/bits/ 8 <2>", { kind: "cells", bits: 8 }],
    ["gpio_int", "<&gpio13 29 0>", { kind: "cells", bits: 32 }],
    ["vbat_comp_ic_para", '"sc8565", "2", "0.5", "3"', { kind: "strings" }],
  ] as const)("parses %s without losing raw text", (name, raw, expected) => {
    const { value } = parseDtsValue(name, raw);
    expect(value).toMatchObject(expected);
    expect(renderDtsValue(value, raw)).toBe(raw);
  });

  it("parses decimal, hex, and negative cells while keeping raw tokens exact", () => {
    const { value } = parseDtsValue("margin", "<0xB -1 42>");
    expect(value).toMatchObject({ kind: "cells", bits: 32 });
    if (value.kind !== "cells") throw new Error("expected cells");
    expect(value.groups[0]).toEqual([
      { kind: "integer", raw: "0xB", value: "11" },
      { kind: "integer", raw: "-1", value: "-1" },
      { kind: "integer", raw: "42", value: "42" },
    ]);
  });

  it("parses multiple comma-separated cell groups", () => {
    const raw = "<1 2600>,<2 2800>";
    const { value } = parseDtsValue("combined_para", raw);
    expect(value).toMatchObject({ kind: "cells", bits: 32 });
    if (value.kind !== "cells") throw new Error("expected cells");
    expect(value.groups).toHaveLength(2);
    expect(renderDtsValue(value, raw)).toBe(raw);
  });

  it("parses a phandle reference as a phandle cell", () => {
    const { value } = parseDtsValue("interrupt-parent", "<&gic>");
    expect(value).toMatchObject({ kind: "cells", bits: 32 });
    if (value.kind !== "cells") throw new Error("expected cells");
    expect(value.groups[0]).toEqual([{ kind: "phandle", label: "gic" }]);
  });

  it("rejects integer overflow for the selected bit width", () => {
    expect(() => parseDtsValue("reg_config", "/bits/ 8 <0x100>")).toThrow();
  });

  it("keeps distinct floating-looking string tokens byte-identical", () => {
    const raw = '"0.5", "-32767", "6|9|10"';
    const { value } = parseDtsValue("comp_para", raw);
    expect(value).toMatchObject({ kind: "strings", values: ["0.5", "-32767", "6|9|10"] });
    expect(renderDtsValue(value, raw)).toBe(raw);
  });

  it("round-trips a multi-line, tab-indented string list byte-identically (real base-power-overlay.dts fixture)", () => {
    // Mirrors the `vbat_comp_ic_para` RHS in src/config/dts-seed/base-power-overlay.dts, where
    // the item list wraps across lines with tab indentation instead of a single ", "-joined run.
    const raw = '"schargerV800", "13", "7", "3",\n\t\t"sc8565", "2", "0.5", "3"';
    const { value } = parseDtsValue("vbat_comp_ic_para", raw);
    expect(value).toMatchObject({
      kind: "strings",
      values: ["schargerV800", "13", "7", "3", "sc8565", "2", "0.5", "3"],
    });
    expect(renderDtsValue(value, raw)).toBe(raw);
  });

  it("parses a [xx yy ...] byte literal to the bytes kind and round-trips it", () => {
    const raw = "[01 02 ab ff]";
    const { value } = parseDtsValue("reg_config", raw);
    expect(value).toEqual({ kind: "bytes", values: [1, 2, 171, 255] });
    expect(renderDtsValue(value, raw)).toBe(raw);
  });

  it("preserves multi-line cell-matrix layout when only one token changes", () => {
    const previous = "<4200 10790 0\n\t\t\t4250 8092 0\n\t\t\t4565 2697 0>";
    const { value } = parseDtsValue("cccv_10_20", previous);
    expect(value).toMatchObject({ kind: "cells", bits: 32 });
    if (value.kind !== "cells") throw new Error("expected cells");

    const nextGroups = value.groups.map((group) =>
      group.map((cell) =>
        cell.kind === "integer" && cell.raw === "10790"
          ? { kind: "integer" as const, raw: "10690", value: "10690" }
          : cell
      )
    );
    const nextValue = { kind: "cells" as const, bits: 32 as const, groups: nextGroups };

    expect(renderDtsValue(nextValue, previous)).toBe(
      "<4200 10690 0\n\t\t\t4250 8092 0\n\t\t\t4565 2697 0>"
    );
    expect(renderDtsValue(nextValue, previous)).not.toBe(
      "<4200 10690 0 4250 8092 0 4565 2697 0>"
    );
  });

  it("falls back to compact cells render when group shape changes", () => {
    const previous = "<4200 10790 0\n\t\t\t4250 8092 0>";
    const nextValue = {
      kind: "cells" as const,
      bits: 32 as const,
      groups: [
        [
          { kind: "integer" as const, raw: "4200", value: "4200" },
          { kind: "integer" as const, raw: "10690", value: "10690" }
        ]
      ]
    };
    expect(renderDtsValue(nextValue, previous)).toBe("<4200 10690>");
  });
});
