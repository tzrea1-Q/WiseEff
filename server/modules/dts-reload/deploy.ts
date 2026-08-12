import { createHash } from "node:crypto";

import { DEVICE_BRIDGE_RELEASES_PATH } from "@wiseeff/device-command-core/bridgeApiPaths";
import { DTS_RELOAD_BRIDGE_RPC_METHODS } from "@wiseeff/device-command-core/bridgeRpcMethods";

import type { BridgeRpcClient } from "../deviceBridge/rpc";
import type { BridgeConnectionPool } from "../deviceBridge/connectionPool";
import { listBridgesForUser } from "../deviceBridge/repository";
import { loadLatestBridgeReleaseManifest } from "../deviceBridge/releaseManifest";
import {
  acquireDebugDeviceLease,
  ensureBridgeDebugDevice,
  ensureDtsReloadLeaseSession,
  releaseDebugDeviceLease
} from "../debugging/repository";
import type { AuthContext } from "../auth/types";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { resolveReloadConfiguration } from "./resolveConfiguration";
import { verifyReloadTargetsBehaviourally } from "./behaviouralVerify";
import type { BehaviouralVerificationDto } from "./behaviouralVerify";
import {
  buildNotObtainedKernelSignal,
  buildObtainedKernelSignal
} from "./kernelSignal";
import type {
  IntegrityCheckStrength,
  ReloadRunDto,
  ReloadSnapshotDto,
  ReloadStep
} from "./types";
import {
  DTS_RELOAD_CONFIRMATION_TOKEN,
  PUSH_FILE_MAX_BYTES,
  RELOAD_KERNEL_LOG_TIMEOUT_MS,
  RELOAD_MOUNT_TIMEOUT_MS,
  RELOAD_PUSH_FILE_TIMEOUT_MS,
  RELOAD_READ_NODE_TIMEOUT_MS,
  RELOAD_TRIGGER_TIMEOUT_MS,
  TRIGGER_RELOAD_UNCONFIRMED_FAILURE_CODE
} from "./types";

export type DeployReloadRunInput = {
  runId: string;
  deviceId: string;
  bridgeId: string;
  targetRef: string;
  protocol: "hdc" | "adb";
  confirmationTokens: string[];
};

export type DeployReloadDeps = {
  bridgeRpcClient: Pick<BridgeRpcClient, "call">;
  bridgeConnectionPool: Pick<BridgeConnectionPool, "isConnected">;
  artifactRoot?: string;
  mountTimeoutMs?: number;
  pushFileTimeoutMs?: number;
  triggerTimeoutMs?: number;
  kernelLogTimeoutMs?: number;
  readNodeTimeoutMs?: number;
  pushFileMaxBytes?: number;
  now?: () => Date;
};

function hasConfirmationToken(tokens: string[], expected: string) {
  return tokens.includes(expected);
}

/**
 * Server-authoritative device identity for a bridge-attached reload target.
 * The device a reload writes to is fully determined by the owned bridge, so the
 * canonical id is derived here and never taken from the client — this binds
 * residue/lease bookkeeping to the bridge and guarantees the `bridge:` prefix
 * that `ensureBridgeDebugDevice` requires.
 */
export function bridgeCanonicalDeviceId(bridgeId: string): string {
  return `bridge:${bridgeId}`;
}

/** Worst-case device lease TTL must outlive mount + transfer + trigger + kernel-log + per-target reads. */
export function computeReloadLeaseTtlMs(input: {
  targetCount: number;
  mountTimeoutMs: number;
  pushFileTimeoutMs: number;
  triggerTimeoutMs: number;
  kernelLogTimeoutMs: number;
  readNodeTimeoutMs: number;
}): number {
  const worstCaseMs =
    input.mountTimeoutMs +
    input.pushFileTimeoutMs +
    input.triggerTimeoutMs +
    input.kernelLogTimeoutMs +
    Math.max(0, input.targetCount) * input.readNodeTimeoutMs +
    60_000;
  return Math.max(5 * 60 * 1000, worstCaseMs);
}

