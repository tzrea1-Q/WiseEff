import { afterEach, describe, expect, it, vi } from "vitest";
import { Blob as NativeBlob } from "node:buffer";
import { gzipSync } from "node:zlib";
import JSZip from "jszip";
import { readRecommendationHeads } from "./recommendationHeads";

afterEach(() => vi.unstubAllGlobals());

describe("bounded upload recommendation heads", () => {
  it("caps files and lines, omits oversized lines and preserves UTF-8", async () => {
    const file = new File([`${"x".repeat(2049)}\n充电就绪\n${Array.from({ length: 80 }, (_, index) => index).join("\n")}`], "kernel.log");
    const heads = await readRecommendationHeads(Array.from({ length: 201 }, () => file), new AbortController().signal);
    expect(heads).toHaveLength(200);
    expect(heads[0].head).toHaveLength(63);
    expect(heads[0].head[0]).toBe("充电就绪");
  });

  it("lists zip paths and reads only bounded entry heads", async () => {
    const zip = new JSZip();
    zip.file("device/kernel.log", "charging ready\n".repeat(20_000));
    zip.file("device/meta.txt", "board=A\nfirmware=v1");
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const heads = await readRecommendationHeads([new File([bytes as BlobPart], "logs.zip")], new AbortController().signal);
    expect(heads.map((file) => file.path)).toEqual(["device/kernel.log", "device/meta.txt"]);
    expect(heads[0].head).toHaveLength(64);
    expect(heads[0].head.every((line) => line === "charging ready")).toBe(true);
    expect(heads[1].head).toEqual(["board=A", "firmware=v1"]);
  });

  it("lists tar regular files and ignores directory entries", async () => {
    const tar = new Uint8Array(2048);
    const encode = new TextEncoder();
    tar.set(encode.encode("device/")); tar[156] = 53;
    tar.set(encode.encode("00000000000"), 124);
    tar.set(encode.encode("kernel.log"), 512);
    tar.set(encode.encode("00000000017"), 512 + 124);
    tar[512 + 156] = 48;
    tar.set(encode.encode("charging ready\n"), 1024);
    expect(await readRecommendationHeads([new File([tar], "logs.tar")], new AbortController().signal))
      .toEqual([{ path: "kernel.log", head: ["charging ready"] }]);
  });

  it("falls back to archive names on unsupported gzip or malformed input", async () => {
    expect(await readRecommendationHeads([new File(["broken"], "logs.gz"), new File(["broken"], "logs.zip")], new AbortController().signal))
      .toEqual([{ path: "logs.gz", head: [] }, { path: "logs.zip", head: [] }]);
  });

  it("reads gzip heads when native browser decompression is available", async () => {
    const file = new File([new Uint8Array(gzipSync("charging ready\nnext"))], "kernel.log.gz");
    // jsdom's Blob lacks stream(); Node supplies the browser-compatible native stream.
    vi.stubGlobal("Blob", NativeBlob);
    expect(await readRecommendationHeads([file], new AbortController().signal))
      .toEqual([{ path: "kernel.log", head: ["charging ready", "next"] }]);
  });

  it("stops after cancellation and does not use a truncated long line as a feature", async () => {
    const controller = new AbortController(); controller.abort();
    expect(await readRecommendationHeads([new File(["charging"], "kernel.log")], controller.signal)).toEqual([]);
    expect(await readRecommendationHeads([new File(["x".repeat(256 * 1024)], "huge.log")], new AbortController().signal))
      .toEqual([{ path: "huge.log", head: [] }]);
  });

  it("does not invent empty lines and supports CR line separators", async () => {
    expect(await readRecommendationHeads([new File([], "empty.log"), new File(["first\rsecond\r"], "cr.log")], new AbortController().signal))
      .toEqual([{ path: "empty.log", head: [] }, { path: "cr.log", head: ["first", "second"] }]);
  });
});
