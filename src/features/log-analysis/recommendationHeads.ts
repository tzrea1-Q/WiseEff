import type { LogRecommendationFile } from "@/application/ports/LogAnalysisRepository";

// Advisory browser preview: 200 files, 64 lines × 2 KiB, 128 KiB read per head.
// Archives use at most 16 MiB compressed / 32 MiB expanded; unsupported/oversized
// archives fall back to names. The server independently enforces its own limits.
const MAX_FILES = 200;
const HEAD_BYTES = 64 * 2048;
const ARCHIVE_BYTES = 16 * 1024 * 1024;
const EXPANDED_BYTES = 32 * 1024 * 1024;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

// JSZip supports this streaming API at runtime but omits it from its declarations.
type ZipHeadStream = {
  pause(): void;
  resume(): void;
  on(event: "data", callback: (chunk: Uint8Array) => void): ZipHeadStream;
  on(event: "end", callback: () => void): ZipHeadStream;
  on(event: "error", callback: (error: Error) => void): ZipHeadStream;
};

function head(bytes: Uint8Array) {
  const text = decoder.decode(bytes.subarray(0, HEAD_BYTES));
  if (!text) return [];
  const lines = text.split(/\r\n?|\n/);
  if (/[\r\n]$/.test(text) || bytes.length >= HEAD_BYTES) lines.pop();
  return lines.slice(0, 64).filter((line) => encoder.encode(line).byteLength <= 2048);
}

function read(blob: Blob, signal: AbortSignal): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    if (signal.aborted) return reject(new Error("Recommendation cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = reader.onabort = () => reject(new Error("Cannot read recommendation preview"));
    reader.onloadend = () => signal.removeEventListener("abort", abort);
    reader.readAsArrayBuffer(blob);
  });
}

async function gzip(file: File, signal: AbortSignal) {
  const compressed = await read(file, signal);
  const reader = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const abort = () => { void reader.cancel(); };
  signal.addEventListener("abort", abort, { once: true });
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > EXPANDED_BYTES) throw new Error("Archive preview limit");
      parts.push(value);
    }
    if (signal.aborted) throw new Error("Recommendation cancelled");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return bytes;
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel();
  }
}

function tar(bytes: Uint8Array): LogRecommendationFile[] {
  const files: LogRecommendationFile[] = [];
  for (let offset = 0, entries = 0; offset + 512 <= bytes.length && entries < MAX_FILES; entries++) {
    const header = bytes.subarray(offset, offset + 512);
    const name = decoder.decode(header.subarray(0, 100)).split("\0")[0];
    if (!name) break;
    const prefix = decoder.decode(header.subarray(345, 500)).split("\0")[0];
    const path = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(decoder.decode(header.subarray(124, 136)).replace(/\0/g, "").trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > bytes.length) break;
    if (header[156] === 0 || header[156] === 48) files.push({ path, head: head(bytes.subarray(offset + 512, offset + 512 + size)) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function archive(file: File, signal: AbortSignal): Promise<LogRecommendationFile[]> {
  if (file.size > ARCHIVE_BYTES) return [{ path: file.name, head: [] }];
  if (/\.zip$/i.test(file.name)) {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(await read(file, signal));
    const files: LogRecommendationFile[] = [];
    for (const path of Object.keys(zip.files).filter((path) => !zip.files[path].dir).slice(0, MAX_FILES)) {
      const bytes = await new Promise<Uint8Array>((resolve, reject) => {
        const entry = zip.files[path] as typeof zip.files[string] & { internalStream(type: "uint8array"): ZipHeadStream };
        const stream = entry.internalStream("uint8array");
        const parts: Uint8Array[] = [];
        let size = 0;
        const finish = () => {
          stream.pause();
          signal.removeEventListener("abort", abort);
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
          resolve(bytes);
        };
        const abort = () => { stream.pause(); reject(new Error("Recommendation cancelled")); };
        if (signal.aborted) return abort();
        signal.addEventListener("abort", abort, { once: true });
        stream.on("data", (chunk) => {
          const part = chunk.subarray(0, HEAD_BYTES - size);
          parts.push(part); size += part.byteLength;
          if (size >= HEAD_BYTES) finish();
        }).on("end", finish).on("error", (error) => { signal.removeEventListener("abort", abort); reject(error); }).resume();
      }).catch(() => new Uint8Array());
      if (signal.aborted) break;
      files.push({ path, head: head(bytes) });
    }
    return files.length ? files : [{ path: file.name, head: [] }];
  }
  const bytes = /\.(gz|tgz)$/i.test(file.name) ? await gzip(file, signal) : await read(file, signal);
  if (/\.(tar|tar\.gz|tgz)$/i.test(file.name)) {
    const files = tar(bytes);
    return files.length ? files : [{ path: file.name, head: [] }];
  }
  return [{ path: file.name.replace(/\.gz$/i, ""), head: head(bytes) }];
}

export async function readRecommendationHeads(files: File[], signal: AbortSignal): Promise<LogRecommendationFile[]> {
  const result: LogRecommendationFile[] = [];
  for (const file of files.slice(0, MAX_FILES)) {
    if (signal.aborted) break;
    try {
      result.push(...(/\.(zip|gz|tgz|tar)$/i.test(file.name)
        ? await archive(file, signal)
        : [{ path: file.name, head: head(await read(file.slice(0, HEAD_BYTES), signal)) }]));
    } catch {
      result.push({ path: file.name, head: [] });
    }
    if (result.length >= MAX_FILES) break;
  }
  return result.filter((file) => file.path.length <= 1024).slice(0, MAX_FILES);
}
