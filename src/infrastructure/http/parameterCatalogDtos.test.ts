import { describe, expect, it } from "vitest";

import {
  catalogCreateBindingDraftRequestSchema,
  catalogDocumentResponseSchema,
  catalogProjectBindingDtoSchema,
  catalogSubjectDtoSchema
} from "@wiseeff/dto-schemas";
import {
  catalogDocumentFromDto,
  catalogProjectBindingFromDto,
  catalogSubjectFromDto
} from "./parameterCatalogDtos";

const catalogDocument = {
  item: {
    catalogReleaseId: "crel_01K42",
    releaseName: "2026.08.3",
    releaseSequence: 42,
    publishedAt: "2026-08-31T02:00:00Z",
    materializedAt: "2026-08-31T02:01:12Z",
    status: "ready" as const,
    digest: "sha256:abc",
    materializationFingerprint: "sha256:def",
    links: {
      subjects: "/api/v2/catalog/subjects",
      definitions: "/api/v2/catalog/definitions"
    }
  }
};

const unregisteredSubject = {
  id: "csub_01KSC8562",
  type: "driver" as const,
  canonicalName: "southchip,sc8562",
  membership: { status: "active" as const, catalogReleaseId: "crel_01K42" },
  registration: { status: "unregistered" as const },
  definitionCounts: { active: 14, deprecated: 1, retired: 0 },
  availableActions: ["register" as const]
};

const binding = {
  id: "pbind_01KPROJECT",
  projectId: "project_1",
  logicalNodeId: "lnode_sc8562_1",
  subjectRegistrationId: "sreg_01KACME",
  definitionId: "pdef_01KGPIOINT",
  effectiveRevisionId: "drev_01K6",
  currentValueId: "pval_01KVALUE",
  recognizedAgainstCatalogReleaseId: "crel_01K41"
};

describe("parameter catalog frontend DTOs", () => {
  it("keeps catalog document and unregistered subject identity mapping", () => {
    const document = catalogDocumentResponseSchema.parse(catalogDocument);
    expect(catalogDocumentFromDto(document).item.status).toBe("ready");
    const subject = catalogSubjectDtoSchema.parse(unregisteredSubject);
    expect(catalogSubjectFromDto({ item: subject }).item.registration.status).toBe("unregistered");
  });

  it("exposes canonical binding IDs and rejects legacy spec identity", () => {
    const parsed = catalogProjectBindingDtoSchema.parse(binding);
    expect(catalogProjectBindingFromDto(parsed)).toEqual(binding);
    expect(catalogProjectBindingDtoSchema.safeParse({ ...binding, parameterSpecId: "spec-1" }).success).toBe(
      false
    );
    expect(
      catalogCreateBindingDraftRequestSchema.safeParse({
        definitionId: "pdef_01KGPIOINT",
        effectiveRevisionId: "drev_01K6",
        targetValue: "1",
        reason: "canonical",
        parameterSpecId: "spec-1"
      }).success
    ).toBe(false);
  });
});
