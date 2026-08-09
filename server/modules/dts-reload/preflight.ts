import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseDts, resolveDts, type DtsValue, type ResolvedNode } from "../dts";
import {
  probeDtsToolchain,
  resolveDtsToolchainCommands,
  runDtsToolchainCommand
} from "../parameter-files/dtsToolchain";
import type { DebugOverlayTarget } from "./debugOverlay";

export type PreflightStepName = "compile-base" | "compile-overlay" | "dry-run-merge" | "assert-effect";

export type PreflightFailureCode =
  | "toolchain-unavailable"
  | "base-compile-failed"
  | "overlay-compile-failed"
  | "target-node-missing"
  | "overlay-not-applicable"
  | "property-absent-in-base"
  | "property-value-mismatch";

export interface PreflightDiagnostic {
  stage: PreflightStepName;
  code: PreflightFailureCode;
  message: string;
  nodePath?: string;
  propertyName?: string;
}

export interface PreflightStep {
  step: PreflightStepName;
  outcome: "passed" | "failed" | "skipped";
}

export interface PreflightObservedValue {
  nodePath: string;
  propertyName: string;
  /** Value in the compiled base device tree, normalised to decimal cells. */
  before: string;
  /** Value after the overlay was dry-run merged, normalised to decimal cells. */
  after: string;
}

export interface PreflightResult {
  ok: boolean;
  steps: PreflightStep[];
  diagnostics: PreflightDiagnostic[];
  /** Compiled overlay blob, present only when every step passed. */
  overlayBlob?: Buffer;
  observedValues: PreflightObservedValue[];
  toolVersions: { dtc: string | null; fdtoverlay: string | null };
}

export interface PreflightInput {
  /** Full base device-tree source for the project's configuration set. */
  baseSource: string;
  overlaySource: string;
  targets: readonly DebugOverlayTarget[];
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * `fdtoverlay` appends this hint to unrelated failures, so it is never the cause of one.
 * Keeping it in a diagnostic would send engineers chasing a symbol table they do not need.
 */
const SYMBOLS_HINT = /^.*__symbols__.*$\n?/gm;

/**
 * Compile the debug overlay, dry-run merge it onto the project's base device tree, then decompile
 * the result and assert the overlay actually changed the properties it claimed to change.
 *
 * The final assertion is not redundant: `fdtoverlay` accepts a misspelled property name and
 * silently creates a new one, so a clean exit code alone does not mean the overlay does anything.
 * A run only produces a downloadable artifact when every step passes.
 */
export async function runDebugOverlayPreflight(input: PreflightInput): Promise<PreflightResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const commands = resolveDtsToolchainCommands();
  const probe = await probeDtsToolchain();
  const toolVersions = { dtc: probe.dtc.version, fdtoverlay: probe.fdtoverlay.version };

  if (probe.dtc.path === null || probe.fdtoverlay.path === null) {
    return {
      ok: false,
      steps: [
        { step: "compile-base", outcome: "skipped" },
        { step: "compile-overlay", outcome: "skipped" },
        { step: "dry-run-merge", outcome: "skipped" },
        { step: "assert-effect", outcome: "skipped" }
      ],
      diagnostics: [
        {
          stage: "compile-base",
          code: "toolchain-unavailable",
          message:
            "The device-tree toolchain is unavailable. Bootstrap it with `npm run dts:toolchain:bootstrap`."
        }
      ],
      observedValues: [],
      toolVersions
    };
  }

  const workDir = await mkdtemp(join(tmpdir(), "wiseeff-reload-preflight-"));
  const steps: PreflightStep[] = [];
  const diagnostics: PreflightDiagnostic[] = [];

  const fail = (
    step: PreflightStepName,
    diagnostic: PreflightDiagnostic | PreflightDiagnostic[]
  ): PreflightResult => {
    steps.push({ step, outcome: "failed" });
    diagnostics.push(...(Array.isArray(diagnostic) ? diagnostic : [diagnostic]));
    for (const remaining of remainingSteps(step)) {
      steps.push({ step: remaining, outcome: "skipped" });
    }
    return { ok: false, steps, diagnostics, observedValues: [], toolVersions };
  };

