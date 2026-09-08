import { mkdir, mkdtemp, readFile, realpath, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type pg from "pg";
import * as domain from "../../../../server/modules/catalog-cutover/activation";
import * as reports from "../../../../server/modules/release-verification/report";
import { validPrepare } from "../../../../server/modules/release-verification/report/fixtures";
import { digestOf } from "../../../../server/modules/release-verification/core/digest";
import type { ReleaseVerificationReport } from "../../../../server/modules/release-verification/core";
import type { Database } from "../../../../server/shared/database/client";
import { openActivationController } from "./activationController";
import { openUpgradeJournal, journalBytes, commitJournalTransition, loadUpgradeJournal } from "./journal";
import { withHostOperationLock } from "./handoff";

afterEach(() => vi.restoreAllMocks());
const pin = `sha256:${"a".repeat(64)}`;
function bindingFor(intent: domain.ActivationIntent): domain.ActivationBinding {
  const body = { version: "pcat-activation-v1" as const, intent, mode: "canonical" as const, sourceSnapshotFingerprint: pin,
    catalog: { releaseId: "release", releaseDigest: pin, compiledFingerprint: pin, databaseFingerprint: pin },
    mapping: { epoch: pin, headDigest: pin }, comparisonReportDigest: pin };
  return { ...body, bindingDigest: digestOf(body) };
}
async function fixture(body: (f: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "activation-controller-")));
  try { await withHostOperationLock(root, async lock => body(await makeFixture(root, lock))); }
  finally { await rm(root, { recursive: true, force: true }); }
}
async function makeFixture(root: string, lock: Parameters<Parameters<typeof withHostOperationLock>[1]>[0]) {
  const opened = openUpgradeJournal({ journalPath: path.join(root, "journal.json"), runId: "host" });
  if (!opened.ok) throw new Error("fixture-journal-failed");
  const journal = opened.value;
  if (!commitJournalTransition(journal, { action: "bind", inputDigest: "bind", cutoverRunId: "cutover", planDigest: pin,
    toState: "cutover-completed", nextAction: "prepareVerification" }).ok) throw new Error("fixture-bind-failed");
  const prepared = validPrepare();
  const observed = { activation: { pins: prepared.pins, subject: prepared.subject, phaseSnapshot: "P10",
    predecessorReportDigests: [], pointerRollbackStatus: "open" as const, trafficIsolationState: "isolated" as const,
    initialReadMode: "legacy" as const, comparisonReportDigest: pin },
    phase: { p12State: "not-started" as const, p13State: "not-started", writerRetirementFingerprint: null, runtimePinGeneration: null } };
  const db: Database = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })), transaction: async body => body(db) };
  const owner = { target: { systemIdentifier: "123", databaseOid: "456" }, managementPool: {} as pg.Pool, reports: db,
    verify: vi.fn(async () => {}), observe: vi.fn(async () => observed) };
  let domainOptions: domain.ActivationOptions;
  let inspected: domain.ActivationInspection | undefined;
  const read = vi.fn(async (intent: domain.ActivationIntent): Promise<domain.ActivationInspection> => inspected ??
    { kind: "not-applied", intent, currentHeadDigest: intent.predecessorBindingDigest });
  const apply = vi.fn(async (intent: domain.ActivationIntent) => {
    await domainOptions.journal.pending(intent);
    const binding = bindingFor(intent);
    await domainOptions.journal.committed(binding);
    inspected = { kind: "applied", binding, currentHeadDigest: binding.bindingDigest };
    return binding;
  });
  // Adapter-only effect seam. Host lock, release dispatcher and host journal
  // remain real; this does not execute PostgreSQL or prove an approved P12.
  vi.spyOn(domain, "createApplicationReadActivation").mockImplementation(options => {
    domainOptions = options;
    return { inspect: read, apply, inspectFacts: vi.fn(async () => ({ currentBinding: null })) } as unknown as ReturnType<typeof domain.createApplicationReadActivation>;
  });
  const request = { action: "activate-p12" as const, attemptId: "attempt", reportDigest: pin };
  const controller = openActivationController({ journal, lock, owner });
  const approveProjectionFixture = () => {
    const report = { digest: pin, purpose: "pre-activation", decision: "passed", pins: observed.activation.pins,
      phaseSnapshot: "P10", predecessorReportDigests: [], pointerRollbackStatus: "open", evidenceRefs: [{ subject: observed.activation.subject }] } as unknown as ReleaseVerificationReport;
    vi.spyOn(reports, "createVerificationReportService").mockReturnValue({ readReport: vi.fn(async () => ({ kind: "present", report })) } as unknown as reports.VerificationReportService);
  };
  return { root, lock, journal, owner, observed, db, controller, request, apply, read, approveProjectionFixture,
    get domainOptions() { return domainOptions!; }, setInspection(value: domain.ActivationInspection) { inspected = value; } };
}

