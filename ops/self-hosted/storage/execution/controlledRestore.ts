import { verifyRecoveryPackage, type RecoveryBootstrapIdentity, type VerifiedRecoveryPackage } from "../recoveryPackage";
import type { RecoveryTargetIdentity } from "../recoveryPoint";
import { recoveryRefuse, sameRecoveryIdentity, ControlledRecoveryRefusal } from "../controlledRecovery";
import type { RecoveryPackageAdapter, RecoveryRestoreBinding } from "./packageRestore";
import { isRecoveryExecutionAuthorization, type RecoveryExecutionAuthorization } from "./authorization";
const safeFailure = (error: unknown): Error => error instanceof ControlledRecoveryRefusal ? error : new ControlledRecoveryRefusal("controlled-recovery-operation-failed");

export type ControlledRecoveryTarget = {
  observe(): Promise<RecoveryTargetIdentity>;
  assertEmptyAndIsolated(): Promise<void>;
  assertBootstrap?(bootstrap?: RecoveryBootstrapIdentity): Promise<void>;
  restorePostgres(backup: Pick<VerifiedRecoveryPackage, "postgres" | "roles" | "bootstrap">): Promise<void>;
  restoreObjects(objects: VerifiedRecoveryPackage["objects"]): Promise<void>;
  restoreRedis(redis: VerifiedRecoveryPackage["redis"]): Promise<void>;
};
/** Uses the existing package verifier and restore journal. The target adapter
 * receives package bytes plus its own secret closure, never a source adapter. */
export function buildControlledRecoveryTarget(input: {
  target: RecoveryTargetIdentity;
  authorization: RecoveryExecutionAuthorization;
}, destination: ControlledRecoveryTarget): RecoveryPackageAdapter {
  if (!isRecoveryExecutionAuthorization(input.authorization)) recoveryRefuse("execution-authorization-required");
  input = { ...input, target: Object.freeze({ ...input.target }) };
  let binding: RecoveryRestoreBinding | undefined;
  const check = async () => {
    if (!sameRecoveryIdentity(await destination.observe(), input.target)) recoveryRefuse("restore-target-drift");
    if (binding) await input.authorization.assertAuthorized(binding);
  };
  return {
    target: input.target,
    async assertBootstrap(bootstrap) {
      try {
        if (destination.assertBootstrap) await destination.assertBootstrap(bootstrap);
        else if (bootstrap) recoveryRefuse("restore-bootstrap-unsupported");
      } catch (error) { throw safeFailure(error); }
    },
    async authorize(presented) {
      try { binding = structuredClone(presented); await check(); }
      catch (error) { throw safeFailure(error); }
    },
    async assertEmptyAndIsolated() { try { await destination.assertEmptyAndIsolated(); } catch (error) { throw safeFailure(error); } },
    async restore(backup) {
      try {
        if (!binding || backup.digest !== input.authorization.packageDigest) recoveryRefuse("execution-authorization-required");
        // Even the internal adapter must not accept caller-invented dump bytes.
        // The only material dispatched below is freshly read from the approved package.
        backup = await verifyRecoveryPackage(input.authorization.directory, input.authorization.packageDigest);
        await input.authorization.begin(binding);
        await check(); await destination.restorePostgres({ postgres: backup.postgres, roles: backup.roles, ...(backup.bootstrap ? { bootstrap: backup.bootstrap } : {}) });
        await input.authorization.committed("postgres");
        await check(); await destination.restoreObjects(backup.objects);
        await input.authorization.committed("objects");
        await check(); await destination.restoreRedis(backup.redis);
        await input.authorization.committed("redis");
        // Redis stays stopped: acceptance of a recovered queue is a separate action.
        await check(); await input.authorization.complete();
      } catch (error) { input.authorization.unknown(); throw safeFailure(error); }
    },
  };
}
