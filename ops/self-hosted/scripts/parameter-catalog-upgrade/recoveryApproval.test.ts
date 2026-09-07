import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { journalBytes, openUpgradeJournal } from "./journal";
import { withHostOperationLock } from "./handoff";
import { recordRecoveryExecutionApproval } from "./recoveryApproval";
import type { IncidentRestoreConfirmation } from "./deploymentAuthority";

it("cannot turn JSON confirmation or an authorization callback into a durable approval", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "recovery-approval-unit-")));
  const opened = openUpgradeJournal({ journalPath: path.join(root,"run.json"), runId: "unit-run" });
  if (!opened.ok) throw new Error("unit-journal-failed");
  const before = journalBytes(opened.value.journalPath);
  try {
    await expect(withHostOperationLock(root, lock => recordRecoveryExecutionApproval({ journal: opened.value, operationRoot: root, lock,
      confirmation: { status: "authenticated-confirmation-not-persisted", authorize: async () => {} } as unknown as IncidentRestoreConfirmation, restoreToken: "untrusted" })))
      .rejects.toThrow("PCAT-UPG-RECOVERY-APPROVAL-UNAVAILABLE");
    expect(journalBytes(opened.value.journalPath)).toEqual(before);
  } finally { await rm(root,{ recursive:true,force:true }); }
});
