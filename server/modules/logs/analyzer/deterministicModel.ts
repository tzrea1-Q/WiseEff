import { LogAnalysisProviderError, type LogAnalysisChatModel } from "./llmAnalyzer";

/**
 * Deterministic offline stub for `LOG_ANALYSIS_DETERMINISTIC=true` (local dev, CI, eval).
 * It reads the prefilter findings and excerpt from the prompt and answers with strict,
 * grounded JSON. A log containing the outage marker simulates a provider failure so the
 * honest-degradation chain can be exercised without a real provider.
 */
export const LOG_ANALYSIS_SIMULATED_OUTAGE_MARKER = "WISEEFF_SIMULATE_LLM_PROVIDER_DOWN";

type RuleHitSummary = { ruleHit: string; lineNumbers: number[] };

const conclusionByRuleHit: Array<{ ruleHit: string; conclusion: string; impact: string; severity: "Critical" | "Warning" | "Info" }> = [
  {
    ruleHit: "thermal-foldback",
    conclusion: "Charging behavior is consistent with thermal foldback protection reducing charge output.",
    impact: "Charging throughput stays reduced until pack temperature returns to the safe operating range.",
    severity: "Warning"
  },
  {
    ruleHit: "device-offline",
    conclusion: "The device went offline or became unavailable during the captured window.",
    impact: "Device availability blocks reads, writes, and continued charging diagnostics.",
    severity: "Critical"
  },
  {
    ruleHit: "communication-timeout",
    conclusion: "Controller communication showed timeout and retry behavior.",
    impact: "Intermittent communication may delay diagnostics or hide the underlying device state.",
    severity: "Warning"
  },
  {
    ruleHit: "charge-current-reduction",
    conclusion: "Charge current was reduced below the requested level without a confirmed root cause.",
    impact: "Charging speed is degraded relative to the requested profile.",
    severity: "Warning"
  },
  {
    ruleHit: "error-code",
    conclusion: "The log contains explicit machine-readable error codes that need follow-up.",
    impact: "Unresolved error codes may indicate a fault that recurs under load.",
    severity: "Warning"
  }
];

function parseExcerptLineNumbers(prompt: string): number[] {
  return [...prompt.matchAll(/^L(\d+): /gm)].map((match) => Number(match[1]));
}

function parseRuleHits(prompt: string): RuleHitSummary[] {
  return [...prompt.matchAll(/^- ([a-z][a-z-]*): lines ([0-9, ]+)/gm)].map((match) => ({
    ruleHit: match[1],
    lineNumbers: match[2]
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value))
  }));
}

function parseAnalysisQuestion(prompt: string): string | undefined {
  return prompt.match(/^Analysis question \(the conclusion must answer it\): (.+)$/m)?.[1]?.trim();
}

export function createDeterministicLogAnalysisModel(): LogAnalysisChatModel {
  return {
    async invoke(messages) {
      const prompt = messages
        .filter((message) => message.role === "user")
        .map((message) => message.content)
        .join("\n");

      if (prompt.includes(LOG_ANALYSIS_SIMULATED_OUTAGE_MARKER)) {
        throw new LogAnalysisProviderError("Simulated log-analysis provider outage (deterministic mode).");
      }

      const excerptLines = parseExcerptLineNumbers(prompt);
      const ruleHits = parseRuleHits(prompt);
      const analysisQuestion = parseAnalysisQuestion(prompt);
      const excerptSet = new Set(excerptLines);

      const matched = conclusionByRuleHit.find((candidate) =>
        ruleHits.some((hit) => hit.ruleHit === candidate.ruleHit && hit.lineNumbers.some((line) => excerptSet.has(line)))
      );
      const matchedHit = matched ? ruleHits.find((hit) => hit.ruleHit === matched.ruleHit) : undefined;
      const citedLines = (matchedHit?.lineNumbers.filter((line) => excerptSet.has(line)) ?? excerptLines).slice(0, 3);

      if (citedLines.length === 0) {
        // No excerpt lines at all — nothing can be grounded; emit an ungroundable shell
        // so the analyzer's grounding check degrades honestly.
        return { content: JSON.stringify({}) };
      }

      const baseConclusion = matched?.conclusion ?? "No known anomaly pattern was detected; the log looks nominal.";
      const conclusion = analysisQuestion ? `${baseConclusion} Regarding the question "${analysisQuestion}": the cited lines are the directly relevant evidence.` : baseConclusion;

      const payload = {
        conclusion,
        impact: matched?.impact ?? "No immediate operational impact was identified from the cited lines.",
        severity: matched?.severity ?? "Info",
        confidence: matched ? 0.82 : 0.45,
        suggestedActions: matched
          ? ["Review the cited lines with the owning team.", "Correlate the finding with recent parameter changes."]
          : ["Collect more context from the device and adjacent logs before escalating."],
        evidence: [
          {
            lineNumbers: citedLines,
            inference: matched
              ? `Deterministic analysis matched the ${matched.ruleHit} pattern on the cited lines.`
              : "Deterministic analysis found no anomaly pattern; the cited lines summarize the log window.",
            suggestedAction: matched
              ? "Confirm the pattern against device telemetry before acting."
              : "No action required unless symptoms persist."
          }
        ]
      };

      const content = JSON.stringify(payload);
      return {
        content,
        usage: {
          inputTokens: Math.ceil(prompt.length / 4),
          outputTokens: Math.ceil(content.length / 4)
        }
      };
    }
  };
}
