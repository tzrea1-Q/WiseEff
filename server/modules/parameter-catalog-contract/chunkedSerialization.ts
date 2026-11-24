import { createHash } from "node:crypto";

import { serializeContract, type ContractJsonValue } from "./results";

const chunkSize = 64 * 1024;

/** Same contract bytes as serializeContract, without constructing a string for the whole tree. */
export function visitContractJsonChunks(value: ContractJsonValue, write: (chunk: string) => void): void {
  const active = new Set<object>();
  let pending = "";
  function append(text: string): void {
    pending += text;
    if (pending.length >= chunkSize) {
      write(pending);
      pending = "";
    }
  }

  function quoted(text: string): void {
    if (text.length <= chunkSize) {
      append(JSON.stringify(text));
      return;
    }
    append('"');
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + chunkSize, text.length);
      // A valid surrogate pair must be escaped/encoded together. JSON.stringify
      // would otherwise produce two escapes instead of the canonical UTF-8 bytes.
      const lastCodeUnit = text.charCodeAt(end - 1);
      if (end < text.length && lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) end--;
      append(JSON.stringify(text.slice(start, end)).slice(1, -1));
      start = end;
    }
    append('"');
  }

  function visit(node: unknown, depth: number): void {
    if (typeof node === "string") return quoted(node);
    if (node === null || typeof node !== "object") {
      // The contract rejects non-finite numbers, -0 and values JSON would silently omit.
      append(serializeContract(node as ContractJsonValue).trimEnd());
      return;
    }
    if (active.has(node)) throw new TypeError("Contract serialization rejected a cyclic object graph");
    active.add(node);
    const array = Array.isArray(node);
    const prototype: unknown = Object.getPrototypeOf(node);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Contract serialization rejected a non-plain container");
    }
    const keys = Reflect.ownKeys(node);
    if (keys.some(key => typeof key !== "string") || (array && keys.length !== node.length + 1)) {
      throw new TypeError("Contract serialization rejected unsupported own properties");
    }
    if (!array) keys.sort();
    const length = array ? node.length : keys.length;
    const indentation = "  ".repeat(depth + 1);
    append(array ? "[" : "{");
    for (let index = 0; index < length; index++) {
      const key = array ? String(index) : keys[index] as string;
      const entry = Object.getOwnPropertyDescriptor(node, key);
      if (!entry?.enumerable || !("value" in entry)) {
        throw new TypeError("Contract serialization rejected a missing, hidden or accessor property");
      }
      append((index ? ",\n" : "\n") + indentation);
      if (!array) {
        quoted(key);
        append(": ");
      }
      visit(entry.value, depth + 1);
    }
    if (length) append("\n" + "  ".repeat(depth));
    append(array ? "]" : "}");
    active.delete(node);
  }

  visit(value, 0);
  append("\n");
  if (pending) write(pending);
}

export function hashContractJson(value: ContractJsonValue): string {
  const hash = createHash("sha256");
  visitContractJsonChunks(value, chunk => hash.update(chunk));
  return `sha256:${hash.digest("hex")}`;
}

export function encodeContractJsonBytes(value: ContractJsonValue): Uint8Array {
  const chunks: Uint8Array[] = [];
  let length = 0;
  visitContractJsonChunks(value, chunk => {
    const bytes = Buffer.from(chunk, "utf8");
    length += bytes.length;
    chunks.push(bytes);
  });
  const result = new Uint8Array(length);
  let offset = 0;
  for (const bytes of chunks) {
    result.set(bytes, offset);
    offset += bytes.length;
  }
  return result;
}
