import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearSchemaRegistryCache,
  getCachedSchemaRegistry,
} from "./schemaRegistryCache";

const scratchDirs: string[] = [];

function writeMiniCatalog(root: string, vendorBody: string, hash: string): void {
  mkdirSync(join(root, "vendor/wiseeff"), { recursive: true });
  writeFileSync(join(root, "vendor/wiseeff/demo.yaml"), vendorBody, "utf8");
  writeFileSync(
    join(root, "catalog.json"),
    JSON.stringify({
      linuxDtSchemaRevision: "test-stub",
      dtschemaVersion: "2026.6",
      vendorContentHash: hash,
      importedAt: "2026-07-16T00:00:00.000Z",
      schemaPaths: ["vendor/wiseeff/demo.yaml"],
    }),
    "utf8",
  );
}

afterEach(() => {
  clearSchemaRegistryCache();
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("getCachedSchemaRegistry", () => {
  it("returns the same registry instance for the same catalog content hash", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-schema-cache-"));
    scratchDirs.push(root);
    writeMiniCatalog(
      root,
      [
        "$id: wiseeff/demo.yaml",
        "title: demo",
        "source: vendor",
        "lifecycle: active",
        "version: 1",
        "schemaNamespace: vendor/demo",
        "compatible:",
        "  - demo,device",
        "properties: {}",
        "",
      ].join("\n"),
      "hash-a",
    );

    const first = getCachedSchemaRegistry(root);
    const second = getCachedSchemaRegistry(root);

    expect(second).toBe(first);
    expect(first.drivers.some((driver) => driver.compatiblePatterns.includes("demo,device"))).toBe(
      true,
    );
  });

  it("reloads when the catalog content hash changes", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-schema-cache-"));
    scratchDirs.push(root);
    writeMiniCatalog(
      root,
      [
        "$id: wiseeff/demo.yaml",
        "title: demo",
        "source: vendor",
        "lifecycle: active",
        "version: 1",
        "schemaNamespace: vendor/demo",
        "compatible:",
        "  - demo,v1",
        "properties: {}",
        "",
      ].join("\n"),
      "hash-a",
    );

    const first = getCachedSchemaRegistry(root);
    expect(first.drivers[0]?.compatiblePatterns).toEqual(["demo,v1"]);

    writeMiniCatalog(
      root,
      [
        "$id: wiseeff/demo.yaml",
        "title: demo",
        "source: vendor",
        "lifecycle: active",
        "version: 1",
        "schemaNamespace: vendor/demo",
        "compatible:",
        "  - demo,v2",
        "properties: {}",
        "",
      ].join("\n"),
      "hash-b",
    );

    const second = getCachedSchemaRegistry(root);
    expect(second).not.toBe(first);
    expect(second.drivers[0]?.compatiblePatterns).toEqual(["demo,v2"]);
  });
});
