import { existsSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

const faults = vi.hoisted(() => ({ directoryInode: null as number | null }));
vi.mock("node:fs", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, fsyncSync(fd: number) {
    if (faults.directoryInode === fs.fstatSync(fd).ino) throw Object.assign(new Error("synthetic-fsync-failure"), { code: "EIO" });
    return fs.fsyncSync(fd);
  } };
});

import {
  commitJournalTransition,
  journalBytes,
  loadUpgradeJournal,
  openUpgradeJournal,
  canonicalJson,
  sha256Prefixed,
  type RecoveryCaptureEvent,
} from "./journal";
import { openCatalogUpgradeController } from "./controller";

const tempJournal = (): string =>
  path.join(mkdtempSync(path.join(tmpdir(), "s11-upg-journal-")), "journal.json");

describe("S11-UPG journal", () => {
  it("compares the complete in-memory record before appending, not its claimed digest alone", () => {
    const opened = openUpgradeJournal({ journalPath: tempJournal(), runId: "cas" });
    if (!opened.ok) throw new Error("fixture-open-failed");
    const journal = opened.value;
    expect(commitJournalTransition(journal, { action: "first", inputDigest: "first", toState: "idle", nextAction: "plan" }).ok).toBe(true);
    const bytes = journalBytes(journal.journalPath);
    Object.assign(journal.record.entries[0]!, { action: "altered-history" });
    expect(commitJournalTransition(journal, { action: "second", inputDigest: "second", toState: "idle", nextAction: "plan" }).ok).toBe(false);
    expect(journalBytes(journal.journalPath)).toEqual(bytes);
  });
  it("does not silently discard a typed activation pending payload", () => {
    const opened = openUpgradeJournal({ journalPath: tempJournal(), runId: "host" });
    if (!opened.ok) throw new Error("fixture-open-failed");
    const journal = opened.value;
    expect(commitJournalTransition(journal, { action: "bind-cutover", inputDigest: "bind", cutoverRunId: "cutover",
      toState: "idle", nextAction: "plan" }).ok).toBe(true);
    const body = { runId: "cutover", attemptId: "activation", target: { systemIdentifier: "123", databaseOid: "456" },
      planDigest: `sha256:${"a".repeat(64)}`, predecessorBindingDigest: null,
      reportDigest: `sha256:${"b".repeat(64)}`, expectedObservationDigest: `sha256:${"c".repeat(64)}` };
    const activation = { hostRunId: "host", outcome: "pending", intent: { ...body, inputDigest: sha256Prefixed(canonicalJson(body)) } };
    expect(commitJournalTransition(journal, { action: "activation-pending", inputDigest: sha256Prefixed(canonicalJson(activation)),
      toState: "idle", nextAction: "plan", outcome: "crashed", activation } as Parameters<typeof commitJournalTransition>[1]).ok).toBe(true);
    const loaded = loadUpgradeJournal({ journalPath: journal.journalPath, runId: "host" });
    expect(loaded.ok && loaded.value.record.entries.at(-1)).toHaveProperty("activation", activation);
  });
  it("retains an uncertain activation persistence lock after directory fsync fails", () => {
    const journalPath = tempJournal();
    const opened = openUpgradeJournal({ journalPath, runId: "host" });
    if (!opened.ok) throw new Error("fixture-open-failed");
    const journal = opened.value;
    expect(commitJournalTransition(journal, { action: "bind-cutover", inputDigest: "bind", cutoverRunId: "cutover",
      toState: "idle", nextAction: "plan" }).ok).toBe(true);
    const body = { runId: "cutover", attemptId: "activation", target: { systemIdentifier: "123", databaseOid: "456" },
      planDigest: `sha256:${"a".repeat(64)}`, predecessorBindingDigest: null,
      reportDigest: `sha256:${"b".repeat(64)}`, expectedObservationDigest: `sha256:${"c".repeat(64)}` };
    const activation = { hostRunId: "host", outcome: "pending" as const, intent: { ...body, inputDigest: sha256Prefixed(canonicalJson(body)) } };
    faults.directoryInode = statSync(path.dirname(journalPath)).ino;
    try {
      expect(commitJournalTransition(journal, { action: "activation-pending", inputDigest: sha256Prefixed(canonicalJson(activation)),
        toState: "idle", nextAction: "plan", outcome: "crashed", activation }).ok).toBe(false);
      expect(existsSync(`${journalPath}.write-lock`)).toBe(true);
      expect(loadUpgradeJournal({ journalPath, runId: "host", requireSettled: true }).ok).toBe(false);
      const diagnostic = loadUpgradeJournal({ journalPath, runId: "host" });
      expect(diagnostic.ok && diagnostic.value.record.entries.at(-1)?.activation?.outcome).toBe("pending");
    } finally { faults.directoryInode = null; }
  });
  it.each(["valid", "orphan", "cross-run", "reference", "principal", "target", "hash-only", "started", "unknown", "pending-capture", "phase", "next-action"])("persists only capture-bound typed recovery approval: %s", fault => {
    const opened = openUpgradeJournal({ journalPath: tempJournal(), runId: "approval" });
    if (!opened.ok) throw new Error("fixture-open-failed");
    const journal = opened.value;
    const source = { deploymentId: "source", hostFingerprint: "host", postgresIdentity: "pg", objectStoreIdentity: "objects", redisIdentity: "redis" };
    const capture = { runId: "approval", source, packageDigest: "a".repeat(64), recoveryPointDigest: `sha256:${"b".repeat(64)}`, boundaryDigest: "c".repeat(64) };
    const pending: RecoveryCaptureEvent = { attemptId: "capture", runId: "approval", outcome: "pending", source,
      directory: { path: "/private/synthetic-package", device: "1", inode: "2" } };
    const append = (action: string, inputDigest: string) => commitJournalTransition(journal, { action, inputDigest, toState: "idle", nextAction: "plan" });
    if (fault !== "orphan") {
      for (const event of [pending, { ...pending, outcome: "committed" as const, capture }]) {
        expect(commitJournalTransition(journal, { action: event.outcome === "pending" ? "recovery-capture-pending" : "recovery-package-captured",
          inputDigest: sha256Prefixed(canonicalJson(event.outcome === "pending" ? event : capture)), toState: "idle", nextAction: "plan",
          outcome: event.outcome === "pending" ? "crashed" : "committed", recoveryCapture: event }).ok).toBe(true);
      }
    }
    const body = { assignmentDigest: `sha256:${"d".repeat(64)}`, runId: fault === "cross-run" ? "other" : "approval", attemptId: "restore",
      captureDigest: sha256Prefixed(canonicalJson(capture)), target: { ...source, deploymentId: "target" },
      principal: { userId: "operator", organizationId: "organization" }, traceId: "trace", expiresAt: "2099-01-01T00:00:00.000Z" };
    const event = { approval: { runId: body.runId, attemptId: body.attemptId, captureDigest: body.captureDigest, target: body.target,
      expiresAt: body.expiresAt, approvalReference: sha256Prefixed(canonicalJson(body)) },
      assignmentDigest: body.assignmentDigest, principal: body.principal, traceId: body.traceId };
    if (fault === "reference") event.approval.approvalReference = `sha256:${"e".repeat(64)}`;
    if (fault === "principal") event.principal.userId = "different";
    if (fault === "target") event.approval.target.postgresIdentity = "different";
    const inputDigest = sha256Prefixed(canonicalJson(event.approval));
    if (fault === "hash-only") expect(append("recovery-execution-authorized", inputDigest).ok).toBe(true);
    if (fault === "started" || fault === "unknown") expect(append(fault === "started" ? "recovery-execution-started" : "recovery-execution-outcome-unknown", "previous").ok).toBe(true);
    if (fault === "pending-capture") {
      const next = { ...pending, attemptId: "next-capture" };
      expect(commitJournalTransition(journal, { action: "recovery-capture-pending", inputDigest: sha256Prefixed(canonicalJson(next)),
        toState: "idle", nextAction: "plan", outcome: "crashed", recoveryCapture: next }).ok).toBe(true);
    }
    const before = journalBytes(journal.journalPath);
    const draft = { action: "recovery-execution-authorized", inputDigest, toState: fault === "phase" ? "completed" as const : "idle" as const,
      nextAction: fault === "next-action" ? "execute" as const : "plan" as const, recoveryApproval: event };
    expect(commitJournalTransition(journal, draft).ok).toBe(fault === "valid");
    if (fault === "valid") {
      const loaded = loadUpgradeJournal({ journalPath: journal.journalPath, runId: "approval" });
      expect(loaded.ok && loaded.value.record.entries.at(-1)?.recoveryApproval).toEqual(event);
      expect(commitJournalTransition(journal, draft)).toMatchObject({ ok: true, value: { replayed: true } });
      const laterBody = { ...body, attemptId: "next-restore" };
      const laterEvent = { ...event, approval: { ...event.approval, attemptId: "next-restore", approvalReference: sha256Prefixed(canonicalJson(laterBody)) } };
      expect(commitJournalTransition(journal, { ...draft, inputDigest: sha256Prefixed(canonicalJson(laterEvent.approval)), recoveryApproval: laterEvent }).ok).toBe(true);
      const latest = journalBytes(journal.journalPath);
      expect(commitJournalTransition(journal, draft).ok).toBe(false);
      expect(journalBytes(journal.journalPath)).toEqual(latest);
    } else expect(journalBytes(journal.journalPath)).toEqual(before);
  });
  it.each(["phase-change", "numeric-inode", "numeric-attempt"])("does not coerce or grant phases through capture metadata: %s", fault => {
    const opened = openUpgradeJournal({ journalPath: tempJournal(), runId: "capture" });
    if (!opened.ok) throw new Error("fixture-open-failed");
    const event = { attemptId: fault === "numeric-attempt" ? 1 : "capture-one", runId: "capture", outcome: "pending",
      source: { deploymentId: "isolated", hostFingerprint: "host", postgresIdentity: "pg", objectStoreIdentity: "objects", redisIdentity: "redis" },
      directory: { path: "/private/synthetic-package", device: "1", inode: fault === "numeric-inode" ? 2 : "2" } };
    const before = journalBytes(opened.value.journalPath);
    expect(commitJournalTransition(opened.value, { action: "recovery-capture-pending", inputDigest: sha256Prefixed(canonicalJson(event)),
      toState: fault === "phase-change" ? "completed" : "idle", nextAction: "plan", outcome: "crashed",
      recoveryCapture: event as RecoveryCaptureEvent }).ok).toBe(false);
    expect(journalBytes(opened.value.journalPath)).toEqual(before);
  });
  it("does not promote a historical hash-only capture by replaying a typed payload", () => {
    const opened = openUpgradeJournal({ journalPath: tempJournal(), runId: "capture" });
    if (!opened.ok) throw new Error("fixture-open-failed");
    const source = { deploymentId: "isolated", hostFingerprint: "host", postgresIdentity: "pg", objectStoreIdentity: "objects", redisIdentity: "redis" };
    const capture = { runId: "capture", source, packageDigest: "a".repeat(64), recoveryPointDigest: `sha256:${"b".repeat(64)}`, boundaryDigest: "c".repeat(64) };
    const draft = { action: "recovery-package-captured", inputDigest: sha256Prefixed(canonicalJson(capture)), toState: "idle" as const, nextAction: "plan" as const };
    expect(commitJournalTransition(opened.value, draft).ok).toBe(true);
    const before = journalBytes(opened.value.journalPath);
    expect(commitJournalTransition(opened.value, { ...draft, recoveryCapture: { attemptId: "capture-one", runId: "capture", outcome: "committed", source,
      directory: { path: "/private/synthetic-package", device: "1", inode: "2" }, capture } }).ok).toBe(false);
    expect(journalBytes(opened.value.journalPath)).toEqual(before);
  });
  it("persists typed capture intent and outcome without promoting an old hash-only record", () => {
    const journalPath = tempJournal();
    const opened = openUpgradeJournal({ journalPath, runId: "capture" });
    if (!opened.ok) throw new Error("fixture-open-failed");
    const source = { deploymentId: "isolated", hostFingerprint: "host", postgresIdentity: "pg", objectStoreIdentity: "objects", redisIdentity: "redis" };
    const pending: RecoveryCaptureEvent = { attemptId: "capture-one", runId: "capture", outcome: "pending", source,
      directory: { path: "/private/synthetic-package", device: "1", inode: "2" } };
    expect(commitJournalTransition(opened.value, { action: "recovery-capture-pending", inputDigest: sha256Prefixed(canonicalJson(pending)),
      toState: "idle", nextAction: "plan", outcome: "crashed", recoveryCapture: pending }).ok).toBe(true);
    const capture = { runId: "capture", source, packageDigest: "a".repeat(64), recoveryPointDigest: `sha256:${"b".repeat(64)}`, boundaryDigest: "c".repeat(64) };
    const committed: RecoveryCaptureEvent = { ...pending, outcome: "committed", capture };
    expect(commitJournalTransition(opened.value, { action: "recovery-package-captured", inputDigest: sha256Prefixed(canonicalJson(capture)),
      toState: "idle", nextAction: "plan", recoveryCapture: committed }).ok).toBe(true);
    const loaded = loadUpgradeJournal({ journalPath, runId: "capture" });
    expect(loaded.ok && loaded.value.record.entries.at(-1)?.recoveryCapture).toEqual(committed);
  });

  it.each(["cross-run", "wrong-action", "changed-source", "orphan", "payload-hash", "packageDigest", "recoveryPointDigest", "boundaryDigest",
    "nextAction", "planDigest", "cutoverRunId", "verificationPlanDigest", "verificationAttemptDigest"])("refuses typed capture %s before publishing a new journal", fault => {
    const journalPath = tempJournal();
    const opened = openUpgradeJournal({ journalPath, runId: "capture" });
    if (!opened.ok) throw new Error("fixture-open-failed");
    const source = { deploymentId: "isolated", hostFingerprint: "host", postgresIdentity: "pg", objectStoreIdentity: "objects", redisIdentity: "redis" };
    const pending: RecoveryCaptureEvent = { attemptId: "capture-one", runId: "capture", outcome: "pending", source,
      directory: { path: "/private/synthetic-package", device: "1", inode: "2" } };
    if (fault !== "orphan") expect(commitJournalTransition(opened.value, { action: "recovery-capture-pending", inputDigest: sha256Prefixed(canonicalJson(pending)),
      toState: "idle", nextAction: "plan", outcome: "crashed", recoveryCapture: pending }).ok).toBe(true);
    const capture = { runId: fault === "cross-run" ? "other" : "capture", source: fault === "changed-source" ? { ...source, postgresIdentity: "other" } : source,
      packageDigest: "a".repeat(64), recoveryPointDigest: `sha256:${"b".repeat(64)}`, boundaryDigest: "c".repeat(64) };
    const event: RecoveryCaptureEvent = { ...pending, outcome: "committed", capture };
    if (["packageDigest", "recoveryPointDigest", "boundaryDigest"].includes(fault)) {
      const field = fault as "packageDigest" | "recoveryPointDigest" | "boundaryDigest";
      Object.assign(capture, { [field]: [capture[field]] });
    }
    const control = ["planDigest", "cutoverRunId", "verificationPlanDigest", "verificationAttemptDigest"].includes(fault) ? { [fault]: "changed" } : {};
    const before = journalBytes(journalPath);
    expect(commitJournalTransition(opened.value, { action: fault === "wrong-action" ? "plan" : "recovery-package-captured",
      inputDigest: fault === "payload-hash" ? "wrong" : sha256Prefixed(canonicalJson(capture)),
      toState: "idle", nextAction: fault === "nextAction" ? "execute" : "plan", ...control, recoveryCapture: event }).ok).toBe(false);
    expect(journalBytes(journalPath)).toEqual(before);
  });
  it("keeps rename-then-fsync failure inspectable but blocks a reopened controller before owners", async () => {
    const journalPath = tempJournal();
    const opened = openUpgradeJournal({ journalPath, runId: "rename-unknown" });
    if (!opened.ok) throw new Error("fixture-open-failed");
    faults.directoryInode = statSync(path.dirname(journalPath)).ino;
    try {
      expect(commitJournalTransition(opened.value, { action: "plan", inputDigest: "uncertain-plan", toState: "planned", nextAction: "execute" }).ok).toBe(false);
    } finally { faults.directoryInode = null; }
    expect(existsSync(`${journalPath}.write-lock`)).toBe(true);
    const diagnostic = loadUpgradeJournal({ journalPath, runId: "rename-unknown" });
    expect(diagnostic.ok && diagnostic.value.record.state).toBe("planned");
    const owner = vi.fn(() => { throw new Error("must-not-call-owner"); });
    const reopened = openCatalogUpgradeController({ journalPath, runId: "rename-unknown", cutover: { plan: owner, execute: owner, inspect: owner, recover: owner }, verification: { prepareVerification: owner, runVerification: owner } });
    if (!reopened.ok) throw new Error("fixture-reopen-failed");
    for (const action of ["plan", "execute", "resume", "runVerification"]) {
      const result = await reopened.value.dispatch({ action });
      expect(result.ok ? "unexpected-success" : result.error.code).toBe("PCAT-UPG-UNKNOWN-OUTCOME");
    }
    expect(owner).not.toHaveBeenCalled();
  });
  it("does not treat a directory left by failed parent fsync as durable on retry", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "upg-directory-durability-"));
    const directory = path.join(parent, "created", "child");
    const journalPath = path.join(directory, "run.json");
    faults.directoryInode = statSync(parent).ino;
    try {
      expect(openUpgradeJournal({ journalPath, runId: "directory" }).ok).toBe(false);
      expect(existsSync(path.join(parent, "created"))).toBe(true);
      expect(openUpgradeJournal({ journalPath, runId: "directory" }).ok).toBe(false);
    } finally { faults.directoryInode = null; }
    expect(openUpgradeJournal({ journalPath, runId: "directory" }).ok).toBe(true);
  });
  it("rejects a stale handle instead of overwriting another committed transition", () => {
    const journalPath = tempJournal();
    const first = openUpgradeJournal({ journalPath, runId: "cas" });
    const stale = openUpgradeJournal({ journalPath, runId: "cas" });
    if (!first.ok || !stale.ok) throw new Error("fixture-open-failed");
    expect(commitJournalTransition(first.value, { action: "plan", inputDigest: "plan", toState: "planned", nextAction: "execute" }).ok).toBe(true);
    const before = journalBytes(journalPath);
    expect(commitJournalTransition(stale.value, { action: "execute", inputDigest: "other", toState: "executing", nextAction: "inspect" }).ok).toBe(false);
    expect(journalBytes(journalPath)).toEqual(before);
  });

  it("refuses a journal symlink before reading or replacing its target", () => {
    const journalPath = tempJournal();
    const original = openUpgradeJournal({ journalPath, runId: "link" });
    expect(original.ok).toBe(true);
    const link = `${journalPath}.link`;
    symlinkSync(journalPath, link);
    expect(loadUpgradeJournal({ journalPath: link, runId: "link" }).ok).toBe(false);
  });
  it("T1 commits a legal transition and replays it without rewriting bytes", () => {
    const journalPath = tempJournal();
    const opened = openUpgradeJournal({ journalPath, runId: "run-legal" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const first = commitJournalTransition(opened.value, {
      action: "plan",
      inputDigest: "sha256:plan-input",
      toState: "planned",
      nextAction: "execute",
      planDigest: "sha256:plan-1",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.snapshot.state).toBe("planned");
    expect(first.value.snapshot.entryCount).toBe(1);
    expect(first.value.replayed).toBe(false);
    const committed = journalBytes(journalPath);

    const replay = commitJournalTransition(opened.value, {
      action: "plan",
      inputDigest: "sha256:plan-input",
      toState: "planned",
      nextAction: "execute",
      planDigest: "sha256:plan-1",
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.replayed).toBe(true);
    expect(replay.value.snapshot.entryCount).toBe(1);
    expect(journalBytes(journalPath).equals(committed)).toBe(true);
  });

  it("T2 leaves journal bytes unchanged when the caller does not commit", () => {
    const journalPath = tempJournal();
    const opened = openUpgradeJournal({ journalPath, runId: "run-illegal" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const before = journalBytes(journalPath);
    expect(opened.value.snapshot.state).toBe("idle");
    expect(journalBytes(journalPath).equals(before)).toBe(true);
  });

  it("T3 reloads the same run after a crash-shaped execute entry", () => {
    const journalPath = tempJournal();
    const firstOpen = openUpgradeJournal({ journalPath, runId: "run-crash" });
    expect(firstOpen.ok).toBe(true);
    if (!firstOpen.ok) return;

    const planned = commitJournalTransition(firstOpen.value, {
      action: "plan",
      inputDigest: "sha256:plan-input",
      toState: "planned",
      nextAction: "execute",
      planDigest: "sha256:plan-1",
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    const crashed = commitJournalTransition(firstOpen.value, {
      action: "execute",
      inputDigest: "sha256:execute-input",
      toState: "executing",
      nextAction: "inspect",
      planDigest: "sha256:plan-1",
      outcome: "crashed",
      lastFailureCode: "PCAT-ORC-CRASH",
    });
    expect(crashed.ok).toBe(true);
    if (!crashed.ok) return;
    const persisted = JSON.parse(readFileSync(journalPath, "utf8")) as {
      runId: string;
      state: string;
      nextAction: string;
      entries: readonly unknown[];
    };
    expect(persisted.runId).toBe("run-crash");
    expect(persisted.state).toBe("executing");
    expect(persisted.nextAction).toBe("inspect");

    const resumed = loadUpgradeJournal({ journalPath, runId: "run-crash" });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value.snapshot.runId).toBe("run-crash");
    expect(resumed.value.snapshot.state).toBe("executing");
    expect(resumed.value.snapshot.entryCount).toBe(2);
    expect(resumed.value.snapshot.nextAction).toBe("inspect");
    expect(resumed.value.snapshot.journalDigest).toBe(crashed.value.snapshot.journalDigest);
  });

  it("refuses to load a journal whose digest does not match the canonical payload", () => {
    const journalPath = tempJournal();
    const opened = openUpgradeJournal({ journalPath, runId: "run-digest" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const record = JSON.parse(readFileSync(journalPath, "utf8")) as {
      journalDigest: string;
      state: string;
    };
    record.state = "planned";
    writeFileSync(journalPath, `${JSON.stringify(record, null, 2)}\n`);
    const tampered = loadUpgradeJournal({ journalPath, runId: "run-digest" });
    expect(tampered.ok).toBe(false);
    if (tampered.ok) return;
    expect(tampered.error.code).toBe("PCAT-UPG-ILLEGAL-ACTION");
    expect(tampered.error.detail).toContain("digest mismatch");
  });

  it("refuses to load a journal whose run identity does not match", () => {
    const journalPath = tempJournal();
    const opened = openUpgradeJournal({ journalPath, runId: "run-a" });
    expect(opened.ok).toBe(true);
    const mismatched = loadUpgradeJournal({ journalPath, runId: "run-b" });
    expect(mismatched.ok).toBe(false);
    if (mismatched.ok) return;
    expect(mismatched.error.code).toBe("PCAT-UPG-ILLEGAL-ACTION");
  });
});
