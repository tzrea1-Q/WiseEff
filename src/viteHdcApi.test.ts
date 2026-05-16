import { describe, expect, it } from "vitest";
import {
  buildReadShellCommand,
  buildWriteShellCommand,
  parseTargets,
  validateNodePath
} from "../viteHdcApi";

describe("viteHdcApi helpers", () => {
  it("parses non-empty hdc targets", () => {
    expect(parseTargets("device-a\n\n device-b \n")).toEqual(["device-a", "device-b"]);
  });

  it("validates absolute Linux node paths", () => {
    expect(validateNodePath("/sys/class/power_supply/battery/temp")).toEqual({ ok: true });
    expect(validateNodePath("relative/path")).toEqual({
      ok: false,
      error: "nodePath must start with /"
    });
  });

  it("quotes read shell commands", () => {
    expect(buildReadShellCommand("/sys/class/power_supply/battery/temp")).toBe(
      "cat '/sys/class/power_supply/battery/temp'"
    );
  });

  it("quotes write shell commands", () => {
    expect(buildWriteShellCommand("/data/local/tmp/a'b", "x'y")).toBe(
      "printf '%s' 'x'\\''y' > '/data/local/tmp/a'\\''b'"
    );
  });
});
