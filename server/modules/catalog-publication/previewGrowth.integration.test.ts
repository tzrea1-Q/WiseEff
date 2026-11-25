import { randomBytes } from "node:crypto";
import pg from "pg";
import { expect, it } from "vitest";
import { createPostgresDatabase, type Database } from "../../shared/database/client";
import { applyMigrations, migrationsDir, withTempDatabase } from "../../testing/tempDatabase";
import { CatalogArtifactId, CatalogReleaseDigest, CatalogReleaseId } from "../parameter-catalog-contract";
import { jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { encodeBundleBytes, refreshSuccessorSource } from "./builder/bundleCodec";
import { firstAcmePredecessor, pageIntegerChange } from "./builder/predecessorHarness";
import { withPublicationCoordinator } from "./coordinator";
import { persistArtifact } from "./persistence/store";
import { previewPublicationCandidate } from "./preview";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "./runtime/provisionRuntimeLogins";

it("bounds warm identity and Markdown definition preview IO as release history grows at fixed Catalog size", async () => {
  await withTempDatabase({ prefix: "previewgrowth", migrate: false }, async ({ db, connectionString }) => {
    await applyMigrations(db, migrationsDir, { before: "0368" });
    const token = randomBytes(8).toString("hex");
    const runtime = await provisionPublicationRuntimeLogins(connectionString, { mode: "lab", runToken: token });
    const api = createPostgresDatabase(runtime.apiUrl);
    const installer = new pg.Pool({ connectionString });
    const releases = [firstAcmePredecessor().first];
    try {
      await applyMigrations(db, migrationsDir);
      // A different migration owner does not inherit the provisioner's default ACL.
      await db.query(`revoke select on catalog_publication.preview_snapshots from ${pg.escapeIdentifier(runtime.apiRole)}`);
      expect((await api.query<{ direct: boolean }>(
        "select has_table_privilege(current_user,'catalog_publication.preview_snapshots','select') as direct",
      )).rows[0]?.direct).toBe(false);
      let installed = 0;
      const artifactSizes: number[] = [];
      const writeSizes: number[] = [];
      for (const depth of [4, 16, 64, 256]) {
        while (releases.length < depth) {
          const previous = releases[releases.length - 1]!;
          const sequence = previous.manifest.release.sequence + 1;
          const suffix = String(sequence).padStart(3, "0");
          releases.push(refreshSuccessorSource({ ...previous, manifest: { ...previous.manifest, release: {
            ...previous.manifest.release, id: `crel_growth_${suffix}`, version: `1.${sequence}.0`, sequence,
            predecessor: { id: previous.manifest.release.id, digest: previous.manifest.release.digest },
          } } }));
        }
        while (installed < depth) {
          const target = releases[installed]!.manifest.release;
          const source = jsonCatalogReleaseSource({ schemaVersion: "1.0.0", targetReleaseId: target.id, releases: releases.slice(0, installed + 1) });
          const command = { source, expectedTargetDigest: CatalogReleaseDigest(target.digest) };
          const result = await installPublishedRelease(installer, target.predecessor
            ? { ...command, mode: "advance", expectedCurrent: { id: CatalogReleaseId(target.predecessor.id), digest: CatalogReleaseDigest(target.predecessor.digest) } }
            : { ...command, mode: "bootstrap" });
          if (!result.ok) throw new Error(JSON.stringify(result.error));
          installed++;
        }
        const target = releases[depth - 1]!.manifest.release;
        const bytes = encodeBundleBytes({ schemaVersion: "1.0.0", targetReleaseId: target.id, releases });
        const stored = await withPublicationCoordinator(api, tx => persistArtifact(tx, {
          id: CatalogArtifactId(`cart_growth_${depth}`), artifactDigest: target.digest, artifactBytes: bytes,
          targetReleaseId: CatalogReleaseId(target.id), targetReleaseDigest: CatalogReleaseDigest(target.digest),
          predecessorReleaseId: CatalogReleaseId(target.predecessor!.id),
          predecessorReleaseDigest: CatalogReleaseDigest(target.predecessor!.digest),
          sourceKind: "repository-bundle", toolchain: {},
        }));
        expect(stored.ok, JSON.stringify(stored.ok ? null : stored.error)).toBe(true);
        let historyReads = 0;
        let mutationBytes = 0;
        const observe = (db: Database): Database => ({
          async query<Row>(sql: string, values?: unknown[]) {
            const result = await db.query<Row>(sql, values);
            if (result.rows.some(row => row && typeof row === "object" && "artifact_byte_chunk" in row && "artifact_digest" in row)) historyReads++;
            if (/\binsert into\b/i.test(sql)) {
              for (const value of values ?? []) mutationBytes += value instanceof Uint8Array
                ? value.byteLength : Buffer.byteLength(String(value));
            }
            return result;
          },
          transaction: (fn, options) => db.transaction(tx => fn(observe(tx)), options),
        });
        const samples = [];
        const writes = [];
        let cold = 0;
        for (let sample = 0; sample <= 10; sample++) {
          mutationBytes = 0;
          const start = performance.now();
          const result = await previewPublicationCandidate({
            db: observe(api), predecessorDigest: target.digest, authorPrincipalId: "growth-admin", authorOrganizationId: "growth",
            changeSet: [{ op: "rename-subject", subjectId: "csub_acme_power", selector: "acme,renamed", keepOldAlias: true }],
          });
          const elapsed = Math.round(performance.now() - start);
          if (!result.ok) throw new Error(JSON.stringify(result.error));
          if (sample === 0) {
            cold = elapsed;
            historyReads = 0;
          } else {
            samples.push(elapsed);
            writeSizes.push(mutationBytes);
            const size = await api.query<{ bytes: number }>(
              "select octet_length(artifact_bytes) as bytes from catalog_publication.release_artifacts where id=$1",
              [result.value.candidate.artifactId],
            );
            writes.push(size.rows[0]!.bytes);
          }
        }
        samples.sort((a, b) => a - b);
        const markdown = await previewPublicationCandidate({
          db: observe(api), predecessorDigest: target.digest, authorPrincipalId: "growth-admin", authorOrganizationId: "growth",
          changeSet: [pageIntegerChange("added_limit", "Added limit")],
          markdownSource: { fileName: "growth.md", sha256: `sha256:${"0".repeat(64)}`, parserVersion: "markdown-import/v2" },
        });
        expect(markdown.ok, JSON.stringify(markdown.ok ? null : markdown.error)).toBe(true);
        console.info({ depth, cold, p50: samples[4], p95: samples[9], historyReads, maxArtifactBytes: Math.max(...writes) });
        expect.soft(historyReads).toBe(0);
        artifactSizes.push(...writes);
      }
      // Only the sequence/version digit widths change between these otherwise identical targets.
      expect(Math.max(...artifactSizes) - Math.min(...artifactSizes)).toBeLessThan(128);
      expect(Math.min(...writeSizes)).toBeGreaterThan(0);
      expect(Math.max(...writeSizes) - Math.min(...writeSizes)).toBeLessThan(256);
    } finally {
      await installer.end();
      await api.close();
      await dropLabRuntimeLogins(connectionString, token);
    }
  });
}, 180_000);
