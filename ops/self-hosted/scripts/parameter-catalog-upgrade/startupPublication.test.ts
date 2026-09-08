import { existsSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
const faults = vi.hoisted(() => ({ directoryInode: null as number | null }));
vi.mock("node:fs", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, fsyncSync(fd: number) {
    if (faults.directoryInode === fs.fstatSync(fd).ino) throw new Error("private-fsync-failure");
    return fs.fsyncSync(fd);
  } };
});
import { canonicalJson, commitJournalTransition, journalBytes, loadUpgradeJournal, openUpgradeJournal, sha256Prefixed,
  type StartupPublicationIntent, type StartupPublicationEvent, type UpgradeJournal } from "./journal";
import { reportPins } from "../../../../server/modules/release-verification/report/fixtures";
import { withHostOperationLock } from "./handoff";
import { openStartupPublicationStorage, prepareStartupPublication } from "./startupPublication";

const roots: string[] = [];
afterEach(() => { faults.directoryInode = null; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const digest = (value: unknown) => sha256Prefixed(canonicalJson(value));
const pin = digest("storage-only");
function fixture() {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), "startup-publication-")); roots.push(root);
  const opened = openUpgradeJournal({ journalPath: path.join(root, "journal.json"), runId: "host" });
  if (!opened.ok) throw new Error("fixture-open-failed");
  const journal = opened.value;
  expect(commitJournalTransition(journal, { action: "bind", inputDigest: "bind", cutoverRunId: "cutover", planDigest: pin,
    toState: "idle", nextAction: "plan" }).ok).toBe(true);
  return journal;
}
// Storage records only: no report is assembled/approved and no P13 effect is claimed.
function intent(): StartupPublicationIntent {
  const body = { hostRunId: "host", cutoverRunId: "cutover", attemptId: "publication-1",
    target: { systemIdentifier: "123", databaseOid: "456" }, activationBindingDigest: pin,
    generation: 1, predecessorDigest: null, boundary: {
      p13State: "retired", writerRetirementFingerprint: pin, runtimePinGeneration: pin,
      pins: { ...reportPins(), cutover: { ...reportPins().cutover, planDigest: pin } }, subject: { targetId: "target", deploymentClass: "self-hosted", environmentId: "isolated" },
      reportDigest: pin, phaseSnapshot: pin, predecessorReportDigests: [pin], pointerRollbackStatus: "open" as const, trafficIsolationState: "isolated" as const,
    } };
  return { ...body, intentDigest: digest(body) };
}
it("persists the complete typed publication intent through the public journal interface", () => {
  const journal = fixture();
  const publication = { outcome: "pending", intent: intent() };
  expect(commitJournalTransition(journal, { action: "startup-publication-pending", inputDigest: digest(publication),
    toState: "idle", nextAction: "plan", outcome: "crashed", publication } as Parameters<typeof commitJournalTransition>[1]).ok).toBe(true);
  const loaded = loadUpgradeJournal({ journalPath: journal.journalPath, runId: "host" });
  expect(loaded.ok && loaded.value.record.entries.at(-1)).toHaveProperty("publication", publication);
});

function append(journal: UpgradeJournal, event: StartupPublicationEvent) {
  return commitJournalTransition(journal, { action: `startup-publication-${event.outcome}`, inputDigest: digest(event),
    publication: event, outcome: event.outcome === "committed" ? "committed" : "crashed",
    toState: journal.record.state, nextAction: journal.record.nextAction });
}
function changed(change: Partial<StartupPublicationIntent>): StartupPublicationIntent {
  const { intentDigest: _digest, ...body } = { ...intent(), ...change };
  return { ...body, intentDigest: digest(body) };
}
it.each(["no-intent", "wrong-run", "wrong-cutover", "wrong-digest", "wrong-generation", "wrong-predecessor", "extra-field", "missing-pin", "not-retired", "empty-runtime-generation"])(
  "rejects malformed or out-of-order publication %s without changing durable bytes", fault => {
    const journal = fixture(); const original = journalBytes(journal.journalPath);
    let selected = intent();
    if (fault === "wrong-run") selected = changed({ hostRunId: "other" });
    if (fault === "wrong-cutover") selected = changed({ cutoverRunId: "other" });
    if (fault === "wrong-digest") selected = { ...selected, intentDigest: pin };
    if (fault === "wrong-generation") selected = changed({ generation: 2 });
    if (fault === "wrong-predecessor") selected = changed({ predecessorDigest: pin });
    if (fault === "extra-field") selected = changed({ boundary: { ...selected.boundary, passed: true } as typeof selected.boundary });
    if (fault === "missing-pin") { const pins = structuredClone(selected.boundary.pins); Reflect.deleteProperty(pins, "recovery"); selected = changed({ boundary: { ...selected.boundary, pins } }); }
    if (fault === "not-retired") selected = changed({ boundary: { ...selected.boundary, p13State: "not-started" } });
    if (fault === "empty-runtime-generation") selected = changed({ boundary: { ...selected.boundary, runtimePinGeneration: "" } });
    expect(append(journal, { intent: selected, outcome: fault === "no-intent" ? "committed" : "pending" }).ok).toBe(false);
    expect(journalBytes(journal.journalPath)).toEqual(original);
  });
