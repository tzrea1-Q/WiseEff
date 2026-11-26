// TEST_DATABASE_URL must point to a disposable PostgreSQL test cluster with pgvector.
// node --import tsx scripts/benchmark-catalog-markdown-publication.ts [startingDefinitions=100] [rounds=3]
// --legacy-mixed alternates creates and revisions against a valid legacy subject with a divergent natural key.
// --documentation-bytes N adds N ASCII bytes to each seed definition to vary serialized size independently.
// --activation-timeout-ms N overrides the manager deadline. --verify-replay compares the final release to the full compiler.
// --prewarm verifies and caches the installed bootstrap release before the first Markdown preview.
// --rebuild-checkpoints-at N drops this disposable database's current derived rows and prewarms before round N.
// --check-no-op measures an unchanged revision separately after all successful publications.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Socket } from "node:net";
import { parseArgs } from "node:util";
import pg from "pg";

import { createPostgresDatabase, getRootPostgresPool } from "../server/shared/database/client";
import { withTempDatabase } from "../server/testing/tempDatabase";
import { makeTestAuthContext } from "../server/testing/authContext";
import { createUserInvocation } from "../server/modules/auth/trustedInvocation";
import { jsonCatalogReleaseSource } from "../server/modules/catalog-kernel/interface";
import { compileCatalogRelease } from "../server/modules/catalog-kernel/compiler/index";
import type { CatalogReleaseBundle, CatalogReleaseDocument } from "../server/modules/catalog-kernel/compiler/types";
import { createCatalogInstaller, installPublishedRelease } from "../server/modules/catalog-kernel/install/installer";
import { CATALOG_MIGRATION_OWNER } from "../server/modules/catalog-kernel/security/catalogRoleManifest";
import { CatalogArtifactId, CatalogReleaseId, CatalogReleaseDigest } from "../server/modules/parameter-catalog-contract";
import { revisePublicationPolicy } from "../server/modules/catalog-publication/authorization/policy";
import { EPHEMERAL_POLICY_REVISION_CONFIRMATION } from "../server/modules/catalog-publication/authorization/types";
import { refreshSuccessorSource, encodeBundleBytes } from "../server/modules/catalog-publication/builder/bundleCodec";
import { firstAcmePredecessor } from "../server/modules/catalog-publication/builder/predecessorHarness";
import { withPublicationCoordinator } from "../server/modules/catalog-publication/coordinator";
import { runPublicationManagerOnce } from "../server/modules/catalog-publication/jobs/manager";
import { decodeStoredArtifact, persistArtifact, readArtifactLineage } from "../server/modules/catalog-publication/persistence/store";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../server/testing/labRuntimeLogins";
import { bindCatalogPublicationCommands } from "../server/modules/parameter-catalog-api/publication/ports";

function positiveInteger(argument: string | undefined, fallback: number) {
  const value = Number(argument ?? fallback);
  assert(Number.isSafeInteger(value) && value > 0, "Expected a positive integer");
  return value;
}

const { values: options, positionals } = parseArgs({
  options: {
    "legacy-mixed": { type: "boolean" }, "documentation-bytes": { type: "string" },
    "activation-timeout-ms": { type: "string" }, "verify-replay": { type: "boolean" }, prewarm: { type: "boolean" },
    "check-no-op": { type: "boolean" }, "rebuild-checkpoints-at": { type: "string" },
  },
  allowPositionals: true,
});
assert(positionals.length <= 2, "Expected starting definitions and rounds");
const definitions = positiveInteger(positionals[0], 100);
const rounds = positiveInteger(positionals[1], 3);
const rebuildAt = options["rebuild-checkpoints-at"] === undefined ? 0 : positiveInteger(options["rebuild-checkpoints-at"], 1);
assert(rebuildAt <= rounds, "Checkpoint rebuild round must be within the benchmark");
const documentationBytes = options["documentation-bytes"] ? positiveInteger(options["documentation-bytes"], 1) : 0;
const activationTimeoutMs = options["activation-timeout-ms"] === undefined ? undefined : positiveInteger(options["activation-timeout-ms"], 1);
const legacy = options["legacy-mixed"] === true;
const subjectCount = Math.min(definitions, 240);