  try {
    const baseDtsPath = join(workDir, "base.dts");
    const baseDtbPath = join(workDir, "base.dtb");
    const overlayDtsPath = join(workDir, "debug-overlay.dts");
    const overlayDtboPath = join(workDir, "debug-overlay.dtbo");
    const mergedDtbPath = join(workDir, "merged.dtb");

    await writeFile(baseDtsPath, input.baseSource, "utf8");
    await writeFile(overlayDtsPath, input.overlaySource, "utf8");

    const compileBase = await runDtsToolchainCommand(
      commands.dtc,
      ["-I", "dts", "-O", "dtb", "-o", baseDtbPath, baseDtsPath],
      { cwd: workDir, timeoutMs }
    );
    if (compileBase.code !== 0) {
      return fail("compile-base", {
        stage: "compile-base",
        code: "base-compile-failed",
        message: toolMessage(compileBase.stderr, compileBase.stdout)
      });
    }

    const baseNodes = await decompileNodes(commands.dtc, baseDtbPath, workDir, timeoutMs);
    if (!baseNodes) {
      return fail("compile-base", {
        stage: "compile-base",
        code: "base-compile-failed",
        message: "The compiled base device tree could not be read back for verification."
      });
    }
    steps.push({ step: "compile-base", outcome: "passed" });

    const compileOverlay = await runDtsToolchainCommand(
      commands.dtc,
      ["-I", "dts", "-O", "dtb", "-o", overlayDtboPath, overlayDtsPath],
      { cwd: workDir, timeoutMs }
    );
    if (compileOverlay.code !== 0) {
      return fail("compile-overlay", {
        stage: "compile-overlay",
        code: "overlay-compile-failed",
        message: toolMessage(compileOverlay.stderr, compileOverlay.stdout)
      });
    }
    steps.push({ step: "compile-overlay", outcome: "passed" });

    const merge = await runDtsToolchainCommand(
      commands.fdtoverlay,
      ["-i", baseDtbPath, "-o", mergedDtbPath, overlayDtboPath],
      { cwd: workDir, timeoutMs }
    );
    if (merge.code !== 0) {
      return fail("dry-run-merge", mergeDiagnostics(merge.stderr, merge.stdout, input.targets, baseNodes));
    }

    const mergedNodes = await decompileNodes(commands.dtc, mergedDtbPath, workDir, timeoutMs);
    if (!mergedNodes) {
      return fail("dry-run-merge", {
        stage: "dry-run-merge",
        code: "overlay-not-applicable",
        message: "The merged device tree could not be read back for verification."
      });
    }
    steps.push({ step: "dry-run-merge", outcome: "passed" });

    const assertion = assertOverlayEffect(input.targets, baseNodes, mergedNodes);
    if (assertion.diagnostics.length > 0) {
      return fail("assert-effect", assertion.diagnostics);
    }
    steps.push({ step: "assert-effect", outcome: "passed" });

    return {
      ok: true,
      steps,
      diagnostics,
      overlayBlob: await readFile(overlayDtboPath),
      observedValues: assertion.observedValues,
      toolVersions
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

const STEP_ORDER: PreflightStepName[] = [
  "compile-base",
  "compile-overlay",
  "dry-run-merge",
  "assert-effect"
];

function remainingSteps(after: PreflightStepName): PreflightStepName[] {
  return STEP_ORDER.slice(STEP_ORDER.indexOf(after) + 1);
}

function toolMessage(stderr: string, stdout: string): string {
  const text = `${stderr}\n${stdout}`.replace(SYMBOLS_HINT, "").trim();
  return text.length > 0 ? text : "The device-tree toolchain failed without a message.";
}

/**
 * `fdtoverlay` reports `FDT_ERR_NOTFOUND` when a fragment's `target-path` does not exist in the
 * base, and applies fragments atomically, so we can name the offending paths ourselves rather
 * than hand the raw error to the engineer.
 */
function mergeDiagnostics(
  stderr: string,
  stdout: string,
  targets: readonly DebugOverlayTarget[],
  baseNodes: Map<string, ResolvedNode>
): PreflightDiagnostic[] {
  const message = toolMessage(stderr, stdout);
  const missing = targets.filter((target) => !baseNodes.has(target.nodePath));

  if (missing.length > 0) {
    return missing.map((target) => ({
      stage: "dry-run-merge" as const,
      code: "target-node-missing" as const,
      message: `Node ${target.nodePath} does not exist in the project's base device tree.`,
      nodePath: target.nodePath
    }));
  }

  return [{ stage: "dry-run-merge", code: "overlay-not-applicable", message }];
}

function assertOverlayEffect(
  targets: readonly DebugOverlayTarget[],
  baseNodes: Map<string, ResolvedNode>,
  mergedNodes: Map<string, ResolvedNode>
): { diagnostics: PreflightDiagnostic[]; observedValues: PreflightObservedValue[] } {
  const diagnostics: PreflightDiagnostic[] = [];
  const observedValues: PreflightObservedValue[] = [];

  for (const target of targets) {
    const baseNode = baseNodes.get(target.nodePath);
    const mergedNode = mergedNodes.get(target.nodePath);

    if (!baseNode || !mergedNode) {
      diagnostics.push({
        stage: "assert-effect",
        code: "target-node-missing",
        message: `Node ${target.nodePath} does not exist in the project's base device tree.`,
        nodePath: target.nodePath
      });
      continue;
    }

    for (const property of target.properties) {
      const before = baseNode.properties.find((candidate) => candidate.name === property.name);
      if (!before) {
        diagnostics.push({
          stage: "assert-effect",
          code: "property-absent-in-base",
          message: `Property ${property.name} does not exist on ${target.nodePath}; the overlay would create a new property instead of changing the parameter.`,
          nodePath: target.nodePath,
          propertyName: property.name
        });
        continue;
      }

      const after = mergedNode.properties.find((candidate) => candidate.name === property.name);
      const expected = normalizeValue(property.value, property.name);
      const observed = after ? normalizeValue(after.cst.value, after.rawText) : null;

      if (observed === null || observed !== expected) {
        diagnostics.push({
          stage: "assert-effect",
          code: "property-value-mismatch",
          message: `Property ${property.name} on ${target.nodePath} is ${observed ?? "absent"} after applying the overlay, but the debug value is ${expected}.`,
          nodePath: target.nodePath,
          propertyName: property.name
        });
        continue;
      }

      observedValues.push({
        nodePath: target.nodePath,
        propertyName: property.name,
        before: normalizeValue(before.cst.value, before.rawText),
        after: observed
      });
    }
  }

  return { diagnostics, observedValues };
}

async function decompileNodes(
  dtc: string,
  dtbPath: string,
  cwd: string,
  timeoutMs: number
): Promise<Map<string, ResolvedNode> | null> {
  const decompiled = await runDtsToolchainCommand(dtc, ["-I", "dtb", "-O", "dts", dtbPath], {
    cwd,
    timeoutMs
  });
  if (decompiled.code !== 0) {
    return null;
  }

  const resolved = resolveDts(parseDts(decompiled.stdout));
  // `resolveDts` reports root-relative paths ("" for the root); device-tree targets are absolute.
  return new Map(resolved.nodes.map((node) => [`/${node.nodePath}`, node]));
}

/**
 * Compare values by cell, not by text: `dtc` decompiles to hexadecimal while a debug value may be
 * entered in decimal, and both spellings mean the same device-tree value.
 */
function normalizeValue(value: DtsValue | undefined, fallback: string): string {
  if (value?.kind === "cells") {
    const groups = value.groups.map((group) =>
      group.map((cell) => (cell.kind === "integer" ? decimal(cell) : `&${cell.label}`)).join(" ")
    );
    return groups.map((group) => `<${group}>`).join(" ");
  }
  return fallback.trim();
}

function decimal(cell: { raw: string; value: string }): string {
  const parsed = BigInt(cell.value.length > 0 ? cell.value : cell.raw);
  return parsed.toString(10);
}
