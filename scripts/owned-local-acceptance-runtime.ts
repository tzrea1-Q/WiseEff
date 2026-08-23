import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { promisify } from "node:util";

import {
  OWNED_ACCEPTANCE_DATABASE_PREFIX,
  OWNED_ACCEPTANCE_DESCRIPTOR_ENV,
  OWNED_ACCEPTANCE_MARKER_PURPOSE,
  OWNED_ACCEPTANCE_MARKER_TABLE,
  OWNED_API_PORT_RANGE,
  OWNED_FRONTEND_PORT_RANGE,
  type OwnedLocalAcceptanceRuntimeDescriptorV1,
  assertOwnedRuntimeDescriptor,
  buildOwnedRuntimeArtifactEnv,
  databaseIdentityFromUrl,
  sha256,
  verifyOwnedRuntimeOwnership,
} from "../e2e/acceptance/helpers/ownedRuntimeDescriptor";
import {
  OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV,
  initializeNestedRuntimeManifest,
  readNestedRuntimeManifest,
  recordNestedRuntimeFinish,
  type NestedRuntimeCleanup,
} from "../e2e/acceptance/helpers/nestedRuntimeManifest";
import {
  gate0SecretValuesFromEnv,
  sanitizeGate0DiagnosticText,
} from "./gate0-artifact-sanitizer";
import { buildGate0OwnedChildProcessEnv } from "./gate0-child-process-env";
import {
  stopOwnedProcessGroup,
  waitForOwnedProcessGroupExit,
  type StopOwnedProcessGroupOptions,
} from "./owned-process-group";
import {
  withOwnerAwarePostgres,
  type OwnerAwarePostgresDeadline,
} from "./owner-aware-postgres";
import {
  readProcessStartIdentity,
  sameProcessStartIdentity,
  type ProcessStartIdentity,
} from "./process-start-identity";

type RuntimeEnv = Record<string, string | undefined>;

export type ProvisionOwnedRuntimeOptions = {
  baseDatabaseUrl: string;
  worktreeRoot?: string;
  runsRoot?: string;
  ownerDeadline?: {
    signal: AbortSignal;
    finalizationSignal?: AbortSignal;
    deadlineAt: number;
    remainingMs(stage: string): number;
  };
  secretRegistryEnv?: RuntimeEnv;
  registerGeneratedSecrets?(values: readonly string[]): void | Promise<void>;
  finalizeProvisionFailureArtifacts?(runRoot: string, signal?: AbortSignal): Promise<void>;
};

export type ProvisionOwnedRuntimeDependencies = {
  allocateLoopbackPort?: typeof allocateAllowedLoopbackPort;
  databaseCreationOperations?: (input: {
    adminUrl: string;
    databaseName: string;
    ownerDeadline?: ProvisionOwnedRuntimeOptions["ownerDeadline"];
  }) => CheckedAbsentDatabaseCreationOperations;
  runNpmScriptWithLog?: typeof runNpmScriptWithLog;
  writeAndReadDatabaseMarker?: typeof writeAndReadDatabaseMarker;
  spawnOwnedProcess?: typeof spawnOwnedProcess;
  waitForHttp?: typeof waitForHttp;
};

export type CheckedAbsentDatabaseCreationEvidence = {
  intendedDatabaseName: string;
  state:
    | "intent-recorded"
    | "absent-confirmed"
    | "create-attempted"
    | "created-acknowledged"
    | "create-failed-database-present"
    | "create-failed-database-absent"
    | "create-failed-presence-unknown"
    | "preexisting-database-refused"
    | "marker-verified";
  absentBeforeCreate?: true;
  createAttempted: boolean;
  createAcknowledged: boolean;
  presenceAfterCreateFailure?: "present" | "absent" | "unknown";
  ownership: "not-owned" | "unverified-no-marker" | "verified-marker";
  retainedDatabaseName?: string;
};

export type CheckedAbsentDatabaseCreationOperations = {
  databaseExistsBeforeCreate(): Promise<boolean>;
  createDatabase(): Promise<void>;
  databaseExistsAfterCreateFailure(): Promise<boolean>;
};

export async function createCheckedAbsentDatabase(input: {
  databaseName: string;
  recordEvidence(evidence: CheckedAbsentDatabaseCreationEvidence): void;
  operations: CheckedAbsentDatabaseCreationOperations;
}) {
  let evidence: CheckedAbsentDatabaseCreationEvidence = {
    intendedDatabaseName: input.databaseName,
    state: "intent-recorded",
    createAttempted: false,
    createAcknowledged: false,
    ownership: "not-owned",
  };
  const record = (next: CheckedAbsentDatabaseCreationEvidence) => {
    evidence = next;
    input.recordEvidence({ ...evidence });
  };
  record(evidence);

  if (await input.operations.databaseExistsBeforeCreate()) {
    record({ ...evidence, state: "preexisting-database-refused" });
    throw new Error(`Owned runtime database must be absent before creation: ${input.databaseName}`);
  }
  record({ ...evidence, state: "absent-confirmed", absentBeforeCreate: true });
  record({
    ...evidence,
    state: "create-attempted",
    createAttempted: true,
    ownership: "unverified-no-marker",
    retainedDatabaseName: input.databaseName,
  });

  try {
    await input.operations.createDatabase();
  } catch (error) {
    let exists: boolean;
    try {
      exists = await input.operations.databaseExistsAfterCreateFailure();
    } catch (reconciliationError) {
      record({
        ...evidence,
        state: "create-failed-presence-unknown",
        presenceAfterCreateFailure: "unknown",
        ownership: "unverified-no-marker",
        retainedDatabaseName: input.databaseName,
      });
      throw new AggregateError(
        [asError(error), asError(reconciliationError)],
        "Database creation failed and bounded presence reconciliation did not settle.",
      );
    }
    record({
      ...evidence,
      state: exists ? "create-failed-database-present" : "create-failed-database-absent",
      presenceAfterCreateFailure: exists ? "present" : "absent",
      ownership: exists ? "unverified-no-marker" : "not-owned",
      retainedDatabaseName: exists ? input.databaseName : undefined,
    });
    throw error;
  }

  record({
    ...evidence,
    state: "created-acknowledged",
    createAcknowledged: true,
    ownership: "unverified-no-marker",
    retainedDatabaseName: input.databaseName,
  });
  return evidence;
}

export type OwnedLocalAcceptanceRuntime = {
  descriptorPath: string;
  descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1;
  env: RuntimeEnv;
  updatePhase(
    phase: "visual" | "browser",
    update: Partial<OwnedLocalAcceptanceRuntimeDescriptorV1["phases"]["visual"]>,
  ): void;
  finish(
    outcome: "success" | "failure",
    finalizeArtifacts?: () => Promise<void>,
    cleanupOwnerDeadline?: ProvisionOwnedRuntimeOptions["ownerDeadline"],
  ): Promise<void>;
};

type StartedProcess = {
  label?: "api" | "frontend";
  child: ChildProcess;
  port?: number;
  command: string;
  log: string;
  processIdentity?: ProcessStartIdentity;
  cleanup: { status: "pending" | "stopped" | "failed"; reason: string };
};

