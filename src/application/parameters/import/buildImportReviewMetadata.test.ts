import { describe, expect, it } from "vitest";
import {
  buildImportReviewMetadata,
  DTS_SERVER_PARSE_HINT,
  shouldUseServerDtsParse
} from "./buildImportReviewMetadata";
import type { ReviewedImportRow } from "./types";

function row(overrides: Partial<ReviewedImportRow>): ReviewedImportRow {
  return {
    rowId: "r1",
    name: "status",
    module: "demo/battery_checker@0",
    sourceFormat: "dts-full",
    status: "pending",
    matchKey: "status::demo/battery_checker@0",
    ...overrides
  };
}

describe("buildImportReviewMetadata", () => {
  it("returns undefined when no rows are skipped", () => {
    expect(buildImportReviewMetadata([row({ status: "approved" })])).toBeUndefined();
  });

  it("aggregates skipped rows into reviewMetadata", () => {
    expect(
      buildImportReviewMetadata([
        row({ status: "approved" }),
        row({
          rowId: "r2",
          name: "weak_source_sleep_enabled",
          module: "demo_bool",
          sourceLocation: "demo_bool/weak_source_sleep_enabled",
          status: "skipped",
          skipReason: "布尔属性暂不导入"
        })
      ])
    ).toEqual({
      skippedRows: [
        {
          rowKey: "demo_bool/weak_source_sleep_enabled",
          name: "weak_source_sleep_enabled",
          module: "demo_bool",
          reason: "布尔属性暂不导入"
        }
      ],
      notes: "wizard skipped 1 row(s)"
    });
  });
});

describe("shouldUseServerDtsParse", () => {
  it("requires server parse above 2MB and exposes the UI hint copy", () => {
    expect(shouldUseServerDtsParse(2 * 1024 * 1024)).toBe(false);
    expect(shouldUseServerDtsParse(2 * 1024 * 1024 + 1)).toBe(true);
    expect(DTS_SERVER_PARSE_HINT).toBe("将使用服务端解析");
  });
});
