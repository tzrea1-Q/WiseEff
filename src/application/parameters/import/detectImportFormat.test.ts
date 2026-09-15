import * as XLSX from "xlsx";
import { describe, expect, it, vi } from "vitest";
import { presentError } from "@/infrastructure/http/presentError";
import { IMPORT_TEMPLATE_HEADERS } from "./columnMap";
import {
  detectImportFormat,
  parseImportSource,
  UnsupportedImportFormatError
} from "./detectImportFormat";

describe("detectImportFormat", () => {
  it("detects xlsx from PK magic bytes", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([[...IMPORT_TEMPLATE_HEADERS]]);
    XLSX.utils.book_append_sheet(workbook, sheet, "参数");
    const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));

    expect(detectImportFormat({ bytes })).toBe("spreadsheet");
  });

  it("detects xlsx from file name", () => {
    expect(detectImportFormat({ fileName: "params.xlsx" })).toBe("spreadsheet");
  });

  it("detects dts-full from file extension", () => {
    expect(detectImportFormat({ fileName: "board.dts" })).toBe("dts-full");
    expect(detectImportFormat({ fileName: "include.dtsi" })).toBe("dts-full");
  });

  it("detects dts-full from dts-v1 marker in text", () => {
    expect(
      detectImportFormat({
        text: '/dts-v1/;\n#include "foo.dtsi"\n/ { compatible = "vendor"; };'
      })
    ).toBe("dts-full");
  });

  it("detects dts-full from /{ marker in text", () => {
    expect(
      detectImportFormat({
        text: "/{ compatible = \"vendor\"; };"
      })
    ).toBe("dts-full");
  });

  it("detects json from parseable array text", () => {
    expect(
      detectImportFormat({
        text: JSON.stringify([{ name: "foo", module: "Bar" }])
      })
    ).toBe("json");
  });

  it("detects json from parseable object text", () => {
    expect(
      detectImportFormat({
        text: JSON.stringify({ items: [{ name: "foo", module: "Bar" }] })
      })
    ).toBe("json");
  });

  it("falls back to spreadsheet for csv-like text", () => {
    expect(
      detectImportFormat({
        fileName: "params.csv",
        text: `${IMPORT_TEMPLATE_HEADERS.join(",")}\nfoo,Bar,1,2,,,,,,,`
      })
    ).toBe("spreadsheet");
  });

  it.each([
    ["params.yaml", "yaml"],
    ["params.yml", "yaml"],
    ["params.toml", "toml"],
    ["params.env", "env"],
    [".env", "env"]
  ])("does not collapse deferred format %s into spreadsheet", (fileName, format) => {
    expect(detectImportFormat({ fileName, text: "unrelated body" })).toBe("unsupported");
    expect(detectImportFormat({ fileName })).toBe("unsupported");
    expect(new UnsupportedImportFormatError(format as "yaml" | "toml" | "env").message).toContain(
      format.toUpperCase()
    );
  });

  it("detects pasted yaml/toml/env bodies that carry no useful file name", () => {
    expect(detectImportFormat({ fileName: "pasted-import.txt", text: "battery:\n  temp_max: 85" })).toBe(
      "unsupported"
    );
    expect(detectImportFormat({ fileName: "pasted-import.txt", text: "[battery]\ntemp_max = 85" })).toBe(
      "unsupported"
    );
    expect(detectImportFormat({ fileName: "pasted-import.txt", text: "TEMP_MAX=85\nBOARD_ID=1" })).toBe(
      "unsupported"
    );
  });

  it("keeps csv-shaped text on the spreadsheet path even when cells contain colons", () => {
    const text = [
      IMPORT_TEMPLATE_HEADERS.join(","),
      "battery_health_reserve_pct,Battery Safety,Note: keep default,12,,,,,,,"
    ].join("\n");
    expect(detectImportFormat({ fileName: "params.csv", text })).toBe("spreadsheet");
  });

  it("prefers the deferred file name over xlsx magic bytes", () => {
    expect(detectImportFormat({ fileName: "params.yaml", bytes: new Uint8Array([0x50, 0x4b]) })).toBe(
      "unsupported"
    );
  });
});

describe("parseImportSource", () => {
  it("routes json input through parseJsonImport", async () => {
    const text = JSON.stringify([
      {
        name: "fast_charge_current_limit_ma",
        module: "Charging Policy",
        currentValue: "3200"
      }
    ]);

    const rows = await parseImportSource({ text });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "fast_charge_current_limit_ma",
      module: "Charging Policy",
      currentValue: "3200",
      sourceFormat: "json"
    });
  });

  it("routes dts-full input through parseDtsFull without fragment fallback", async () => {
    const text = `/dts-v1/;\n&demo {\n\tbattery_checker@0 {\n\t\tstatus = "ok";\n\t};\n};\n`;
    const parseDtsImport = vi.fn(async () => ({
      format: "dts-full" as const,
      rows: [
        {
          name: "status",
          module: "demo/battery_checker@0",
          sourceNodePath: "demo/battery_checker@0/status",
          rawText: '"ok"',
          normalizedValue: '"ok"',
          valueType: "string-list"
        }
      ]
    }));

    const rows = await parseImportSource(
      { fileName: "board.dts", text },
      { parseDtsFullDeps: { parseDtsImport } }
    );

    expect(parseDtsImport).toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "status",
      module: "demo/battery_checker@0",
      sourceFormat: "dts-full",
      sourceLocation: "demo/battery_checker@0/status"
    });
    expect(rows.every((row) => row.sourceFormat !== "dts-fragment")).toBe(true);
  });

  it("rejects dts-full parse without parseDtsFullDeps instead of fragment silent fallback", async () => {
    await expect(parseImportSource({ fileName: "board.dts", text: "status = \"ok\";" })).rejects.toThrow(
      /parse-dts|parseDtsFullDeps/
    );
  });

  it("routes csv-like input through parseSpreadsheetImport", async () => {
    const text = [
      IMPORT_TEMPLATE_HEADERS.join(","),
      "battery_health_reserve_pct,Battery Safety,10,12,,,,,,,"
    ].join("\n");

    const rows = await parseImportSource({ fileName: "params.csv", text });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "battery_health_reserve_pct",
      module: "Battery Safety",
      sourceFormat: "spreadsheet"
    });
  });

  it.each([
    ["params.yaml", "battery:\n  temp_max: 85", "yaml"],
    ["params.yml", "- name: temp_max", "yaml"],
    ["params.toml", "[battery]\ntemp_max = 85", "toml"],
    ["params.env", "TEMP_MAX=85", "env"],
    [".env", "TEMP_MAX=85", "env"]
  ])("rejects deferred input %s with an explicit unsupported-format message", async (fileName, text, format) => {
    let thrown: unknown;
    try {
      await parseImportSource({ fileName, text });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UnsupportedImportFormatError);
    const error = thrown as UnsupportedImportFormatError;
    expect(error.format).toBe(format);
    expect(error.fileName).toBe(fileName);
    // The wizard surfaces thrown errors through presentError, which passes CJK product
    // copy through: the user sees the explicit unsupported-format message, not a parse error.
    const shown = presentError(error, "解析失败，请检查文件内容。");
    expect(shown).toContain("暂不支持");
    expect(shown).toContain(format.toUpperCase());
    expect(shown).not.toBe("解析失败，请检查文件内容。");
  });

  it("rejects a pasted yaml body before any spreadsheet parsing", async () => {
    await expect(
      parseImportSource({ fileName: "pasted-import.txt", text: "battery:\n  temp_max: 85" })
    ).rejects.toBeInstanceOf(UnsupportedImportFormatError);
  });
});
