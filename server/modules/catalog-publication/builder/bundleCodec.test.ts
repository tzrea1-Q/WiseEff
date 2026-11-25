import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { encodeContractJsonBytes, hashContractJson, visitContractJsonChunks } from "../../parameter-catalog-contract/chunkedSerialization";
import { serializeContract, type ContractJsonValue } from "../../parameter-catalog-contract/results";
import { encodeBundleBytes, parseBundleBytes } from "./bundleCodec";

describe("catalog release bundle bytes", () => {
  const streamPadding = Buffer.alloc(32 * 1024 * 1024, " ");
  it("keeps legacy canonical bytes, including release order and trailing newline", () => {
    const bundle = validCatalogReleaseBundle();
    const bytes = encodeBundleBytes({ ...bundle, releases: [...bundle.releases].reverse() });
    const canonical = serializeContract(bundle as unknown as ContractJsonValue);
    expect(Buffer.from(bytes).equals(Buffer.from(canonical))).toBe(true);
    expect(parseBundleBytes(bytes)).toEqual({ ok: true, bundle });
  });

  it("escapes large strings without changing UTF-8 or splitting surrogate pairs", () => {
    const text = "a".repeat(64 * 1024 - 1) + '😀雪\uFEFF\\\n"' + "\u0000\ud800".repeat(70_000);
    const value = { z: [{ [text]: text }], a: [null, false, 0.25, {}] };
    const canonical = serializeContract(value);
    const chunks: string[] = [];
    visitContractJsonChunks(value, chunk => chunks.push(chunk));
    expect(chunks.length).toBeGreaterThan(1);
    expect(Buffer.from(encodeContractJsonBytes(value)).equals(Buffer.from(canonical))).toBe(true);
    expect(hashContractJson(value)).toBe(`sha256:${createHash("sha256").update(canonical).digest("hex")}`);
  });

  it("retains data-graph validation and allows shared values", () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);
    const shared = { a: true };
    expect(Buffer.from(encodeContractJsonBytes([shared, shared])).toString()).toBe(serializeContract([shared, shared]));
    for (const invalid of [cycle, new Array(2), new Date(), { [Symbol()]: 1 }, Object.defineProperty({}, "x", { get: () => true }), { a: -0 }]) {
      expect(() => encodeContractJsonBytes(invalid as ContractJsonValue)).toThrow(TypeError);
    }
  });

  it.each(["雪", "😀", "\\uD800", "\\\\", '\\"', "\uFEFF"])("decodes across a read boundary starting with %s", tail => {
    const prefix = '\uFEFF{"targetReleaseId":"';
    const filler = "a".repeat(256 * 1024 - Buffer.byteLength(prefix) - 1);
    const source = prefix + filler + tail + '","__proto__":{"own":true},"releases":[],"schemaVersion":"0","schemaVersion":"1"}';
    const parsed = parseBundleBytes(Buffer.concat([Buffer.from(source), streamPadding]));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.bundle).toStrictEqual(JSON.parse(source.slice(1)));
      expect(Object.getPrototypeOf(parsed.bundle)).toBe(Object.prototype);
      expect(Object.hasOwn(parsed.bundle, "__proto__")).toBe(true);
    }
  });

  it("refuses malformed envelopes, UTF-8, JSON, and truncated final tokens without leaking input", () => {
    const pad = Buffer.alloc(256 * 1024 - 1, " ");
    const envelope = '{"schemaVersion":"1","releases":[],"targetReleaseId":"x"}';
    for (const invalid of [
      "{}", "[1,]", envelope + "true", envelope.slice(0, -1), '{"key":"\\u01', '{"key":01}',
      '{"schemaVersion":"1","releases":null,"targetReleaseId":"x"}',
      Buffer.from([0x22, 0xe9, 0x81, 0x22]), Buffer.from([0x22, 0xe9, 0x81]),
    ]) {
      expect(parseBundleBytes(Buffer.concat([streamPadding, pad, Buffer.from(invalid)]))).toEqual({ ok: false, detail: "catalog-release-bundle-unreadable" });
    }
  });
});
