import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createActivationJournal } from "./activationJournal";
import { canonicalJson, commitJournalTransition, journalBytes, loadUpgradeJournal, openUpgradeJournal, sha256Prefixed,
  type ActivationIntentRecord, type ActivationBindingRecord } from "./journal";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const digest = (value: unknown) => sha256Prefixed(canonicalJson(value));
const pin = `sha256:${"a".repeat(64)}`;
function intent(attemptId = "attempt"): ActivationIntentRecord {
  const body = { runId: "cutover", attemptId, target: { systemIdentifier: "123", databaseOid: "456" }, planDigest: pin,
    predecessorBindingDigest: null, reportDigest: pin, expectedObservationDigest: pin };
  return { ...body, inputDigest: digest(body) };
}
function binding(request = intent()): ActivationBindingRecord {
  const body = { version: "pcat-activation-v1" as const, intent: request, mode: "canonical" as const,
    sourceSnapshotFingerprint: pin, catalog: { releaseId: "release", releaseDigest: pin, compiledFingerprint: pin, databaseFingerprint: pin },
    mapping: { epoch: "epoch", headDigest: pin }, comparisonReportDigest: pin };
  return { ...body, bindingDigest: digest(body) };
}
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "activation-journal-")); roots.push(root);
  const opened = openUpgradeJournal({ journalPath: path.join(root, "journal.json"), runId: "host" });
  if (!opened.ok) throw new Error("fixture-open-failed");
  const journal = opened.value;
  expect(commitJournalTransition(journal, { action: "bind-cutover", inputDigest: "bind", cutoverRunId: "cutover", toState: "idle", nextAction: "plan" }).ok).toBe(true);
  const assertBoundary = vi.fn(async () => {});
  const inspect = vi.fn(async (_intent: ActivationIntentRecord) => ({ kind: "applied" as const, binding: binding(), currentHeadDigest: binding().bindingDigest }));
  const options = { journal, target: intent().target, cutoverRunId: "cutover", assertBoundary, inspect };
  return { ...options, adapter: createActivationJournal(options), options };
}

it("requires durable pending before accepting the exact acknowledged domain binding", async () => {
  const f = fixture(); const before = journalBytes(f.journal.journalPath);
  await expect(f.adapter.committed(binding())).rejects.toThrow("PCAT-UPG-ACTIVATION");
  expect(journalBytes(f.journal.journalPath)).toEqual(before);
  await f.adapter.pending(intent());
  const loaded = loadUpgradeJournal({ journalPath: f.journal.journalPath, runId: "host" });
  expect(loaded.ok && loaded.value.record.entries.at(-1)?.activation).toMatchObject({ hostRunId: "host", outcome: "pending", intent: intent() });
  await f.adapter.committed(binding());
  expect(f.journal.record.entries.at(-1)?.activation).toEqual({ hostRunId: "host", outcome: "committed", intent: intent(), binding: binding() });
  expect(f.inspect).not.toHaveBeenCalled();
  expect(f.journal.record.state).toBe("idle");
});

it.each(["pending", "unknown"])("blocks another attempt and a fresh adapter acknowledgment after %s", async outcome => {
  const f = fixture(); await f.adapter.pending(intent());
  if (outcome === "unknown") await f.adapter.unknown(intent());
  const bytes = journalBytes(f.journal.journalPath);
  await expect(f.adapter.pending(intent("other"))).rejects.toThrow("PCAT-UPG-ACTIVATION");
  await expect(createActivationJournal(f.options).committed(binding())).rejects.toThrow("PCAT-UPG-ACTIVATION");
  if (outcome === "unknown") await expect(f.adapter.committed(binding())).rejects.toThrow("PCAT-UPG-ACTIVATION");
  expect(journalBytes(f.journal.journalPath)).toEqual(bytes);
});

