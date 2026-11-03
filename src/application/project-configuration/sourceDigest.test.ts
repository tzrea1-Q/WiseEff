import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { digestSourceText } from "./sourceDigest";

afterEach(() => { vi.unstubAllGlobals(); });

it.each([
  ["empty", ""],
  ["ASCII", "/dts-v1/;\n/ { compatible = \"hisilicon,spmi\"; };\n"],
  ["Unicode, BOM and mixed line endings", "\uFEFF/* 电池 🔋 */\r\n/ { label = \"充电\"; };\n"],
  ["unpaired surrogate", "/* \uD800 */"],
  ["2 MiB", "a".repeat(2 * 1024 * 1024)]
])("matches the server digest without Web Crypto: %s", (_name, source) => {
  vi.stubGlobal("crypto", undefined);
  expect(digestSourceText(source)).toBe(createHash("sha256").update(source, "utf8").digest("hex"));
});

it("retains line endings and BOM as source identity", () => {
  expect(digestSourceText("/ {};\n")).not.toBe(digestSourceText("/ {};\r\n"));
  expect(digestSourceText("/ {};\n")).not.toBe(digestSourceText("\uFEFF/ {};\n"));
});
