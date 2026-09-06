import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogUpgradeController, ControllerCommand } from "./controller";
import { canonicalJson, sha256Prefixed } from "./journal";
import { parseEnvText } from "../ip-lab-profile";

type Docker = { daemonId: string; command(args: string[]): Buffer };
type Artifact = { sha: string; tree: string };
export type HandoffInputs = {
  runId: string; expectedDaemonId: string;
  entrypoint: Artifact & { checkout: string };
  source: { checkout: string; sha: string; composeFile: string; project: string;
    applications: { service: "api" | "worker" | "web"; containerId: string; imageId: string; imageReference: string }[];
    stores: { service: "postgres" | "minio" | "redis"; containerId: string; volumeName: string; destination: string }[];
  };
  candidate: Artifact & { checkout: string; imageId: string };
  privateConfigPath: string;
  lockRoot: string;
  journalPath: string;
};
export type DataIdentity = { postgres: string; objectStore: string; redis: string };
export type HandoffObserver = {
  docker: Docker;
  /** The composition root must query database system/database identity, actual bucket
   * identity, and Redis process/namespace. Returning input config strings is not proof. */
  observeDataIdentity(inputs: HandoffInputs): Promise<DataIdentity>;
};
type HandoffObservation = Awaited<ReturnType<typeof observe>>;
export type HandoffPlan = { format: "wiseeff-fixed-entry-handoff-v1"; inputs: HandoffInputs; observation: HandoffObservation; digest: string };
const fail = (code: string): never => { throw new Error(`handoff-${code}`); };
const git = (checkout: string, ...args: string[]) => {
  const result = spawnSync("git", ["-C", checkout, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME }, timeout: 10000 });
  if (result.status !== 0) fail("git-observation-failed");
  return result.stdout.trim();
};
const sha = (value: string) => /^[a-f0-9]{40}$/.test(value);
const bytesDigest = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const readBoundedFile = async (filename: string, maximum: number, privateFile = false) => {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => fail("file-unavailable"));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maximum || (privateFile && (stat.mode & 0o777) !== 0o600)) fail("file-not-secure");
    const data = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < data.length) {
      const next = await file.read(data, length, data.length - length, length);
      if (!next.bytesRead) break;
      length += next.bytesRead;
    }
    if (length !== stat.size) fail("file-changed");
    const after = await lstat(filename);
    if (after.isSymbolicLink() || after.dev !== stat.dev || after.ino !== stat.ino || after.size !== stat.size || after.nlink !== 1) fail("file-changed");
    return { bytes: data.subarray(0, length), device: String(stat.dev), inode: String(stat.ino) };
  } finally { await file.close(); }
};
const runtimeConfigKeys = ["WISEEFF_API_ENV_FILE", "WISEEFF_WORKER_ENV_FILE", "WISEEFF_MANAGEMENT_ENV_FILE"] as const;
const dataOnlyEnv = (bytes: Buffer) => {
  const text = bytes.toString("utf8");
  const keys = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#!") || /\u0000|\$\(|`|;|&&|\|\|/.test(line)) fail("private-config-not-data-only");
    if (!line || line.startsWith("#")) continue;
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!assignment || keys.has(assignment[1]!)) fail("private-config-not-data-only");
    keys.add(assignment[1]!);
  }
  // Reuse the self-hosted data parser; never source/eval or expand shell variables.
  return parseEnvText(text);
};
const observePrivateConfigurations = async (mainPath: string, buildRoots: readonly string[]) => {
  const identities = new Set<string>();
  const paths = new Set<string>();
  const readPrivate = async (filename: string) => {
    if (!path.isAbsolute(filename)) fail("private-file-path-not-absolute");
    const canonical = await realpath(filename).catch(() => fail("private-file-unavailable"));
    if (buildRoots.some(root => canonical === root || canonical.startsWith(`${root}${path.sep}`))) fail("private-file-inside-build-checkout");
    if (canonical !== filename || (await lstat(filename)).isSymbolicLink()) fail("private-file-path-alias");
    const file = await readBoundedFile(canonical, 1024 * 1024, true);
    if (await realpath(filename) !== canonical) fail("private-file-path-alias");
    const identity = `${file.device}:${file.inode}`;
    if (paths.has(canonical) || identities.has(identity)) fail("private-file-alias");
    paths.add(canonical); identities.add(identity);
    return { env: dataOnlyEnv(file.bytes), binding: { path: canonical, device: file.device, inode: file.inode, digest: bytesDigest(file.bytes) } };
  };
  const main = await readPrivate(mainPath);
  const runtime: Record<string, { path: string; device: string; inode: string; digest: string }> = {};
  for (const key of runtimeConfigKeys) {
    const filename = main.env[key];
    if (!filename || filename !== filename.trim() || /["'$]/.test(filename)) fail("runtime-config-path-required");
    const roleConfig = await readPrivate(filename);
    if (key !== "WISEEFF_MANAGEMENT_ENV_FILE" && roleConfig.env.NODE_ENV !== undefined && roleConfig.env.NODE_ENV !== "production") fail("runtime-production-mode-required");
    runtime[key] = roleConfig.binding;
  }
  return { env: main.env, binding: { main: main.binding, runtime } };
};
const observe = async (input: HandoffInputs, deps: HandoffObserver) => {
  if (deps.docker.daemonId !== input.expectedDaemonId) fail("daemon-mismatch");
  if (!/^[A-Za-z0-9_-]+$/.test(input.runId) || !/^[a-z0-9][a-z0-9_-]*$/.test(input.source.project)) fail("invalid-identity");
  if (![input.entrypoint.sha, input.entrypoint.tree, input.source.sha, input.candidate.sha, input.candidate.tree].every(sha)) fail("artifact-not-fixed");
  const entryRoot = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."));
  if (await realpath(input.entrypoint.checkout) !== entryRoot) fail("wrong-entry-checkout");
  git(entryRoot, "ls-files", "--error-unmatch", fileURLToPath(import.meta.url));
  if (git(entryRoot, "rev-parse", "HEAD") !== input.entrypoint.sha || git(entryRoot, "rev-parse", "HEAD^{tree}") !== input.entrypoint.tree || git(entryRoot, "status", "--porcelain", "--untracked-files=no")) fail("entry-artifact-changed");
  const sourceRoot = await realpath(input.source.checkout);
  if (sourceRoot === entryRoot || git(sourceRoot, "rev-parse", "HEAD") !== input.source.sha || git(sourceRoot, "status", "--porcelain", "--untracked-files=no")) fail("source-checkout-artifact-mismatch");
  const candidateRoot = await realpath(input.candidate.checkout);
  if (candidateRoot === sourceRoot || await realpath(git(candidateRoot, "rev-parse", "--show-toplevel")) !== candidateRoot || git(candidateRoot, "rev-parse", "HEAD") !== input.candidate.sha || git(candidateRoot, "rev-parse", "HEAD^{tree}") !== input.candidate.tree || git(candidateRoot, "status", "--porcelain", "--untracked-files=no")) fail("candidate-checkout-artifact-mismatch");
  const composeFile = await realpath(input.source.composeFile);
  if (!composeFile.startsWith(`${sourceRoot}${path.sep}`)) fail("compose-outside-source-checkout");
  const privateConfigurations = await observePrivateConfigurations(input.privateConfigPath, [entryRoot, candidateRoot]);
  const expectedLock = privateConfigurations.env.WISEEFF_OPERATION_LOCK_DIR || path.join(sourceRoot, "ops/self-hosted/.state");
  if (!path.isAbsolute(expectedLock) || path.resolve(input.lockRoot) !== expectedLock || !path.isAbsolute(input.journalPath) || !path.resolve(input.journalPath).startsWith(`${expectedLock}${path.sep}`)) fail("lock-or-journal-binding-mismatch");
  for (let current = path.resolve(input.journalPath); current !== path.dirname(expectedLock); current = path.dirname(current)) {
    const stat = await lstat(current).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (stat?.isSymbolicLink()) fail("journal-path-symlink");
  }
  if (git(entryRoot, "rev-parse", `${input.candidate.sha}^{tree}`) !== input.candidate.tree) fail("candidate-tree-mismatch");
  const imageInfo = JSON.parse(deps.docker.command(["image", "inspect", input.candidate.imageId]).toString())[0];
  if (imageInfo.Id !== input.candidate.imageId || !/^sha256:[a-f0-9]{64}$/.test(input.candidate.imageId)) fail("candidate-image-mismatch");
  if (imageInfo.Config?.Labels?.["org.opencontainers.image.revision"] !== input.candidate.sha || imageInfo.Config?.Labels?.["org.wiseeff.source.tree"] !== input.candidate.tree) fail("candidate-image-source-label-mismatch");
  const inspect = (id: string, service: string) => {
    if (!/^[a-f0-9]{64}$/.test(id)) fail("container-id-not-fixed");
    const info = JSON.parse(deps.docker.command(["inspect", id]).toString())[0];
    if (info.Id !== id || info.Config?.Labels?.["com.docker.compose.project"] !== input.source.project || info.Config?.Labels?.["com.docker.compose.service"] !== service || info.Config?.Labels?.["com.docker.compose.project.config_files"] !== composeFile || info.Config?.Labels?.["com.docker.compose.project.working_dir"] !== path.dirname(composeFile)) fail("compose-container-mismatch");
    return info;
  };
  if (input.source.applications.map(a => a.service).sort().join(",") !== "api,web,worker" || input.source.stores.map(s => s.service).sort().join(",") !== "minio,postgres,redis") fail("source-service-set-incomplete");
  const applications = input.source.applications.map(app => {
    const info = inspect(app.containerId, app.service);
    if (info.Image !== app.imageId || info.Config.Image !== app.imageReference || !info.State.Running) fail("source-running-artifact-mismatch");
    if (!app.imageReference.endsWith(`:${input.source.sha}`) || (info.Config.Labels?.["org.opencontainers.image.revision"] && info.Config.Labels["org.opencontainers.image.revision"] !== input.source.sha)) fail("source-sha-image-reference-mismatch");
    return { service: app.service, id: info.Id as string, imageId: info.Image as string, imageReference: info.Config.Image as string };
  });
  const stores = input.source.stores.map(store => {
    const info = inspect(store.containerId, store.service);
    const mounts = info.Mounts.filter((m: { Destination: string }) => m.Destination === store.destination);
    if (mounts.length !== 1 || mounts[0].Type !== "volume" || mounts[0].Name !== store.volumeName) fail("source-volume-mismatch");
    const volume = JSON.parse(deps.docker.command(["volume", "inspect", store.volumeName]).toString())[0];
    if (volume.Name !== store.volumeName || volume.Labels?.["com.docker.compose.project"] !== input.source.project) fail("source-volume-owner-mismatch");
    return { service: store.service, id: info.Id as string, imageId: info.Image as string, mount: mounts[0], volume };
  });
  const identities = await deps.observeDataIdentity(input);
  if (Object.keys(identities).sort().join(",") !== "objectStore,postgres,redis" || Object.values(identities).some(value => typeof value !== "string" || !value)) fail("data-identity-unavailable");
  return { daemonId: deps.docker.daemonId, hostFingerprint: bytesDigest(Buffer.from(`${os.hostname()}\0${os.platform()}\0${os.arch()}`)), sourceRoot, candidateRoot, composeFile, applications, stores, identities,
    privateConfigDigest: privateConfigurations.binding.main.digest, privateConfigurations: privateConfigurations.binding,
    composeDigest: bytesDigest((await readBoundedFile(composeFile, 1024 * 1024)).bytes),
    candidateImage: { id: imageInfo.Id as string, platform: `${imageInfo.Os}/${imageInfo.Architecture}` } };
};

/** Target read-only. Git, Docker inspect and actual store identity reads do not stop,
 * migrate, switch pointers, start Compose or rewrite the source checkout. */
export async function inspectHandoff(input: HandoffInputs, deps: HandoffObserver) {
  try { return await observe(input, deps); }
  catch (error) { if (error instanceof Error && /^handoff-[a-z-]+$/.test(error.message)) throw error; return fail("observation-failed"); }
}
export async function prepareHandoff(input: HandoffInputs, planFile: string, deps: HandoffObserver): Promise<HandoffPlan> {
  const observation = await inspectHandoff(input, deps);
  const body = { format: "wiseeff-fixed-entry-handoff-v1" as const, inputs: input, observation };
  const plan = { ...body, digest: sha256Prefixed(canonicalJson(body)) };
  const file = await open(planFile, "wx", 0o600).catch(() => fail("plan-exists-or-unavailable"));
  try { await file.writeFile(JSON.stringify(plan)); await file.sync(); } finally { await file.close(); }
  return plan;
}

/** Uses the same shell lock as ordinary setup/upgrade, holding its process alive until
 * the callback completes. Root dispatchers that already hold this lock pass their own
 * withOperationLock wrapper instead; they must not acquire the same lock twice. */
export async function withHostOperationLock<T>(lockRoot: string, action: () => Promise<T>): Promise<T> {
  const script = 'source "$1"; wiseeff_operation_lock_acquire "$2" "Catalog handoff lock occupied" "catalog-handoff" || exit $?; trap wiseeff_operation_lock_release EXIT; printf "LOCKED\\n"; read -r release';
  const child = spawn("bash", ["-c", script, "handoff-lock", fileURLToPath(new URL("../operation-lock.sh", import.meta.url)), lockRoot], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ["pipe", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; if (output.includes("LOCKED\n")) resolve(); });
    child.once("error", () => reject(new Error("handoff-lock-unavailable")));
    child.once("exit", () => reject(new Error("handoff-lock-unavailable")));
  });
  try { return await action(); }
  finally {
    await new Promise<void>(resolve => { child.once("exit", () => resolve()); child.stdin.end("release\n"); });
  }
}

/** No second controller or journal: dispatches the actual existing controller only
 * after immutable source/config/store pins are re-observed under the host lock. */
export async function executeHandoff(plan: HandoffPlan, expectedDigest: string, command: ControllerCommand,
  deps: HandoffObserver & { openController(binding: { runId: string; journalPath: string }): CatalogUpgradeController; withOperationLock<T>(root: string, action: () => Promise<T>): Promise<T> }) {
  const { digest, ...body } = plan;
  if (digest !== expectedDigest || digest !== sha256Prefixed(canonicalJson(body))) fail("plan-digest-mismatch");
  return deps.withOperationLock(plan.inputs.lockRoot, async () => {
    const observed = await inspectHandoff(plan.inputs, deps);
    if (canonicalJson(observed) !== canonicalJson(plan.observation)) fail("target-changed-after-plan");
    return deps.openController({ runId: plan.inputs.runId, journalPath: plan.inputs.journalPath }).dispatch(command);
  });
}
