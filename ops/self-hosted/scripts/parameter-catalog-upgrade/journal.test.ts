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
} from "./journal";

const tempJournal = (): string =>
  path.join(mkdtempSync(path.join(tmpdir(), "s11-upg-journal-")), "journal.json");

describe("S11-UPG journal", () => {
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
