import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../server/modules/catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../server/modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import {
  EXCLUDED_SCHEMA_BASENAMES,
  FIRST_ACME_RELEASE_DIGEST,
  FIRST_ACME_RELEASE_ID,
  VENDOR_SUCCESSOR_AGGREGATE_DIGEST,
  VENDOR_SUCCESSOR_RELEASE_ID,
  compileVendorCatalogSuccessor,
} from "./compile-vendor-catalog-release";

const firstReleaseBundle = () => {
  const full = validCatalogReleaseBundle();
  const first = full.releases[0]!;
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
};

describe("compileVendorCatalogSuccessor", () => {
  it("compiles a successor of crel_acme_1 from catalog.json minus excluded fixtures", () => {
    const first = compileCatalogRelease(firstReleaseBundle());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    for (const name of EXCLUDED_SCHEMA_BASENAMES) {
      expect(existsSync(path.join("schemas/dts/vendor/wiseeff", name))).toBe(true);
    }

    const result = compileVendorCatalogSuccessor();
    expect(result.compiled.release.id).toBe(VENDOR_SUCCESSOR_RELEASE_ID);
    expect(result.predecessor).toEqual(first.value.release);
    expect(result.compiled.predecessor).toEqual({
      id: first.value.release.id,
      digest: first.value.release.digest,
    });
    expect(result.predecessor.id).toBe(FIRST_ACME_RELEASE_ID);
    expect(result.predecessor.digest).toBe(FIRST_ACME_RELEASE_DIGEST);
    expect(result.compiled.aggregateDigest).toBe(VENDOR_SUCCESSOR_AGGREGATE_DIGEST);
    expect(result.excluded).toEqual([...EXCLUDED_SCHEMA_BASENAMES]);
    expect(result.compiled.counts).toEqual({
      subjects: 48,
      subjectMemberships: 48,
      aliases: 1,
      aliasMemberships: 1,
      definitions: 114,
      definitionRevisions: 114,
    });

    const target = result.bundle.releases.find(
      (release) => release.manifest.release.id === VENDOR_SUCCESSOR_RELEASE_ID,
    );
    expect(target).toBeDefined();
    const ids = new Set(target!.documents.map((document) => document.content.id));
    expect(ids.has("csub_acme_power")).toBe(true);
    expect(ids.has("pdef_acme_power_iin_max")).toBe(true);
    expect(ids.has("cali_acme_power_v1")).toBe(true);
    expect(ids.has("csub_nt_root")).toBe(true);
    expect(ids.has("pdef_nt_root_board_id")).toBe(true);
    expect([...ids].some((id) => id.includes("ambiguous"))).toBe(false);

    const keys = target!.documents
      .filter((document) => document.kind === "definition")
      .map((document) => document.content.propertyKey);
    expect(keys).toContain("iin_max");
    expect(keys).toContain("board_id");
    expect(keys).not.toContain("fast_charge_current_limit_ma");
    expect(keys).not.toContain("shared_prop");
    expect(keys).not.toContain("status");
  });

  it("is deterministic for the same repository catalog", () => {
    const first = compileVendorCatalogSuccessor();
    const second = compileVendorCatalogSuccessor();
    expect(second.compiled.aggregateDigest).toBe(first.compiled.aggregateDigest);
    expect(second.compiled.release.digest).toBe(first.compiled.release.digest);
    expect(second.compiled.aggregateDigest).toBe(VENDOR_SUCCESSOR_AGGREGATE_DIGEST);
  });

  it("fails closed when vendorContentHash does not match on-disk YAML", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wiseeff-vendor-catalog-"));
    const vendorDir = path.join(root, "schemas/dts/vendor/wiseeff");
    mkdirSync(vendorDir, { recursive: true });
    writeFileSync(
      path.join(root, "schemas/dts/catalog.json"),
      JSON.stringify({
        vendorContentHash: "0".repeat(64),
        schemaPaths: ["vendor/wiseeff/x.yaml"],
      }),
    );
    writeFileSync(path.join(vendorDir, "x.yaml"), "title: x\n");
    expect(() => compileVendorCatalogSuccessor(root)).toThrow(/catalog-vendor-hash-mismatch/);
  });
});
