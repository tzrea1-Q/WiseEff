import pg from "pg";
import { expect, it } from "vitest";
import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { compileCatalogRelease } from "../compiler";
import { refreshAuthoritativeSource, validCatalogReleaseBundle } from "../compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../compiler/types";
import { jsonCatalogReleaseSource } from "../interface";
import { installPublishedRelease } from "./installer";

it("installs and activates an alias equal to another driver's child name", async () => {
  const lane = await createEphemeralTestDatabase("owner_alias");
  const pool = new pg.Pool({ connectionString: lane.url });
  try {
    const release = structuredClone(validCatalogReleaseBundle().releases[0]!) as unknown as {
      manifest: { release: { id: string } };
      documents: Array<{ kind: string; content: Record<string, unknown> }>;
    };
    const driver = release.documents.find((document) => document.kind === "subject")!;
    const alias = release.documents.find((document) => document.kind === "alias")!;
    release.documents.push({ ...structuredClone(driver), content: { ...structuredClone(driver.content), id: "owner-alias-driver-b",
      canonicalKey: "driver:vendor,owner-b", selector: { kind: "driver-compatible", value: "vendor,owner-b", provenance: { source: "owner-test" } } } });
    const child = (id: string, name: string, owner: string) => ({ ...structuredClone(driver), content: {
      id, kind: "node-type", canonicalKey: `node-type:${name}`, ownerSubjectId: owner, lifecycle: "active",
      selector: { kind: "node-type-name", value: name, provenance: { source: "owner-test" } }, subtype: {}, tombstone: null,
    } });
    release.documents.push(child("owner-alias-child-a", "child_a", "csub_acme_power"));
    release.documents.push(child("owner-alias-child-b", "child_b", "owner-alias-driver-b"));
    release.documents.push({ ...structuredClone(alias), content: { ...structuredClone(alias.content), id: "owner-alias-child-a-name",
      subjectId: "owner-alias-child-a", selectorKind: "node-type-name", normalizedSelector: "child_b" } });
    refreshAuthoritativeSource(release as never);
    const bundle = { schemaVersion: "1.0.0", targetReleaseId: release.manifest.release.id, releases: [release] } as unknown as CatalogReleaseBundle;
    const compiled = compileCatalogRelease(bundle);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    if (!compiled.ok) return;
    const result = await installPublishedRelease(pool, { mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: compiled.value.aggregateDigest });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result).toMatchObject({ ok: true, value: { status: "installed" } });
    expect((await pool.query(`select current_catalog_release_id from parameter_catalog.catalog_state`)).rows[0])
      .toEqual({ current_catalog_release_id: release.manifest.release.id });
  } finally { await pool.end(); await lane.drop(); }
}, 120_000);