it("requires the exact pending intent for commit and does not recommit unknown", () => {
  const journal = fixture(), selected = intent();
  expect(append(journal, { intent: selected, outcome: "pending" }).ok).toBe(true);
  expect(append(journal, { intent: changed({ attemptId: "other" }), outcome: "committed" }).ok).toBe(false);
  expect(append(journal, { intent: selected, outcome: "unknown" }).ok).toBe(true);
  const bytes = journalBytes(journal.journalPath);
  expect(append(journal, { intent: selected, outcome: "committed" }).ok).toBe(false);
  expect(append(journal, { intent: changed({ attemptId: "other", generation: 2, predecessorDigest: selected.intentDigest }), outcome: "pending" }).ok).toBe(false);
  expect(journalBytes(journal.journalPath)).toEqual(bytes);
});
it("CAS advances only an explicit same-target predecessor and never replays an older generation", () => {
  const journal = fixture(), first = intent();
  expect(append(journal, { intent: first, outcome: "pending" }).ok).toBe(true);
  expect(append(journal, { intent: first, outcome: "committed" }).ok).toBe(true);
  const next = changed({ attemptId: "publication-2", generation: 2, predecessorDigest: first.intentDigest });
  expect(append(journal, { intent: next, outcome: "pending" }).ok).toBe(true);
  const bytes = journalBytes(journal.journalPath);
  expect(append(journal, { intent: first, outcome: "committed" }).ok).toBe(false);
  expect(journalBytes(journal.journalPath)).toEqual(bytes);
  expect(append(journal, { intent: next, outcome: "committed" }).ok).toBe(true);
  expect(append(journal, { intent: changed({ attemptId: "publication-3", generation: 3, predecessorDigest: next.intentDigest,
    target: { systemIdentifier: "123", databaseOid: "999" } }), outcome: "pending" }).ok).toBe(false);
});

it("uses the genuine same-directory host lock and snapshots the pending selection", async () => {
  const journal = fixture(), selected = intent();
  const before = journalBytes(journal.journalPath);
  const forged = openStartupPublicationStorage({ journal, lock: { async assertHeld() {} } });
  await expect(forged.pending(selected)).rejects.toMatchObject({ reason: "boundary-unavailable" });
  expect(journalBytes(journal.journalPath)).toEqual(before);
  await withHostOperationLock(path.dirname(journal.journalPath), async lock => {
    const storage = openStartupPublicationStorage({ journal, lock });
    const pending = storage.pending(selected);
    Object.assign(selected.boundary.subject, { targetId: "mutated" });
    await pending;
    const original = intent();
    await storage.committed(original.intentDigest);
    const result = await storage.inspect({ attemptId: original.attemptId, intentDigest: original.intentDigest });
    expect(result).toEqual({ scope: "publication-storage-only", event: { intent: original, outcome: "committed" } });
  });
});

it("a fresh adapter cannot promote pending or unknown, and stale memory cannot append", async () => {
  const journal = fixture(), selected = intent();
  const stale = loadUpgradeJournal({ journalPath: journal.journalPath, runId: "host" });
  if (!stale.ok) throw new Error("fixture-load-failed");
  await withHostOperationLock(path.dirname(journal.journalPath), async lock => {
    const storage = openStartupPublicationStorage({ journal, lock });
    await storage.pending(selected);
    const fresh = openStartupPublicationStorage({ journal, lock });
    await expect(fresh.committed(selected.intentDigest)).rejects.toMatchObject({ reason: "intent-mismatch" });
    await expect(openStartupPublicationStorage({ journal: stale.value, lock }).pending(selected)).rejects.toMatchObject({ reason: "journal-unavailable" });
    await storage.unknown(selected.intentDigest);
    await expect(storage.committed(selected.intentDigest)).rejects.toMatchObject({ reason: "intent-mismatch" });
    const reopened = openStartupPublicationStorage({ journal, lock });
    expect((await reopened.inspect({ attemptId: selected.attemptId, intentDigest: selected.intentDigest })).event.outcome).toBe("unknown");
  });
});

it("does not adopt an unrelated durable append through the shared journal object", async () => {
  const journal = fixture();
  await withHostOperationLock(path.dirname(journal.journalPath), async lock => {
    const storage = openStartupPublicationStorage({ journal, lock });
    expect(commitJournalTransition(journal, { action: "other-owner-write", inputDigest: pin, toState: "idle", nextAction: "plan" }).ok).toBe(true);
    const bytes = journalBytes(journal.journalPath);
    await expect(storage.pending(intent())).rejects.toMatchObject({ reason: "journal-unavailable" });
    expect(journalBytes(journal.journalPath)).toEqual(bytes);
  });
});

