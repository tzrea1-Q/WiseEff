import { describe, expect, it } from "vitest";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { mockParseDtsImportContent } from "./mockDtsImportParse";

describe("mockParseDtsImportContent", () => {
  it("rejects /include/ as a WiseEffApiError with the dts-include-unsupported detail", () => {
    let thrown: unknown;
    try {
      mockParseDtsImportContent({
        sourceName: "board.dts",
        content: '/dts-v1/;\n/include/ "pin.dtsi"\n/ { board_id = <0>; };\n'
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(WiseEffApiError);
    expect(thrown).toMatchObject({
      code: "VALIDATION_FAILED",
      message: "DTS /include/ 暂不支持，请提供展开后的文件。",
      details: { code: "dts-include-unsupported" },
      requestId: "mock"
    });
  });
});