export type ProvisionFailureProcessRecord = {
  label: "api" | "frontend";
  pid?: number;
  port: number;
  command: string;
  log: string;
  processIdentity?: ProcessStartIdentity;
  cleanup: { status: "pending" | "stopped" | "failed"; reason: string };
};

export type OrphanedOwnedRuntimeCleanupInput = {
  baseDatabaseUrl: string;
  worktreeRoot: string;
  runRoot: string;
  databaseName: string;
  runId: string;
  sourceCommit: string;
  ports: number[];
  ownerDeadline?: OwnerAwarePostgresDeadline;
};

const defaultRunsRoot = "test-results/acceptance-runtime-runs";
const execFileAsync = promisify(execFile);

export async function provisionOwnedLocalAcceptanceRuntime(
  options: ProvisionOwnedRuntimeOptions,
  dependencies: ProvisionOwnedRuntimeDependencies = {},
): Promise<OwnedLocalAcceptanceRuntime> {
  const worktreeRoot = realpathSync(options.worktreeRoot ?? process.cwd());
  checkpointOwner(options, "source inspection");
  const source = await readCleanSource(worktreeRoot, options.ownerDeadline?.signal);
  checkpointOwner(options, "runtime root creation");
  const runId = buildRunId(source.commit);
  const runsRoot = path.resolve(worktreeRoot, options.runsRoot ?? defaultRunsRoot);
  assertPathWithinWorktree(worktreeRoot, runsRoot, "runtime runs root");
  const runRoot = path.join(runsRoot, runId);
  const objectRoot = path.join(runRoot, "object-store");
  const descriptorPath = path.join(runRoot, "runtime.json");
  const operationEvidenceRuntimeSnapshot = path.join(runRoot, "runtime-operation-evidence-snapshot.json");
  const apiLog = path.join(runRoot, "api.log");
  const frontendLog = path.join(runRoot, "frontend.log");
  const provisionLog = path.join(runRoot, "provision.log");
  const failureInventory = path.join(runRoot, "failure-inventory.json");
  const sourceWorktreeOutputManifest = path.join(runRoot, "source-worktree-output-manifest.json");
  const nestedRuntimeManifest = path.join(runRoot, "nested-runtime-manifest.json");
  const databaseCreationJournal = path.join(runRoot, "database-creation.json");
  const databaseName = buildDatabaseName(runId);
  const databaseUrl = databaseUrlFor(options.baseDatabaseUrl, databaseName);
  const adminUrl = databaseUrlFor(options.baseDatabaseUrl, "postgres");
  const authSecret = randomBytes(32).toString("hex");
  const authIssuer = `wiseeff-${runId}`;
  const objectMarker = path.join(objectRoot, ".wiseeff-acceptance-owner.json");
  const started: StartedProcess[] = [];
  let databaseCreated = false;
  let objectRootCreated = false;
  let databaseCreationEvidence: CheckedAbsentDatabaseCreationEvidence | undefined;

  try {
    ensureExistingAncestorsAreNotSymlinks(worktreeRoot, path.dirname(runsRoot));
    mkdirSync(runsRoot, { recursive: true });
    if (lstatSync(runsRoot).isSymbolicLink()) {
      throw new Error("Owned runtime runs root must not be a symbolic link.");
    }
    if (existsSync(runRoot)) throw new Error(`Owned runtime run root already exists: ${runRoot}`);
    mkdirSync(runRoot);
    if (existsSync(objectRoot)) throw new Error(`Owned runtime object root already exists: ${objectRoot}`);
    mkdirSync(objectRoot);
    objectRootCreated = true;
    if (lstatSync(objectRoot).isSymbolicLink()) {
      throw new Error("Owned runtime object root must not be a symbolic link.");
    }
    const objectMarkerContent = `${JSON.stringify({
      kind: "wiseeff-owned-local-acceptance-object-store",
      purpose: OWNED_ACCEPTANCE_MARKER_PURPOSE,
      runId,
      sourceCommit: source.commit,
    }, null, 2)}\n`;
    writeFileSync(objectMarker, objectMarkerContent, { encoding: "utf8", flag: "wx" });
    initializeNestedRuntimeManifest(nestedRuntimeManifest, {
      parentRunId: runId,
      sourceCommit: source.commit,
    });

    const allocatePort = dependencies.allocateLoopbackPort ?? allocateAllowedLoopbackPort;
    const apiPort = await allocatePort(OWNED_API_PORT_RANGE, options.ownerDeadline);
    const frontendPort = await allocatePort(OWNED_FRONTEND_PORT_RANGE, options.ownerDeadline);
    const apiUrl = `http://127.0.0.1:${apiPort}`;
    const frontendUrl = `http://127.0.0.1:${frontendPort}`;
    const env = {
      ...buildOwnedRuntimeEnv({
        databaseUrl,
        objectRoot,
        apiUrl,
        frontendUrl,
        apiPort,
        authIssuer,
        authSecret,
        descriptorPath,
        runId,
        sourceCommit: source.commit,
        runRoot,
        nestedRuntimeManifest,
      }),
      ...options.secretRegistryEnv,
    };
    await options.registerGeneratedSecrets?.(gate0SecretValuesFromEnv(env));

    checkpointOwner(options, "database creation");
    const databaseCreationOperations = dependencies.databaseCreationOperations?.({
      adminUrl,
      databaseName,
      ownerDeadline: options.ownerDeadline,
    }) ?? buildCheckedAbsentDatabaseCreationOperations(adminUrl, databaseName, options.ownerDeadline);
    databaseCreationEvidence = await createCheckedAbsentDatabase({
      databaseName,
      recordEvidence(evidence) {
        databaseCreationEvidence = evidence;
        writeDatabaseCreationJournal(databaseCreationJournal, {
          runId,
          sourceCommit: source.commit,
          evidence,
        });
      },
      operations: databaseCreationOperations,
    });
    databaseCreated = true;
    const runProvisionScript = dependencies.runNpmScriptWithLog ?? runNpmScriptWithLog;
    await runProvisionScript(worktreeRoot, "db:migrate", env, provisionLog, options.ownerDeadline);
    await runProvisionScript(worktreeRoot, "db:seed:all", env, provisionLog, options.ownerDeadline);
    checkpointOwner(options, "database marker proof");
    const databaseEvidence = await (
      dependencies.writeAndReadDatabaseMarker ?? writeAndReadDatabaseMarker
    )(databaseUrl, {
      runId,
      sourceCommit: source.commit,
    }, options.ownerDeadline);
    databaseCreationEvidence = {
      ...databaseCreationEvidence,
      state: "marker-verified",
      ownership: "verified-marker",
      retainedDatabaseName: databaseName,
    };
    writeDatabaseCreationJournal(databaseCreationJournal, {
      runId,
      sourceCommit: source.commit,
      evidence: databaseCreationEvidence,
    });

    const spawnRuntimeProcess = dependencies.spawnOwnedProcess ?? spawnOwnedProcess;
    const waitForOwnedHttp = dependencies.waitForHttp ?? waitForHttp;
    const api = spawnRuntimeProcess({
      label: "api",
      cwd: worktreeRoot,
      command: process.execPath,
      args: ["--import", "tsx", path.join(worktreeRoot, "server/index.ts")],
      env: { ...env, PORT: String(apiPort) },
      port: apiPort,
      log: apiLog,
    });
    started.push(api);
    api.processIdentity = requireProcessStartIdentity(api.child, "API");
    await waitForOwnedHttp(`${apiUrl}/health/live`, api.child, "API", options.ownerDeadline);

    const frontend = spawnRuntimeProcess({
      label: "frontend",
      cwd: worktreeRoot,
      command: process.execPath,
      args: [
        path.join(worktreeRoot, "node_modules/vite/bin/vite.js"),
        "--host",
        "127.0.0.1",
        "--port",
        String(frontendPort),
        "--strictPort",
      ],
      env,
      port: frontendPort,
      log: frontendLog,
    });
    started.push(frontend);
    frontend.processIdentity = requireProcessStartIdentity(frontend.child, "frontend");
    await waitForOwnedHttp(frontendUrl, frontend.child, "frontend", options.ownerDeadline);

    const now = new Date().toISOString();
    const descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1 = {
      version: 1,
      kind: "wiseeff-owned-local-acceptance",
      run: {
        id: runId,
        sourceCommit: source.commit,
        worktreeRoot,
        sourceDirtyBefore: false,
        ownerPid: process.pid,
        createdAt: now,
        state: "ready",
      },
      database: {
        name: databaseName,
        connection: databaseIdentityFromUrl(databaseUrl),
        absentBeforeCreate: true,
        marker: {
          table: OWNED_ACCEPTANCE_MARKER_TABLE,
          purpose: OWNED_ACCEPTANCE_MARKER_PURPOSE,
          runId,
          sourceCommit: source.commit,
        },
        migration: {
          command: "npm run db:migrate",
          appliedCount: databaseEvidence.appliedCount,
          latest: databaseEvidence.latestMigration,
          completedAt: databaseEvidence.completedAt,
        },
        seed: {
          command: "npm run db:seed:all",
          completedAt: databaseEvidence.completedAt,
          sentinels: databaseEvidence.sentinels,
        },
      },
      objectStore: {
        mode: "local",
        root: objectRoot,
        absentBeforeCreate: true,
        markerFile: objectMarker,
        markerSha256: sha256(objectMarkerContent),
      },
      endpoints: {
        api: {
          host: "127.0.0.1",
          port: apiPort,
          url: apiUrl,
          healthUrl: `${apiUrl}/health/live`,
        },
        frontend: {
          host: "127.0.0.1",
          port: frontendPort,
          url: frontendUrl,
        },
      },
      processes: {
        api: {
          pid: requirePid(api.child, "API"),
          processIdentity: requireStartedProcessIdentity(api, "API"),
          startedAt: now,
          command: api.command,
          log: api.log,
        },
        frontend: {
          pid: requirePid(frontend.child, "frontend"),
          processIdentity: requireStartedProcessIdentity(frontend, "frontend"),
          startedAt: now,
          command: frontend.command,
          log: frontend.log,
        },
      },
      auth: {
        mode: "production",
        provider: "hmac",
        issuer: authIssuer,
        smokeSubject: "u-xu-yun",
      },
      runtime: {
        frontendMode: "api",
        xiaozeDeterministic: true,
        logAnalysisDeterministic: true,
        localWebhookAllowed: true,
        gatewayMode: "simulator",
        hdcAvailable: false,
      },
      phases: {
        visual: { status: "pending" },
        browser: { status: "pending" },
      },
      artifacts: {
        runRoot,
        descriptor: descriptorPath,
        operationEvidenceRuntimeSnapshot,
        failureInventory,
        sourceWorktreeOutputManifest,
        nestedRuntimeManifest,
        runtimeLogs: [apiLog, frontendLog],
      },
      cleanup: {
        policy: "success-only",
        status: "pending",
        exactDatabaseName: databaseName,
        exactObjectStoreRoot: objectRoot,
        resources: {
          apiProcess: { status: "pending" },
          frontendProcess: { status: "pending" },
          database: { status: "pending" },
          objectStore: { status: "pending" },
          descriptor: { status: "pending" },
          artifacts: { status: "pending" },
        },
      },
    };
    assertOwnedRuntimeDescriptor(descriptor);
    writeDescriptor(descriptorPath, descriptor);
    await verifyOwnedRuntimeOwnership(descriptor, env, options.ownerDeadline);
    descriptor.run.state = "running";
    writeDescriptor(descriptorPath, descriptor);
    writeOperationEvidenceRuntimeSnapshot(operationEvidenceRuntimeSnapshot, descriptor);

    let finished = false;
    return {
      descriptorPath,
      descriptor,
      env,
      updatePhase(phase, update) {
        if (finished) throw new Error("Owned runtime is already finalized.");
        Object.assign(descriptor.phases[phase], update);
        writeDescriptor(descriptorPath, descriptor);
      },
      async finish(outcome, finalizeArtifacts, cleanupOwnerDeadline = options.ownerDeadline) {
        if (finished) throw new Error("Owned runtime is already finalized.");
        finished = true;
        if (outcome === "failure") {
          const cleanupErrors: Error[] = [];
          await finalizeRunningNestedRuntimesAfterFailure(
            descriptor.artifacts.nestedRuntimeManifest,
            "Gate0 failure policy retains nested forensic resources.",
            { signal: cleanupOwnerDeadline?.signal },
          ).catch((error) => cleanupErrors.push(asError(error)));
          await stopAndRecordOwnedProcesses(started, descriptor, cleanupOwnerDeadline?.signal)
            .catch((error) => cleanupErrors.push(asError(error)));
          setRetainedResources(descriptor, "Gate0 failure policy retains forensic resources.");
          await finalizeArtifacts?.().then(
            () => { descriptor.cleanup.resources.artifacts = { status: "verified" }; },
            (error) => {
              descriptor.cleanup.resources.artifacts = { status: "failed", reason: safeCleanupReason(error) };
              cleanupErrors.push(asError(error));
            },
          );
          descriptor.cleanup.resources.descriptor = { status: "retained", reason: "Forensic descriptor retained." };
          descriptor.run.state = cleanupErrors.length > 0 ? "cleanup-failed-retained" : "failed-retained";
          descriptor.cleanup.status = "retained-on-failure";
          writeDescriptor(descriptorPath, descriptor);
          if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Gate0 failure finalization did not complete cleanly.");
          return;
        }

        try {
          assertNestedRuntimesCleanedForSuccess(descriptor.artifacts.nestedRuntimeManifest);
          await verifyOwnedRuntimeOwnership(descriptor, env, cleanupOwnerDeadline);
          await stopAndRecordOwnedProcesses(started, descriptor, cleanupOwnerDeadline?.signal);
          await finalizeArtifacts?.();
          descriptor.cleanup.resources.artifacts = { status: "verified" };
          await verifyDatabaseCleanupMarker(databaseUrl, descriptor, cleanupOwnerDeadline);
          descriptor.cleanup.resources.database = { status: "verified" };
          verifyObjectRootForCleanup(descriptor);
          descriptor.cleanup.resources.objectStore = { status: "verified" };
          await dropExactDatabase(adminUrl, descriptor.database.name, cleanupOwnerDeadline);
          descriptor.cleanup.resources.database = { status: "removed" };
          cleanupOwnerDeadline?.remainingMs("exact object-store cleanup");
          rmSync(descriptor.objectStore.root, { recursive: true, force: false });
          await assertDatabaseAbsent(adminUrl, descriptor.database.name, cleanupOwnerDeadline);
          if (existsSync(descriptor.objectStore.root)) {
            throw new Error("Owned runtime object root still exists after cleanup.");
          }
          descriptor.cleanup.resources.objectStore = { status: "removed" };
          descriptor.cleanup.resources.descriptor = { status: "retained", reason: "Cleanup proof descriptor retained." };
          descriptor.run.state = "cleaned";
          descriptor.cleanup.status = "complete";
          descriptor.cleanup.completedAt = new Date().toISOString();
          writeDescriptor(descriptorPath, descriptor);
        } catch (error) {
          const cleanupErrors = [asError(error)];
          await finalizeRunningNestedRuntimesAfterFailure(
            descriptor.artifacts.nestedRuntimeManifest,
            "Gate0 success cleanup was refused; nested forensic resources retained.",
            { signal: cleanupOwnerDeadline?.signal },
          ).catch((nestedError) => cleanupErrors.push(asError(nestedError)));
          await stopAndRecordOwnedProcesses(started, descriptor, cleanupOwnerDeadline?.signal)
            .catch((stopError) => cleanupErrors.push(asError(stopError)));
          retainPendingCleanupResources(descriptor, "Cleanup aborted after a fail-closed ownership or artifact check.");
          descriptor.cleanup.resources.descriptor = { status: "retained", reason: "Cleanup failure descriptor retained." };
          descriptor.run.state = "cleanup-failed-retained";
          descriptor.cleanup.status = "retained-on-failure";
          writeDescriptor(descriptorPath, descriptor);
          throw new AggregateError(cleanupErrors, "Gate0 exact cleanup failed; remaining owned resources were retained.");
        }
      },
    };
  } catch (error) {
    const failures = [asError(error)];
    await stopOwnedProcesses(started, options.ownerDeadline?.finalizationSignal)
      .catch((stopError) => failures.push(asError(stopError)));
    if (existsSync(runRoot)) {
      try {
        writeProvisionFailure(runRoot, {
          runId,
          sourceCommit: source.commit,
          databaseName: databaseCreationEvidence?.retainedDatabaseName ?? (databaseCreated ? databaseName : undefined),
          databaseCreationEvidence,
          objectRoot: objectRootCreated ? objectRoot : undefined,
          processes: started.map(provisionFailureProcessRecord),
          errors: failures,
        });
      } catch (failureWriteError) {
        failures.push(asError(failureWriteError));
      }
      await options.finalizeProvisionFailureArtifacts?.(
        runRoot,
        options.ownerDeadline?.finalizationSignal,
      ).catch((artifactError) => failures.push(asError(artifactError)));
    }
    throw new AggregateError(failures, "Owned runtime provisioning failed; exact resources were retained.");
  }
}

