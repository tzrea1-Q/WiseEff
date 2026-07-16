import { describe, expect, it } from "vitest";

import {
  matchLogicalNode,
  type LogicalNodeCandidate,
  type LogicalNodeSnapshot,
} from "./identity";

const parentI2cId = "logical-i2c-fdf5e000";
const sc8562Id = "logical-sc8562-6e";
const driverSchemaVersionId = "dsv-sc8562-v1";

function previousSc8562(overrides: Partial<LogicalNodeSnapshot> = {}): LogicalNodeSnapshot {
  return {
    logicalNodeId: sc8562Id,
    nodeLocator: "/amba/i2c@FDF5E000/sc8562@6E",
    name: "sc8562",
    unitAddress: "6E",
    parentLogicalNodeId: parentI2cId,
    driverSchemaVersionId,
    reg: "<0x6e>",
    uniqueKeys: { "i2c-reg": "0x6e" },
    topologyRelation: "child-of:logical-i2c-fdf5e000",
    labels: ["sc8562_chg"],
    ...overrides,
  };
}

function candidate(
  overrides: Partial<LogicalNodeCandidate> & Pick<LogicalNodeCandidate, "logicalNodeId" | "nodeLocator">,
): LogicalNodeCandidate {
  return {
    name: "sc8562",
    unitAddress: "6E",
    parentLogicalNodeId: parentI2cId,
    driverSchemaVersionId,
    reg: "<0x6e>",
    uniqueKeys: { "i2c-reg": "0x6e" },
    topologyRelation: "child-of:logical-i2c-fdf5e000",
    labels: ["sc8562_chg"],
    ...overrides,
  };
}

describe("matchLogicalNode", () => {
  it("matches when the node moved but unique evidence is unchanged", () => {
    const previous = previousSc8562();
    const movedButUniqueSc8562 = candidate({
      logicalNodeId: "logical-candidate-moved",
      // Path / bus address encoding changed; identity evidence did not.
      nodeLocator: "/amba/i2c@FDF5F000/sc8562@6E",
      unitAddress: "6E",
      parentLogicalNodeId: parentI2cId,
      driverSchemaVersionId,
      reg: "<0x6e>",
      uniqueKeys: { "i2c-reg": "0x6e" },
    });

    expect(matchLogicalNode(previous, movedButUniqueSc8562)).toMatchObject({
      kind: "matched",
      value: expect.objectContaining({ logicalNodeId: "logical-candidate-moved" }),
    });
    expect(matchLogicalNode(previous, [movedButUniqueSc8562])).toMatchObject({
      kind: "matched",
    });
  });

  it("returns ambiguous when two candidates share equivalent deterministic evidence", () => {
    const previous = previousSc8562();
    const twoEquivalentCandidates = [
      candidate({
        logicalNodeId: "logical-candidate-a",
        nodeLocator: "/amba/i2c@FDF5E000/sc8562@6E",
      }),
      candidate({
        logicalNodeId: "logical-candidate-b",
        nodeLocator: "/amba/i2c@FDF5E000/sc8562_dup@6E",
        name: "sc8562_dup",
      }),
    ];

    expect(matchLogicalNode(previous, twoEquivalentCandidates)).toMatchObject({
      kind: "ambiguous",
      candidates: expect.arrayContaining([
        expect.objectContaining({ logicalNodeId: "logical-candidate-a" }),
        expect.objectContaining({ logicalNodeId: "logical-candidate-b" }),
      ]),
    });
  });

  it("rejects locator-only and label-only candidates", () => {
    const previous = previousSc8562();
    const locatorOnly = candidate({
      logicalNodeId: "logical-locator-only",
      nodeLocator: previous.nodeLocator,
      parentLogicalNodeId: null,
      driverSchemaVersionId: null,
      reg: undefined,
      uniqueKeys: {},
      topologyRelation: undefined,
      unitAddress: undefined,
      locatorOnlyMatch: true,
    });

    expect(matchLogicalNode(previous, [{ ...locatorOnly, locatorOnlyMatch: true }])).toMatchObject({
      kind: "unmatched",
    });

    const labelOnly = candidate({
      logicalNodeId: "logical-label-only",
      nodeLocator: "/somewhere/else/sc8562@99",
      parentLogicalNodeId: null,
      driverSchemaVersionId: null,
      reg: undefined,
      uniqueKeys: {},
      topologyRelation: undefined,
      unitAddress: "99",
      labels: ["sc8562_chg"],
      // Same label as previous, but no deterministic identity keys.
    });
    // Strip deterministic keys so only the shared label remains.
    const labelOnlyBare: LogicalNodeCandidate = {
      logicalNodeId: labelOnly.logicalNodeId,
      nodeLocator: labelOnly.nodeLocator,
      name: "sc8562",
      labels: ["sc8562_chg"],
      parentLogicalNodeId: null,
      unitAddress: undefined,
    };

    expect(matchLogicalNode(previous, [labelOnlyBare])).toMatchObject({ kind: "unmatched" });
  });

  it("matches via explicit reviewed continuity mapping alone", () => {
    const previous = previousSc8562({
      reviewedMappingTo: "logical-reviewed-target",
    });
    const reviewed = candidate({
      logicalNodeId: "logical-reviewed-target",
      nodeLocator: "/totally/different/path",
      parentLogicalNodeId: null,
      driverSchemaVersionId: null,
      reg: undefined,
      uniqueKeys: {},
      topologyRelation: undefined,
      unitAddress: undefined,
      labels: [],
    });

    expect(matchLogicalNode(previous, [reviewed])).toMatchObject({
      kind: "matched",
      value: expect.objectContaining({ logicalNodeId: "logical-reviewed-target" }),
      evidence: expect.arrayContaining(["reviewed-mapping"]),
    });
  });

  it("reviewed mapping uniquely wins when other candidates also look deterministic", () => {
    const previous = previousSc8562({
      reviewedMappingTo: "logical-left",
    });
    const left = candidate({
      logicalNodeId: "logical-left",
      nodeLocator: "/amba/i2c@FDF5E000/left@6E",
      name: "left",
      unitAddress: "6E",
    });
    const right = candidate({
      logicalNodeId: "logical-right",
      nodeLocator: "/amba/i2c@FDF5E000/right@6E",
      name: "right",
      unitAddress: "6E",
    });

    expect(matchLogicalNode(previous, [left, right])).toMatchObject({
      kind: "matched",
      value: expect.objectContaining({ logicalNodeId: "logical-left" }),
      evidence: expect.arrayContaining(["reviewed-mapping"]),
    });
  });
});
