import { describe, expect, it } from "vitest";
import { ApiError } from "../../shared/http/errors";
import { assertRecognitionUpdate } from "./recognitionValidation";
import type { UpdateModuleRecognition } from "./recognitionSettings";

function details(kind: "driver" | "node-type", body: UpdateModuleRecognition) {
  try { assertRecognitionUpdate(kind, body); } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return (error as ApiError).details as { issues: Record<string, unknown>[]; truncated: boolean };
  }
  throw new Error("Expected validation failure");
}

describe("actionable recognition validation", () => {
  it.each([
    ["", "empty"], ["acme,power\n", "control-character"], ["华为,power", "non-ascii"],
    [" acme,power", "surrounding-whitespace"], ["acme,pow er", "whitespace-forbidden"],
    ['"acme,power"', "quoted-source-token"], ["acme,*", "wildcard-forbidden"], ["acme,power,extra", "invalid-syntax"],
  ])("explains compatible %j with a specific repair rule", (value, code) => {
    const issue = details("driver", { compatibles: ["acme,valid", value] }).issues[0];
    expect(issue).toMatchObject({ path: "compatibles.1", code, received: value, example: "acme,power",
      rule: expect.stringContaining("compatible"), hint: expect.any(String) });
    expect(String(issue.message)).not.toContain("类型不匹配，或");
  });

  it.each([["battery_checker@0", "unit-address-present"], ["a".repeat(32), "length-out-of-range"], ["0node", "invalid-syntax"]])(
    "explains node name %j", (value, code) => {
      expect(details("node-type", { nodeTypeName: value }).issues[0]).toMatchObject({ path: "nodeTypeName", code,
        received: value, rule: expect.stringContaining("31"), example: "battery_checker" });
    });

  it("reports the unsupported field separately from each malformed selector", () => {
    const result = details("driver", { compatibles: ["acme,*", "bad value"], nodeTypeName: "node" });
    expect(result.issues.map(issue => [issue.path, issue.code])).toEqual([
      ["nodeTypeName", "field-not-supported"], ["compatibles.0", "wildcard-forbidden"], ["compatibles.1", "whitespace-forbidden"],
    ]);
    expect(details("node-type", { compatibles: [], driverNature: "physical-device", instanceCardinality: "multiple" }).issues.map(issue => issue.path))
      .toEqual(["compatibles", "driverNature", "instanceCardinality"]);
  });

  it("retains accepted selector formats and empty driver lists", () => {
    expect(() => assertRecognitionUpdate("driver", { compatibles: ["sc8562", "huawei,batt_info", "acme,foo/bar", "huawei, wireless_aux_tx"] })).not.toThrow();
    expect(() => assertRecognitionUpdate("driver", { compatibles: [] })).not.toThrow();
    expect(() => assertRecognitionUpdate("driver", { driverNature: "logical-service" })).not.toThrow();
    expect(() => assertRecognitionUpdate("node-type", { nodeTypeName: "/" })).not.toThrow();
    expect(() => assertRecognitionUpdate("node-type", { nodeTypeName: "battery_checker" })).not.toThrow();
    expect(details("driver", {}).issues[0]).toMatchObject({ code: "empty-update", rule: expect.stringContaining("compatibles") });
  });

  it("bounds issue counts and values and identifies omitted data", () => {
    const result = details("driver", { compatibles: Array.from({ length: 51 }, () => "bad value") });
    expect(result.issues).toHaveLength(50);
    expect(result.truncated).toBe(true);
    expect(details("driver", { compatibles: Array.from({ length: 50 }, () => "bad value") }).truncated).toBe(false);
    const issue = details("driver", { compatibles: [" ".repeat(3000)] }).issues[0];
    expect(issue.receivedTruncated).toBe(true);
    expect(String(issue.received).length).toBeLessThan(1100);
  });
});
