import { describe, expect, it } from "vitest";
import { planSubjectPlacement } from "./subjects";

const root = { subjectId: "driver", kind: "driver" as const, ownerSubjectId: null, state: "retired" as const,
  cascadeRetired: false, placement: { kind: "module" as const, moduleRef: "a" }, displayAlias: "Alias", recognition: null };

describe("subject placement planning", () => {
  it("distinguishes unset, unclassified, omission and a cleared alias", () => {
    const plan = planSubjectPlacement([{ subjectId: "driver", placement: { kind: "unset" }, displayAlias: null }], [root], [root], {});
    expect(plan.changes).toEqual([
      { subjectId: "driver", field: "placement", before: { kind: "module", moduleRef: "a" }, after: { kind: "unset" } },
      { subjectId: "driver", field: "displayAlias", before: "Alias", after: null },
    ]);
    expect(planSubjectPlacement([{ subjectId: "driver" }], [root], [root], {}).changes).toEqual([]);
    expect(planSubjectPlacement([{ subjectId: "driver", placement: { kind: "unclassified" } }], [root], [root], {}).changes[0]?.after).toEqual({ kind: "unclassified" });
  });

  it("requires a resolution when the same field changed and forbids independent child edits", () => {
    const current = { ...root, displayAlias: "Other" };
    const edits = [{ subjectId: "driver", displayAlias: null }];
    expect(planSubjectPlacement(edits, [root], [current], {}).conflicts).toMatchObject([{ key: "subject:driver:displayAlias", baseline: "Alias", file: null, current: "Other" }]);
    expect(planSubjectPlacement(edits, [root], [current], { "subject:driver:displayAlias": "file" }).changes).toHaveLength(1);
    const child = { ...root, subjectId: "child", ownerSubjectId: "driver", placement: null };
    expect(() => planSubjectPlacement([{ subjectId: "child", displayAlias: "Bad" }], [child], [child], {})).toThrow();
  });
});
