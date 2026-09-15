/**
 * Pure source-location resolution rules for definition identity correction.
 *
 * Executed threat-matrix rows: SR-01 (missing provenance), SR-02 (unsupported
 * format), SR-03 (ambiguous match) and the opaque `config-set:` resolution the
 * dts ingest path depends on.
 */
import { describe, expect, it } from "vitest";

import { deriveDtsSourceRef, resolveSourceLocation } from "./evaluate";

const facts = (overrides: Partial<Parameters<typeof resolveSourceLocation>[0]> = {}) => ({
  recordedSourceRef: "config-set:dcs-1",
  configRevisionId: "drev-1",
  occurrenceCount: 1,
  fileName: "board.dts",
  nodeLocator: "/charger@0",
  ...overrides,
});

describe("resolveSourceLocation", () => {
  it("resolves an opaque config-set ref through the DTS occurrence file", () => {
    expect(resolveSourceLocation(facts())).toEqual({
      status: "resolved",
      format: "dts",
      sourceRef: "board.dts!/charger@0",
    });
  });

  it("keeps an already explicit .dts ref unchanged", () => {
    expect(resolveSourceLocation(facts({ recordedSourceRef: "config/board.dts" }))).toEqual({
      status: "resolved",
      format: "dts",
      sourceRef: "config/board.dts",
    });
  });

  it("blocks a placeholder identity source as missing provenance", () => {
    expect(resolveSourceLocation(facts({ recordedSourceRef: "canonical-binding-identity" }))).toEqual({
      status: "blocked",
      reason: "missing-source-provenance",
    });
  });

  it("blocks an empty config revision as missing provenance", () => {
    expect(resolveSourceLocation(facts({ configRevisionId: "" }))).toEqual({
      status: "blocked",
      reason: "missing-source-provenance",
    });
  });

  it("blocks an opaque ref with no matching DTS occurrence", () => {
    expect(resolveSourceLocation(facts({ occurrenceCount: 0, fileName: null }))).toEqual({
      status: "blocked",
      reason: "missing-source-provenance",
    });
  });

  it("blocks an opaque ref with two matching occurrences as ambiguous", () => {
    expect(resolveSourceLocation(facts({ occurrenceCount: 2 }))).toEqual({
      status: "blocked",
      reason: "ambiguous-source-match",
    });
  });

  it("blocks an opaque ref whose file row is missing", () => {
    expect(resolveSourceLocation(facts({ fileName: null }))).toEqual({
      status: "blocked",
      reason: "missing-source-provenance",
    });
  });

  it("blocks an opaque ref whose DTS occurrence came from a non-.dts file", () => {
    expect(resolveSourceLocation(facts({ fileName: "board.yaml" }))).toEqual({
      status: "blocked",
      reason: "unsupported-source-format",
    });
  });

  it("blocks a recorded ref that names a real non-.dts file", () => {
    expect(resolveSourceLocation(facts({ recordedSourceRef: "config/board.yaml" }))).toEqual({
      status: "blocked",
      reason: "unsupported-source-format",
    });
  });

  it("derives a file-only ref when the config carries no node locator", () => {
    expect(deriveDtsSourceRef({ fileName: "board.dts", nodeLocator: null })).toBe("board.dts");
  });
});
