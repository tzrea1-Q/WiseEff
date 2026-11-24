import { constants } from "node:buffer";
import { none } from "stream-chain/defs.js";
import Assembler from "stream-json/core/assembler.js";
import { jsonParser, type TokenSource } from "stream-json/core/parser.js";

import type { CatalogReleaseBundle } from "./types";

const chunkSize = 256 * 1024;

export type BundleReadErrorDetail = "catalog-release-bundle-unreadable" | "catalog-release-bundle-scalar-too-large";

function parseJson(bytes: Uint8Array): unknown {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  if (bytes.byteLength <= chunkSize) return JSON.parse(decoder.decode(bytes));

  const assembler = new Assembler();
  // The tokenizer's flush protocol accepts `none` at EOF in addition to text.
  const tokenize = jsonParser({
    streamValues: false,
    maxDepth: Infinity,
    maxPackedLength: constants.MAX_STRING_LENGTH,
  }) as (chunk: string | typeof none) => ReturnType<TokenSource>;
  function consume(chunk: string | typeof none): void {
    const tokens = tokenize(chunk);
    if (tokens !== none) for (const token of tokens.values) assembler.consume(token);
  }
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    consume(decoder.decode(bytes.subarray(offset, offset + chunkSize), { stream: true }));
  }
  consume(decoder.decode());
  consume(none);
  return assembler.current;
}

type Unreadable = { readonly ok: false; readonly detail: BundleReadErrorDetail };

function readJson(bytes: Uint8Array): { readonly ok: true; readonly value: unknown } | Unreadable {
  try {
    return { ok: true, value: parseJson(bytes) };
  } catch (error) {
    // Parser errors can quote private source content. Only these safe codes may leave the reader.
    const scalarTooLarge = error instanceof RangeError && (error.message === "Invalid string length" ||
      error.message.startsWith("parser: a packed value exceeds maxPackedLength"));
    return { ok: false, detail: scalarTooLarge ? "catalog-release-bundle-scalar-too-large" : "catalog-release-bundle-unreadable" };
  }
}

/** JSON.parse semantics with fatal UTF-8 validation and bounded input strings. */
export function decodeJsonBytes(bytes: Uint8Array): unknown {
  const result = readJson(bytes);
  if (!result.ok) throw new Error(result.detail);
  return result.value;
}

export function parseBundleBytes(bytes: Uint8Array):
  | { readonly ok: true; readonly bundle: CatalogReleaseBundle } | Unreadable {
  const result = readJson(bytes);
  if (!result.ok) return result;
  const parsed = result.value;
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) &&
    "schemaVersion" in parsed && typeof parsed.schemaVersion === "string" &&
    "targetReleaseId" in parsed && typeof parsed.targetReleaseId === "string" &&
    "releases" in parsed && Array.isArray(parsed.releases)) {
    return { ok: true, bundle: parsed as CatalogReleaseBundle };
  }
  return { ok: false, detail: "catalog-release-bundle-unreadable" };
}