it.each(["run", "target", "plan", "predecessor", "report", "observation", "numeric-id", "extra"])("rejects intent drift or malformed input: %s", async fault => {
  const f = fixture(); await f.adapter.pending(intent());
  const changed = structuredClone(intent()) as unknown as Record<string, unknown>;
  if (fault === "run") changed.runId = "other";
  if (fault === "target") changed.target = { systemIdentifier: "123", databaseOid: "999" };
  if (fault === "plan") changed.planDigest = digest("other");
  if (fault === "predecessor") changed.predecessorBindingDigest = digest("other");
  if (fault === "report") changed.reportDigest = digest("other");
  if (fault === "observation") changed.expectedObservationDigest = digest("other");
  if (fault === "numeric-id") changed.attemptId = 123;
  if (fault === "extra") changed.approved = true;
  const { inputDigest: _previous, ...body } = changed;
  changed.inputDigest = digest(body);
  const bytes = journalBytes(f.journal.journalPath);
  await expect(f.adapter.committed(binding(changed as unknown as ActivationIntentRecord))).rejects.toThrow("PCAT-UPG-ACTIVATION");
  expect(journalBytes(f.journal.journalPath)).toEqual(bytes);
});

it("keeps an immutable exact acknowledgment replay and rejects a different binding", async () => {
  const f = fixture(); await f.adapter.pending(intent()); await f.adapter.committed(binding());
  const bytes = journalBytes(f.journal.journalPath);
  await f.adapter.committed(binding());
  const changed = { ...binding(), catalog: { ...binding().catalog, releaseId: "different" } };
  const { bindingDigest: _old, ...body } = changed; changed.bindingDigest = digest(body);
  await expect(f.adapter.committed(changed)).rejects.toThrow("PCAT-UPG-ACTIVATION");
  await expect(f.adapter.pending(intent("other"))).rejects.toThrow("PCAT-UPG-ACTIVATION");
  expect(journalBytes(f.journal.journalPath)).toEqual(bytes);
});

it.each(["pending", "unknown"])("reconciles %s only using the full matching current domain readback", async outcome => {
  const f = fixture(); await f.adapter.pending(intent());
  if (outcome === "unknown") await f.adapter.unknown(intent());
  const fresh = createActivationJournal(f.options);
  await fresh.reconcile();
  expect(f.inspect).toHaveBeenCalledExactlyOnceWith(intent());
  expect(f.journal.record.entries.at(-1)?.activation).toEqual({ hostRunId: "host", outcome: "reconciled", intent: intent(), binding: binding() });
  await expect(fresh.pending(intent("other"))).rejects.toThrow("PCAT-UPG-ACTIVATION");
});

it.each(["boolean", "wrong-head", "wrong-attempt", "bad-binding-digest", "extra", "throw", "lost-lock", "changed-journal", "shared-journal-object"])("does not resolve unknown from an invalid inspection: %s", async fault => {
  const f = fixture(); await f.adapter.pending(intent()); await f.adapter.unknown(intent());
  const original = journalBytes(f.journal.journalPath);
  f.inspect.mockImplementationOnce(async () => {
    if (fault === "throw") throw new Error("private database connection string");
    if (fault === "lost-lock") f.assertBoundary.mockRejectedValueOnce(new Error("private lock diagnostic"));
    if (fault === "changed-journal") {
      const other = loadUpgradeJournal({ journalPath: f.journal.journalPath, runId: "host" });
      if (!other.ok) throw new Error("fixture-load-failed");
      expect(commitJournalTransition(other.value, { action: "inspection-note", inputDigest: "note", toState: "idle", nextAction: "plan" }).ok).toBe(true);
    }
    if (fault === "shared-journal-object") expect(commitJournalTransition(f.journal, {
      action: "inspection-note", inputDigest: "note", toState: "idle", nextAction: "plan" }).ok).toBe(true);
    const result = { kind: "applied", binding: binding(fault === "wrong-attempt" ? intent("other") : intent()), currentHeadDigest: binding().bindingDigest };
    if (fault === "wrong-head") result.currentHeadDigest = pin;
    if (fault === "bad-binding-digest") result.binding = { ...result.binding, bindingDigest: pin };
    return (fault === "boolean" ? true : fault === "extra" ? { ...result, approved: true } : result) as Awaited<ReturnType<typeof f.inspect>>;
  });
  await expect(createActivationJournal(f.options).reconcile()).rejects.toThrow(/^PCAT-UPG-ACTIVATION-JOURNAL-REFUSED$/);
  expect(f.journal.record.entries.filter(entry => entry.activation).at(-1)?.activation?.outcome).toBe("unknown");
  if (!["changed-journal", "shared-journal-object"].includes(fault)) expect(journalBytes(f.journal.journalPath)).toEqual(original);
});