function syntheticBundle(): CatalogReleaseBundle {
  const template = firstAcmePredecessor().first;
  const driver = template.documents.find(doc => doc.kind === "subject");
  const alias = template.documents.find(doc => doc.kind === "alias");
  const definition = template.documents.find(doc => doc.kind === "definition");
  assert(driver && alias && definition);
  const subjects = Array.from({ length: subjectCount }, (_, n) => {
    if (n === 0) return legacy
      ? { ...driver, content: { ...driver.content, canonicalKey: "driver:bench,legacy" } }
      : driver;
    const selector = `bench,device-${n}`;
    return { ...driver, content: { ...driver.content, id: `csub_bench_${n}`, canonicalKey: `driver:${selector}`,
      selector: { ...driver.content.selector, value: selector } } };
  });
  const documents: CatalogReleaseDocument[] = [...subjects, alias, { ...alias, content: {
    ...alias.content, id: "cali_bench_second", normalizedSelector: "acme,power-v2",
  } }];
  const documentationSuffix = "d".repeat(documentationBytes);
  for (let n = 0; n < definitions; n++) {
    const key = `param_${n}`;
    const revision = definition.content.revision;
    documents.push({ ...definition, content: { ...definition.content, id: `pdef_bench_${n}`,
      subjectId: subjects[n % subjects.length]!.content.id, propertyKey: key, revision: {
        ...revision, documentation: revision.documentation + documentationSuffix,
        id: `drev_bench_${n}_1`, matching: { ...revision.matching, sourceProperty: key },
      },
    } });
  }
  const release = refreshSuccessorSource({ ...template, documents: documents.map(doc => structuredClone(doc)) });
  return { schemaVersion: "1.0.0", targetReleaseId: release.manifest.release.id, releases: [release] };
}

// Socket bytes include PostgreSQL protocol overhead, snapshots and BYTEA text encoding.
// ReadyForQuery is one completed client/server exchange, including transaction control.
function observeWire(pool: pg.Pool) {
  let exchanges = 0;
  let historyReadBytes = 0;
  let snapshotReadBytes = 0;
  let checkpointReadBytes = 0;
  let artifactRecordsRead = 0;
  const sockets = new Set<Socket>();
  pool.on("connect", client => {
    assert(client instanceof pg.Client && client.connection.stream instanceof Socket);
    sockets.add(client.connection.stream);
    client.connection.on("readyForQuery", () => { exchanges++; });
    let artifactColumn = -1;
    let byteSource: "history" | "snapshot" | "checkpoint" = "history";
    let chunkOffsetColumn = -1;
    client.connection.on("rowDescription", (message: { fields: { name: string }[] }) => {
      const columns = message.fields.map(field => field.name);
      byteSource = columns.includes("target_checksum") ? "snapshot" : columns.includes("artifact_digest") ? "history" : "checkpoint";
      chunkOffsetColumn = columns.indexOf("artifact_byte_start");
      artifactColumn = columns.indexOf("artifact_byte_chunk");
    });
    client.connection.on("dataRow", (message: { fields: (string | null)[] }) => {
      const value = message.fields[artifactColumn];
      if (value != null) {
        assert(value.startsWith("\\x"), "Expected PostgreSQL hex BYTEA output");
        const bytes = (value.length - 2) / 2;
        if (byteSource === "snapshot") snapshotReadBytes += bytes;
        else if (byteSource === "checkpoint") checkpointReadBytes += bytes;
        else {
          historyReadBytes += bytes;
          if (message.fields[chunkOffsetColumn] === "1") artifactRecordsRead++;
        }
      }
    });
  });
  return () => ({
    exchanges, historyReadBytes, snapshotReadBytes, checkpointReadBytes, artifactRecordsRead,
    receivedBytes: [...sockets].reduce((sum, socket) => sum + socket.bytesRead, 0),
    sentBytes: [...sockets].reduce((sum, socket) => sum + socket.bytesWritten, 0),
  });
}

async function measure<T>(depth: number, currentDefinitions: number, stage: string, wire: ReturnType<typeof observeWire>, action: () => Promise<T>) {
  const before = wire();
  const cpu = process.cpuUsage();
  const start = performance.now();
  const result = await action();
  const wallMs = Math.round(performance.now() - start);
  const elapsed = process.cpuUsage(cpu);
  const after = wire();
  console.log(JSON.stringify({ stage, depth, currentDefinitions, processMaxRssKiB: process.resourceUsage().maxRSS,
    wallMs, nodeCpuMs: Math.round((elapsed.user + elapsed.system) / 1_000),
    exchanges: after.exchanges - before.exchanges, historyReadBytes: after.historyReadBytes - before.historyReadBytes,
    snapshotReadBytes: after.snapshotReadBytes - before.snapshotReadBytes,
    checkpointReadBytes: after.checkpointReadBytes - before.checkpointReadBytes,
    artifactRecordsRead: after.artifactRecordsRead - before.artifactRecordsRead,
    pgRxBytes: after.receivedBytes - before.receivedBytes,
    pgTxBytes: after.sentBytes - before.sentBytes }));
  return result;
}

