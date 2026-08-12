import { describe, expect, it } from "vitest";
import { nodePathToParameterIdentity } from "./pathMapper";

describe("nodePathToParameterIdentity", () => {
  it("maps a two-segment path to name and module", () => {
    expect(nodePathToParameterIdentity("battery/temp_max")).toEqual({
      name: "temp_max",
      module: "battery",
    });
  });

  it("maps a nested path to name and module", () => {
    expect(nodePathToParameterIdentity("power/battery/temp_max")).toEqual({
      name: "temp_max",
      module: "power/battery",
    });
  });

  it("throws when the path has fewer than two segments", () => {
    expect(() => nodePathToParameterIdentity("temp_max")).toThrow(
      "Invalid node path: temp_max",
    );
  });
});
