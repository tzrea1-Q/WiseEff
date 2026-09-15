import { describe, expect, it } from "vitest";

import type { CatalogSubjectResponse } from "@/infrastructure/http/parameterCatalogDtos";

import {
  CATALOG_UNREGISTERED_GROUP_ID,
  buildCatalogModuleTree,
  subjectIdsForModule
} from "./catalogModuleScope";

type SubjectItem = CatalogSubjectResponse["item"];

const subject = (input: {
  id: string;
  canonicalName: string;
  type?: "driver" | "node-type";
  placement?: { id: string; moduleId: string; displayName: string; parentPlacementId: string | null };
  registration?: "active" | "unregistered";
}): SubjectItem =>
  ({
    id: input.id,
    type: input.type ?? "driver",
    canonicalName: input.canonicalName,
    aliases: [],
    membership: { status: "active", catalogReleaseId: "crel_1" },
    registration:
      input.registration === "unregistered"
        ? { status: "unregistered" }
        : {
            status: "active",
            id: `sreg_${input.id}`,
            method: "explicit",
            placement: input.placement ?? null
          },
    definitionCounts: { active: 0, deprecated: 0, retired: 0 },
    reviewCount: 0
  }) as unknown as SubjectItem;

const describeSubject = (item: SubjectItem) => `${item.type} · ${item.registration.status}`;

describe("catalog module navigator tree", () => {
  it("renders one tree: module branches with their registered subjects as leaves", () => {
    const nodes = buildCatalogModuleTree(
      [
        subject({
          id: "csub_charger",
          canonicalName: "charger",
          type: "node-type",
          placement: {
            id: "spla_1",
            moduleId: "pmod-op08-node-type",
            displayName: "Node type",
            parentPlacementId: null
          }
        })
      ],
      describeSubject
    );

    expect(nodes).toHaveLength(1);
    const moduleNode = nodes[0]!;
    expect(moduleNode.kind).toBe("module");
    expect(moduleNode.id).toBe("pmod-op08-node-type");
    expect(moduleNode.subjectCount).toBe(1);
    expect(moduleNode.children).toHaveLength(1);
    const leaf = moduleNode.children[0]!;
    expect(leaf.kind).toBe("subject");
    expect(leaf.subjectId).toBe("csub_charger");
    expect(leaf.displayName).toBe("charger");
    expect(leaf.meta).toBe("node-type · active");
    expect(leaf.children).toEqual([]);
  });

  it("keeps subjects without a placement reachable under one unregistered branch", () => {
    const nodes = buildCatalogModuleTree(
      [
        subject({
          id: "csub_power",
          canonicalName: "acme,power",
          placement: {
            id: "spla_power",
            moduleId: "pmod_driver",
            displayName: "Drivers",
            parentPlacementId: null
          }
        }),
        subject({ id: "csub_sensor", canonicalName: "acme,sensor", registration: "unregistered" }),
        subject({ id: "csub_extra", canonicalName: "acme,extra", registration: "unregistered" })
      ],
      describeSubject
    );

    // Module branches first, then the single unregistered branch.
    expect(nodes.map((node) => node.kind)).toEqual(["module", "unregistered-group"]);
    const group = nodes[1]!;
    expect(group.id).toBe(CATALOG_UNREGISTERED_GROUP_ID);
    expect(group.subjectCount).toBe(2);
    expect(group.children.map((child) => child.displayName)).toEqual(["acme,extra", "acme,sensor"]);
    expect(group.children.every((child) => child.kind === "subject" && typeof child.subjectId === "string")).toBe(true);
  });

  it("scopes a module node to every subject in its subtree", () => {
    const subjects = [
      subject({
        id: "csub_parent",
        canonicalName: "parent",
        placement: {
          id: "spla_parent",
          moduleId: "pmod_parent",
          displayName: "Parent",
          parentPlacementId: null
        }
      }),
      subject({
        id: "csub_child",
        canonicalName: "child",
        placement: {
          id: "spla_child",
          moduleId: "pmod_child",
          displayName: "Child",
          parentPlacementId: "spla_parent"
        }
      })
    ];
    const nodes = buildCatalogModuleTree(subjects, describeSubject);
    expect(nodes[0]!.subjectCount).toBe(2);
    expect(subjectIdsForModule(subjects, "pmod_parent")).toEqual(new Set(["csub_parent", "csub_child"]));
    expect(subjectIdsForModule(subjects, "pmod_child")).toEqual(new Set(["csub_child"]));
  });
});
