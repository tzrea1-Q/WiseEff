import { lstat, readdir } from "node:fs/promises";
import { captureRecoveryPackage, verifyRecoveryPackage, type RecoveryPackageInput, type RecoveryPackageTarget, type RecoveryRestoreBinding, type VerifiedRecoveryPackage } from "./recoveryPackage";
import type { RecoveryTargetIdentity } from "./recoveryPoint";

export type ControlledBoundaryReceipt = {
  readonly runId: string;
  readonly target: RecoveryTargetIdentity;
  readonly digest: string;
  readonly observedAt: string;
  readonly expiresAt: string;
};
/** Server-owned adapter to the existing controller's persisted, approved writer
 * boundary. Neither command-line JSON nor a caller boolean implements this port. */
export type ControlledRecoveryBoundary = {
  acquire(input: { runId: string; target: RecoveryTargetIdentity }): Promise<ControlledBoundaryReceipt>;
  verify(receipt: ControlledBoundaryReceipt): Promise<void>;
};
export type ControlledRecoverySource = {
  observe(): Promise<RecoveryTargetIdentity>;
  /** Acquires actual source locks; closes without resuming any writer. */
  open(): Promise<{
    postgres(): Promise<Pick<RecoveryPackageInput, "postgres" | "roles">>;
    objects(): Promise<RecoveryPackageInput["objects"]>;
    redis(): Promise<RecoveryPackageInput["redis"]>;
    close(): Promise<void>;
  }>;
};
export class ControlledRecoveryRefusal extends Error {}
export const recoveryRefuse = (reason: string): never => { throw new ControlledRecoveryRefusal(`controlled-recovery-${reason}`); };
const identityKeys = ["deploymentId", "hostFingerprint", "postgresIdentity", "objectStoreIdentity", "redisIdentity"] as const;
export const sameRecoveryIdentity = (left: RecoveryTargetIdentity, right: RecoveryTargetIdentity): boolean =>
  identityKeys.every(key => typeof left?.[key] === "string" && left[key].length > 0 && left[key] === right?.[key]);
const safeFailure = (error: unknown): Error => error instanceof ControlledRecoveryRefusal ? error : new ControlledRecoveryRefusal("controlled-recovery-operation-failed");

/** Captures a bounded package from live stores under one independently verified
 * writer boundary. It never fences writers, approves, restores, or cleans up. */
export async function captureControlledRecovery(
  input: { directory: string; runId: string; target: RecoveryTargetIdentity },
  source: ControlledRecoverySource,
  boundary: ControlledRecoveryBoundary,
) {
  input = { ...input, target: Object.freeze({ ...input.target }) };
  let opened: Awaited<ReturnType<ControlledRecoverySource["open"]>> | undefined;
  try {
    const stat = await lstat(input.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || (await readdir(input.directory)).length) recoveryRefuse("private-empty-directory-required");
    if (!/^[A-Za-z0-9_-]+$/.test(input.runId)) recoveryRefuse("run-invalid");
    const issued = await boundary.acquire({ runId: input.runId, target: { ...input.target } });
    const receipt = Object.freeze({ ...issued, target: Object.freeze({ ...issued.target }) });
    const check = async () => {
      const now = Date.now();
      if (receipt.runId !== input.runId || !sameRecoveryIdentity(receipt.target, input.target) || !/^[a-f0-9]{64}$/.test(receipt.digest)
        || !Number.isFinite(Date.parse(receipt.observedAt)) || Date.parse(receipt.observedAt) > now
        || now - Date.parse(receipt.observedAt) > 24 * 60 * 60 * 1000
        || !Number.isFinite(Date.parse(receipt.expiresAt)) || Date.parse(receipt.expiresAt) <= now) recoveryRefuse("boundary-mismatch");
      await boundary.verify(receipt);
      if (!sameRecoveryIdentity(await source.observe(), input.target)) recoveryRefuse("source-identity-drift");
    };
    await check();
    opened = await source.open();
    await check();
    const database = await opened.postgres();
    await check();
    const objects = await opened.objects();
    await check();
    const redis = await opened.redis();
    await check();
    const digest = await captureRecoveryPackage(input.directory, {
      runId: input.runId, target: input.target,
      quiescence: { status: "quiesced", writersFenced: true, queueDrained: true, proxyStopped: true, observedAt: receipt.observedAt },
      ...database, objects, redis,
    });
    await check();
    const verified = await verifyRecoveryPackage(input.directory, digest);
    return { packageDigest: digest, boundaryDigest: receipt.digest, manifest: verified.manifest.recovery,
      status: "captured-not-restored" as const };
  } catch (error) { throw safeFailure(error); }
  finally {
    if (opened) { try { await opened.close(); } catch { recoveryRefuse("source-close-unknown"); } }
  }
}

export type ControlledRecoveryTarget = {
  observe(): Promise<RecoveryTargetIdentity>;
  assertEmptyAndIsolated(): Promise<void>;
  restorePostgres(backup: Pick<VerifiedRecoveryPackage, "postgres" | "roles">): Promise<void>;
  restoreObjects(objects: VerifiedRecoveryPackage["objects"]): Promise<void>;
  restoreRedis(redis: VerifiedRecoveryPackage["redis"]): Promise<void>;
};
/** Uses the existing package verifier and restore journal. The target adapter
 * receives package bytes plus its own secret closure, never a source adapter. */
export function createControlledRecoveryTarget(input: {
  target: RecoveryTargetIdentity; journalPath: string;
  authorize(binding: RecoveryRestoreBinding): Promise<void>;
}, destination: ControlledRecoveryTarget): RecoveryPackageTarget {
  input = { ...input, target: Object.freeze({ ...input.target }) };
  const check = async () => {
    if (!sameRecoveryIdentity(await destination.observe(), input.target)) recoveryRefuse("restore-target-drift");
  };
  return {
    target: input.target, journalPath: input.journalPath,
    async authorize(binding) { try { await check(); await input.authorize(binding); } catch (error) { throw safeFailure(error); } },
    async assertEmptyAndIsolated() { try { await check(); await destination.assertEmptyAndIsolated(); } catch (error) { throw safeFailure(error); } },
    async restore(backup) {
      try {
        await check(); await destination.restorePostgres({ postgres: backup.postgres, roles: backup.roles });
        await check(); await destination.restoreObjects(backup.objects);
        await check(); await destination.restoreRedis(backup.redis);
        // Redis stays stopped: acceptance of a recovered queue is a separate action.
        await check();
      } catch (error) { throw safeFailure(error); }
    },
  };
}
