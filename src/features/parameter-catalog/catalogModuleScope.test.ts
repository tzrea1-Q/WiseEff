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
  placement?: { id: string; moduleId?: string; displayName: string; parentPlacementId: string | null };
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
  it("uses the maintained taxonomy, including empty categories and modules without registrations", () => {
    const modules = [
      { id: "power", name: "Power", parentId: null, sortOrder: 1 },
      { id: "empty", name: "Empty category", parentId: null, sortOrder: 2 },
      { id: "middle", name: "Business category", parentId: "power", sortOrder: 0 },
      { id: "driver", name: "Maintained driver", parentId: "middle", sortOrder: 0 }
    ];
    const subjects = [subject({ id: "driver-subject", canonicalName: "vendor,driver",
      placement: { id: "driver-placement", moduleId: "driver", displayName: "Old name", parentPlacementId: null } })];
    const tree = buildCatalogModuleTree(subjects, describeSubject, modules);
    expect(tree.map(node => node.id)).toEqual(["power", "empty"]);
    expect(tree[0]).toMatchObject({ subjectCount: 1, children: [
      { id: "middle", children: [{ id: "driver", displayName: "Maintained driver", children: [
        { subjectId: "driver-subject" }
      ] }] }
    ] });
    expect(tree[1]).toMatchObject({ subjectCount: 0, children: [] });
    expect(subjectIdsForModule(subjects, "power", modules)).toEqual(new Set(["driver-subject"]));
    expect(subjectIdsForModule(subjects, "empty", modules)).toEqual(new Set());
    const moved = modules.map(module => module.id === "driver" ? { ...module, parentId: "empty" } : module);
    expect(subjectIdsForModule(subjects, "power", moved)).toEqual(new Set());
    expect(subjectIdsForModule(subjects, "empty", moved)).toEqual(new Set(["driver-subject"]));
  });
  it("keeps registered subjects with cleared module attribution in an unset group", () => {
    const cleared = subject({ id: "unset-subject", canonicalName: "retained-driver",
      placement: { id: "retained-placement", displayName: "unset", parentPlacementId: null } });
    const tree = buildCatalogModuleTree([cleared], describeSubject, []);
    expect(tree).toMatchObject([{ id: "group:unset", displayName: "unset（未分配模块）", subjectCount: 1,
      children: [{ id: "subject:unset-subject", subjectId: "unset-subject" }] }]);
    expect(subjectIdsForModule([cleared], "retained-placement", []).size).toBe(0);
  });
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
      describeSubject,
      [{ id: "pmod-op08-node-type", name: "Node type", parentId: null, sortOrder: 0 }]
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
    expect(leaf.subjectType).toBe("node-type");
    expect(leaf.retired).toBe(false);
    expect(leaf.children).toEqual([]);
  });

  it.each(["membership", "registration"])("marks a subject retired from its actual %s state", (source) => {
    const item = subject({ id: "old", canonicalName: "vendor,old", registration: "unregistered" });
    const retired: SubjectItem = source === "membership"
      ? { ...item, membership: { ...item.membership, status: "retired" } }
      : { ...item, registration: { status: "retired", id: "registration-old" } };
    const roots = buildCatalogModuleTree([retired], describeSubject, []);
    expect(roots[0].children[0]).toMatchObject({ subjectId: "old", retired: true });
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
      describeSubject,
      [{ id: "pmod_driver", name: "Drivers", parentId: null, sortOrder: 0 }]
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
    const modules = [
      { id: "pmod_parent", name: "Parent", parentId: null, sortOrder: 0 },
      { id: "pmod_child", name: "Child", parentId: "pmod_parent", sortOrder: 0 }
    ];
    const nodes = buildCatalogModuleTree(subjects, describeSubject, modules);
    expect(nodes[0]!.subjectCount).toBe(2);
    expect(subjectIdsForModule(subjects, "pmod_parent", modules)).toEqual(new Set(["csub_parent", "csub_child"]));
    expect(subjectIdsForModule(subjects, "pmod_child", modules)).toEqual(new Set(["csub_child"]));
  });
});
