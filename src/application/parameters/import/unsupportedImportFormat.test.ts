/**
 * Issue #849: recognized-but-deferred project sources (YAML / TOML / ENV) must never be
 * silently downgraded to a spreadsheet parse. This suite mocks the spreadsheet parser so
 * "never reached" is asserted directly rather than inferred from row shapes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedImportRow } from "./types";

const { parseSpreadsheetImportMock } = vi.hoisted(() => ({
  parseSpreadsheetImportMock: vi.fn<(input: unknown) => ParsedImportRow[]>(() => [])
}));

vi.mock("./parseSpreadsheet", () => ({
  parseSpreadsheetImport: parseSpreadsheetImportMock
}));

import { IMPORT_TEMPLATE_HEADERS } from "./columnMap";
import { parseImportSource, UnsupportedImportFormatError } from "./detectImportFormat";

beforeEach(() => {
  parseSpreadsheetImportMock.mockClear();
});

describe("deferred import sources never reach parseSpreadsheetImport", () => {
  it.each([
    ["params.yaml", "battery:\n  temp_max: 85"],
    ["params.yml", "- name: temp_max\n- name: board_id"],
    ["params.toml", "[battery]\ntemp_max = 85"],
    ["params.env", "TEMP_MAX=85\nBOARD_ID=1"],
    [".env", "TEMP_MAX=85"]
  ])("refuses %s without parsing a spreadsheet", async (fileName, text) => {
    await expect(parseImportSource({ fileName, text })).rejects.toBeInstanceOf(UnsupportedImportFormatError);
    expect(parseSpreadsheetImportMock).not.toHaveBeenCalled();
  });

  it("refuses a pasted yaml body carrying only the placeholder file name", async () => {
    await expect(
      parseImportSource({ fileName: "pasted-import.txt", text: "battery:\n  temp_max: 85" })
    ).rejects.toBeInstanceOf(UnsupportedImportFormatError);
    expect(parseSpreadsheetImportMock).not.toHaveBeenCalled();
  });
});

describe("supported import sources still work", () => {
  it("keeps csv on the spreadsheet path", async () => {
    const text = [
      IMPORT_TEMPLATE_HEADERS.join(","),
      "battery_health_reserve_pct,Battery Safety,10,12,,,,,,,"
    ].join("\n");

    await parseImportSource({ fileName: "params.csv", text });

    expect(parseSpreadsheetImportMock).toHaveBeenCalledTimes(1);
  });

  it("keeps xlsx on the spreadsheet path", async () => {
    await parseImportSource({ fileName: "params.xlsx", bytes: new Uint8Array([0x50, 0x4b]) });

    expect(parseSpreadsheetImportMock).toHaveBeenCalledTimes(1);
  });

  it("keeps json on the json path", async () => {
    const rows = await parseImportSource({
      text: JSON.stringify([{ name: "temp_max", module: "battery", currentValue: "85" }])
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "temp_max", sourceFormat: "json" });
    expect(parseSpreadsheetImportMock).not.toHaveBeenCalled();
  });

  it("keeps dts-full on the dts path", async () => {
    const parseDtsImport = vi.fn(async () => ({ format: "dts-full" as const, rows: [] }));

    await parseImportSource(
      { fileName: "board.dts", text: '/dts-v1/;\n/ { a = <0>; };\n' },
      { parseDtsFullDeps: { parseDtsImport } }
    );

    expect(parseDtsImport).toHaveBeenCalledTimes(1);
    expect(parseSpreadsheetImportMock).not.toHaveBeenCalled();
  });
});
