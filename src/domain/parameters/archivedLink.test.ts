import { describe, expect, it } from "vitest";

import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { archivedParameterLinkNotice } from "./archivedLink";

const archived = (diagnostic: string, evidence?: string) =>
  new WiseEffApiError(
    "GONE",
    diagnostic,
    evidence === undefined
      ? { diagnostic }
      : { diagnostic, migrationEvidenceId: evidence },
    "req-1"
  );

describe("archivedParameterLinkNotice", () => {
  it("classifies both archived diagnostics as one archived outcome", () => {
    expect(archivedParameterLinkNotice("p-1", archived("legacy-id-archived"))).toEqual({
      parameterId: "p-1",
      diagnostic: "legacy-id-archived",
      migrationEvidenceId: null
    });
    expect(archivedParameterLinkNotice("p-1", archived("legacy-parameter-id-retired"))).toEqual({
      parameterId: "p-1",
      diagnostic: "legacy-parameter-id-retired",
      migrationEvidenceId: null
    });
  });

  it("carries the migration evidence id when the server supplies one", () => {
    expect(archivedParameterLinkNotice("p-9", archived("legacy-id-archived", "mig-42"))).toEqual({
      parameterId: "p-9",
      diagnostic: "legacy-id-archived",
      migrationEvidenceId: "mig-42"
    });
  });

  it("falls back to the error message when details carry no diagnostic", () => {
    const error = new WiseEffApiError("GONE", "legacy-id-archived", {}, "req-2");
    expect(archivedParameterLinkNotice("p-2", error)?.diagnostic).toBe("legacy-id-archived");
  });

  it("ignores an empty migration evidence id", () => {
    expect(
      archivedParameterLinkNotice("p-3", archived("legacy-id-archived", ""))?.migrationEvidenceId
    ).toBeNull();
  });

  it("does not treat other GONE responses as archived old links", () => {
    expect(archivedParameterLinkNotice("p-4", new WiseEffApiError("GONE", "gone", {}, "req-3"))).toBeNull();
    expect(
      archivedParameterLinkNotice("p-4", new WiseEffApiError("GONE", "x", { diagnostic: "forbidden" }, "req-4"))
    ).toBeNull();
  });

  it("does not treat other error codes as archived even with the diagnostic present", () => {
    expect(
      archivedParameterLinkNotice(
        "p-5",
        new WiseEffApiError("NOT_FOUND", "not-found", { diagnostic: "legacy-id-archived" }, "req-5")
      )
    ).toBeNull();
  });

  it("accepts a plain error-shaped object and rejects everything else", () => {
    expect(
      archivedParameterLinkNotice("p-6", {
        code: "GONE",
        message: "legacy-id-archived",
        details: { diagnostic: "legacy-id-archived" }
      })?.diagnostic
    ).toBe("legacy-id-archived");
    expect(archivedParameterLinkNotice("p-7", null)).toBeNull();
    expect(archivedParameterLinkNotice("p-7", undefined)).toBeNull();
    expect(archivedParameterLinkNotice("p-7", "GONE")).toBeNull();
    expect(archivedParameterLinkNotice("p-7", new Error("boom"))).toBeNull();
  });
});
