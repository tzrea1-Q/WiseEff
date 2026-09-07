import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { canonicalJson, commitJournalTransition, loadUpgradeJournal, openUpgradeJournal, sha256Prefixed } from "./journal";
import { reportPins } from "../../../../server/modules/release-verification/report/fixtures";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
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
function intent() {
  const body = { hostRunId: "host", cutoverRunId: "cutover", attemptId: "publication-1",
    target: { systemIdentifier: "123", databaseOid: "456" }, activationBindingDigest: pin,
    generation: 1, predecessorDigest: null, boundary: {
      p13State: "retired", writerRetirementFingerprint: pin, runtimePinGeneration: pin,
      pins: reportPins(), subject: { targetId: "target", deploymentClass: "self-hosted", environmentId: "isolated" },
      reportDigest: pin, phaseSnapshot: pin, predecessorReportDigests: [pin], pointerRollbackStatus: "open", trafficIsolationState: "isolated",
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
