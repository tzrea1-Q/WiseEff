import { describe, expect, it, vi } from "vitest";

import { parseDtsFull } from "./parseDtsFull";
import type { DtsImportParseResult } from "@/application/ports/ParameterRepository";

describe("parseDtsFull", () => {
  it("maps server parse rows into ParsedImportRow with dts-full sourceFormat and @ paths", async () => {
    const parseDtsImport = vi.fn(async (): Promise<DtsImportParseResult> => ({
      format: "dts-full",
      rows: [
        {
          name: "status",
          module: "demo_multi_instance/battery_checker@0",
          sourceNodePath: "demo_multi_instance/battery_checker@0/status",
          rawText: '"ok"',
          normalizedValue: '"ok"',
          valueType: "string-list"
        }
      ]
    }));

    const rows = await parseDtsFull(
      { sourceName: "board.dts", content: '&demo { battery_checker@0 { status = "ok"; }; };' },
      { parseDtsImport }
    );

    expect(parseDtsImport).toHaveBeenCalledWith({
      sourceName: "board.dts",
      content: '&demo { battery_checker@0 { status = "ok"; }; };'
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "status",
      module: "demo_multi_instance/battery_checker@0",
      sourceFormat: "dts-full",
      sourceLocation: "demo_multi_instance/battery_checker@0/status",
      currentValue: '"ok"',
      rawSnippet: '"ok"'
    });
    expect(rows[0]?.sourceFormat).not.toBe("dts-fragment");
  });

  it("propagates dts-include-unsupported errors from the parse port", async () => {
    const parseDtsImport = vi.fn(async () => {
      const error = new Error("DTS /include/ 暂不支持，请提供展开后的文件。") as Error & {
        details?: { code?: string };
      };
      error.details = { code: "dts-include-unsupported" };
      throw error;
    });

    await expect(
      parseDtsFull({ sourceName: "board.dts", content: '/include/ "pin.dtsi"' }, { parseDtsImport })
    ).rejects.toMatchObject({
      details: { code: "dts-include-unsupported" }
    });
  });
});
