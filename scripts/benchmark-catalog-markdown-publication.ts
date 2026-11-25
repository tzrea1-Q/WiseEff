// TEST_DATABASE_URL must point to a disposable PostgreSQL test cluster with pgvector.
// node --import tsx scripts/benchmark-catalog-markdown-publication.ts [startingDefinitions=100] [rounds=3]
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Socket } from "node:net";
import pg from "pg";

import { createPostgresDatabase, getRootPostgresPool } from "../server/shared/database/client";
import { withTempDatabase } from "../server/testing/tempDatabase";
import { makeTestAuthContext } from "../server/testing/authContext";
import { createUserInvocation } from "../server/modules/auth/trustedInvocation";
import { jsonCatalogReleaseSource } from "../server/modules/catalog-kernel/interface";
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
import { persistArtifact } from "../server/modules/catalog-publication/persistence/store";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../server/testing/labRuntimeLogins";
import { bindCatalogPublicationCommands } from "../server/modules/parameter-catalog-api/publication/ports";

function positiveInteger(argument: string | undefined, fallback: number) {
  const value = Number(argument ?? fallback);
  assert(Number.isSafeInteger(value) && value > 0, "Expected a positive integer");
  return value;
}

const definitions = positiveInteger(process.argv[2], 100);
const rounds = positiveInteger(process.argv[3], 3);
const subjectCount = Math.min(definitions, 240);

function syntheticBundle(): CatalogReleaseBundle {
  const template = firstAcmePredecessor().first;
  const driver = template.documents.find(doc => doc.kind === "subject");
  const alias = template.documents.find(doc => doc.kind === "alias");
  const definition = template.documents.find(doc => doc.kind === "definition");
  assert(driver && alias && definition);
  const subjects = Array.from({ length: subjectCount }, (_, n) => {
    if (n === 0) return driver;
    const selector = `bench,device-${n}`;
    return { ...driver, content: { ...driver.content, id: `csub_bench_${n}`, canonicalKey: `driver:${selector}`,
      selector: { ...driver.content.selector, value: selector } } };
  });
  const documents: CatalogReleaseDocument[] = [...subjects, alias, { ...alias, content: {
    ...alias.content, id: "cali_bench_second", normalizedSelector: "acme,power-v2",
  } }];
  for (let n = 0; n < definitions; n++) {
    const key = `param_${n}`;
    const revision = definition.content.revision;
    documents.push({ ...definition, content: { ...definition.content, id: `pdef_bench_${n}`,
      subjectId: subjects[n % subjects.length]!.content.id, propertyKey: key, revision: {
        ...revision, id: `drev_bench_${n}_1`, matching: { ...revision.matching, sourceProperty: key },
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
  const sockets = new Set<Socket>();
  pool.on("connect", client => {
    assert(client instanceof pg.Client && client.connection.stream instanceof Socket);
    sockets.add(client.connection.stream);
    client.connection.on("readyForQuery", () => { exchanges++; });
    let artifactColumn = -1;
    let snapshot = false;
    client.connection.on("rowDescription", (message: { fields: { name: string }[] }) => {
      snapshot = message.fields.some(field => field.name === "target_checksum");
      artifactColumn = message.fields.findIndex(field => field.name === "artifact_byte_chunk");
    });
    client.connection.on("dataRow", (message: { fields: (string | null)[] }) => {
      const value = message.fields[artifactColumn];
      if (value != null) {
        assert(value.startsWith("\\x"), "Expected PostgreSQL hex BYTEA output");
        const bytes = (value.length - 2) / 2;
        if (snapshot) snapshotReadBytes += bytes;
        else historyReadBytes += bytes;
      }
    });
  });
  return () => ({
    exchanges, historyReadBytes, snapshotReadBytes,
    receivedBytes: [...sockets].reduce((sum, socket) => sum + socket.bytesRead, 0),
    sentBytes: [...sockets].reduce((sum, socket) => sum + socket.bytesWritten, 0),
  });
}

async function measure<T>(depth: number, stage: string, wire: ReturnType<typeof observeWire>, action: () => Promise<T>) {
  const before = wire();
  const cpu = process.cpuUsage();
  const start = performance.now();
  const result = await action();
  const wallMs = Math.round(performance.now() - start);
  const elapsed = process.cpuUsage(cpu);
  const after = wire();
  console.log(JSON.stringify({ stage, depth, currentDefinitions: definitions + depth - 1,
    wallMs, nodeCpuMs: Math.round((elapsed.user + elapsed.system) / 1_000),
    exchanges: after.exchanges - before.exchanges, historyReadBytes: after.historyReadBytes - before.historyReadBytes,
    snapshotReadBytes: after.snapshotReadBytes - before.snapshotReadBytes,
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
      console.log(JSON.stringify({ stage: "setup", definitions, subjects: subjectCount, aliases: 2, rounds,
        baseArtifactBytes: artifactBytes.byteLength, node: process.version }));
      let current = base.release.id;
      for (let depth = 1; depth <= rounds; depth++) {
        const markdown = "# Driver `acme,power`\n## `added_" + depth + "` Added parameter\n| 字段 | 值 |\n| --- | --- |\n| 类型 | integer |\n";
        const preview = await measure(depth, "preview", apiWire, () => commands.previewCandidate({
          ...scope, catalogReleaseId: current, markdownImport: { document: markdown, fileName: "bench.md" },
        }));
        if (!preview.ok) throw new Error(JSON.stringify(preview.error));
        assert("candidate" in preview.value && preview.value.candidate);
        const candidateId = preview.value.candidate.id;
        const queued = await measure(depth, "enqueue", apiWire, () => commands.publishCandidate({
          ...scope, catalogReleaseId: current, candidateId, idempotencyKey: `bench-${depth}`,
        }));
        if (!queued.ok) throw new Error(JSON.stringify(queued.error));
        const completed = await measure(depth, "manager", managerWire, () => runPublicationManagerOnce({
          db: manager, pool: managerPool, installer: createCatalogInstaller(managerPool),
          resolvePublisherActor: async () => scope.trustedActor, ownerId: "bench-manager",
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
        assert.equal(head.heads, definitions + depth);
        current = head.id;
      }
    } finally {
      await Promise.all([api.close(), manager.close(), installerPool.end()]);
      await dropLabRuntimeLogins(connectionString, token);
    }
  });
}

await main();
