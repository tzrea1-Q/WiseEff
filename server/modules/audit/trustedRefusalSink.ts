import { TrustedInvocationContextError } from "../auth/trustedInvocation";
import { writeTrustedRefusalAudit } from "./auditedWrite";
import type { TrustedAuditEventInput } from "./trustedAudit";
import { isRootDatabase, type RootDatabase } from "../../shared/database/client";

const trustedRefusalAuditSinkBrand = Symbol("wiseeff.trusted-refusal-audit-sink");

/** A refusal writer that is bound to a server-owned pool root, never a caller transaction. */
export type TrustedRefusalAuditSink = {
  readonly [trustedRefusalAuditSinkBrand]: true;
  readonly write: (input: TrustedAuditEventInput) => Promise<void>;
};

const trustedRefusalAuditSinks = new WeakSet<object>();

/** Construct the only sink accepted by DTS reload mutation contexts. */
export function createTrustedRefusalAuditSink(rootDatabase: RootDatabase): TrustedRefusalAuditSink {
  if (!isRootDatabase(rootDatabase)) {
    throw new TrustedInvocationContextError(
      "refusal audit sink requires a server-owned PostgreSQL root database"
    );
  }

  const sink: TrustedRefusalAuditSink = {
    [trustedRefusalAuditSinkBrand]: true,
    write: (input) => writeTrustedRefusalAudit(rootDatabase, input)
  };
  Object.freeze(sink);
  trustedRefusalAuditSinks.add(sink);
  return sink;
}

/** Validate the private sink brand before any refusal or domain work is attempted. */
export function assertTrustedRefusalAuditSink(value: unknown): asserts value is TrustedRefusalAuditSink {
  if (
    typeof value !== "object" ||
    value === null ||
    !Object.isFrozen(value) ||
    !trustedRefusalAuditSinks.has(value) ||
    Reflect.get(value, trustedRefusalAuditSinkBrand) !== true
  ) {
    throw new TrustedInvocationContextError(
      "refusal audit sink must come from the server-owned PostgreSQL pool assembly"
    );
  }
}
