import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";

import {
  loadOwnedRuntimeDescriptor,
  type OwnedLocalAcceptanceRuntimeDescriptorV1,
} from "../e2e/acceptance/helpers/ownedRuntimeDescriptor";
import {
  readNestedRuntimeManifest,
  type NestedRuntimeProcessIdentity,
} from "../e2e/acceptance/helpers/nestedRuntimeManifest";
import {
  sanitizeGate0ArtifactTree,
  scanGate0ArtifactTree,
  loadGate0PersistedExactValuesForSnapshot,
  retireGate0PersistedExactValuesAfterSnapshot,
  gate0SecretValuesFromEnv,
  type Gate0ArtifactSanitization,
  type Gate0ArtifactScan,
} from "./gate0-artifact-sanitizer";
import {
  stopOwnedProcessGroup,
  type StopOwnedProcessGroupOptions,
} from "./owned-process-group";
import {
  readProcessStartIdentity,
  sameProcessStartIdentity,
  type ProcessStartIdentity,
} from "./process-start-identity";

type OwnedWriter = {
  label: string;
  pid: number;
  processIdentity: ProcessStartIdentity;
};

export type FinalizeGate0UploadSnapshotOptions = {
  runsRoot: string;
  uploadRoot: string;
  signal?: AbortSignal;
  stopOptions?: StopOwnedProcessGroupOptions;
};

export type Gate0UploadSnapshotResult = {
  archivePath: string;
  writersStopped: number;
  sanitization: Gate0ArtifactSanitization;
  scan: Gate0ArtifactScan;
};

/**
 * Fresh-process Gate0 evidence finalizer. It first takes over every writer that
 * has a durable process-start identity, retains DB/object evidence, and only
 * then publishes a read-only sibling snapshot for CI upload.
 */
