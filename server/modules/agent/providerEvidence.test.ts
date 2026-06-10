import { describe, expect, it } from "vitest";
import { sanitizeAgentProviderEvidence, toMetricLabels } from "./providerEvidence";

describe("agent provider evidence", () => {
  it("keeps only safe provider metadata", () => {
    expect(
      sanitizeAgentProviderEvidence({
        provider: "live",
        format: "pi",
        piProvider: "minimax",
        model: "abab6.5s-chat",
        promptVersion: "m7-pi-agent-v1",
        apiKey: "secret",
        authorization: "Bearer secret",
        rawPrompt: "customer prompt"
      } as never)
    ).toEqual({
      provider: "live",
      format: "pi",
      piProvider: "minimax",
      model: "abab6.5s-chat",
      promptVersion: "m7-pi-agent-v1"
    });
  });

  it("drops blank optional values and rejects unsupported provider formats", () => {
    expect(
      sanitizeAgentProviderEvidence({
        provider: "live",
        format: "pi",
        piProvider: "   ",
        model: "model-a",
        promptVersion: "m7-pi-agent-v1"
      })
    ).toEqual({
      provider: "live",
      format: "pi",
      model: "model-a",
      promptVersion: "m7-pi-agent-v1"
    });

    expect(
      sanitizeAgentProviderEvidence({
        provider: "live",
        format: "filesystem",
        model: "model-a",
        promptVersion: "m7-pi-agent-v1"
      } as never)
    ).toEqual(undefined);
  });

  it("uses low-cardinality metric labels", () => {
    expect(
      toMetricLabels({
        provider: "live",
        format: "pi",
        piProvider: "minimax",
        model: "model-a",
        promptVersion: "m7-pi-agent-v1"
      })
    ).toEqual({
      provider: "live",
      format: "pi",
      piProvider: "minimax"
    });
  });
});
