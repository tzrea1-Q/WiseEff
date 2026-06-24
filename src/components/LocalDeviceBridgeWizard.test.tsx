import { describe, expect, it } from "vitest";

import { deriveWizardStep, type BridgePanelStatus } from "./LocalDeviceBridgeWizard";

describe("deriveWizardStep", () => {
  const cases: Array<{ status: BridgePanelStatus; step: ReturnType<typeof deriveWizardStep> }> = [
    { status: "missing_bridge", step: 1 },
    { status: "not_paired", step: 2 },
    { status: "not_running", step: 2 },
    { status: "not_connected", step: 2 },
    { status: "tools_missing", step: 3 },
    { status: "online_no_device", step: 3 },
    { status: "bridges_with_targets", step: "done" }
  ];

  for (const { status, step } of cases) {
    it(`maps ${status} to step ${step}`, () => {
      expect(deriveWizardStep(status)).toBe(step);
    });
  }
});