export async function finalizeGate0UploadSnapshot(
  options: FinalizeGate0UploadSnapshotOptions,
): Promise<Gate0UploadSnapshotResult> {
  const runsRoot = requireDirectory(options.runsRoot, "Gate0 live runs root");
  const archivePath = path.resolve(options.uploadRoot);
  if (path.extname(archivePath).toLowerCase() !== ".zip") {
    throw new Error("Gate0 upload snapshot must be one exact ZIP archive.");
  }
  assertSeparateSnapshotPath(runsRoot, archivePath);
  const descriptors = loadRootDescriptors(runsRoot);
  await assertOwnersExited(descriptors, options.stopOptions);
  await preflightWriterIdentities([
    ...phaseWriters(descriptors),
    ...discoverOwnedWriters(runsRoot),
  ], options.stopOptions);
  await stopPhaseWriters(descriptors, options);
  const writers = discoverOwnedWriters(runsRoot);
  await preflightWriterIdentities(writers, options.stopOptions);
  for (const writer of writers) {
    throwIfAborted(options.signal);
    await stopOwnedProcessGroup(writer.pid, {
      ...options.stopOptions,
      expectedProcessIdentity: writer.processIdentity,
    });
  }

  throwIfAborted(options.signal);
  await assertOwnersExited(loadRootDescriptors(runsRoot), options.stopOptions);
  const exactValues = [...new Set([
    ...gate0SecretValuesFromEnv(),
    ...loadGate0PersistedExactValuesForSnapshot(runsRoot),
  ])];
  if (existsSync(archivePath)) {
    const scan = await verifyPublishedArchive(archivePath, exactValues, descriptors, options.signal);
    retireGate0PersistedExactValuesAfterSnapshot(runsRoot);
    return {
      archivePath,
      writersStopped: writers.length,
      sanitization: { filesScanned: 0, archivesScanned: 0, filesChanged: 0, replacements: 0 },
      scan,
    };
  }
  const sanitization = await sanitizeGate0ArtifactTree(runsRoot, options.signal, exactValues);
  const liveScan = await scanGate0ArtifactTree(
    runsRoot,
    options.signal,
    exactValues,
    { retirePersistedExactValues: false },
  );
  if (liveScan.violations.length > 0) {
    throw new Error(`Gate0 live artifact safety found ${liveScan.violations.length} violation(s); refusing upload.`);
  }

  const uploadParent = path.dirname(archivePath);
  mkdirSync(uploadParent, { recursive: true });
  assertRegularDirectory(uploadParent, "Gate0 upload snapshot parent");
  const stagingParent = mkdtempSync(path.join(uploadParent, ".gate0-upload-staging-"));
  const staging = path.join(stagingParent, "tree");
  mkdirSync(staging, { mode: 0o700 });
  const archiveCandidateParent = mkdtempSync(path.join(uploadParent, ".gate0-upload-archive-"));
  const archiveCandidate = path.join(archiveCandidateParent, path.basename(archivePath));
  try {
    copyTreeContents(runsRoot, staging);
    writeFileSync(path.join(staging, "gate0-upload-snapshot.json"), `${JSON.stringify({
      version: 1,
      kind: "wiseeff-gate0-immutable-upload-snapshot",
      writerPolicy: "all-persisted-process-start-identities-stopped",
      writersStopped: writers.length,
      resources: {
        database: "retained-for-failure-evidence",
        objectStore: "retained-for-failure-evidence",
      },
      runs: canonicalRunIdentities(descriptors),
    }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });

    await sanitizeGate0ArtifactTree(staging, options.signal, exactValues);
    const stagingScan = await scanGate0ArtifactTree(staging, options.signal, exactValues);
    if (stagingScan.violations.length > 0) {
      throw new Error(`Gate0 upload staging tree has ${stagingScan.violations.length} violation(s); refusing publication.`);
    }
    await writeZipArchive(staging, archiveCandidate);
    const scan = await scanGate0ArtifactTree(archiveCandidateParent, options.signal, exactValues);
    if (scan.violations.length > 0) {
      throw new Error(`Gate0 upload snapshot has ${scan.violations.length} violation(s); refusing publication.`);
    }
    chmodSync(archiveCandidate, 0o444);
    fsyncFile(archiveCandidate);
    renameSync(archiveCandidate, archivePath);
    fsyncDirectory(uploadParent);
    retireGate0PersistedExactValuesAfterSnapshot(runsRoot);
    return { archivePath, writersStopped: writers.length, sanitization, scan };
  } finally {
    rmSync(stagingParent, { force: true, recursive: true });
    rmSync(archiveCandidateParent, { force: true, recursive: true });
  }
}

function loadRootDescriptors(runsRoot: string) {
  const runRoots = readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => {
      if (entry.isSymbolicLink()) throw new Error("Gate0 live runs root contains a symbolic link.");
      return entry.isDirectory();
    })
    .map((entry) => path.join(runsRoot, entry.name));
  const descriptors = runRoots.map((runRoot) => {
      const descriptorPath = path.join(runRoot, "runtime.json");
      if (!existsSync(descriptorPath)) {
        throw new Error(`Gate0 run ${path.basename(runRoot)} lacks a complete owned runtime descriptor; refusing upload.`);
      }
      const descriptor = loadOwnedRuntimeDescriptor(descriptorPath);
      assertRunRootInside(runsRoot, descriptor);
      if (path.resolve(descriptor.artifacts.runRoot) !== path.resolve(runRoot)) {
        throw new Error("Owned runtime descriptor is not bound to its canonical run directory.");
      }
      const nestedPath = path.join(runRoot, "nested-runtime-manifest.json");
      if (path.resolve(descriptor.artifacts.nestedRuntimeManifest) !== path.resolve(nestedPath)) {
        throw new Error("Nested runtime manifest path does not match the descriptor identity.");
      }
      const nested = readNestedRuntimeManifest(nestedPath);
      if (nested.parentRunId !== descriptor.run.id || nested.sourceCommit !== descriptor.run.sourceCommit) {
        throw new Error("Nested runtime manifest does not match its parent run/source identity.");
      }
      return descriptor;
    });
  const canonicalNested = new Set(descriptors.map((descriptor) => path.resolve(descriptor.artifacts.nestedRuntimeManifest)));
  for (const nestedPath of listRegularFiles(runsRoot)
    .filter((filePath) => path.basename(filePath) === "nested-runtime-manifest.json")) {
    if (!canonicalNested.has(path.resolve(nestedPath))) {
      throw new Error("Gate0 artifact tree contains a non-canonical nested runtime manifest.");
    }
  }
  return descriptors;
}

async function assertOwnersExited(
  descriptors: readonly OwnedLocalAcceptanceRuntimeDescriptorV1[],
  stopOptions: StopOwnedProcessGroupOptions = {},
) {
  const processGroupExists = stopOptions.processGroupExists ?? defaultProcessExists;
  const readIdentity = stopOptions.readProcessIdentity ?? readProcessStartIdentity;
  for (const descriptor of descriptors) {
    if (!(await processGroupExists(descriptor.run.ownerPid))) continue;
    const current = readIdentity(descriptor.run.ownerPid);
    if (!current) {
      throw new Error(`Gate0 owner ${descriptor.run.ownerPid} identity is unknown; refusing upload.`);
    }
    if (sameProcessStartIdentity(descriptor.run.ownerProcessIdentity, current)) {
      throw new Error(`Gate0 owner ${descriptor.run.ownerPid} is still alive; refusing upload.`);
    }
  }
}

async function stopPhaseWriters(
  descriptors: readonly OwnedLocalAcceptanceRuntimeDescriptorV1[],
  options: FinalizeGate0UploadSnapshotOptions,
) {
  for (const descriptor of descriptors) {
    for (const phaseName of ["visual", "browser"] as const) {
      const phase = descriptor.phases[phaseName];
      if (phase.status === "launching") {
        throw new Error(`Gate0 ${phaseName} phase launch did not publish a process-start identity; refusing upload.`);
      }
      if (phase.status === "running" && !phase.process) {
        throw new Error(`Gate0 running ${phaseName} phase lacks a process-start identity; refusing upload.`);
      }
      if (!phase.process) continue;
      await stopOwnedProcessGroup(phase.process.pid, {
        ...options.stopOptions,
        expectedProcessIdentity: phase.process.processIdentity,
      });
    }
  }
}

function phaseWriters(descriptors: readonly OwnedLocalAcceptanceRuntimeDescriptorV1[]) {
  const writers: OwnedWriter[] = [];
  for (const descriptor of descriptors) {
    for (const phaseName of ["visual", "browser"] as const) {
      const phase = descriptor.phases[phaseName];
      if (phase.process) writers.push({
        label: `phase ${descriptor.run.id} ${phaseName}`,
        pid: phase.process.pid,
        processIdentity: phase.process.processIdentity,
      });
    }
  }
  return writers;
}

async function preflightWriterIdentities(
  writers: readonly OwnedWriter[],
  stopOptions: StopOwnedProcessGroupOptions = {},
) {
  const processGroupExists = stopOptions.processGroupExists ?? defaultProcessGroupExists;
  const readIdentity = stopOptions.readProcessIdentity ?? readProcessStartIdentity;
  for (const writer of uniqueOwnedWriters([...writers])) {
    if (!(await processGroupExists(writer.pid))) continue;
    const current = readIdentity(writer.pid);
    if (!sameProcessStartIdentity(writer.processIdentity, current)) {
      throw new Error(`${writer.label} process-start identity is unknown or changed; refusing all signals.`);
    }
  }
}

function discoverOwnedWriters(runsRoot: string) {
  const writers: OwnedWriter[] = [];
  for (const descriptor of loadRootDescriptors(runsRoot)) {
    writers.push(
      writerFromRootDescriptor(descriptor, "api"),
      writerFromRootDescriptor(descriptor, "frontend"),
    );
    const manifestPath = descriptor.artifacts.nestedRuntimeManifest;
    const manifest = readNestedRuntimeManifest(manifestPath);
    for (const child of manifest.children) {
      const active = ["provisioning", "running", "cleanup-failed"].includes(child.state);
      if (active && (
        !child.apiPid || !child.apiProcessIdentity ||
        !child.frontendPid || !child.frontendProcessIdentity
      )) {
        throw new Error(`Nested runtime ${child.id} has unresolved writer identity; refusing upload.`);
      }
      writers.push(...writerFromNestedProcess(child.id, "api", child.apiPid, child.apiProcessIdentity));
      writers.push(...writerFromNestedProcess(
        child.id,
        "frontend",
        child.frontendPid,
        child.frontendProcessIdentity,
      ));
    }
    const failurePath = path.join(descriptor.artifacts.runRoot, "provision-failure.json");
    if (existsSync(failurePath)) writers.push(...writersFromProvisionFailure(failurePath, descriptor));
  }
  return uniqueOwnedWriters(writers);
}

function writerFromRootDescriptor(
  descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1,
  label: "api" | "frontend",
): OwnedWriter {
  const process = descriptor.processes[label];
  return {
    label: `root ${descriptor.run.id} ${label}`,
    pid: process.pid,
    processIdentity: process.processIdentity,
  };
}

function writerFromNestedProcess(
  childId: string,
  label: "api" | "frontend",
  pid: number | undefined,
  identity: NestedRuntimeProcessIdentity | undefined,
): OwnedWriter[] {
  if (pid === undefined && identity === undefined) return [];
  if (!pid || !identity || identity.pid !== pid) {
    throw new Error(`Nested runtime ${childId} ${label} writer lacks an exact process-start identity.`);
  }
  assertProcessStartIdentity(identity, `Nested runtime ${childId} ${label}`);
  return [{ label: `nested ${childId} ${label}`, pid, processIdentity: identity }];
}

function writersFromProvisionFailure(
  failurePath: string,
  descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1,
): OwnedWriter[] {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(failurePath, "utf8")) as unknown;
  } catch {
    throw new Error("Gate0 provision-failure writer record is malformed.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Gate0 provision-failure writer record is invalid.");
  }
  const failure = value as { kind?: unknown; runId?: unknown; sourceCommit?: unknown; processes?: unknown };
  if (
    failure.kind !== "wiseeff-owned-local-acceptance-provision-failure" ||
    failure.runId !== descriptor.run.id || failure.sourceCommit !== descriptor.run.sourceCommit ||
    !Array.isArray(failure.processes)
  ) {
    throw new Error("Gate0 provision-failure writer record identity is invalid.");
  }
  return failure.processes.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Gate0 provision-failure process record is invalid.");
    }
    const process = entry as { label?: unknown; pid?: unknown; processIdentity?: unknown };
    if (process.pid === undefined) return [];
    if (!Number.isSafeInteger(process.pid) || Number(process.pid) <= 0) {
      throw new Error("Gate0 provision-failure process PID is invalid.");
    }
    assertProcessStartIdentity(process.processIdentity, `Provision-failure process ${index}`);
    return [{
      label: `provision failure ${failure.runId} ${String(process.label ?? index)}`,
      pid: Number(process.pid),
      processIdentity: process.processIdentity as ProcessStartIdentity,
    }];
  });
}

function uniqueOwnedWriters(writers: OwnedWriter[]) {
  const byPid = new Map<number, OwnedWriter>();
  for (const writer of writers) {
    const prior = byPid.get(writer.pid);
    if (
      prior &&
      (prior.processIdentity.startToken !== writer.processIdentity.startToken ||
        prior.processIdentity.commandSha256 !== writer.processIdentity.commandSha256)
    ) {
      throw new Error(`Conflicting persisted process-start identities for PID ${writer.pid}; refusing upload.`);
    }
    if (!prior) byPid.set(writer.pid, writer);
  }
  return [...byPid.values()].sort((left, right) => left.pid - right.pid || left.label.localeCompare(right.label));
}

function assertProcessStartIdentity(value: unknown, label: string): asserts value is ProcessStartIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} lacks an exact process-start identity.`);
  }
  const identity = value as Partial<ProcessStartIdentity>;
  if (!identity.startToken || !/^[a-f0-9]{64}$/u.test(identity.commandSha256 ?? "")) {
    throw new Error(`${label} has an invalid process-start identity.`);
  }
}

