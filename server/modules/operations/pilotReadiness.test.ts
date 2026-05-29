import { describe, expect, it } from "vitest";
import { buildPilotReadiness } from "./pilotReadiness";

describe("pilot readiness", () => {
  it("passes when all M5 gates are ready", () => {
    expect(
      buildPilotReadiness({
        contract: { ok: true, status: "ready" },
        auth: { ok: true, status: "ready" },
        database: { ok: true, status: "ready" },
        objectStore: { ok: true, status: "ready" },
        worker: { ok: true, status: "ready" },
        deviceGateway: { ok: true, status: "ready" },
        agentProvider: { ok: true, status: "ready" },
        backups: { ok: true, status: "ready" }
      })
    ).toMatchObject({ ok: true, status: "pilot_ready", blockedBy: [] });
  });

  it("fails with actionable blocked gates", () => {
    expect(
      buildPilotReadiness({
        contract: { ok: true, status: "ready" },
        auth: { ok: false, status: "failed", message: "AUTH_MODE is development." },
        database: { ok: true, status: "ready" },
        objectStore: { ok: true, status: "ready" },
        worker: { ok: true, status: "ready" },
        deviceGateway: { ok: true, status: "ready" },
        agentProvider: { ok: true, status: "ready" },
        backups: { ok: false, status: "missing", message: "Restore drill not recorded." }
      })
    ).toMatchObject({
      ok: false,
      status: "blocked",
      blockedBy: ["auth", "backups"]
    });
  });
});