it("refuses a structural lock before observing a target or touching its journal", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "activation-controller-")));
  try {
    const opened = openUpgradeJournal({ journalPath: path.join(root, "journal.json"), runId: "host" });
    if (!opened.ok) throw new Error("fixture-journal-failed");
    const before = journalBytes(opened.value.journalPath);
    const verify = vi.fn(async () => {});
    const controller = openActivationController({ journal: opened.value, lock: { assertHeld: verify },
      owner: { verify } } as never);
    await expect(controller.dispatch({ action: "activate-p12", attemptId: "attempt", reportDigest: `sha256:${"a".repeat(64)}` }))
      .rejects.toThrow("PCAT-UPG-ACTIVATION-CONTROLLER-REFUSED");
    expect(verify).not.toHaveBeenCalled();
    expect(journalBytes(opened.value.journalPath)).toEqual(before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("uses the actual Report absent result without creating an activation intent", async () => fixture(async f => {
  const before = journalBytes(f.journal.journalPath);
  expect(await f.controller.dispatch(f.request)).toEqual({ action: "activate-p12", admission: { ok: false, reason: "absent" } });
  expect(f.db.query).toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
  expect(journalBytes(f.journal.journalPath)).toEqual(before);
}));

it("keeps the actual Report unapproved result separate from a stored passed field", async () => fixture(async f => {
  vi.mocked(f.db.query).mockResolvedValueOnce({ rows: [{ purpose: "pre-activation", decision: "passed", digest: pin }], rowCount: 1 });
  expect(await f.controller.dispatch(f.request)).toMatchObject({ admission: { ok: false, reason: "unapproved" } });
  expect(f.apply).not.toHaveBeenCalled(); expect(f.journal.record.entries.some(entry => entry.activation)).toBe(false);
}));

it("records acknowledged adapter effects in the actual journal without changing controller phase", async () => fixture(async f => {
  f.approveProjectionFixture();
  const result = await f.controller.dispatch(f.request);
  expect(result).toMatchObject({ action: "activate-p12", admission: { ok: true } });
  expect(f.journal.record.entries.filter(entry => entry.activation).map(entry => entry.activation!.outcome)).toEqual(["pending", "committed"]);
  expect(f.journal.record.state).toBe("cutover-completed");
  expect(f.apply).toHaveBeenCalledOnce();
  const bytes = journalBytes(f.journal.journalPath);
  expect(await f.controller.dispatch({ action: "inspect-activation", attemptId: "attempt" })).toMatchObject({ inspection: { kind: "applied" } });
  expect(journalBytes(f.journal.journalPath)).toEqual(bytes);
  await expect(f.controller.dispatch(f.request)).rejects.toThrow("PCAT-UPG-ACTIVATION-CONTROLLER-REFUSED");
  expect(f.apply).toHaveBeenCalledOnce();
}));

it("cannot report activation success when its domain returns without a committed binding", async () => fixture(async f => {
  f.approveProjectionFixture();
  f.apply.mockResolvedValueOnce(undefined as never);
  await expect(f.controller.dispatch(f.request)).rejects.toThrow("PCAT-UPG-ACTIVATION-CONTROLLER-REFUSED");
  expect(f.journal.record.entries.some(entry => entry.activation)).toBe(false);
}));

it("preserves unknown and reconciles the exact persisted intent without apply or new observation", async () => fixture(async f => {
  f.approveProjectionFixture();
  f.apply.mockImplementationOnce(async intent => {
    await f.domainOptions.journal.pending(intent);
    await f.domainOptions.journal.unknown(intent);
    throw new Error("password=private");
  });
  expect(await f.controller.dispatch(f.request)).toMatchObject({ admission: { ok: false, reason: "unknown-outcome" } });
  const reopened = loadUpgradeJournal({ journalPath: f.journal.journalPath, runId: "host" });
  if (!reopened.ok) throw new Error("fixture-reopen-failed");
  expect(reopened.value.record.entries.at(-1)?.activation?.outcome).toBe("unknown");
  const resumed = openActivationController({ journal: reopened.value, lock: f.lock, owner: f.owner });
  await expect(resumed.dispatch({ ...f.request, attemptId: "another" })).rejects.toThrow("PCAT-UPG-ACTIVATION-CONTROLLER-REFUSED");
  f.owner.observe.mockRejectedValue(new Error("must not observe or run comparison again"));
  expect(await resumed.dispatch({ action: "reconcile-activation", attemptId: "attempt" })).toEqual({ action: "reconcile-activation", outcome: "not-applied" });
  expect(f.read).toHaveBeenCalledOnce(); expect(f.apply).toHaveBeenCalledOnce();
  expect(reopened.value.record.entries.at(-1)?.activation?.outcome).toBe("not-applied");
}));

it("keeps an interrupted pending effect and refuses a cross-attempt SQL readback", async () => fixture(async f => {
  f.approveProjectionFixture();
  f.apply.mockImplementationOnce(async intent => {
    await f.domainOptions.journal.pending(intent);
    throw new Error("simulated-process-interruption");
  });
  expect(await f.controller.dispatch(f.request)).toMatchObject({ admission: { reason: "unknown-outcome" } });
  const event = f.journal.record.entries.at(-1)!.activation!;
  expect(event.outcome).toBe("pending");
  const bytes = journalBytes(f.journal.journalPath);
  const { inputDigest: _inputDigest, ...prior } = event.intent;
  const altered = domain.createActivationIntent({ ...prior, attemptId: "another" });
  f.setInspection({ kind: "not-applied", intent: altered, currentHeadDigest: null });
  await expect(f.controller.dispatch({ action: "reconcile-activation", attemptId: "attempt" })).rejects.toThrow("PCAT-UPG-ACTIVATION-CONTROLLER-REFUSED");
  expect(journalBytes(f.journal.journalPath)).toEqual(bytes);
  expect(f.apply).toHaveBeenCalledOnce();
}));

it.each([false, true])("reconciles an acknowledged SQL binding only at the exact current head (stale=%s)", async stale => fixture(async f => {
  f.approveProjectionFixture();
  f.apply.mockImplementationOnce(async intent => {
    await f.domainOptions.journal.pending(intent);
    const binding = bindingFor(intent);
    f.setInspection({ kind: "applied", binding, currentHeadDigest: stale ? pin : binding.bindingDigest });
    await f.domainOptions.journal.unknown(intent);
    throw new Error("simulated-lost-SQL-acknowledgment");
  });
  expect(await f.controller.dispatch(f.request)).toMatchObject({ admission: { reason: "unknown-outcome" } });
  const before = journalBytes(f.journal.journalPath);
  if (stale) {
    await expect(f.controller.dispatch({ action: "reconcile-activation", attemptId: "attempt" })).rejects.toThrow("PCAT-UPG-ACTIVATION-CONTROLLER-REFUSED");
    expect(journalBytes(f.journal.journalPath)).toEqual(before);
  } else {
    expect(await f.controller.dispatch({ action: "reconcile-activation", attemptId: "attempt" })).toEqual({ action: "reconcile-activation", outcome: "reconciled" });
    expect(f.journal.record.entries.at(-1)?.activation?.outcome).toBe("reconciled");
  }
  expect(f.apply).toHaveBeenCalledOnce();
}));

it.each(["other-action", "extra-pins", "wrong-attempt", "missing-report"])("refuses %s without a pending effect", async fault => fixture(async f => {
  const input = fault === "other-action" ? { ...f.request, action: "start-candidate" } : fault === "extra-pins" ? { ...f.request, pins: {} } :
    fault === "wrong-attempt" ? { action: "reconcile-activation", attemptId: "another" } : { ...f.request, reportDigest: " " };
  if (fault === "missing-report") expect(await f.controller.dispatch(input as never)).toMatchObject({ admission: { reason: "missing-report" } });
  else await expect(f.controller.dispatch(input as never)).rejects.toThrow("PCAT-UPG-ACTIVATION-CONTROLLER-REFUSED");
  expect(f.apply).not.toHaveBeenCalled(); expect(f.journal.record.entries.some(entry => entry.activation)).toBe(false);
}));

it("rejects a shared observation object changed during report read", async () => fixture(async f => {
  f.approveProjectionFixture();
  const projection = reports.createVerificationReportService({ db: f.db });
  vi.mocked(reports.createVerificationReportService).mockImplementation(() => ({ readReport: async () => {
    const result = structuredClone(await projection.readReport(pin));
    f.observed.activation.phaseSnapshot = "changed";
    return result;
  } }) as unknown as reports.VerificationReportService);
  expect(await f.controller.dispatch(f.request)).toMatchObject({ admission: { ok: false, reason: "unknown-outcome" } });
  expect(f.apply).not.toHaveBeenCalled();
}));

it("rejects reentrant dispatch and preserves private owner failures", async () => fixture(async f => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  f.owner.verify.mockImplementationOnce(async () => { await waiting; });
  const first = f.controller.dispatch(f.request);
  try { await expect(f.controller.dispatch(f.request)).rejects.toThrow("PCAT-UPG-ACTIVATION-CONTROLLER-REFUSED"); }
  finally { release(); }
  await first;
  f.owner.verify.mockRejectedValue(new Error("password=private"));
  await expect(f.controller.dispatch(f.request)).rejects.toThrow(/^PCAT-UPG-ACTIVATION-CONTROLLER-REFUSED$/);
}));

it("refuses another component's journal mutation during owner verification", async () => fixture(async f => {
  f.owner.verify.mockImplementationOnce(async () => {
    if (!commitJournalTransition(f.journal, { action: "concurrent-component", inputDigest: "other", toState: f.journal.record.state,
      nextAction: f.journal.record.nextAction }).ok) throw new Error("fixture-mutation-failed");
  });
  await expect(f.controller.dispatch(f.request)).rejects.toThrow("PCAT-UPG-ACTIVATION-CONTROLLER-REFUSED");
  expect(f.owner.observe).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
}));

it("does not adopt a changed journal from a late owner observation", async () => fixture(async f => {
  f.owner.observe.mockImplementationOnce(async () => {
    if (!commitJournalTransition(f.journal, { action: "late-component", inputDigest: "late", toState: f.journal.record.state,
      nextAction: f.journal.record.nextAction }).ok) throw new Error("fixture-mutation-failed");
    return f.observed;
  });
  await expect(f.controller.dispatch(f.request)).rejects.toThrow("PCAT-UPG-ACTIVATION-CONTROLLER-REFUSED");
  expect(f.db.query).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
}));

it("refuses a lock from another actual journal directory", async () => fixture(async f => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "activation-controller-wrong-")));
  try {
    const opened = openUpgradeJournal({ journalPath: path.join(root, "journal.json"), runId: "host" });
    if (!opened.ok) throw new Error("fixture-journal-failed");
    await expect(openActivationController({ journal: opened.value, lock: f.lock, owner: f.owner }).dispatch(f.request))
      .rejects.toThrow("PCAT-UPG-ACTIVATION-CONTROLLER-REFUSED");
    expect(f.owner.verify).not.toHaveBeenCalled();
  } finally { await rm(root, { recursive: true, force: true }); }
}));