function assertRunRootInside(runsRoot: string, descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1) {
  const runRoot = path.resolve(descriptor.artifacts.runRoot);
  if (!isDescendant(runsRoot, runRoot)) {
    throw new Error("Owned runtime descriptor run root escapes the live runs root.");
  }
}

function copyTreeContents(source: string, destination: string) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (isExactValueRegistryArtifact(entry.name)) continue;
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Gate0 live artifact tree contains a symbolic link.");
    if (entry.isDirectory()) {
      mkdirSync(destinationPath, { mode: 0o700 });
      copyTreeContents(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      cpSync(sourcePath, destinationPath, {
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
      });
    } else {
      throw new Error("Gate0 live artifact tree contains a non-regular entry.");
    }
  }
}

async function writeZipArchive(treeRoot: string, archivePath: string) {
  const zip = new JSZip();
  for (const filePath of listRegularFiles(treeRoot)) {
    const relativePath = path.relative(treeRoot, filePath).split(path.sep).join("/");
    const stat = lstatSync(filePath);
    zip.file(relativePath, Buffer.from(readFileSync(filePath, "base64"), "base64"), {
      binary: true,
      date: stat.mtime,
      unixPermissions: stat.mode & 0o777,
    });
  }
  writeFileSync(archivePath, await zip.generateAsync({
    type: "nodebuffer",
    platform: process.platform === "win32" ? "DOS" : "UNIX",
    compression: "STORE",
  }), { flag: "wx", mode: 0o600 });
}

