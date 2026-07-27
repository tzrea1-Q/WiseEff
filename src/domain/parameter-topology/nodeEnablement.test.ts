import { describe, expect, it } from "vitest";

import {
  annotateNodeEnablements,
  classifyStatusRaw,
  parseStatusToken,
  withEffectiveEnablement
} from "./nodeEnablement";

describe("parseStatusToken", () => {
  it("extracts the first quoted string from DTS raw text", () => {
    expect(parseStatusToken('"ok"')).toBe("ok");
    expect(parseStatusToken('"okay"')).toBe("okay");
    expect(parseStatusToken(' "disabled" ')).toBe("disabled");
  });

  it("returns null for absent or empty raw status", () => {
    expect(parseStatusToken(null)).toBeNull();
    expect(parseStatusToken(undefined)).toBeNull();
    expect(parseStatusToken("")).toBeNull();
  });
});

describe("classifyStatusRaw", () => {
  it("treats absent status as enabled and unstated", () => {
    expect(classifyStatusRaw(null)).toEqual({
      selfEnabled: true,
      override: "unstated",
      rawStatus: null,
      rawToken: null
    });
  });

  it("treats ok and okay as force-enabled", () => {
    expect(classifyStatusRaw('"ok"').selfEnabled).toBe(true);
    expect(classifyStatusRaw('"ok"').override).toBe("force-enabled");
    expect(classifyStatusRaw('"okay"').override).toBe("force-enabled");
  });

  it("treats disabled as force-disabled", () => {
    expect(classifyStatusRaw('"disabled"')).toMatchObject({
      selfEnabled: false,
      override: "force-disabled",
      rawToken: "disabled"
    });
  });

  it("treats reserved and fail as nonstandard and not enabled", () => {
    expect(classifyStatusRaw('"reserved"')).toMatchObject({
      selfEnabled: false,
      override: "nonstandard",
      rawToken: "reserved"
    });
    expect(classifyStatusRaw('"fail"').override).toBe("nonstandard");
  });
});

describe("annotateNodeEnablements", () => {
  it("marks a child unreachable when an ancestor is disabled", () => {
    const byId = annotateNodeEnablements([
      {
        id: "i2c",
        parentId: null,
        label: "i2c@FDF5E000",
        rawStatus: '"disabled"'
      },
      {
        id: "sc8562",
        parentId: "i2c",
        label: "sc8562@6E",
        rawStatus: '"ok"'
      }
    ]);

    expect(byId.get("i2c")).toMatchObject({
      selfEnabled: false,
      reachable: false,
      blockingAncestorId: null
    });
    expect(byId.get("sc8562")).toMatchObject({
      selfEnabled: true,
      reachable: false,
      blockingAncestorId: "i2c",
      blockingAncestorLabel: "i2c@FDF5E000"
    });
  });

  it("keeps a self-enabled node reachable when ancestors are enabled or unstated", () => {
    const byId = annotateNodeEnablements([
      { id: "root", parentId: null, label: "/", rawStatus: null },
      { id: "child", parentId: "root", label: "batt", rawStatus: '"okay"' }
    ]);

    expect(byId.get("child")).toMatchObject({
      selfEnabled: true,
      reachable: true,
      blockingAncestorId: null
    });
  });

  it("keys effective enablement by logicalNodeId so parent links resolve", () => {
    const nodes = withEffectiveEnablement([
      {
        id: "rev-bus",
        logicalNodeId: "logical-bus",
        name: "i2c",
        unitAddress: "FDF5E000",
        locator: "/amba/i2c@FDF5E000",
        parentLogicalNodeId: null,
        rawStatus: '"disabled"'
      },
      {
        id: "rev-child",
        logicalNodeId: "logical-child",
        name: "sc8562",
        unitAddress: "6E",
        locator: "/amba/i2c@FDF5E000/sc8562@6E",
        parentLogicalNodeId: "logical-bus",
        rawStatus: '"ok"'
      }
    ]);

    expect(nodes[1]?.enablement).toMatchObject({
      selfEnabled: true,
      reachable: false,
      blockingAncestorId: "logical-bus",
      blockingAncestorLabel: "i2c@FDF5E000"
    });
  });
});
