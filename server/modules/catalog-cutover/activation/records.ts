import { isDeepStrictEqual } from "node:util";
import { digestOf } from "../../release-verification/core/digest";
import { ActivationRefusal, type ActivationBinding, type ActivationIntent } from "./interface";

export const refuse = (reason: string): never => { throw new ActivationRefusal(reason); };
const digest = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: unknown, expected: string[]) => record(value) && isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
const intentKeys = ["runId", "attemptId", "target", "planDigest", "predecessorBindingDigest", "reportDigest", "expectedObservationDigest"];

export function createActivationIntent(input: Omit<ActivationIntent, "inputDigest">): ActivationIntent {
  if (!keys(input, intentKeys) || !identifier(input.runId) || !identifier(input.attemptId) ||
      !keys(input.target, ["systemIdentifier", "databaseOid"]) || !/^\d+$/.test(input.target.systemIdentifier) || !/^\d+$/.test(input.target.databaseOid) ||
      !digest(input.planDigest) || !digest(input.reportDigest) || !digest(input.expectedObservationDigest) ||
      (input.predecessorBindingDigest !== null && !digest(input.predecessorBindingDigest))) refuse("INTENT-REJECTED");
  const fixed = structuredClone(input);
  return Object.freeze({ ...fixed, target: Object.freeze(fixed.target), inputDigest: digestOf(fixed) });
}

export function validateIntent(input: ActivationIntent): ActivationIntent {
  if (!keys(input, [...intentKeys, "inputDigest"])) refuse("INTENT-REJECTED");
  const { inputDigest, ...body } = input;
  const expected = createActivationIntent(body);
  if (inputDigest !== expected.inputDigest) refuse("INTENT-REJECTED");
  return expected;
}

export function decodeBinding(value: unknown): ActivationBinding {
  if (!keys(value, ["version", "intent", "mode", "sourceSnapshotFingerprint", "catalog", "mapping", "comparisonReportDigest", "bindingDigest"])) refuse("BINDING-INVALID");
  const binding = value as ActivationBinding;
  validateIntent(binding.intent);
  if (binding.version !== "pcat-activation-v1" || binding.mode !== "canonical" || !digest(binding.sourceSnapshotFingerprint) ||
      !keys(binding.catalog, ["releaseId", "releaseDigest", "compiledFingerprint", "databaseFingerprint"]) ||
      !identifier(binding.catalog.releaseId) || !digest(binding.catalog.releaseDigest) || !digest(binding.catalog.compiledFingerprint) || !digest(binding.catalog.databaseFingerprint) ||
      !keys(binding.mapping, ["epoch", "headDigest"]) || !digest(binding.mapping.epoch) || !digest(binding.mapping.headDigest) ||
      !digest(binding.comparisonReportDigest) || !digest(binding.bindingDigest)) refuse("BINDING-INVALID");
  const { bindingDigest, ...body } = binding;
  if (digestOf(body) !== bindingDigest) refuse("BINDING-INVALID");
  return structuredClone(binding);
}

/** Fold the entire append-only chain. SQL ordering/timestamps are never a
 * current-pointer selector. Multiple roots, forks and orphan links refuse. */
export function activationHead(records: readonly unknown[]): ActivationBinding | null {
  const bindings = records.map(decodeBinding);
  if (!bindings.length) return null;
  const digests = new Set<string>(), runs = new Set<string>(), attempts = new Set<string>();
  for (const row of bindings) {
    if (digests.has(row.bindingDigest) || runs.has(row.intent.runId) || attempts.has(row.intent.attemptId)) refuse("CHAIN-CONFLICT");
    digests.add(row.bindingDigest); runs.add(row.intent.runId); attempts.add(row.intent.attemptId);
  }
  const roots = bindings.filter(row => row.intent.predecessorBindingDigest === null);
  if (roots.length !== 1) refuse("CHAIN-CONFLICT");
  let head = roots[0]!;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(head.bindingDigest)) refuse("CHAIN-CONFLICT");
    seen.add(head.bindingDigest);
    const next = bindings.filter(row => row.intent.predecessorBindingDigest === head.bindingDigest);
    if (next.length > 1) refuse("CHAIN-CONFLICT");
    if (!next.length) break;
    head = next[0]!;
  }
  if (seen.size !== bindings.length) refuse("CHAIN-CONFLICT");
  return head;
}
