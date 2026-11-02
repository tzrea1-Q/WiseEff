import { describe, expect, it } from "vitest";

import {
  defaultDriverRegistrationAttributes,
} from "./attributionSubjects";

describe("attributionSubjects", () => {
  it("defaults existing driver groups to physical multi-instance", () => {
    expect(defaultDriverRegistrationAttributes()).toEqual({
      driverNature: "physical-device",
      instanceCardinality: "multiple",
    });
  });

});