async function verifyPublishedArchive(
  archivePath: string,
  exactValues: readonly string[],
  descriptors: readonly OwnedLocalAcceptanceRuntimeDescriptorV1[],
  signal?: AbortSignal,
) {
  const stat = lstatSync(archivePath);
  if (
    stat.isSymbolicLink() || !stat.isFile() ||
    (process.platform !== "win32" && (stat.mode & 0o222) !== 0)
  ) {
    throw new Error("Existing Gate0 upload archive is not a read-only regular file.");
  }
  const zip = await JSZip.loadAsync(Buffer.from(readFileSync(archivePath, "base64"), "base64"));
  const snapshotEntry = zip.file("gate0-upload-snapshot.json");
  if (!snapshotEntry) throw new Error("Existing Gate0 upload archive lacks its snapshot identity.");
  let snapshot: { version?: unknown; kind?: unknown; runs?: unknown };
  try {
    snapshot = JSON.parse(await snapshotEntry.async("string")) as typeof snapshot;
  } catch {
    throw new Error("Existing Gate0 upload archive snapshot identity is malformed.");
  }
  if (
    snapshot.version !== 1 ||
    snapshot.kind !== "wiseeff-gate0-immutable-upload-snapshot" ||
    JSON.stringify(snapshot.runs) !== JSON.stringify(canonicalRunIdentities(descriptors))
  ) {
    throw new Error("Existing Gate0 upload archive snapshot identity is invalid.");
  }
  const verificationRoot = mkdtempSync(path.join(path.dirname(archivePath), ".gate0-upload-verify-"));
  try {
    cpSync(archivePath, path.join(verificationRoot, path.basename(archivePath)), {
      errorOnExist: true,
      force: false,
    });
    const scan = await scanGate0ArtifactTree(verificationRoot, signal, exactValues);
    if (scan.violations.length > 0) {
      throw new Error(`Existing Gate0 upload archive has ${scan.violations.length} violation(s).`);
    }
    return scan;
  } finally {
    rmSync(verificationRoot, { force: true, recursive: true });
  }
}