export async function cleanupExactOrphanedOwnedRuntime(
  input: OrphanedOwnedRuntimeCleanupInput,
  dependencies: {
    verifyDatabaseMarker?: (databaseUrl: string, input: OrphanedOwnedRuntimeCleanupInput) => Promise<void>;
    assertPortsUnused?: (ports: number[]) => Promise<void>;
    dropDatabase?: (adminUrl: string, databaseName: string) => Promise<void>;
    assertDatabaseAbsent?: (adminUrl: string, databaseName: string) => Promise<void>;
  } = {},
) {
  const worktreeRoot = realpathSync(input.worktreeRoot);
  const runsRoot = path.join(worktreeRoot, defaultRunsRoot);
  const runRoot = realpathSync(input.runRoot);
  assertPathWithinWorktree(runsRoot, runRoot, "orphaned runtime cleanup target");
  if (path.basename(runRoot) !== input.runId) {
    throw new Error("Refusing orphan cleanup: run root and run ID mismatch.");
  }
  if (!/^[a-f0-9]{40}$/u.test(input.sourceCommit)) {
    throw new Error("Refusing orphan cleanup: source commit must be exact.");
  }
  if (!/^wiseeff_acceptance_full_[a-z0-9_]+$/u.test(input.databaseName)) {
    throw new Error("Refusing orphan cleanup: database name is unsafe.");
  }
  const objectRoot = path.join(runRoot, "object-store");
  const markerPath = path.join(objectRoot, ".wiseeff-acceptance-owner.json");
  const objectStat = lstatSync(objectRoot);
  const markerStat = lstatSync(markerPath);
  if (objectStat.isSymbolicLink() || !objectStat.isDirectory() || markerStat.isSymbolicLink() || !markerStat.isFile()) {
    throw new Error("Refusing orphan cleanup: object root or marker is not a regular owned path.");
  }
  const marker = JSON.parse(readFileSync(markerPath, "utf8")) as Record<string, unknown>;
  if (
    marker.kind !== "wiseeff-owned-local-acceptance-object-store" ||
    marker.purpose !== OWNED_ACCEPTANCE_MARKER_PURPOSE ||
    marker.runId !== input.runId ||
    marker.sourceCommit !== input.sourceCommit
  ) {
    throw new Error("Refusing orphan cleanup: object marker identity mismatch.");
  }

  const databaseUrl = databaseUrlFor(input.baseDatabaseUrl, input.databaseName);
  const adminUrl = databaseUrlFor(input.baseDatabaseUrl, "postgres");
  await (dependencies.verifyDatabaseMarker ?? verifyOrphanDatabaseMarker)(databaseUrl, input);
  await (dependencies.assertPortsUnused ?? assertOwnedPortsUnused)(input.ports);
  await (dependencies.dropDatabase ?? ((url, name) => dropExactDatabase(url, name, input.ownerDeadline)))(adminUrl, input.databaseName);
  rmSync(objectRoot, { recursive: true, force: false });
  await (dependencies.assertDatabaseAbsent ?? ((url, name) => assertDatabaseAbsent(url, name, input.ownerDeadline)))(adminUrl, input.databaseName);
  if (existsSync(objectRoot)) throw new Error("Orphaned owned object root still exists after exact cleanup.");
  const evidencePath = path.join(runRoot, "exact-cleanup.json");
  writeFileSync(evidencePath, `${JSON.stringify({
    kind: "wiseeff-owned-local-acceptance-exact-cleanup",
    runId: input.runId,
    sourceCommit: input.sourceCommit,
    databaseName: input.databaseName,
    database: { status: "removed" },
    objectStore: { status: "removed" },
    ports: input.ports.map((port) => ({ port, status: "unused-before-cleanup" })),
    runRoot: { status: "retained-for-cleanup-evidence" },
    completedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  return evidencePath;
}

async function verifyOrphanDatabaseMarker(databaseUrl: string, input: OrphanedOwnedRuntimeCleanupInput) {
  await withOwnerAwarePostgres({
    connectionString: databaseUrl,
    owner: input.ownerDeadline,
    stage: "orphan database marker verification",
  }, async (database) => {
    const result = await database.query<{ database_name: string; purpose: string; run_id: string; source_commit: string }>(
      `select current_database() as database_name, purpose, run_id, source_commit
       from ${OWNED_ACCEPTANCE_MARKER_TABLE} where purpose = $1`,
      [OWNED_ACCEPTANCE_MARKER_PURPOSE],
      "marker query",
    );
    const marker = result.rows[0];
    if (
      result.rows.length !== 1 ||
      marker?.database_name !== input.databaseName ||
      marker.purpose !== OWNED_ACCEPTANCE_MARKER_PURPOSE ||
      marker.run_id !== input.runId ||
      marker.source_commit !== input.sourceCommit
    ) {
      throw new Error("Refusing orphan cleanup: database marker identity mismatch.");
    }
  });
}

async function assertOwnedPortsUnused(ports: number[]) {
  for (const port of ports) {
    if (!Number.isSafeInteger(port) || port <= 0) throw new Error("Refusing orphan cleanup: invalid owned port.");
    const server = createServer();
    const available = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (!available) throw new Error(`Refusing orphan cleanup: port ${port} still has a listener.`);
  }
}

export async function readCleanSource(worktreeRoot: string, signal?: AbortSignal) {
  const commit = await runGit(worktreeRoot, ["rev-parse", "HEAD"], signal);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Owned runtime could not resolve exact source commit.");
  const status = await runGit(worktreeRoot, ["status", "--porcelain", "--untracked-files=all"], signal);
  if (status) throw new Error("Owned runtime requires a clean source worktree before provisioning.");
  return { commit };
}

async function runGit(cwd: string, args: string[], signal?: AbortSignal) {
  try {
    const result = await execFileAsync("git", args, { cwd, encoding: "utf8", signal });
    return result.stdout.trim();
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    throw new Error(`git ${args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function buildRunId(commit: string) {
  const timestamp = new Date().toISOString().replace(/[^0-9A-Za-z]/g, "");
  return `full-${timestamp}-${commit.slice(0, 12)}-${randomBytes(4).toString("hex")}`.toLowerCase();
}

function buildDatabaseName(runId: string) {
  const parts = runId.split("-");
  const timestamp = parts[1]?.replace(/[^a-z0-9]/g, "").slice(0, 17);
  const commit = parts[2]?.replace(/[^a-z0-9]/g, "").slice(0, 8);
  const nonce = parts[3]?.replace(/[^a-z0-9]/g, "").slice(0, 8);
  const suffix = [timestamp, commit, nonce].filter(Boolean).join("_");
  const databaseName = `${OWNED_ACCEPTANCE_DATABASE_PREFIX}${suffix}`;
  if (!/^wiseeff_acceptance_full_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error(`Cannot build a safe owned runtime database name from ${runId}.`);
  }
  return databaseName;
}

function databaseUrlFor(baseUrl: string, databaseName: string) {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function buildCheckedAbsentDatabaseCreationOperations(
  adminUrl: string,
  databaseName: string,
  owner?: OwnerAwarePostgresDeadline,
): CheckedAbsentDatabaseCreationOperations {
  return {
    databaseExistsBeforeCreate: () => databaseExists(
      adminUrl,
      databaseName,
      owner,
      "checked-absent database creation",
    ),
    createDatabase: () => withOwnerAwarePostgres({
      connectionString: adminUrl,
      owner,
      stage: "checked-absent database creation",
    }, (database) => database.query(
      `create database ${quoteIdentifier(databaseName)}`,
      [],
      "create query",
    ).then(() => undefined)),
    databaseExistsAfterCreateFailure: () => withBoundedDatabaseCreationReconciliation(
      (recoveryOwner) => databaseExists(
        adminUrl,
        databaseName,
        recoveryOwner,
        "database creation failure reconciliation",
      ),
    ),
  };
}

async function databaseExists(
  adminUrl: string,
  databaseName: string,
  owner: OwnerAwarePostgresDeadline | undefined,
  stage: string,
) {
  return withOwnerAwarePostgres({
    connectionString: adminUrl,
    owner,
    stage,
  }, async (database) => {
    const existing = await database.query(
      "select 1 from pg_database where datname = $1",
      [databaseName],
      "presence query",
    );
    return existing.rows.length > 0;
  });
}

async function withBoundedDatabaseCreationReconciliation<T>(
  operation: (owner: OwnerAwarePostgresDeadline) => Promise<T>,
) {
  const timeoutMs = 5_000;
  const controller = new AbortController();
  const deadlineAt = Date.now() + timeoutMs;
  const timer = setTimeout(
    () => controller.abort(new Error("Database creation reconciliation deadline elapsed.")),
    timeoutMs,
  );
  timer.unref();
  try {
    return await operation({
      signal: controller.signal,
      remainingMs(stage) {
        const remaining = deadlineAt - Date.now();
        if (controller.signal.aborted || remaining <= 0) {
          throw new Error(`Database creation reconciliation deadline elapsed before ${stage}.`);
        }
        return remaining;
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function writeAndReadDatabaseMarker(
  databaseUrl: string,
  identity: { runId: string; sourceCommit: string },
  owner?: OwnerAwarePostgresDeadline,
) {
  return withOwnerAwarePostgres({
    connectionString: databaseUrl,
    owner,
    stage: "database marker and seed proof",
  }, async (database) => {
    await database.query(
      `create table ${OWNED_ACCEPTANCE_MARKER_TABLE} (
         purpose text primary key,
         run_id text not null,
         source_commit text not null,
         created_at timestamptz not null default now()
      )`,
      [],
      "marker table create",
    );
    await database.query(
      `insert into ${OWNED_ACCEPTANCE_MARKER_TABLE} (purpose, run_id, source_commit) values ($1, $2, $3)`,
      [OWNED_ACCEPTANCE_MARKER_PURPOSE, identity.runId, identity.sourceCommit],
      "marker insert",
    );
    const migrations = await database.query<{ name: string }>(
      "select name from schema_migrations order by name",
      [],
      "migration evidence query",
    );
    if (migrations.rows.length === 0) throw new Error("Owned runtime migration evidence is empty.");
    const sentinels: Record<string, number> = {};
    for (const table of ["organizations", "users", "projects", "log_records"]) {
      const result = await database.query<{ count: string }>(
        `select count(*)::text as count from ${table}`,
        [],
        `${table} seed sentinel query`,
      );
      sentinels[table] = Number(result.rows[0]?.count ?? 0);
      if (sentinels[table] <= 0) throw new Error(`Owned runtime seed sentinel ${table} is empty.`);
    }
    return {
      appliedCount: migrations.rows.length,
      latestMigration: migrations.rows.at(-1)!.name,
      completedAt: new Date().toISOString(),
      sentinels,
    };
  });
}

async function runNpmScriptWithLog(
  cwd: string,
  script: string,
  env: RuntimeEnv,
  logPath: string,
  owner?: ProvisionOwnedRuntimeOptions["ownerDeadline"],
) {
  owner?.remainingMs(script);
  const processRecord = spawnOwnedProcess({
    cwd,
    command: "npm",
    args: ["run", script],
    env,
    log: logPath,
  });
  const status = await waitForOwnedProcessGroupExit(processRecord.child, { signal: owner?.signal });
  if (status !== 0) throw new Error(`${script} failed with status ${status ?? "unknown"}; see ${logPath}.`);
}

function spawnOwnedProcess(input: {
  label?: "api" | "frontend";
  cwd: string;
  command: string;
  args: string[];
  env: RuntimeEnv;
  port?: number;
  log: string;
}): StartedProcess {
  const fd = openSync(input.log, "a");
  try {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: buildOwnedChildProcessEnv(input.env),
      stdio: ["ignore", fd, fd],
      detached: process.platform !== "win32",
    });
    const command = [input.command, ...input.args].join(" ");
    return {
      label: input.label,
      child,
      port: input.port,
      command,
      log: input.log,
      cleanup: { status: "pending", reason: "Process cleanup has not been attempted." },
    };
  } finally {
    closeSync(fd);
  }
}

export function buildOwnedChildProcessEnv(
  ownedEnv: RuntimeEnv,
  inheritedEnv: RuntimeEnv = process.env,
): RuntimeEnv {
  return buildGate0OwnedChildProcessEnv(ownedEnv, inheritedEnv);
}

async function waitForHttp(
  url: string,
  child: ChildProcess,
  label: string,
  owner?: ProvisionOwnedRuntimeOptions["ownerDeadline"],
) {
  const deadline = Math.min(Date.now() + 90_000, owner?.deadlineAt ?? Number.POSITIVE_INFINITY);
  while (Date.now() < deadline) {
    owner?.remainingMs(`${label} HTTP startup`);
    if (child.exitCode != null) throw new Error(`Owned ${label} process exited with ${child.exitCode}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The exact owned process is still starting.
    }
    await sleepWithAbort(250, owner?.signal);
  }
  throw new Error(`Timed out waiting for owned ${label} runtime at ${url}.`);
}

function sleepWithAbort(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

async function stopOwnedProcesses(processes: StartedProcess[], signal?: AbortSignal) {
  const errors: Error[] = [];
  for (const processRecord of [...processes].reverse()) {
    try {
      await settleBeforeAbort(stopOwnedProcess(processRecord), signal);
      processRecord.cleanup = { status: "stopped", reason: "Exact owned process group stopped and verified absent." };
    } catch (error) {
      processRecord.cleanup = { status: "failed", reason: safeCleanupReason(error) };
      errors.push(asError(error));
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, "One or more owned process trees could not be stopped.");
}

async function stopAndRecordOwnedProcesses(
  processes: StartedProcess[],
  descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1,
  signal?: AbortSignal,
) {
  const errors: Error[] = [];
  for (const [label, processRecord] of ([
    ["frontendProcess", processes.find((entry) => entry.child.pid === descriptor.processes.frontend.pid)],
    ["apiProcess", processes.find((entry) => entry.child.pid === descriptor.processes.api.pid)],
  ] as const)) {
    if (!processRecord) {
      descriptor.cleanup.resources[label] = { status: "failed", reason: "Owned process record is missing." };
      errors.push(new Error(`${label} process record is missing.`));
      continue;
    }
    try {
      const descriptorIdentity = descriptor.processes[
        label === "apiProcess" ? "api" : "frontend"
      ].processIdentity;
      if (
        !processRecord.processIdentity ||
        !sameProcessStartIdentity(processRecord.processIdentity, descriptorIdentity)
      ) {
        throw new Error("Owned process-start identity differs from the persisted descriptor; refusing signal.");
      }
      await settleBeforeAbort(stopOwnedProcess(processRecord), signal);
      descriptor.cleanup.resources[label] = { status: "stopped" };
    } catch (error) {
      descriptor.cleanup.resources[label] = { status: "failed", reason: safeCleanupReason(error) };
      errors.push(asError(error));
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, "One or more owned process trees could not be stopped.");
}

function setRetainedResources(descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1, reason: string) {
  descriptor.cleanup.resources.database = { status: "retained", reason };
  descriptor.cleanup.resources.objectStore = { status: "retained", reason };
}

function retainPendingCleanupResources(descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1, reason: string) {
  for (const resource of ["database", "objectStore", "artifacts"] as const) {
    if (["pending", "verified"].includes(descriptor.cleanup.resources[resource].status)) {
      descriptor.cleanup.resources[resource] = { status: "retained", reason };
    }
  }
}

function safeCleanupReason(error: unknown) {
  return sanitizeGate0DiagnosticText(error instanceof Error ? error.message : String(error)).value
    .replace(/authorization/giu, "credential-header")
    .replace(/auth.?secret/giu, "credential-secret");
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

async function stopOwnedProcess(processRecord: StartedProcess) {
  if (!processRecord.processIdentity) {
    throw new Error("Owned process-start identity is unavailable; refusing signal.");
  }
  await stopOwnedProcessGroup(processRecord.child, {
    expectedProcessIdentity: processRecord.processIdentity,
  });
}

export function assertNestedRuntimesCleanedForSuccess(manifestPath: string) {
  const manifest = readNestedRuntimeManifest(manifestPath);
  const unclean = manifest.children.filter((child) =>
    child.state !== "cleaned" ||
    child.cleanup?.apiProcess.status !== "stopped" ||
    child.cleanup.frontendProcess.status !== "stopped" ||
    child.cleanup.database.status !== "removed" ||
    child.cleanup.objectStore.status !== "removed"
  );
  if (unclean.length > 0) {
    throw new Error(`Nested runtimes are not clean for Gate0 success: ${unclean.map((child) => `${child.id}:${child.state}`).join(", ")}.`);
  }
}

export async function finalizeRunningNestedRuntimesAfterFailure(
  manifestPath: string,
  retentionReason: string,
  options: StopOwnedProcessGroupOptions & {
    signal?: AbortSignal;
    stopProcessGroup?: (pid: number, options?: StopOwnedProcessGroupOptions) => Promise<void>;
    verifyProcessIdentity?: (pid: number, expected: ProcessStartIdentity) => boolean | Promise<boolean>;
  } = {},
) {
  const manifest = readNestedRuntimeManifest(manifestPath);
  const errors: Error[] = [];
  const stopProcessGroup = options.stopProcessGroup ?? stopOwnedProcessGroup;
  const verifyProcessIdentity = options.verifyProcessIdentity ?? ((pid, expected) =>
    sameProcessStartIdentity(expected, readProcessStartIdentity(pid)));
  const safeRetentionReason = safeCleanupReason(retentionReason);
  for (const child of manifest.children.filter((entry) =>
    entry.state === "provisioning" || entry.state === "running" || entry.state === "cleanup-failed"
  )) {
    const cleanup: NestedRuntimeCleanup = {
      apiProcess: { status: "failed" as const, reason: "Nested API process cleanup did not settle." },
      frontendProcess: { status: "failed" as const, reason: "Nested frontend process cleanup did not settle." },
      database: child.cleanup?.database ?? { status: "retained" as const, reason: safeRetentionReason },
      objectStore: child.cleanup?.objectStore ?? { status: "retained" as const, reason: safeRetentionReason },
    };
    for (const [label, pid, identity] of [
      ["apiProcess", child.apiPid, child.apiProcessIdentity],
      ["frontendProcess", child.frontendPid, child.frontendProcessIdentity],
    ] as const) {
      if (child.cleanup?.[label].status === "stopped") {
        cleanup[label] = { status: "stopped" };
        continue;
      }
      if (pid === undefined) {
        cleanup[label] = { status: "not-started" };
        continue;
      }
      try {
        if (!identity || identity.pid !== pid || !(await verifyProcessIdentity(pid, identity))) {
          throw new Error(`Nested ${label} process identity is missing or no longer matches PID ${pid}; refusing signal.`);
        }
        await settleBeforeAbort(stopProcessGroup(pid, {
          ...options,
          expectedProcessIdentity: identity,
        }), options.signal);
        cleanup[label] = { status: "stopped" };
      } catch (error) {
        cleanup[label] = { status: "failed", reason: safeCleanupReason(error) };
        errors.push(asError(error));
      }
    }
    const processesSettled = cleanup.apiProcess.status !== "failed" && cleanup.frontendProcess.status !== "failed";
    const resourcesRetained = cleanup.database.status === "retained" && cleanup.objectStore.status === "retained";
    if (!resourcesRetained) {
      errors.push(new Error(`Nested runtime ${child.id} has partial resource cleanup and cannot be marked retained.`));
    }
    recordNestedRuntimeFinish(
      manifestPath,
      child.id,
      processesSettled && resourcesRetained
        ? "failed-retained"
        : "cleanup-failed",
      cleanup,
    );
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "One or more nested runtime finalizations did not settle.");
  }
}

function settleBeforeAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) {
    return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("Gate0 finalization deadline elapsed."));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(
      signal.reason instanceof Error ? signal.reason : new Error("Gate0 finalization deadline elapsed."),
    );
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

async function allocateAllowedLoopbackPort(
  range: { min: number; max: number },
  owner?: ProvisionOwnedRuntimeOptions["ownerDeadline"],
) {
  for (let port = range.min; port <= range.max; port += 1) {
    owner?.remainingMs("loopback port allocation");
    const available = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error(`No owned loopback port is available in ${range.min}-${range.max}.`);
}

function checkpointOwner(options: ProvisionOwnedRuntimeOptions, stage: string) {
  options.ownerDeadline?.remainingMs(stage);
}

export function buildOwnedRuntimeEnv(input: {
  databaseUrl: string;
  objectRoot: string;
  apiUrl: string;
  frontendUrl: string;
  apiPort: number;
  authIssuer: string;
  authSecret: string;
  descriptorPath: string;
  runId: string;
  sourceCommit: string;
  runRoot: string;
  nestedRuntimeManifest: string;
}): RuntimeEnv {
  const authorization = createOwnedAcceptanceAuthorization(input.authIssuer, input.authSecret);
  return {
    NODE_ENV: "development",
    DATABASE_URL: input.databaseUrl,
    TEST_DATABASE_URL: input.databaseUrl,
    HOST: "127.0.0.1",
    PORT: String(input.apiPort),
    AUTH_MODE: "production",
    AUTH_PROVIDER: "hmac",
    AUTH_TOKEN_ISSUER: input.authIssuer,
    AUTH_TOKEN_HMAC_SECRET: input.authSecret,
    M5_SMOKE_AUTHORIZATION: authorization,
    WISEEFF_SMOKE_AUTHORIZATION: authorization,
    VITE_WISEEFF_API_AUTHORIZATION: authorization,
    OBJECT_STORE_MODE: "local",
    OBJECT_STORE_ROOT: input.objectRoot,
    XIAOZE_DETERMINISTIC: "true",
    XIAOZE_PROACTIVE_ENABLED: "true",
    LOG_ANALYSIS_DETERMINISTIC: "true",
    LOG_WEBHOOK_ALLOW_INSECURE_LOCAL: "true",
    DEBUG_DEVICE_GATEWAY_MODE: "simulator",
    HDC_DEVICE_LAB_AVAILABLE: "false",
    DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: "true",
    VITE_WISEEFF_RUNTIME_MODE: "api",
    WISEEFF_API_BASE_URL: input.apiUrl,
    VITE_WISEEFF_API_BASE_URL: input.apiUrl,
    WISEEFF_ACCEPTANCE_FRONTEND_URL: input.frontendUrl,
    VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED: "true",
    VITE_XIAOZE_PROACTIVE_ENABLED: "false",
    M5_CONTRACT_CHECK_PASSED: "true",
    M5_SMOKE_ALLOW_NO_API: "false",
    WISEEFF_ACCEPTANCE_NO_START_RUNTIME: "true",
    WISEEFF_QUALITY_SKIP_SEED: "true",
    [OWNED_ACCEPTANCE_DESCRIPTOR_ENV]: input.descriptorPath,
    [OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV]: input.nestedRuntimeManifest,
    WISEEFF_ACCEPTANCE_EVIDENCE_ROOT: path.join(input.runRoot, "operation-evidence"),
    WISEEFF_ACCEPTANCE_EVIDENCE_RUN_ID: input.runId,
    WISEEFF_ACCEPTANCE_EVIDENCE_SOURCE_COMMIT: input.sourceCommit,
    WISEEFF_ACCEPTANCE_EVIDENCE_RUN_KIND: "full",
    WISEEFF_ACCEPTANCE_DEFER_LATEST_PUBLISH: "true",
    ...buildOwnedRuntimeArtifactEnv(input.runRoot),
  };
}

export function createOwnedAcceptanceAuthorization(issuer: string, secret: string) {
  const payload = Buffer.from(
    JSON.stringify({
      iss: issuer,
      sub: "u-xu-yun",
      org: "org-chargelab",
      name: "Xu Yun",
      email: "xu@chargelab.cn",
      title: "Acceptance User",
      orgName: "ChargeLab",
      roles: [],
      permissions: [],
      isActive: true,
      nbf: 0,
      exp: 9_999_999_999,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `Bearer ${payload}.${signature}`;
}

async function verifyDatabaseCleanupMarker(
  databaseUrl: string,
  descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1,
  owner?: OwnerAwarePostgresDeadline,
) {
  await withOwnerAwarePostgres({
    connectionString: databaseUrl,
    owner,
    stage: "database cleanup marker verification",
  }, async (database) => {
    const result = await database.query<{ database_name: string; run_id: string; source_commit: string; purpose: string }>(
      `select current_database() as database_name, run_id, source_commit, purpose
       from ${OWNED_ACCEPTANCE_MARKER_TABLE}
       where purpose = $1`,
      [OWNED_ACCEPTANCE_MARKER_PURPOSE],
      "marker query",
    );
    const row = result.rows[0];
    if (
      result.rows.length !== 1 ||
      row?.database_name !== descriptor.database.name ||
      row.run_id !== descriptor.run.id ||
      row.source_commit !== descriptor.run.sourceCommit
    ) {
      throw new Error("Refusing cleanup: owned database marker mismatch.");
    }
  });
}

function verifyObjectRootForCleanup(descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1) {
  if (descriptor.cleanup.exactObjectStoreRoot !== descriptor.objectStore.root) {
    throw new Error("Refusing cleanup: object root target mismatch.");
  }
  const stat = lstatSync(descriptor.objectStore.root);
  if (stat.isSymbolicLink()) throw new Error("Refusing cleanup: object root is a symbolic link.");
  const runRoot = realpathSync(descriptor.artifacts.runRoot);
  const objectRoot = realpathSync(descriptor.objectStore.root);
  assertPathWithinWorktree(runRoot, objectRoot, "object root cleanup target");
  const marker = lstatSync(descriptor.objectStore.markerFile);
  if (marker.isSymbolicLink()) throw new Error("Refusing cleanup: object marker is a symbolic link.");
  const markerContent = readFileSync(descriptor.objectStore.markerFile, "utf8");
  if (sha256(markerContent) !== descriptor.objectStore.markerSha256) {
    throw new Error("Refusing cleanup: object marker digest mismatch.");
  }
  const markerIdentity = JSON.parse(markerContent) as { runId?: string; sourceCommit?: string };
  if (
    markerIdentity.runId !== descriptor.run.id ||
    markerIdentity.sourceCommit !== descriptor.run.sourceCommit
  ) {
    throw new Error("Refusing cleanup: object marker run/source mismatch.");
  }
}

async function dropExactDatabase(
  adminUrl: string,
  databaseName: string,
  owner?: OwnerAwarePostgresDeadline,
) {
  if (!/^wiseeff_acceptance_full_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error(`Refusing destructive cleanup for database ${databaseName}.`);
  }
  await withOwnerAwarePostgres({
    connectionString: adminUrl,
    owner,
    stage: "exact database cleanup",
  }, (database) => database.query(
    `drop database ${quoteIdentifier(databaseName)} with (force)`,
    [],
    "drop query",
  ).then(() => undefined));
}

async function assertDatabaseAbsent(
  adminUrl: string,
  databaseName: string,
  owner?: OwnerAwarePostgresDeadline,
) {
  await withOwnerAwarePostgres({
    connectionString: adminUrl,
    owner,
    stage: "database absence verification",
  }, async (database) => {
    const result = await database.query(
      "select 1 from pg_database where datname = $1",
      [databaseName],
      "absence query",
    );
    if (result.rows.length > 0) throw new Error(`Owned runtime database still exists after cleanup: ${databaseName}`);
  });
}

function writeDescriptor(descriptorPath: string, descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1) {
  assertOwnedRuntimeDescriptor(descriptor);
  writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
}

function writeOperationEvidenceRuntimeSnapshot(
  snapshotPath: string,
  descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1,
) {
  const snapshot = {
    version: 1,
    kind: "wiseeff-owned-local-acceptance-operation-evidence-runtime",
    run: {
      id: descriptor.run.id,
      sourceCommit: descriptor.run.sourceCommit,
      worktreeRoot: descriptor.run.worktreeRoot,
      ownerPid: descriptor.run.ownerPid,
      createdAt: descriptor.run.createdAt,
    },
    database: {
      name: descriptor.database.name,
      connection: descriptor.database.connection,
      marker: descriptor.database.marker,
      migration: descriptor.database.migration,
      seed: descriptor.database.seed,
    },
    objectStore: {
      root: descriptor.objectStore.root,
      markerFile: descriptor.objectStore.markerFile,
      markerSha256: descriptor.objectStore.markerSha256,
    },
    endpoints: descriptor.endpoints,
    processes: descriptor.processes,
    auth: descriptor.auth,
    runtime: descriptor.runtime,
    artifacts: {
      runRoot: descriptor.artifacts.runRoot,
      descriptor: descriptor.artifacts.descriptor,
    },
  };
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export function buildProvisionFailureRecord(input: {
    runId: string;
    sourceCommit: string;
    databaseName?: string;
    databaseCreationEvidence?: CheckedAbsentDatabaseCreationEvidence;
    objectRoot?: string;
    processes: ProvisionFailureProcessRecord[];
    errors: Error[];
  }) {
  return {
    kind: "wiseeff-owned-local-acceptance-provision-failure" as const,
    runId: input.runId,
    sourceCommit: input.sourceCommit,
    intendedDatabaseName: input.databaseCreationEvidence?.intendedDatabaseName,
    retainedDatabaseName: input.databaseName,
    databaseOwnership: input.databaseCreationEvidence ? {
      state: input.databaseCreationEvidence.state,
      presenceAfterCreateFailure: input.databaseCreationEvidence.presenceAfterCreateFailure,
      markerStatus: input.databaseCreationEvidence.ownership,
      uncertainty: input.databaseCreationEvidence.ownership === "unverified-no-marker"
        ? "No owned database marker was verified; destructive cleanup is refused until exact marker proof succeeds."
        : undefined,
    } : undefined,
    retainedObjectRoot: input.objectRoot,
    processes: input.processes.map((process) => ({
      ...process,
      command: safeCleanupReason(process.command),
      log: safeCleanupReason(process.log),
      cleanup: {
        status: process.cleanup.status,
        reason: safeCleanupReason(process.cleanup.reason),
      },
    })),
    failures: input.errors.map((error, index) => ({
      stage: index === 0 ? "provision" : "process-cleanup",
      message: safeCleanupReason(error),
    })),
    recordedAt: new Date().toISOString(),
  };
}

function writeProvisionFailure(
  runRoot: string,
  input: Parameters<typeof buildProvisionFailureRecord>[0],
) {
  writeFileSync(
    path.join(runRoot, "provision-failure.json"),
    `${JSON.stringify(buildProvisionFailureRecord(input), null, 2)}\n`,
    "utf8",
  );
}

function writeDatabaseCreationJournal(
  journalPath: string,
  input: {
    runId: string;
    sourceCommit: string;
    evidence: CheckedAbsentDatabaseCreationEvidence;
  },
) {
  const temporaryPath = `${journalPath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify({
      kind: "wiseeff-owned-local-acceptance-database-creation",
      runId: input.runId,
      sourceCommit: input.sourceCommit,
      ...input.evidence,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temporaryPath, journalPath);
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function provisionFailureProcessRecord(process: StartedProcess): ProvisionFailureProcessRecord {
  if (!process.label || process.port === undefined) {
    throw new Error("Provision failure process record requires an API/frontend label and owned port.");
  }
  return {
    label: process.label,
    pid: process.child.pid,
    port: process.port,
    command: process.command,
    log: process.log,
    processIdentity: process.processIdentity,
    cleanup: process.cleanup,
  };
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function requirePid(child: ChildProcess, label: string) {
  if (!child.pid) throw new Error(`Owned ${label} process did not expose a PID.`);
  return child.pid;
}

function requireProcessStartIdentity(child: ChildProcess, label: string) {
  const identity = readProcessStartIdentity(requirePid(child, label));
  if (!identity) throw new Error(`Owned ${label} process-start identity is unavailable.`);
  return identity;
}

function requireStartedProcessIdentity(processRecord: StartedProcess, label: string) {
  if (!processRecord.processIdentity) {
    throw new Error(`Owned ${label} process-start identity is unavailable.`);
  }
  return processRecord.processIdentity;
}

function assertPathWithinWorktree(parent: string, child: string, label: string) {
  const relative = path.relative(parent, child);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Owned ${label} must be a strict descendant of ${parent}.`);
  }
}

function ensureExistingAncestorsAreNotSymlinks(root: string, target: string) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Owned runtime path escapes the source worktree.");
  }
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Owned runtime path contains symbolic link ${current}.`);
    }
  }
}