it("refuses an issued lock after its actual holder has exited", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "activation-controller-ended-")));
  try {
    let f!: Awaited<ReturnType<typeof makeFixture>>;
    await withHostOperationLock(root, async lock => { f = await makeFixture(root, lock); });
    await expect(f.controller.dispatch(f.request)).rejects.toThrow("PCAT-UPG-ACTIVATION-CONTROLLER-REFUSED");
    expect(f.owner.verify).not.toHaveBeenCalled();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("preserves pending in the original directory when the actual host root is replaced after intent", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "activation-controller-replaced-")));
  const moved = `${root}-original`;
  try {
    await expect(withHostOperationLock(root, async lock => {
      const f = await makeFixture(root, lock);
      f.approveProjectionFixture();
      f.apply.mockImplementationOnce(async intent => {
        await f.domainOptions.journal.pending(intent);
        await rename(root, moved); await mkdir(root, { mode: 0o700 });
        throw new Error("simulated-lock-root-replacement");
      });
      await expect(f.controller.dispatch(f.request)).rejects.toThrow("PCAT-UPG-ACTIVATION-CONTROLLER-REFUSED");
      const record = JSON.parse(await readFile(path.join(moved, "journal.json"), "utf8"));
      expect(record.entries.at(-1).activation.outcome).toBe("pending");
      await expect(readFile(path.join(root, "journal.json"))).rejects.toMatchObject({ code: "ENOENT" });
      await rm(root, { recursive: true }); await rename(moved, root);
    })).rejects.toThrow("handoff-lock-lost");
  } finally {
    await rm(root, { recursive: true, force: true }); await rm(moved, { recursive: true, force: true });
  }
});
