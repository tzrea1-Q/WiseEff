import { describe, expect, it } from "vitest";

import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogSubjectId,
  DefinitionRevisionId,
  MaintenanceAttemptId,
  ParameterDefinitionId,
  SubjectPlacementId
} from "./index";

const releaseId = CatalogReleaseId("crel_01K42");

// @ts-expect-error Raw wire strings must be validated and branded first.
const primitiveReleaseId: CatalogReleaseId = "crel_01K42";

// @ts-expect-error Different opaque identifier kinds are not interchangeable.
const crossKindSubjectId: CatalogSubjectId = releaseId;

void primitiveReleaseId;
void crossKindSubjectId;

describe("parameter catalog nominal identifiers", () => {
  it("preserves the validated wire primitive while keeping identifier kinds distinct", () => {
    expect(CatalogReleaseId("crel_01K42")).toBe("crel_01K42");
    expect(CatalogReleaseDigest("sha256:release")).toBe("sha256:release");
    expect(CatalogSubjectId("csub_01KSC8562")).toBe("csub_01KSC8562");
    expect(ParameterDefinitionId("pdef_01KVIN")).toBe("pdef_01KVIN");
    expect(DefinitionRevisionId("drev_01KVIN3")).toBe("drev_01KVIN3");
    expect(SubjectPlacementId("spla_root_drivers")).toBe("spla_root_drivers");
    expect(MaintenanceAttemptId("maint_01KCUTOVER")).toBe("maint_01KCUTOVER");
  });
});
