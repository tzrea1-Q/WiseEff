import { describe, expect, it } from "vitest";

import {
  emptyReasonForView,
  mapObservationRecognition,
  mapProposalStatus,
  mapRegistrationMethod,
  mapRegistrationStatus,
} from "./mapping";

describe("governance query literal mapping", () => {
  it("maps internal registration methods without unchecked casts", () => {
    expect(mapRegistrationMethod("explicit")).toBe("explicit");
    expect(mapRegistrationMethod("automatic")).toBe("automatic");
    expect(mapRegistrationMethod("review")).toBe("review");
    expect(mapRegistrationMethod("EXPLICIT")).toBeNull();
    expect(mapRegistrationMethod("curated")).toBeNull();
  });

  it("maps observation recognitions including retired-registration-observed", () => {
    expect(mapObservationRecognition("matched")).toBe("matched");
    expect(mapObservationRecognition("unknown")).toBe("unknown");
    expect(mapObservationRecognition("ambiguous")).toBe("ambiguous");
    expect(mapObservationRecognition("retired-registration-observed")).toBe("retired");
    expect(mapObservationRecognition("placement-conflict")).toBe("unknown");
    expect(mapObservationRecognition("other")).toBeNull();
  });

  it("CATFIX-QUERY-07 distinguishes four empty reasons by view", () => {
    expect(emptyReasonForView("registrations", 0, false)).toBe("no-registrations");
    expect(emptyReasonForView("definitions", 0, false)).toBe("no-definitions");
    expect(emptyReasonForView("reviews", 0, false)).toBe("no-review-work");
    expect(emptyReasonForView("subjects", 0, true)).toBe("no-filter-match");
    expect(emptyReasonForView("registrations", 1, false)).toBeUndefined();
  });

  it("maps proposal statuses through the fixed table", () => {
    expect(mapProposalStatus("submitted")).toBe("submitted");
    expect(mapProposalStatus("draft")).toBe("draft");
    expect(mapProposalStatus("accepted")).toBe("accepted");
    expect(mapProposalStatus("bogus")).toBeNull();
    expect(mapRegistrationStatus("active")).toBe("active");
    expect(mapRegistrationStatus("retired")).toBe("retired");
    expect(mapRegistrationStatus("unregistered")).toBeNull();
  });
});