it("records an exact not-applied readback without automatically retrying the old attempt", async () => {
  const f = fixture(); await f.adapter.pending(intent()); await f.adapter.unknown(intent());
  const fresh = createActivationJournal({ ...f.options, inspect: vi.fn(async () => ({ kind: "not-applied" as const, intent: intent(), currentHeadDigest: null })) });
  await fresh.reconcile();
  expect(f.journal.record.entries.at(-1)?.activation?.outcome).toBe("not-applied");
  await expect(fresh.pending(intent())).rejects.toThrow("PCAT-UPG-ACTIVATION");
  await fresh.pending(intent("explicit-new-attempt"));
  expect(f.journal.record.entries.at(-1)?.activation?.outcome).toBe("pending");
});

it.each(["target", "attempt"])("rejects a not-applied readback with a changed %s", async fault => {
  const f = fixture(); await f.adapter.pending(intent());
  const bytes = journalBytes(f.journal.journalPath);
  const fresh = createActivationJournal({ ...f.options, inspect: async () => ({ kind: "not-applied" as const,
    intent: fault === "attempt" ? intent("other") : intent(), currentHeadDigest: fault === "target" ? pin : null }) });
  await expect(fresh.reconcile()).rejects.toThrow("PCAT-UPG-ACTIVATION");
  expect(journalBytes(f.journal.journalPath)).toEqual(bytes);
});

it("copies caller intent before any asynchronous boundary and refuses concurrent adapter admission", async () => {
  const f = fixture(); let resume!: () => void;
  f.assertBoundary.mockImplementationOnce(() => new Promise<void>(resolve => { resume = resolve; }));
  const request = structuredClone(intent()); const starting = f.adapter.pending(request);
  Object.assign(request, { attemptId: "mutated" });
  await expect(f.adapter.pending(intent("concurrent"))).rejects.toThrow("PCAT-UPG-ACTIVATION");
  resume(); await starting;
  expect(f.journal.record.entries.at(-1)?.activation?.intent).toEqual(intent());
});

it.each(["missing", "state", "next-action", "plan", "cutover", "failure", "orphan", "cross-host", "bad-digest"])("enforces typed activation at the raw journal boundary: %s", fault => {
  const f = fixture(); const event = { hostRunId: fault === "cross-host" ? "other" : "host", outcome: fault === "orphan" ? "committed" as const : "pending" as const,
    intent: intent(), ...(fault === "orphan" ? { binding: binding() } : {}) };
  const bytes = journalBytes(f.journal.journalPath);
  const result = commitJournalTransition(f.journal, { action: `activation-${event.outcome}`, inputDigest: fault === "bad-digest" ? pin : digest(event),
    toState: fault === "state" ? "completed" : "idle", nextAction: fault === "next-action" ? "execute" : "plan",
    ...(fault === "missing" ? {} : { activation: event }), outcome: fault === "orphan" ? "committed" : "crashed",
    ...(fault === "plan" ? { planDigest: pin } : {}), ...(fault === "cutover" ? { cutoverRunId: "other" } : {}),
    ...(fault === "failure" ? { lastFailureCode: "fake" } : {}) });
  expect(result.ok).toBe(false); expect(journalBytes(f.journal.journalPath)).toEqual(bytes);
});

it("rejects a tampered event even when the outer journal digest was recomputed", async () => {
  const f = fixture(); await f.adapter.pending(intent());
  const record = JSON.parse(journalBytes(f.journal.journalPath).toString("utf8"));
  record.entries.at(-1).activation.hostRunId = "foreign-host";
  record.entries.at(-1).inputDigest = digest(record.entries.at(-1).activation);
  const { journalDigest: _old, ...body } = record; record.journalDigest = digest(body);
  writeFileSync(f.journal.journalPath, JSON.stringify(record));
  expect(loadUpgradeJournal({ journalPath: f.journal.journalPath, runId: "host" }).ok).toBe(false);
});

it("redacts a non-cloneable malformed request without writing intent", async () => {
  const f = fixture(); const before = journalBytes(f.journal.journalPath);
  const malformed = { ...intent(), privateSecret: function privateSecret() { return "private connection string"; } };
  await expect(f.adapter.pending(malformed)).rejects.toThrow(/^PCAT-UPG-ACTIVATION-JOURNAL-REFUSED$/);
  expect(journalBytes(f.journal.journalPath)).toEqual(before);
});
