import { describe, expect, it } from "vitest";
import { parseRegisterTable, registerPasteIssue } from "./registerTable";

describe("datasheet register table", () => {
  it("rejects a 200 KiB adversarial whitespace paste in under 50 ms", () => {
    const hostile = `7${" ".repeat(200 * 1024)}NO_PIPE`;
    const started = performance.now();
    const rows = parseRegisterTable(hostile, 8);
    expect(performance.now() - started).toBeLessThan(50);
    expect(rows[0].reason).toContain("64 KiB");
    const bounded = `7${" ".repeat(60 * 1024)}FIELD`;
    const boundedStarted = performance.now();
    expect(parseRegisterTable(bounded, 8)[0].field).toEqual({ bits: [7, 7], name: "FIELD" });
    expect(performance.now() - boundedStarted).toBeLessThan(50);
  });
  it("enforces UTF-8 byte and line caps before parsing", () => {
    expect(registerPasteIssue("界".repeat(22_000))).toContain("64 KiB");
    expect(registerPasteIssue("\n".repeat(512))).toContain("512 行");
    expect(registerPasteIssue("\n".repeat(511))).toBeNull();
    expect(parseRegisterTable("\n".repeat(512), 8)[0].reason).toContain("512 行");
  });
  it.each(["7\tFAULT\tFault flag", "7,FAULT,Fault flag", "7  FAULT  Fault flag", "| 7 | FAULT | Fault flag |"])("parses separator: %s", (text) => {
    expect(parseRegisterTable(text, 8)).toEqual([{ line: 1, text, field: { bits: [7, 7], name: "FAULT", description: "Fault flag" } }]);
  });
  it.each(["7:5", "[7:5]", "7-5"])("parses range %s", (bits) => {
    expect(parseRegisterTable(`${bits}\tFAULT\tFault flag`, 8)[0].field?.bits).toEqual([7, 5]);
  });
  it("skips English/Chinese headers and markdown separators, retaining source line numbers and per-line reasons", () => {
    const rows = parseRegisterTable("Bits | Name | Description\n| --- | --- | --- |\n\n7,FLAG,Flag\nnope,BAD\n9,OUT\n6,\n5,FLAG\n7,OVERLAP\n2:4,REVERSED\n[3:2,BROKEN", 8);
    expect(rows.map((row) => row.line)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(rows.map((row) => row.reason)).toEqual([undefined, expect.stringContaining("无法识别"), expect.stringContaining("超出 8"), expect.stringContaining("字段名称"), expect.stringContaining("重复"), expect.stringContaining("重叠"), expect.stringContaining("无法识别"), expect.stringContaining("无法识别")]);
    expect(parseRegisterTable("位段\t名称\t说明\n0\tVALID", 8)[0].line).toBe(2);
  });
});