async function main() {
  assert(process.env.TEST_DATABASE_URL?.trim(), "Set TEST_DATABASE_URL to a disposable test cluster with pgvector");
  await withTempDatabase({ prefix: "mdpubbench", migrate: true }, async ({ db, connectionString }) => {
    const token = randomBytes(8).toString("hex");
    const roles = await provisionPublicationRuntimeLogins(connectionString, { mode: "lab", runToken: token });
    const api = createPostgresDatabase(roles.apiUrl);
    const manager = createPostgresDatabase(roles.managerUrl);
    const installerPool = new pg.Pool({ connectionString });
    try {
      const apiPool = getRootPostgresPool(api)!;
      const managerPool = getRootPostgresPool(manager)!;
      const apiWire = observeWire(apiPool);
      const managerWire = observeWire(managerPool);
      const commands = bindCatalogPublicationCommands({ db: api, pool: apiPool });
      const permissions = ["catalog:publish", "catalog:author", "parameter:view"] as const;
      const scope = { principalId: "benchmark-publisher", organizationId: "org-bench", actorKind: "org-admin" as const,
        permissions, trustedActor: createUserInvocation(makeTestAuthContext({ userId: "benchmark-publisher", organizationId: "org-bench", permissions })) };
      await db.transaction(async tx => {
        await tx.query(`set local role ${CATALOG_MIGRATION_OWNER}`);
        const policy = await revisePublicationPolicy(tx, { trustedActor: scope.trustedActor, publicationEnabled: true,
          lowRiskSingleActorPublish: true, capabilityContractRevision: "catalog-capability/v1",
          isolatedInstanceConfirmation: EPHEMERAL_POLICY_REVISION_CONFIRMATION });
        assert(policy.ok, JSON.stringify(policy));
      });
      const bundle = syntheticBundle();
      const base = bundle.releases[0]!.manifest;
      const digest = CatalogReleaseDigest(base.release.digest);
      const installed = await installPublishedRelease(installerPool, { mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: digest });
      if (!installed.ok) throw new Error(JSON.stringify(installed.error));
      const artifactBytes = encodeBundleBytes(bundle);
      const stored = await withPublicationCoordinator(api, tx => persistArtifact(tx, {
        id: CatalogArtifactId("cart_bench_bootstrap"), artifactDigest: digest, artifactBytes, targetReleaseId: CatalogReleaseId(base.release.id),
        targetReleaseDigest: digest, predecessorReleaseId: null, predecessorReleaseDigest: null, sourceKind: "repository-bundle", toolchain: base.toolchain,
      }));
      if (!stored.ok) throw new Error(JSON.stringify(stored.error));
      console.log(JSON.stringify({ stage: "setup", definitions, subjects: subjectCount, aliases: 2, rounds, legacy, documentationBytes,
        activationTimeoutMs, baseArtifactBytes: artifactBytes.byteLength, node: process.version }));
      async function measurePrewarm(depth: number, headCount: number) {
        const { prewarmCatalogCheckpoint } = await import("../server/modules/catalog-publication/runtime/prewarmCheckpoint");
        const warmed = await measure(depth, headCount, "prewarm", managerWire, () => prewarmCatalogCheckpoint(managerPool));
        assert.equal(warmed.status, "warmed");
        const repeated = await measure(depth, headCount, "repeat-prewarm", managerWire, () => prewarmCatalogCheckpoint(managerPool));
        assert.equal(repeated.status, "already-warm");
      }
      if (options.prewarm) await measurePrewarm(0, definitions);
      let current = base.release.id;
      let currentDefinitions = definitions;
      let lastRevisionMarkdown = "";
      for (let depth = 1; depth <= rounds; depth++) {
        if (depth === rebuildAt) {
          await db.transaction(async tx => {
            const { rows: [release] } = await tx.query<{ digest: string }>(
              "select release_digest as digest from parameter_catalog.catalog_releases where id = $1", [current],
            );
            assert(release);
            await tx.query("delete from catalog_publication.activation_checkpoints where artifact_digest = $1", [release.digest]);
            await tx.query("delete from catalog_publication.preview_snapshots where artifact_digest = $1", [release.digest]);
          });
          await measurePrewarm(depth, currentDefinitions);
        }
        const revise = legacy && depth % 2 === 0;
        const key = `added_${revise ? depth - 1 : depth}`;
        const name = revise ? "Revised parameter" : "Added parameter";
        const header = `# Driver \`acme,power\`\n## \`${key}\` ${name}\n| 字段 | 值 |\n| --- | --- |\n`;
        lastRevisionMarkdown = header + "| 操作 | 修订 |\n";
        const markdown = header +
          (revise ? "| 操作 | 修订 |\n" : "| 类型 | integer |\n");
        const preview = await measure(depth, currentDefinitions, "preview", apiWire, () => commands.previewCandidate({
          ...scope, catalogReleaseId: current, markdownImport: { document: markdown, fileName: "bench.md" },
        }));
        if (!preview.ok) throw new Error(JSON.stringify(preview.error));
        assert("candidate" in preview.value && preview.value.candidate);
        const candidateId = preview.value.candidate.id;
        const queued = await measure(depth, currentDefinitions, "enqueue", apiWire, () => commands.publishCandidate({
          ...scope, catalogReleaseId: current, candidateId, idempotencyKey: `bench-${depth}`,
        }));
        if (!queued.ok) throw new Error(JSON.stringify(queued.error));
        const completed = await measure(depth, currentDefinitions, "manager", managerWire, () => runPublicationManagerOnce({
          db: manager, pool: managerPool, installer: createCatalogInstaller(managerPool),
          resolvePublisherActor: async () => scope.trustedActor, ownerId: "bench-manager", activationTimeoutMs,
        }));
        assert.equal(completed, "claimed");
        const verified = await commands.getPublication({ ...scope, jobId: queued.value.id });
        assert(verified.ok && verified.value.effective && verified.value.isCurrent && verified.value.attemptCount === 1,
          JSON.stringify(verified));
        const head = (await db.query<{ id: string; heads: number }>(
          `select current_catalog_release_id as id, (select count(*)::int from parameter_catalog.catalog_release_definition_heads
             where release_id = state.current_catalog_release_id) as heads from parameter_catalog.catalog_state state`,
        )).rows[0]!;
        assert.notEqual(head.id, current);
        if (!revise) currentDefinitions++;
        assert.equal(head.heads, currentDefinitions);
        const changes = await db.query<{ revision_number: number; name: string; key: string }>(
          `select revision_number::integer as revision_number, content->>'displayName' as name, content->'matching'->>'sourceProperty' as key
             from parameter_catalog.definition_revisions
            where catalog_release_id = $1`, [head.id],
        );
        assert.deepEqual(changes.rows, [{ revision_number: revise ? 2 : 1, name, key }]);
        current = head.id;
      }
      if (options["check-no-op"]) {
        const unchanged = await measure(rounds, currentDefinitions, "unchanged-preview", apiWire, () => commands.previewCandidate({
          ...scope, catalogReleaseId: current, markdownImport: { document: lastRevisionMarkdown, fileName: "bench.md" },
        }));
        if (!unchanged.ok) throw new Error(JSON.stringify(unchanged.error));
        assert("noChange" in unchanged.value && unchanged.value.noChange && unchanged.value.candidate === null);
      }
      const { rows: [storage] } = await db.query<{ artifacts: number; artifact_bytes: string }>(
        `select count(*)::int as artifacts, sum(octet_length(artifact_bytes))::text as artifact_bytes
           from catalog_publication.release_artifacts`,
      );
      assert(storage);
      if (options["verify-replay"]) {
        const { rows: [published] } = await db.query<{
          release_digest: string; compiled_model_digest: string; toolchain_digest: string; compiled_fingerprint: string; database_fingerprint: string;
        }>(`select release_digest, compiled_model_digest, toolchain_digest, compiled_fingerprint, database_fingerprint
              from parameter_catalog.catalog_releases r join parameter_catalog.catalog_materializations m on m.release_id = r.id
             where r.id = $1`, [current]);
        assert(published);
        const lineage = await readArtifactLineage(db, published.release_digest);
        if (!lineage.ok) throw new Error(JSON.stringify(lineage.error));
        const decoded = decodeStoredArtifact(lineage.value);
        if (!decoded.ok) throw new Error(JSON.stringify(decoded.error));
        const compiled = compileCatalogRelease(decoded.value);
        if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
        assert.equal(compiled.value.release.id, current);
        assert.equal(compiled.value.aggregateDigest, published.release_digest);
        assert.equal(compiled.value.compiledReleaseDigest, published.compiled_model_digest);
        assert.equal(compiled.value.toolchainDigest, published.toolchain_digest);
        assert.equal(compiled.value.materializationFingerprint, published.compiled_fingerprint);
        assert.equal(compiled.value.materializationFingerprint, published.database_fingerprint);
      }
      console.log(JSON.stringify({ stage: "verified", rounds, currentDefinitions, artifacts: storage.artifacts,
        artifactBytes: Number(storage.artifact_bytes), fullReplayVerified: options["verify-replay"] === true }));
    } finally {
      await Promise.all([api.close(), manager.close(), installerPool.end()]);
      await dropLabRuntimeLogins(connectionString, token);
    }
  });
}

await main();