function parseSemverParts(version: string): number[] | null {
  const match = version.trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/** True when `version` is strictly older than `minimum` (feature-local gate only). */
export function isBridgeVersionBelowMinimum(version: string | null | undefined, minimum: string): boolean {
  if (!version?.trim()) return false;
  const left = parseSemverParts(version);
  const right = parseSemverParts(minimum);
  if (!left || !right) return false;
  for (let i = 0; i < 3; i += 1) {
    if (left[i]! < right[i]!) return true;
    if (left[i]! > right[i]!) return false;
  }
  return false;
}

function upgradeRequiredError(message: string, details: Record<string, unknown> = {}) {
  return new ApiError("VALIDATION_FAILED", message, 409, {
    code: "bridge-upgrade-required",
    releasesPath: DEVICE_BRIDGE_RELEASES_PATH,
    ...details
  });
}

export async function assertBridgeSupportsReloadDeploy(input: {
  rpc: Pick<BridgeRpcClient, "call">;
  bridgeId: string;
  clientVersion: string | null;
  artifactRoot?: string;
}): Promise<{ methods: string[]; minCompatibleVersion: string | null }> {
  const capabilities = await input.rpc.call(input.bridgeId, "bridge.getCapabilities", {}, { timeoutMs: 5_000 });
  const methods = Array.isArray(capabilities.methods)
    ? capabilities.methods.filter((value): value is string => typeof value === "string")
    : [];
  const missing = DTS_RELOAD_BRIDGE_RPC_METHODS.filter((method) => !methods.includes(method));

  let minCompatibleVersion: string | null = null;
  if (input.artifactRoot) {
    try {
      const manifest = await loadLatestBridgeReleaseManifest(input.artifactRoot);
      minCompatibleVersion = manifest.minCompatibleVersion;
    } catch {
      minCompatibleVersion = null;
    }
  }

  if (missing.length > 0) {
    throw upgradeRequiredError(
      `Device bridge is missing required RPC methods for DTS reload deploy (${missing.join(", ")}). Upgrade the bridge from ${DEVICE_BRIDGE_RELEASES_PATH}.`,
      { missingMethods: missing, methods, minCompatibleVersion }
    );
  }

  if (minCompatibleVersion && isBridgeVersionBelowMinimum(input.clientVersion, minCompatibleVersion)) {
    throw upgradeRequiredError(
      `Device bridge version ${input.clientVersion} is below the minimum compatible version ${minCompatibleVersion} required for DTS reload deploy. Upgrade from ${DEVICE_BRIDGE_RELEASES_PATH}.`,
      { clientVersion: input.clientVersion, minCompatibleVersion, methods }
    );
  }

  return { methods, minCompatibleVersion };
}

function integrityMatches(input: {
  strength: IntegrityCheckStrength;
  artifactBytes: Buffer;
  artifactSha256: string;
  remoteDigest: string;
}): boolean {
  if (input.strength === "sha256") {
    return input.remoteDigest.toLowerCase() === input.artifactSha256.toLowerCase();
  }
  if (input.strength === "md5") {
    return input.remoteDigest.toLowerCase() === createHash("md5").update(input.artifactBytes).digest("hex");
  }
  return input.remoteDigest === String(input.artifactBytes.length);
}

export function buildReloadSnapshot(input: {
  targets: ReloadRunDto["targets"];
  artifactSha256: string | null;
  onDeviceDigest: string | null;
  integrityCheck: IntegrityCheckStrength | null;
  kernelSignal?: ReloadSnapshotDto["kernelSignal"];
  behaviouralVerification?: BehaviouralVerificationDto | null;
}): ReloadSnapshotDto {
  return {
    libraryBaselines: input.targets.map((target) => ({
      bindingId: target.bindingId,
      propertyKey: target.propertyKey,
      nodePath: target.nodePath,
      baselineValue: target.baselineValue
    })),
    artifactDigest: input.artifactSha256
      ? {
          sha256: input.artifactSha256,
          onDeviceDigest: input.onDeviceDigest,
          integrityCheck: input.integrityCheck
        }
      : null,
    kernelSignal: input.kernelSignal ?? null,
    behaviouralVerification: input.behaviouralVerification ?? null
  };
}

type PersistDeployProgress = (update: {
  status: ReloadRunDto["status"];
  failureCode: string | null;
  steps: ReloadStep[];
  deviceId: string;
  bridgeId: string;
  bridgeMachineLabel: string;
  targetRef: string;
  protocol: "hdc" | "adb";
  integrityCheck: IntegrityCheckStrength | null;
  reloadSnapshot: ReloadSnapshotDto;
  completedAt: string | null;
}, options?: { claim?: boolean }) => Promise<ReloadRunDto>;

export async function executeReloadDeploy(input: {
  db: Database;
  auth: AuthContext;
  run: ReloadRunDto;
  artifactBytes: Buffer;
  deploy: DeployReloadRunInput;
  deps: DeployReloadDeps;
  persistProgress: PersistDeployProgress;
}): Promise<ReloadRunDto> {
  const { auth, run, artifactBytes, deploy, deps } = input;
  const now = deps.now ?? (() => new Date());
  const mountTimeoutMs = deps.mountTimeoutMs ?? RELOAD_MOUNT_TIMEOUT_MS;
  const pushFileTimeoutMs = deps.pushFileTimeoutMs ?? RELOAD_PUSH_FILE_TIMEOUT_MS;
  const triggerTimeoutMs = deps.triggerTimeoutMs ?? RELOAD_TRIGGER_TIMEOUT_MS;
  const kernelLogTimeoutMs = deps.kernelLogTimeoutMs ?? RELOAD_KERNEL_LOG_TIMEOUT_MS;
  const readNodeTimeoutMs = deps.readNodeTimeoutMs ?? RELOAD_READ_NODE_TIMEOUT_MS;
  const pushFileMaxBytes = deps.pushFileMaxBytes ?? PUSH_FILE_MAX_BYTES;
  // Server-authoritative device identity — never trust the client's deviceId for device writes.
  const deviceId = bridgeCanonicalDeviceId(deploy.bridgeId);

  if (!hasConfirmationToken(deploy.confirmationTokens, DTS_RELOAD_CONFIRMATION_TOKEN)) {
    throw new ApiError(
      "VALIDATION_FAILED",
      `Deploying a reload run requires confirmation token "${DTS_RELOAD_CONFIRMATION_TOKEN}".`,
      400,
      { code: "missing-dts-reload-confirmation", requiredToken: DTS_RELOAD_CONFIRMATION_TOKEN }
    );
  }

  if (run.status !== "validated" && run.status !== "failed") {
    throw new ApiError(
      "CONFLICT",
      `Reload run status "${run.status}" cannot be deployed. Expected validated (or failed retry).`,
      409,
      { code: "reload-not-deployable", status: run.status }
    );
  }

  if (!run.artifact?.sha256) {
    throw new ApiError("CONFLICT", "Reload run has no compiled overlay artifact to deploy.", 409, {
      code: "reload-artifact-missing"
    });
  }

  if (artifactBytes.length > pushFileMaxBytes) {
    throw new ApiError(
      "VALIDATION_FAILED",
      `Compiled overlay exceeds the server pushFile size cap of ${pushFileMaxBytes} bytes.`,
      400,
      { code: "push-file-too-large", sizeBytes: artifactBytes.length, maxBytes: pushFileMaxBytes }
    );
  }

  // Ownership check precedes the connection probe so a caller cannot use the
  // offline-vs-online response difference to enumerate bridges they do not own.
  const bridges = await listBridgesForUser(input.db, {
    userId: auth.user.id,
    organizationId: auth.organization.id
  });
  const bridge = bridges.find((item) => item.id === deploy.bridgeId && item.revokedAt === null);
  if (!bridge) {
    throw new ApiError("NOT_FOUND", "Device bridge was not found.", 404, { bridgeId: deploy.bridgeId });
  }

  if (!deps.bridgeConnectionPool.isConnected(deploy.bridgeId)) {
    throw new ApiError("DEVICE_UNAVAILABLE", "Selected device bridge is offline.", 409, {
      bridgeId: deploy.bridgeId
    });
  }

  await assertBridgeSupportsReloadDeploy({
    rpc: deps.bridgeRpcClient,
    bridgeId: deploy.bridgeId,
    clientVersion: bridge.clientVersion,
    artifactRoot: deps.artifactRoot
  });

  const configuration = await resolveReloadConfiguration(input.db, {
    organizationId: auth.organization.id,
    deviceId
  });

  const preflightSteps = (run.steps as ReloadStep[]).filter((step) =>
    ["compile-base", "compile-overlay", "dry-run-merge", "assert-effect"].includes(step.step)
  );
  const steps: ReloadStep[] = [
    ...preflightSteps,
    { step: "mount-target", outcome: "pending" },
    { step: "transfer-artifact", outcome: "pending" },
    { step: "trigger-reload", outcome: "pending" }
  ];

  const emptySnapshot = buildReloadSnapshot({
    targets: run.targets,
    artifactSha256: run.artifact.sha256,
    onDeviceDigest: null,
    integrityCheck: null
  });

  const markStep = (name: ReloadStep["step"], patch: Partial<ReloadStep>) => {
    steps.splice(
      0,
      steps.length,
      ...steps.map((step) => (step.step === name ? { ...step, ...patch } : step))
    );
  };

  let latestIntegrity: IntegrityCheckStrength | null = null;
  let latestSnapshot = emptySnapshot;

  const failAborted = async (error: unknown) => {
    const message = error instanceof Error && error.message.trim() ? error.message : "Deploy aborted due to an unexpected error.";
    const running = steps.find((step) => step.outcome === "running");
    if (running) {
      markStep(running.step, {
        outcome: "failed",
        completedAt: now().toISOString(),
        error: message
      });
    }
    return input.persistProgress({
      status: "failed",
      failureCode: "deploy-aborted",
      steps: [...steps],
      deviceId,
      bridgeId: deploy.bridgeId,
      bridgeMachineLabel: bridge.machineLabel,
      targetRef: deploy.targetRef,
      protocol: deploy.protocol,
      integrityCheck: latestIntegrity,
      reloadSnapshot: latestSnapshot,
      completedAt: now().toISOString()
    });
  };

  // Claim before lease so a lost race never releases another deployer's same-session lease.
  await input.persistProgress(
    {
      status: "deploying",
      failureCode: null,
      steps,
      deviceId,
      bridgeId: deploy.bridgeId,
      bridgeMachineLabel: bridge.machineLabel,
      targetRef: deploy.targetRef,
      protocol: deploy.protocol,
      integrityCheck: null,
      reloadSnapshot: emptySnapshot,
      completedAt: null
    },
    { claim: true }
  );

  // Everything after the claim runs inside try/finally: a throw during device/lease
  // setup must still drive the run to a terminal state via failAborted (never leave it
  // wedged in "deploying") and release the lease only when it was actually acquired.
  const leaseSessionId = `dts-reload:${run.id}`;
  let leaseAcquired = false;
  try {
    await ensureBridgeDebugDevice(input.db, {
      organizationId: auth.organization.id,
      deviceId,
      name: bridge.machineLabel,
      protocol: deploy.protocol
    });

    await ensureDtsReloadLeaseSession(input.db, {
      organizationId: auth.organization.id,
      sessionId: leaseSessionId,
      deviceId,
      bridgeId: deploy.bridgeId,
      bridgeMachineLabel: bridge.machineLabel,
      protocol: deploy.protocol,
      targetRef: deploy.targetRef,
      actorUserId: auth.user.id
    });

    const lease = await acquireDebugDeviceLease(input.db, {
      organizationId: auth.organization.id,
      deviceId,
      sessionId: leaseSessionId,
      actorUserId: auth.user.id,
      leaseTtlMs: computeReloadLeaseTtlMs({
        targetCount: run.targets.length,
        mountTimeoutMs,
        pushFileTimeoutMs,
        triggerTimeoutMs,
        kernelLogTimeoutMs,
        readNodeTimeoutMs
      })
    });
    if (!lease) {
      return await input.persistProgress({
        status: "failed",
        failureCode: "device-lease-held",
        steps: [...steps],
        deviceId,
        bridgeId: deploy.bridgeId,
        bridgeMachineLabel: bridge.machineLabel,
        targetRef: deploy.targetRef,
        protocol: deploy.protocol,
        integrityCheck: null,
        reloadSnapshot: emptySnapshot,
        completedAt: now().toISOString()
      });
    }
    leaseAcquired = true;

    // 1) Mount
    markStep("mount-target", { outcome: "running", startedAt: now().toISOString(), error: undefined });
    await input.persistProgress({
      status: "deploying",
      failureCode: null,
      steps: [...steps],
      deviceId,
      bridgeId: deploy.bridgeId,
      bridgeMachineLabel: bridge.machineLabel,
      targetRef: deploy.targetRef,
      protocol: deploy.protocol,
      integrityCheck: null,
      reloadSnapshot: emptySnapshot,
      completedAt: null
    });

    const mountResult = await deps.bridgeRpcClient.call(
      deploy.bridgeId,
      "debug.mountTarget",
      { protocol: deploy.protocol, targetRef: deploy.targetRef },
      { timeoutMs: mountTimeoutMs }
    );
    if (mountResult.ok !== true) {
      const message =
        typeof mountResult.error === "string" && mountResult.error.trim()
          ? mountResult.error
          : "Failed to mount the device writable target.";
      markStep("mount-target", {
        outcome: "failed",
        completedAt: now().toISOString(),
        error: message
      });
      return input.persistProgress({
        status: "failed",
        failureCode: "mount-target-failed",
        steps: [...steps],
        deviceId,
        bridgeId: deploy.bridgeId,
        bridgeMachineLabel: bridge.machineLabel,
        targetRef: deploy.targetRef,
        protocol: deploy.protocol,
        integrityCheck: null,
        reloadSnapshot: emptySnapshot,
        completedAt: now().toISOString()
      });
    }
    markStep("mount-target", { outcome: "passed", completedAt: now().toISOString() });

    // 2) Transfer
    markStep("transfer-artifact", { outcome: "running", startedAt: now().toISOString(), error: undefined });
    await input.persistProgress({
      status: "deploying",
      failureCode: null,
      steps: [...steps],
      deviceId,
      bridgeId: deploy.bridgeId,
      bridgeMachineLabel: bridge.machineLabel,
      targetRef: deploy.targetRef,
      protocol: deploy.protocol,
      integrityCheck: null,
      reloadSnapshot: emptySnapshot,
      completedAt: null
    });

    const contentSha256 = run.artifact.sha256.toLowerCase();
    const pushResult = await deps.bridgeRpcClient.call(
      deploy.bridgeId,
      "debug.pushFile",
      {
        protocol: deploy.protocol,
        targetRef: deploy.targetRef,
        destinationDirectory: configuration.destinationDirectory,
        destinationFilename: configuration.destinationFilename,
        contentBase64: artifactBytes.toString("base64"),
        contentSha256
      },
      { timeoutMs: pushFileTimeoutMs }
    );

    const integrityCheck =
      pushResult.integrityCheck === "sha256" ||
      pushResult.integrityCheck === "md5" ||
      pushResult.integrityCheck === "byte-length"
        ? pushResult.integrityCheck
        : null;
    const remoteDigest = typeof pushResult.remoteDigest === "string" ? pushResult.remoteDigest : null;
    const localDigest = typeof pushResult.localDigest === "string" ? pushResult.localDigest : null;

    const pushOk =
      pushResult.ok === true &&
      localDigest?.toLowerCase() === contentSha256 &&
      integrityCheck !== null &&
      remoteDigest !== null &&
      integrityMatches({
        strength: integrityCheck,
        artifactBytes,
        artifactSha256: contentSha256,
        remoteDigest
      });

    if (!pushOk) {
      const message =
        typeof pushResult.error === "string" && pushResult.error.trim()
          ? pushResult.error
          : remoteDigest && integrityCheck && localDigest?.toLowerCase() === contentSha256
            ? `On-device ${integrityCheck} integrity check did not match the compiled artifact.`
            : "Failed to transfer the compiled overlay to the device.";
      markStep("transfer-artifact", {
        outcome: "failed",
        completedAt: now().toISOString(),
        error: message,
        detail: {
          integrityCheck,
          localDigest,
          remoteDigest
        }
      });
      const failedSnapshot = buildReloadSnapshot({
        targets: run.targets,
        artifactSha256: contentSha256,
        onDeviceDigest: remoteDigest,
        integrityCheck
      });
      return input.persistProgress({
        status: "failed",
        failureCode:
          integrityCheck && remoteDigest && localDigest?.toLowerCase() === contentSha256
            ? "artifact-integrity-mismatch"
            : "transfer-artifact-failed",
        steps: [...steps],
        deviceId,
        bridgeId: deploy.bridgeId,
        bridgeMachineLabel: bridge.machineLabel,
        targetRef: deploy.targetRef,
        protocol: deploy.protocol,
        integrityCheck,
        reloadSnapshot: failedSnapshot,
        completedAt: now().toISOString()
      });
    }

    markStep("transfer-artifact", {
      outcome: "passed",
      completedAt: now().toISOString(),
      detail: { integrityCheck, localDigest, remoteDigest }
    });

    latestIntegrity = integrityCheck;
    latestSnapshot = buildReloadSnapshot({
      targets: run.targets,
      artifactSha256: contentSha256,
      onDeviceDigest: remoteDigest,
      integrityCheck
    });

    // 3) Trigger via existing writeNode with readBack disabled
    markStep("trigger-reload", { outcome: "running", startedAt: now().toISOString(), error: undefined });
    await input.persistProgress({
      status: "deploying",
      failureCode: null,
      steps: [...steps],
      deviceId,
      bridgeId: deploy.bridgeId,
      bridgeMachineLabel: bridge.machineLabel,
      targetRef: deploy.targetRef,
      protocol: deploy.protocol,
      integrityCheck: latestIntegrity,
      reloadSnapshot: latestSnapshot,
      completedAt: null
    });

    // Kernel log capture is unjudged evidence; run outcome is never derived from log text.
    // Captured after a successful trigger, and also after a failed/unconfirmed trigger — the log
    // is most valuable exactly when the reload went wrong (permission denied, parse errors).
    const captureKernelSignal = async () => {
      try {
        const captureResult = await deps.bridgeRpcClient.call(
          deploy.bridgeId,
          "debug.readKernelLog",
          {
            protocol: deploy.protocol,
            targetRef: deploy.targetRef,
            command: configuration.kernelLogCommand
          },
          { timeoutMs: kernelLogTimeoutMs }
        );
        const rawText = typeof captureResult.text === "string" ? captureResult.text : "";
        // Prefer non-empty verbatim text even when the bridge reports ok:false — kernel log lines
        // may look like tool diagnostics, and the capture is unjudged evidence either way.
        if (rawText.length > 0) {
          return buildObtainedKernelSignal({
            command: configuration.kernelLogCommand,
            rawText,
            truncated: captureResult.truncated === true,
            targets: run.targets
          });
        }
        if (captureResult.ok === true) {
          return buildNotObtainedKernelSignal({
            command: configuration.kernelLogCommand,
            captureError: "Kernel log capture returned no text."
          });
        }
        const message =
          typeof captureResult.error === "string" && captureResult.error.trim()
            ? captureResult.error
            : "Kernel log capture failed.";
        return buildNotObtainedKernelSignal({
          command: configuration.kernelLogCommand,
          captureError: message
        });
      } catch (error) {
        return buildNotObtainedKernelSignal({
          command: configuration.kernelLogCommand,
          captureError: error instanceof Error && error.message.trim() ? error.message : "Kernel log capture threw."
        });
      }
    };

    // A trigger RPC that throws (timeout / transport drop) is UNCONFIRMED: the write may have
    // reached the device and applied the overlay. Treat it as a distinct terminal that still
    // captures kernel evidence, and record residue defensively for ordinary runs (in the service
    // layer) so a restore-baseline is offered even though the deploy did not confirm.
    let triggerResult: Awaited<ReturnType<typeof deps.bridgeRpcClient.call>> | null = null;
    let triggerUnconfirmedMessage: string | null = null;
    try {
      triggerResult = await deps.bridgeRpcClient.call(
        deploy.bridgeId,
        "debug.writeNode",
        {
          protocol: deploy.protocol,
          targetRef: deploy.targetRef,
          nodePath: configuration.triggerNodePath,
          value: configuration.triggerPayload,
          readBack: false,
          preserveExactRead: false
        },
        { timeoutMs: triggerTimeoutMs }
      );
    } catch (error) {
      triggerUnconfirmedMessage =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Reload trigger write did not confirm (bridge RPC error).";
    }

    if (triggerUnconfirmedMessage !== null) {
      markStep("trigger-reload", {
        outcome: "failed",
        completedAt: now().toISOString(),
        error: triggerUnconfirmedMessage
      });
      return await input.persistProgress({
        status: "failed",
        failureCode: TRIGGER_RELOAD_UNCONFIRMED_FAILURE_CODE,
        steps: [...steps],
        deviceId,
        bridgeId: deploy.bridgeId,
        bridgeMachineLabel: bridge.machineLabel,
        targetRef: deploy.targetRef,
        protocol: deploy.protocol,
        integrityCheck,
        reloadSnapshot: buildReloadSnapshot({
          targets: run.targets,
          artifactSha256: contentSha256,
          onDeviceDigest: remoteDigest,
          integrityCheck,
          kernelSignal: await captureKernelSignal()
        }),
        completedAt: now().toISOString()
      });
    }

    if (triggerResult!.ok !== true) {
      const message =
        typeof triggerResult!.error === "string" && triggerResult!.error.trim()
          ? triggerResult!.error
          : "Failed to write the reload trigger node.";
      markStep("trigger-reload", {
        outcome: "failed",
        completedAt: now().toISOString(),
        error: message
      });
      return await input.persistProgress({
        status: "failed",
        failureCode: "trigger-reload-failed",
        steps: [...steps],
        deviceId,
        bridgeId: deploy.bridgeId,
        bridgeMachineLabel: bridge.machineLabel,
        targetRef: deploy.targetRef,
        protocol: deploy.protocol,
        integrityCheck,
        reloadSnapshot: buildReloadSnapshot({
          targets: run.targets,
          artifactSha256: contentSha256,
          onDeviceDigest: remoteDigest,
          integrityCheck,
          kernelSignal: await captureKernelSignal()
        }),
        completedAt: now().toISOString()
      });
    }

    markStep("trigger-reload", { outcome: "passed", completedAt: now().toISOString() });

    const kernelSignal = await captureKernelSignal();

    // Behavioural verification via existing debug.readNode only — after kernel log capture.
    // Kernel log remains unjudged evidence; outcomes come only from debug-node read-back.
    // Never fail the whole deploy after a successful trigger — degrade to unverifiable.
    let verification: {
      status: Extract<ReloadRunDto["status"], "verified" | "contradicted" | "unverifiable">;
      behaviouralVerification: BehaviouralVerificationDto;
    };
    try {
      verification = await verifyReloadTargetsBehaviourally({
        db: input.db,
        organizationId: auth.organization.id,
        targets: run.targets,
        protocol: deploy.protocol,
        bridgeId: deploy.bridgeId,
        targetRef: deploy.targetRef,
        bridgeRpcClient: deps.bridgeRpcClient,
        readTimeoutMs: readNodeTimeoutMs
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Behavioural verification aborted unexpectedly.";
      verification = {
        status: "unverifiable",
        behaviouralVerification: {
          outcomes: run.targets.map((target) => ({
            bindingId: target.bindingId,
            propertyKey: target.propertyKey,
            outcome: "read-failed" as const,
            debugNodeId: null,
            nodePath: null,
            expectedValue: target.debugValue,
            readValue: null,
            reason: message
          }))
        }
      };
    }

    const snapshot = buildReloadSnapshot({
      targets: run.targets,
      artifactSha256: contentSha256,
      onDeviceDigest: remoteDigest,
      integrityCheck,
      kernelSignal,
      behaviouralVerification: verification.behaviouralVerification
    });

    return input.persistProgress({
      status: verification.status,
      failureCode: null,
      steps: [...steps],
      deviceId,
      bridgeId: deploy.bridgeId,
      bridgeMachineLabel: bridge.machineLabel,
      targetRef: deploy.targetRef,
      protocol: deploy.protocol,
      integrityCheck,
      reloadSnapshot: snapshot,
      completedAt: now().toISOString()
    });
  } catch (error) {
    return failAborted(error);
  } finally {
    if (leaseAcquired) {
      await releaseDebugDeviceLease(input.db, {
        organizationId: auth.organization.id,
        deviceId,
        sessionId: leaseSessionId
      });
    }
  }
}
