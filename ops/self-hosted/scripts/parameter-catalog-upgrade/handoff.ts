import { spawn, spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogUpgradeController, ControllerCommand } from "./controller";
import { canonicalJson, sha256Prefixed } from "./journal";

type Docker = { daemonId: string; command(args: string[]): Buffer };
type Artifact = { sha: string; tree: string };
export type HandoffInputs = {
  runId: string; expectedDaemonId: string;
  entrypoint: Artifact & { checkout: string };
  source: { checkout: string; sha: string; composeFile: string; project: string;
    applications: { service: "api" | "worker" | "web"; containerId: string; imageId: string; imageReference: string }[];
    stores: { service: "postgres" | "minio" | "redis"; containerId: string; volumeName: string; destination: string }[];
  };
  candidate: Artifact & { imageId: string };
  privateConfigPath: string;
  lockRoot: string;
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
const digestFile = async (filename: string, maximum: number, privateFile = false) => {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => fail("file-unavailable"));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maximum || (privateFile && (stat.mode & 0o077) !== 0)) fail("file-not-secure");
    const data = Buffer.alloc(stat.size + 1);
    const result = await file.read(data, 0, data.length, 0);
    if (result.bytesRead !== stat.size) fail("file-changed");
    return sha256Prefixed(data.subarray(0, result.bytesRead).toString("base64"));
  } finally { await file.close(); }
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
  const composeFile = await realpath(input.source.composeFile);
  if (!composeFile.startsWith(`${sourceRoot}${path.sep}`)) fail("compose-outside-source-checkout");
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
  return { daemonId: deps.docker.daemonId, sourceRoot, composeFile, applications, stores, identities,
    privateConfigDigest: await digestFile(input.privateConfigPath, 1024 * 1024, true), composeDigest: await digestFile(composeFile, 1024 * 1024),
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
  deps: HandoffObserver & { controller: CatalogUpgradeController; withOperationLock<T>(root: string, action: () => Promise<T>): Promise<T> }) {
  const { digest, ...body } = plan;
  if (digest !== expectedDigest || digest !== sha256Prefixed(canonicalJson(body))) fail("plan-digest-mismatch");
  return deps.withOperationLock(plan.inputs.lockRoot, async () => {
    const observed = await inspectHandoff(plan.inputs, deps);
    if (canonicalJson(observed) !== canonicalJson(plan.observation)) fail("target-changed-after-plan");
    return deps.controller.dispatch(command);
  });
}
