import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearSchemaRegistryCache,
  getCachedOrganizationSchemaRegistry,
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
  it("shares the pinned instance across organizations and draft reads without consulting overlay history", async () => {
    const root = mkdtempSync(join(tmpdir(), "t1066-schema-cache-"));
    scratchDirs.push(root);
    writeMiniCatalog(root, [
      "$id: wiseeff/demo.yaml", "source: vendor", "schemaNamespace: vendor/demo",
      'compatible: ["demo,device"]', "properties: {}",
    ].join("\n"), "hash-a");
    const db = { query: vi.fn(async () => { throw new Error("Overlay history must not be read"); }) };
    const pinned = getCachedSchemaRegistry(root);
    expect(await getCachedOrganizationSchemaRegistry(db, { schemasRoot: root, organizationId: "t1066_org_a" })).toBe(pinned);
    expect(await getCachedOrganizationSchemaRegistry(db, { schemasRoot: root, organizationId: "t1066_org_b", includeDrafts: true })).toBe(pinned);
    expect(db.query).not.toHaveBeenCalled();
  });

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
