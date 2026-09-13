import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  assertTestSummary,
  readIdentity,
  shadowModuleIds,
  type Identity,
  type NativeSummary,
  type ShadowSummary,
} from "../ci-required-results";
import { createPreview, type Preview } from "./plan";
import type { RegistryModule, Selection } from "./selection";

const commands = ["frontend", "scripts", "bridge", "server"] as const;
type ShadowCommand = typeof commands[number];
const taskByCommand: Record<ShadowCommand, string> = {
  frontend: "frontend-tests", scripts: "scripts-tests", bridge: "bridge-tests", server: "backend-tests",
};
const shadowErrors = ["SHADOW_PLAN_INVALID", "SHADOW_ADAPTER_FAILED", "SHADOW_IDENTITY_MISMATCH", "SHADOW_NATIVE_INVALID"] as const;
type MinimalRegistryModule = Pick<RegistryModule, "id" | "status" | "risk" | "tasks">;

type ShadowModuleInput = {
  id: typeof shadowModuleIds[number]; status: "observation-pending"; risk: "R2" | "R3";
  tasks: Record<string, string[]>;
};
type ObservationInput = {
  identity: Identity; command: ShadowCommand; files: string[]; native: NativeSummary;
  selection: Selection; registry: readonly ShadowModuleInput[]; policyDigest: string; registryDigest: string; root?: string;
};

function requireShadow(condition: unknown, code: typeof shadowErrors[number] | "SHADOW_NATIVE_INVALID"): asserts condition {
  if (!condition) throw new Error(code);
}
function digest(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function relativeFiles(root: string, files: string[]): string[] {
  requireShadow(files.length > 0 && new Set(files).size === files.length, "SHADOW_NATIVE_INVALID");
  return files.map((file) => {
    requireShadow(typeof file === "string" && path.isAbsolute(file), "SHADOW_NATIVE_INVALID");
    const relative = path.relative(root, file).replaceAll("\\", "/");
    requireShadow(relative && relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative), "SHADOW_NATIVE_INVALID");
    return relative;
  });
}
function matches(file: string, pattern: string): boolean { return pattern.endsWith("/") ? file.startsWith(pattern) : file === pattern; }
function fixedModules(selection: Selection, registry: readonly ShadowModuleInput[], files: string[], command: ShadowCommand): ShadowSummary["modules"] {
  requireShadow(registry.length === shadowModuleIds.length && registry.every((module, index) => module.id === shadowModuleIds[index]), "SHADOW_PLAN_INVALID");
  requireShadow(selection.moduleStates.length === shadowModuleIds.length
    && selection.moduleStates.every((module, index) => module.id === shadowModuleIds[index] && module.status === "observation-pending"), "SHADOW_PLAN_INVALID");
  const task = taskByCommand[command];
  return shadowModuleIds.map((id, index) => {
    const module = registry[index]!;
    const selected = selection.moduleStates[index]!.selected;
    const paths = selected && selection.tasks.includes(task) ? module.tasks[task] ?? [] : [];
    requireShadow(Array.isArray(paths) && new Set(paths).size === paths.length && paths.every((file) => typeof file === "string"), "SHADOW_PLAN_INVALID");
    return {
      id, status: "observation-pending" as const, selected,
      wouldSelectFileCount: paths.length,
      actualFullFileCount: files.length,
      matchedCount: files.filter((file) => paths.some((pattern) => matches(file, pattern))).length,
    };
  });
}

export function createShadowObservation(input: ObservationInput): ShadowSummary {
  requireShadow(commands.includes(input.command), "SHADOW_PLAN_INVALID");
  requireShadow(/^[a-f0-9]{64}$/.test(input.policyDigest) && /^[a-f0-9]{64}$/.test(input.registryDigest), "SHADOW_PLAN_INVALID");
  assertTestSummary(input.native, input.command, input.identity);
  const root = path.resolve(input.root ?? process.cwd());
  const files = relativeFiles(root, input.files);
  requireShadow(digest(JSON.stringify([...input.files].sort())) === input.native.filesSha256 && input.native.files === files.length, "SHADOW_NATIVE_INVALID");
  const modules = fixedModules(input.selection, input.registry, files, input.command);
  return {
    version: 1, scope: "ci-shadow", effectiveMode: "shadow", activation: "observation-pending", memo: "disabled",
    status: "observed", error: null, planValid: true,
    identity: input.identity, command: input.command, policyDigest: input.policyDigest, registryDigest: input.registryDigest,
    nativeReportSha256: input.native.sha256, actualFilesSha256: input.native.filesSha256,
    actualFullFileCount: files.length, modules,
  };
}

