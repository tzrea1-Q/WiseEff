import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DtsExportConfigSetResult } from "@/application/ports/DtsStructuredRepository";
import { downloadExportBundle } from "./workbenchShellHelpers";

beforeEach(() => vi.clearAllMocks());

function bundle(names = ["boards/主板😀.dts", "settings.json"]): DtsExportConfigSetResult {
  return {
    manifest: { configSetId: "set", name: "量产配置", projectId: "project", exportedAt: "2026-10-17T00:00:00Z",
      validation: { ok: true, mode: "warn", compiler: "dtc", requiresConfirmation: false },
      members: names.map((fileName, index) => ({ fileId: `file-${index}`, fileName, role: index ? "overlay" : "base",
        sortOrder: index, versionNumber: index + 1, format: fileName.endsWith(".json") ? "json" : "dts" })) },
    files: names.map((name) => ({ name, format: name.endsWith(".json") ? "json" : "dts",
      content: name.endsWith(".json") ? '{\n  "enabled": true, "notes": "原样\\n文本"\n}\n' : '\uFEFF/dts-v1/;\r\n/ { model = "原样"; };\r\n' }))
  };
}

async function downloadedArchive() {
  const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0];
  if (!(blob instanceof Blob)) throw new Error("No ZIP Blob was downloaded");
  expect(blob.type).toBe("application/zip");
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" || !reader.result
      ? reject(new Error("Expected ZIP bytes")) : resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  return JSZip.loadAsync(bytes, { checkCRC32: true });
}

describe("configuration export ZIP", () => {
  it("downloads a real ZIP with the complete manifest and unmodified original file bytes and logical names", async () => {
    const result = bundle();
    let link: HTMLAnchorElement | undefined;
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function (this: HTMLAnchorElement) { link = this; });
    await downloadExportBundle("量产配置", result);
    const zip = await downloadedArchive();
    expect(Object.keys(zip.files).sort()).toEqual(["wiseeff-config-set-export-manifest.json", ...result.files.map((file) => file.name)].sort());
    expect(JSON.parse(await zip.file("wiseeff-config-set-export-manifest.json")!.async("string"))).toEqual(result.manifest);
    for (const file of result.files) {
      expect(Array.from(await zip.file(file.name)!.async("uint8array"))).toEqual(Array.from(new TextEncoder().encode(file.content)));
    }
    expect(link?.download).toBe("量产配置-export.zip");
    expect(link?.isConnected).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:mock");
  });

  it("supports a manifest-only archive and empty file content without inventing bytes", async () => {
    await downloadExportBundle("", bundle([]));
    expect(Object.keys((await downloadedArchive()).files)).toEqual(["wiseeff-config-set-export-manifest.json"]);
    vi.mocked(URL.createObjectURL).mockClear();
    const result = bundle(["empty.json"]);
    result.files[0]!.content = "";
    await downloadExportBundle("", result);
    expect(await (await downloadedArchive()).file("empty.json")!.async("uint8array")).toHaveLength(0);
  });

  it.each([
    "", "/absolute.dts", "C:/absolute.dts", "C:relative.dts", "\\\\server\\file.dts", "dir\\file.dts",
    "../outside.dts", "dir/../outside.dts", "./file.dts", "dir//file.dts", "dir/", "null\0.dts", "\ud800.dts"
  ])("rejects unsafe archive path %j before creating a download", async (name) => {
    await expect(downloadExportBundle("config", bundle([name]))).rejects.toThrow("导出文件路径或内容无效");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it("rejects a path that cannot fit the ZIP filename field", async () => {
    await expect(downloadExportBundle("config", bundle(["x".repeat(0x10000)]))).rejects.toThrow("导出文件路径或内容无效");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it.each([
    ["same.dts", "same.dts"], ["Board.dts", "board.dts"], ["é.json", "e\u0301.json"],
    ["wiseeff-config-set-export-manifest.json"], ["WISEEFF-CONFIG-SET-EXPORT-MANIFEST.JSON"],
    ["wiseeff-config-set-export-manifest.json/child.dts"], ["folder", "folder/board.dts"], ["Folder/board.dts", "folder"]
  ])("rejects duplicate, reserved or file/directory collisions: %j", async (...names) => {
    await expect(downloadExportBundle("config", bundle(names))).rejects.toThrow(/路径.*冲突|路径重复/);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it("rejects invalid file content and unserializable manifests without triggering a download", async () => {
    const invalidContent = bundle();
    Object.defineProperty(invalidContent.files[0], "content", { value: null });
    await expect(downloadExportBundle("config", invalidContent)).rejects.toThrow("导出文件路径或内容无效");
    const circular = bundle();
    Object.assign(circular.manifest, { self: circular.manifest });
    await expect(downloadExportBundle("config", circular)).rejects.toThrow();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it("releases the object URL and removes the anchor when the download fails", async () => {
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => { throw new Error("download blocked"); });
    await expect(downloadExportBundle("config", bundle())).rejects.toThrow("download blocked");
    expect(document.querySelector('a[download$="-export.zip"]')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:mock");
  });
});
