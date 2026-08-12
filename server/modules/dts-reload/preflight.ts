import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseDts, resolveDts, type ResolvedNode } from "../dts";
import {
  probeDtsToolchain,
  resolveDtsToolchainCommands,
  runDtsToolchainCommand
} from "../parameter-files/dtsToolchain";
import type { DebugOverlayTarget } from "./debugOverlay";
import { canonicalizeReloadValue, decimalCellText } from "./valueShape";

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
      // `-@` emits `/__symbols__` so overlays that carry phandle cells (e.g. gpio_int)
      // can resolve `&label` fixups at `fdtoverlay` time.
      ["-@", "-I", "dts", "-O", "dtb", "-o", baseDtbPath, baseDtsPath],
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
      ["-@", "-I", "dts", "-O", "dtb", "-o", overlayDtboPath, overlayDtsPath],
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
  // Decompiled trees expose phandle numbers; debug overlays still carry `&label` cells.
  const labelPhandles = buildLabelPhandleMap(baseNodes);
  const resolvePhandle = (label: string) => labelPhandles.get(label) ?? null;

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
      const expected = canonicalizeReloadValue(property.value, property.name, resolvePhandle);
      const observed = after
        ? canonicalizeReloadValue(after.cst.value, after.rawText, resolvePhandle)
        : null;

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
        before: canonicalizeReloadValue(before.cst.value, before.rawText, resolvePhandle),
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

  try {
    const resolved = resolveDts(parseDts(decompiled.stdout));
    // `resolveDts` reports root-relative paths ("" for the root); device-tree targets are absolute.
    return new Map(resolved.nodes.map((node) => [`/${node.nodePath}`, node]));
  } catch {
    // Real vendor trees can decompile to forms our DTS lexer does not yet accept (for example
    // bare byte arrays). Treat that as an unreadable tree rather than crashing the run request.
    return null;
  }
}

function buildLabelPhandleMap(nodes: Map<string, ResolvedNode>): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of nodes.values()) {
    const phandleProp = node.properties.find((property) => property.name === "phandle");
    const phandleValue = phandleProp?.cst.value;
    if (!phandleValue || phandleValue.kind !== "cells") continue;
    const cell = phandleValue.groups[0]?.[0];
    if (!cell || cell.kind !== "integer") continue;
    const numeric = decimalCellText(cell);
    for (const label of node.labels) {
      map.set(label, numeric);
    }
  }
  return map;
}