function canonicalRunIdentities(descriptors: readonly OwnedLocalAcceptanceRuntimeDescriptorV1[]) {
  return descriptors
    .map((descriptor) => ({ runId: descriptor.run.id, sourceCommit: descriptor.run.sourceCommit }))
    .sort((left, right) => left.runId.localeCompare(right.runId) || left.sourceCommit.localeCompare(right.sourceCommit));
}

function fsyncFile(filePath: string) {
  const descriptor = openSync(filePath, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function fsyncDirectory(directory: string) {
  if (process.platform === "win32") return;
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function listRegularFiles(root: string, treeRoot = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Gate0 live artifact tree contains a symbolic link.");
    if (entry.isDirectory()) files.push(...listRegularFiles(entryPath, treeRoot));
    else if (entry.isFile()) files.push(entryPath);
    else throw new Error("Gate0 live artifact tree contains a non-regular entry.");
  }
  return files;
}

function requireDirectory(directory: string, label: string) {
  const resolved = path.resolve(directory);
  assertRegularDirectory(resolved, label);
  return resolved;
}

function assertRegularDirectory(directory: string, label: string) {
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} must be a regular directory.`);
}

function assertSeparateSnapshotPath(runsRoot: string, uploadRoot: string) {
  if (runsRoot === uploadRoot || isDescendant(runsRoot, uploadRoot) || isDescendant(uploadRoot, runsRoot)) {
    throw new Error("Gate0 upload snapshot must be outside the live runs root.");
  }
}

function isExactValueRegistryArtifact(name: string) {
  return name === ".gate0-exact-values.v1.enc.json" ||
    name === ".gate0-exact-values.v1.enc.json.retiring" ||
    /^\.gate0-exact-values\.v1\.enc\.json\.[a-f0-9-]{36}\.tmp$/iu.test(name);
}

function defaultProcessExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    throw error;
  }
}

function defaultProcessGroupExists(pid: number) {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    throw error;
  }
}

function isDescendant(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason;
}

function parseArgs(argv: string[]) {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    const candidate = index >= 0 ? argv[index + 1]?.trim() : undefined;
    if (!candidate) throw new Error(`${flag} is required.`);
    return candidate;
  };
  return { runsRoot: value("--root"), uploadRoot: value("--output") };
}

async function main() {
  const result = await finalizeGate0UploadSnapshot(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Gate0 upload snapshot finalization failed.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
