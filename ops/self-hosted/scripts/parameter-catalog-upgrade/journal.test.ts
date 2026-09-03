import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  commitJournalTransition,
  journalBytes,
  loadUpgradeJournal,
  openUpgradeJournal,
} from "./journal";

const tempJournal = (): string =>
  path.join(mkdtempSync(path.join(tmpdir(), "s11-upg-journal-")), "journal.json");

describe("S11-UPG journal", () => {
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
