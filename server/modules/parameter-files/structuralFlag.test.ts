import { describe, expect, it } from "vitest";
import { isDtsStructuralIngestEnabled } from "./structuralFlag";

describe("isDtsStructuralIngestEnabled", () => {
  it("defaults to enabled", () => {
    expect(isDtsStructuralIngestEnabled({})).toBe(true);
  });

  it("disables on 0/false/off/no", () => {
    expect(isDtsStructuralIngestEnabled({ DTS_STRUCTURAL_INGEST: "0" })).toBe(false);
    expect(isDtsStructuralIngestEnabled({ DTS_STRUCTURAL_INGEST: "false" })).toBe(false);
    expect(isDtsStructuralIngestEnabled({ DTS_STRUCTURAL_INGEST: "off" })).toBe(false);
    expect(isDtsStructuralIngestEnabled({ DTS_STRUCTURAL_INGEST: "no" })).toBe(false);
  });

  it("enables on true/1/on", () => {
    expect(isDtsStructuralIngestEnabled({ DTS_STRUCTURAL_INGEST: "true" })).toBe(true);
    expect(isDtsStructuralIngestEnabled({ DTS_STRUCTURAL_INGEST: "1" })).toBe(true);
    expect(isDtsStructuralIngestEnabled({ DTS_STRUCTURAL_INGEST: "on" })).toBe(true);
  });
});
