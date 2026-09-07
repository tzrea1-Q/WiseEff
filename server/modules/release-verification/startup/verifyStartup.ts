import { isDeepStrictEqual } from "node:util";
import { createStartupRuntimePin } from "../report/index";
import type { StartupOptions, StartupResult } from "./interface";

/** Startup consumes the existing read-only projection. It cannot assemble, approve,
 * migrate, repair, start workers or authorize public traffic. The target producer
 * is mandatory; there is deliberately no environment/report-based default.
 */
export async function verifyIsolatedCandidateStartup(options: StartupOptions): Promise<StartupResult> {
  try {
    return await options.target.withLockedBoundary(async (): Promise<StartupResult> => {
      const current = structuredClone(await options.target.observe());
      if (current.trafficIsolationState !== "isolated") return { ok: false, reason: "not-isolated" };
      if (current.p13State !== "retired" || !current.writerRetirementFingerprint?.trim() ||
          !current.runtimePinGeneration?.trim()) return { ok: false, reason: "pre-pin" };
      if (!current.reportDigest?.trim()) return { ok: false, reason: "missing" };
      const selected = await createStartupRuntimePin({ db: options.reports }).readApprovedRuntimePin(current);
      if (selected.kind === "absent") return { ok: false, reason: selected.reason };
      const report = selected.report;
      if (report.digest !== current.reportDigest || report.purpose !== "post-retirement-runtime" ||
          report.decision !== "passed" || !isDeepStrictEqual(report.pins, current.pins) ||
          report.phaseSnapshot !== current.phaseSnapshot ||
          !isDeepStrictEqual(report.predecessorReportDigests, current.predecessorReportDigests) ||
          report.pointerRollbackStatus !== current.pointerRollbackStatus ||
          report.evidenceRefs.length === 0 || report.evidenceRefs.some(ref => !isDeepStrictEqual(ref.subject, current.subject))) {
        return { ok: false, reason: "boundary-mismatch" };
      }
      // Clone the first observation: a producer mutating a shared object cannot
      // make both sides of the comparison silently change during report lookup.
      if (!isDeepStrictEqual(current, await options.target.observe())) return { ok: false, reason: "boundary-mismatch" };
      return { ok: true, reportDigest: report.digest, scope: "isolated-candidate-startup-only" };
    });
  } catch {
    // No raw SQL, business identifiers or credential-bearing errors escape.
    return { ok: false, reason: "source-unavailable" };
  }
}