it("refuses a released genuine host lock without writing an intent", async () => {
  const journal = fixture();
  let storage: ReturnType<typeof openStartupPublicationStorage> | undefined;
  await withHostOperationLock(path.dirname(journal.journalPath), async lock => { storage = openStartupPublicationStorage({ journal, lock }); });
  const bytes = journalBytes(journal.journalPath);
  await expect(storage!.pending(intent())).rejects.toMatchObject({ reason: "boundary-unavailable" });
  expect(journalBytes(journal.journalPath)).toEqual(bytes);
});

it("keeps failed directory fsync uncertain and never clears the durable write lock", async () => {
  const journal = fixture(), selected = intent();
  await withHostOperationLock(path.dirname(journal.journalPath), async lock => {
    const storage = openStartupPublicationStorage({ journal, lock });
    await storage.pending(selected);
    faults.directoryInode = statSync(path.dirname(journal.journalPath)).ino;
    await expect(storage.committed(selected.intentDigest)).rejects.toMatchObject({ reason: "journal-unavailable" });
    faults.directoryInode = null;
    expect(existsSync(`${journal.journalPath}.write-lock`)).toBe(true);
    expect(loadUpgradeJournal({ journalPath: journal.journalPath, runId: "host", requireSettled: true }).ok).toBe(false);
    // Renamed bytes are diagnostic, not an acknowledged durable publication.
    const diagnostic = loadUpgradeJournal({ journalPath: journal.journalPath, runId: "host" });
    expect(diagnostic.ok && diagnostic.value.record.entries.at(-1)?.publication?.outcome).toBe("committed");
    await expect(storage.inspect({ attemptId: selected.attemptId, intentDigest: selected.intentDigest })).rejects.toMatchObject({ reason: "journal-unavailable" });
  });
});

it.each(["pending", "committed"] as const)("reads back exact %s storage after the issuing process is terminated", async outcome => {
  const journal = fixture(), selected = intent();
  const script = `import { loadUpgradeJournal } from './ops/self-hosted/scripts/parameter-catalog-upgrade/journal.ts';
import { withHostOperationLock } from './ops/self-hosted/scripts/parameter-catalog-upgrade/handoff.ts';
import { openStartupPublicationStorage } from './ops/self-hosted/scripts/parameter-catalog-upgrade/startupPublication.ts';
const loaded=loadUpgradeJournal({journalPath:process.argv[1],runId:'host'});
if(!loaded.ok) process.exit(2);
await withHostOperationLock(process.argv[2],async lock=>{
 const storage=openStartupPublicationStorage({journal:loaded.value,lock});
 const intent=JSON.parse(process.argv[3]);
 await storage.pending(intent);
 if(process.argv[4]==='committed') await storage.committed(intent.intentDigest);
});
process.stdout.write('durable-intent-ready\\n');
setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script,
    journal.journalPath, path.dirname(journal.journalPath), JSON.stringify(selected), outcome], {
    cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = ""; child.stderr.on("data", chunk => { stderr += chunk; });
  const closed = once(child, "close");
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const ready = new Promise<void>((resolve, reject) => {
      let text = "";
      child.stdout.on("data", chunk => { text += chunk; if (text === "durable-intent-ready\n") resolve(); });
      child.once("error", () => reject(new Error("child-start-failed")));
      child.once("exit", () => reject(new Error("child-ended-before-ready")));
      deadline = setTimeout(() => reject(new Error("child-ready-deadline")), 5000);
    });
    await ready;
    clearTimeout(deadline);
    child.kill("SIGTERM");
    expect((await closed)[1]).toBe("SIGTERM");
    expect(stderr).toBe("");
    const reopened = loadUpgradeJournal({ journalPath: journal.journalPath, runId: "host", requireSettled: true });
    if (!reopened.ok) throw new Error("fixture-reopen-failed");
    await withHostOperationLock(path.dirname(journal.journalPath), async lock => {
      const storage = openStartupPublicationStorage({ journal: reopened.value, lock });
      expect(await storage.inspect({ attemptId: selected.attemptId, intentDigest: selected.intentDigest })).toEqual({ scope: "publication-storage-only", event: { intent: selected, outcome } });
      await expect(storage.committed(selected.intentDigest)).rejects.toMatchObject({ reason: "intent-mismatch" });
    });
  } finally { clearTimeout(deadline); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await closed; }
});

it("the formal publisher cannot use caller JSON, a login-fence flag or an absent P12 as startup authority", async () => {
  const journal = fixture(), before = journalBytes(journal.journalPath);
  await withHostOperationLock(path.dirname(journal.journalPath), async lock => {
    const reports = { query: vi.fn(() => { throw new Error("must-not-query"); }) };
    const options = { journal, lock, activation: { target: intent().target, reports },
      boundary: intent().boundary, p13State: "retired", authenticationFenced: true };
    await expect(prepareStartupPublication(options as unknown as Parameters<typeof prepareStartupPublication>[0])).rejects.toMatchObject({ reason: "activation-unavailable" });
    expect(reports.query).not.toHaveBeenCalled();
  });
  expect(journalBytes(journal.journalPath)).toEqual(before);
});