export function createUnavailableShadow(input: { identity: Identity; command: ShadowCommand; native?: NativeSummary; error: typeof shadowErrors[number] }): ShadowSummary {
  const native = input.native;
  return {
    version: 1, scope: "ci-shadow", effectiveMode: "shadow", activation: "observation-pending", memo: "disabled",
    status: "unavailable", error: input.error, planValid: false,
    identity: input.identity, command: input.command, policyDigest: null, registryDigest: null,
    nativeReportSha256: native?.sha256 ?? null, actualFilesSha256: native?.filesSha256 ?? null,
    actualFullFileCount: native?.files ?? 0,
    modules: shadowModuleIds.map((id) => ({ id, status: "observation-pending" as const, selected: false, wouldSelectFileCount: 0, actualFullFileCount: native?.files ?? 0, matchedCount: 0 })),
  };
}

export function createNotApplicableShadow(input: { identity: Identity; command: ShadowCommand }): ShadowSummary {
  return {
    version: 1, scope: "ci-shadow", effectiveMode: "shadow", activation: "observation-pending", memo: "disabled",
    status: "not-applicable", error: "NOT_APPLICABLE", planValid: false,
    identity: input.identity, command: input.command, policyDigest: null, registryDigest: null,
    nativeReportSha256: null, actualFilesSha256: null, actualFullFileCount: 0,
    modules: shadowModuleIds.map((id) => ({ id, status: "observation-pending" as const, selected: false, wouldSelectFileCount: 0, actualFullFileCount: 0, matchedCount: 0 })),
  };
}

function readRegistry(cwd: string): ShadowModuleInput[] {
  const file = path.resolve(cwd, "scripts/verification/registry.json");
  const stat = lstatSync(file);
  requireShadow(stat.isFile() && !stat.isSymbolicLink(), "SHADOW_PLAN_INVALID");
  const value = JSON.parse(readFileSync(file, "utf8")) as { modules?: unknown };
  requireShadow(Array.isArray(value.modules) && value.modules.length === shadowModuleIds.length, "SHADOW_PLAN_INVALID");
  const modules = value.modules.map((raw) => {
    const module = raw as Partial<MinimalRegistryModule>;
    requireShadow(typeof module.id === "string" && module.status === "observation-pending"
      && (module.risk === "R2" || module.risk === "R3") && module.tasks !== null && typeof module.tasks === "object" && !Array.isArray(module.tasks), "SHADOW_PLAN_INVALID");
    return { id: module.id! as typeof shadowModuleIds[number], status: module.status!, risk: module.risk!, tasks: module.tasks! };
  });
  const byId = new Map(modules.map((module) => [module.id, module]));
  requireShadow(byId.size === shadowModuleIds.length && shadowModuleIds.every((id) => byId.has(id)), "SHADOW_PLAN_INVALID");
  return shadowModuleIds.map((id) => byId.get(id)!);
}

export type CiShadowInput = { identity: unknown; command: string; files: unknown; native: unknown };
export function buildShadow(input: CiShadowInput, cwd = process.cwd()): ShadowSummary {
  const identity = readIdentity(input.identity);
  requireShadow(commands.includes(input.command as ShadowCommand), "SHADOW_PLAN_INVALID");
  const command = input.command as ShadowCommand;
  requireShadow(Array.isArray(input.files), "SHADOW_NATIVE_INVALID");
  assertTestSummary(input.native, command, identity);
  if (identity.event !== "pull_request") return createNotApplicableShadow({ identity, command });
  try {
    const preview: Preview = createPreview({ cwd, base: identity.base, head: identity.head });
    requireShadow(preview.executedSha === identity.sha && preview.tree === identity.tree && preview.acceptedBase === identity.base && preview.head === identity.head, "SHADOW_IDENTITY_MISMATCH");
    return createShadowObservation({ identity, command, files: input.files as string[], native: input.native, selection: preview.selection,
      registry: readRegistry(cwd), policyDigest: preview.policyDigest, registryDigest: preview.registryDigest, root: cwd });
  } catch (error) {
    const code = error instanceof Error && shadowErrors.includes(error.message as typeof shadowErrors[number]) ? error.message as typeof shadowErrors[number] : "SHADOW_PLAN_INVALID";
    return createUnavailableShadow({ identity, command, native: input.native, error: code });
  }
}

function cli(): void {
  const input = readFileSync("/dev/stdin", "utf8");
  requireShadow(Buffer.byteLength(input, "utf8") <= 256 * 1024, "SHADOW_NATIVE_INVALID");
  const value = JSON.parse(input) as CiShadowInput;
  process.stdout.write(`${JSON.stringify(buildShadow(value))}\n`);
}
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  try {
    if (process.argv[2] === "--scope") {
      const event = process.env.GITHUB_EVENT_NAME;
      process.stdout.write(`CI shadow scope: ${event === "pull_request" ? "ordinary-pull-request" : "not-applicable"}\n`);
    } else cli();
  } catch { process.exitCode = 1; }
}
