import type { SignalRuleSet } from "./signalRules";

/** Array order preserves evidence order and breaks equal analysis priorities. */
export const defaultChargingRuleSet: SignalRuleSet = {
  rules: [
    {
      id: "thermal-foldback",
      anyOf: [
        { type: "text", pattern: "thermal", flags: "i" },
        { type: "text", pattern: "battery_temp", flags: "i" },
        { type: "text", pattern: "foldback", flags: "i" },
        { type: "text", pattern: "E_THERMAL_FOLDBACK", flags: "i" }
      ],
      stageId: "rootcause",
      inference: "Thermal protection reduced charging output.",
      suggestedAction: "Inspect pack temperature, cooling path, and BMS thermal thresholds before resuming fast charge.",
      analysis: {
        conclusion: { value: "Charging behavior is consistent with thermal foldback protection.", priority: 0 },
        impact: { value: "Charging throughput may be reduced until pack temperature returns to the safe operating range.", priority: 1 },
        severity: { value: "Warning", priority: 1 },
        confidence: { value: 0.85, priority: 0, requiresErrorEvidence: true },
        suggestedActions: [
          { value: "Inspect pack temperature, cooling path, and BMS thermal thresholds before resuming fast charge.", priority: 0 },
          { value: "Review ambient conditions and recent charge current requests for thermal stress.", priority: 2 }
        ]
      }
    },
    {
      id: "charge-current-reduction",
      anyOf: [
        { type: "text", pattern: "current reduced", flags: "i" },
        { type: "text", pattern: "reduced current", flags: "i" },
        { type: "text", pattern: "charge current reduced", flags: "i" },
        { type: "numericComparison", leftTokens: ["charge_current_ma", "current_ma"], operator: "lt", rightTokens: ["requested_ma"] }
      ],
      stageId: "pattern",
      inference: "Requested charge current was reduced by the controller.",
      suggestedAction: "Compare requested and delivered current around the event window.",
      analysis: {
        conclusion: { value: "The log indicates charge current reduction without a confirmed root cause.", priority: 3 },
        severity: { value: "Warning", priority: 1 },
        suggestedActions: [{ value: "Compare requested and delivered current around the event window.", priority: 0 }]
      }
    },
    {
      id: "communication-timeout",
      anyOf: [
        { type: "text", pattern: "timeout", flags: "i" },
        { type: "text", pattern: "retry", flags: "i" },
        { type: "text", pattern: "E_TIMEOUT", flags: "i" }
      ],
      stageId: "pattern",
      inference: "Controller communication showed timeout or retry behavior.",
      suggestedAction: "Check network latency, controller availability, and retry counts.",
      analysis: {
        conclusion: { value: "The log indicates communication timeout or retry behavior.", priority: 2 },
        impact: { value: "Intermittent communication may delay diagnostics or hide the underlying device state.", priority: 2 },
        severity: { value: "Warning", priority: 1 },
        confidence: { value: 0.72, priority: 1 },
        suggestedActions: [{ value: "Check network latency, controller availability, and retry counts.", priority: 0 }]
      }
    },
    {
      id: "device-offline",
      anyOf: [
        { type: "text", pattern: "offline", flags: "i" },
        { type: "text", pattern: "disconnect", flags: "i" },
        { type: "text", pattern: "DEVICE_UNAVAILABLE", flags: "i" }
      ],
      stageId: "rootcause",
      inference: "The device became unavailable or disconnected.",
      suggestedAction: "Verify device power, link status, and reconnect behavior.",
      analysis: {
        conclusion: { value: "The log indicates the device went offline or became unavailable.", priority: 1 },
        impact: { value: "Device availability may block reads, writes, or continued charging diagnostics.", priority: 0 },
        severity: { value: "Critical", priority: 0, requiresErrorEvidence: true },
        confidence: { value: 0.85, priority: 0, requiresErrorEvidence: true },
        suggestedActions: [{ value: "Verify device power, link status, and reconnect behavior.", priority: 0 }]
      }
    },
    {
      id: "error-code",
      anyOf: [{ type: "severityToken", severity: "error", token: "code" }],
      stageId: "pattern",
      inference: "Error lines include explicit machine-readable error codes.",
      suggestedAction: "Use the error code to correlate firmware diagnostics and incident history.",
      analysis: {
        conclusion: { value: "The log contains explicit error codes that need follow-up.", priority: 4 },
        severity: { value: "Warning", priority: 1 },
        suggestedActions: [{ value: "Correlate the error code with firmware diagnostics and recent parameter changes.", priority: 1 }]
      }
    }
  ],
  noHit: {
    confidence: 0.42,
    conclusion: "No rule-based log findings were detected.",
    impact: "No immediate operational impact was identified from the provided lines.",
    severity: "Info",
    suggestedActions: ["Collect more context from the device and adjacent logs before escalating."]
  },
  hitDefaults: {
    confidence: 0.64,
    conclusion: "No rule-based log findings were detected.",
    impact: "The finding may require operator review before closing the incident.",
    severity: "Info",
    suggestedActions: []
  }
};
