import { describe, expect, it } from "vitest";

import {
  defaultDriverRegistrationAttributes,
  isValidAttributionParentKind,
} from "./attributionSubjects";

describe("attributionSubjects", () => {
  it("defaults existing driver groups to physical multi-instance", () => {
    expect(defaultDriverRegistrationAttributes()).toEqual({
      driverNature: "physical-device",
      instanceCardinality: "multiple",
    });
  });

  it("allows the confirmed taxonomy nesting rules", () => {
    expect(isValidAttributionParentKind("business", null)).toBe(true);
    expect(isValidAttributionParentKind("business", "business")).toBe(true);
    expect(isValidAttributionParentKind("driver-group", "business")).toBe(true);
    expect(isValidAttributionParentKind("node-type", "business")).toBe(true);
    expect(isValidAttributionParentKind("node-type", "driver-group")).toBe(true);
    expect(isValidAttributionParentKind("node-type", "node-type")).toBe(true);

    expect(isValidAttributionParentKind("driver-group", null)).toBe(false);
    expect(isValidAttributionParentKind("driver-group", "driver-group")).toBe(false);
    expect(isValidAttributionParentKind("business", "driver-group")).toBe(false);
    expect(isValidAttributionParentKind("node-type", null)).toBe(false);
  });
});
