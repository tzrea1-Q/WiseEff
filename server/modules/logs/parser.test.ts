import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { parseLogText } from "./parser";

describe("parseLogText", () => {
  it("parses UTF-8 .log files with stable 1-based line numbers", async () => {
    const bytes = await readFile("test-fixtures/logs/charging-foldback.log");

    const result = parseLogText({ fileName: "charging-foldback.log", content: bytes });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rawLines).toHaveLength(6);
    expect(result.entries.map((entry) => entry.lineNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(result.entries[0]).toMatchObject({
      lineNumber: 1,
      timestamp: "2026-05-25T10:03:12.120Z",
      severity: "info",
      message: "INFO charger session started device=PACK-A01 mode=fast_charge",
      tokens: { device: "PACK-A01", mode: "fast_charge" }
    });
    expect(result.entries[3].tokens).toMatchObject({
      code: "E_THERMAL_FOLDBACK",
      detail: "current reduced to protect pack"
    });
  });

  it("retains empty lines in rawLines while ignoring them for entries", () => {
    const result = parseLogText({
      fileName: "sample.txt",
      content: Buffer.from("2026-05-25T10:00:00Z INFO started\n\nWARN retry=1\n", "utf8")
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rawLines).toEqual(["2026-05-25T10:00:00Z INFO started", "", "WARN retry=1", ""]);
    expect(result.entries.map((entry) => entry.lineNumber)).toEqual([1, 3]);
  });

  it("extracts space-separated timestamps and trims the message", () => {
    const result = parseLogText({
      fileName: "sample.log",
      content: Buffer.from("2026-05-25 10:03:12 WARN retry=1\n", "utf8")
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries[0]).toMatchObject({
      timestamp: "2026-05-25 10:03:12",
      message: "WARN retry=1",
      severity: "warn",
      tokens: { retry: "1" }
    });
  });

  it("accepts .csv, .txt, and .json files as UTF-8 text logs", () => {
    const txt = parseLogText({ fileName: "events.txt", content: Buffer.from("INFO ok", "utf8") });
    const csv = parseLogText({ fileName: "events.csv", content: Buffer.from("level,message\nERROR,bad", "utf8") });
    const json = parseLogText({
      fileName: "events.json",
      content: Buffer.from('{"level":"INFO","message":"ok"}\n', "utf8")
    });

    expect(txt.ok).toBe(true);
    expect(csv.ok).toBe(true);
    expect(json.ok).toBe(true);
  });

  it("rejects .bin, unsupported .gz inner names, and missing extensions with an unsupported format error", () => {
    for (const fileName of ["events.bin", "events.bin.gz", "events"]) {
      const result = parseLogText({ fileName, content: Buffer.from("INFO ok", "utf8") });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toMatch(/unsupported/i);
    }
  });

  it("accepts archive-named stored objects whose content was unpacked at intake", () => {
    // Unpacking happens in the upload service; by the time the worker parses,
    // .log.gz / .zip named objects already hold plain UTF-8 text.
    const gz = parseLogText({ fileName: "events.log.gz", content: Buffer.from("INFO ok", "utf8") });
    const zip = parseLogText({ fileName: "events.zip", content: Buffer.from("INFO ok", "utf8") });

    expect(gz.ok).toBe(true);
    expect(zip.ok).toBe(true);
  });

  it("rejects invalid UTF-8 or null-byte-heavy content with a readable reason", () => {
    const invalidUtf8 = parseLogText({ fileName: "events.log", content: Buffer.from([0xc3, 0x28]) });
    const nullHeavy = parseLogText({
      fileName: "events.log",
      content: Buffer.from([0x00, 0x00, 0x00, 0x49, 0x4e, 0x46, 0x4f])
    });

    expect(invalidUtf8.ok).toBe(false);
    expect(nullHeavy.ok).toBe(false);
    if (!invalidUtf8.ok) expect(invalidUtf8.reason).toMatch(/utf-?8|decode/i);
    if (!nullHeavy.ok) expect(nullHeavy.reason).toMatch(/binary|null/i);
  });

  it("rejects null-byte-heavy string content with a readable reason", () => {
    const result = parseLogText({ fileName: "events.log", content: "\0\0\0INFO" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/binary|null/i);
  });
});

describe("parseLogText with a format profile", () => {
  it("uses the profile timestamp pattern and severity map", () => {
    const result = parseLogText(
      {
        fileName: "kernel.log",
        content: Buffer.from("[00012.345] <3> charge fault code=E42\n[00012.400] <6> heartbeat ok\n", "utf8")
      },
      {
        profile: {
          timestampPattern: "^\\[(\\d{5}\\.\\d{3})\\]",
          severityMap: { error: ["<3>"], info: ["<6>"] }
        }
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries[0]).toMatchObject({
      lineNumber: 1,
      timestamp: "00012.345",
      severity: "error",
      message: "<3> charge fault code=E42",
      tokens: { code: "E42" }
    });
    expect(result.entries[1]).toMatchObject({ lineNumber: 2, severity: "info" });
  });

  it("merges continuation lines by start pattern while keeping stable raw line numbers", () => {
    const content = [
      "[001] ERROR stack trace follows",
      "  at chargeController.start",
      "  at scheduler.tick",
      "[002] INFO recovered"
    ].join("\n");

    const result = parseLogText(
      { fileName: "trace.log", content: Buffer.from(content, "utf8") },
      { profile: { multiline: { mode: "start-pattern", startPattern: "^\\[\\d+\\]" }, severityMap: { error: ["ERROR"] } } }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rawLines).toHaveLength(4);
    expect(result.entries.map((entry) => entry.lineNumber)).toEqual([1, 4]);
    expect(result.entries[0].message).toContain("at chargeController.start");
    expect(result.entries[0].severity).toBe("error");
  });

  it("merges indented continuation lines in indent mode", () => {
    const result = parseLogText(
      {
        fileName: "trace.log",
        content: Buffer.from("ERROR boom detail=first\n    caused by: overload\nINFO next entry\n", "utf8")
      },
      { profile: { multiline: { mode: "indent" } } }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.map((entry) => entry.lineNumber)).toEqual([1, 3]);
    expect(result.entries[0].message).toContain("caused by: overload");
  });

  it("falls back to generic behavior when profile regexes do not match", () => {
    const result = parseLogText(
      { fileName: "sample.log", content: Buffer.from("2026-05-25T10:00:00Z ERROR bad thing\n", "utf8") },
      { profile: { timestampPattern: "^NEVER-MATCHES" } }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries[0].timestamp).toBeUndefined();
    expect(result.entries[0].severity).toBe("error");
  });
});
