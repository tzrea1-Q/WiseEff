import { describe, expect, it } from "vitest";

import {
  IdentityChainError,
  assertBindingGetOk,
  assertJobSucceeded,
  assertJobSuperseded,
  assertOfficialProjectValue,
  assertUniqueBinding,
  assertUniqueDefinition,
} from "../e2e/acceptance/helpers/catalogIdentityChain";

describe("strong M1 identity-chain red cases", () => {
  it("fails Binding GET 403/404", () => {
    expect(() => assertBindingGetOk(403)).toThrow(IdentityChainError);
    expect(() => assertBindingGetOk(404)).toThrow(IdentityChainError);
    expect(() => assertBindingGetOk(499)).toThrow(IdentityChainError);
  });

  it("fails an empty binding list", () => {
    expect(() =>
      assertUniqueBinding([], { propertyKey: "ra04_x", definitionId: "pdef_1", projectId: "aurora" }),
    ).toThrow(/empty/);
  });

  it("fails when only an unrelated Binding exists", () => {
    expect(() =>
      assertUniqueBinding(
        [{ id: "b1", projectId: "aurora", logicalNodeId: "n1", definitionId: "pdef_other", propertyKey: "other", effectiveRevisionId: "drev_1", currentValueId: "pv_1" }],
        { propertyKey: "ra04_x", definitionId: "pdef_1", projectId: "aurora" },
      ),
    ).toThrow(/no binding/);
  });

  it("fails a wrong Definition/Revision", () => {
    expect(() =>
      assertUniqueDefinition(
        [{ id: "pdef_other", subjectId: "sub_1", propertyKey: "ra04_x", currentRevisionId: "drev_1" }],
        { propertyKey: "ra04_x", subjectId: "sub_expected" },
      ),
    ).toThrow(/exactly one definition/);
  });

  it("fails a missing Receipt / undefined effective", () => {
    expect(() =>
      assertJobSucceeded(
        { id: "job_1", candidateId: "cand_1", status: "active", currentness: "active", isCurrent: true },
        { jobId: "job_1", candidateId: "cand_1" },
      ),
    ).toThrow(/effective/);
    expect(() =>
      assertJobSucceeded(
        { id: "job_1", candidateId: "cand_1", status: "active", effective: false, currentness: "active", isCurrent: true },
        { jobId: "job_1", candidateId: "cand_1" },
      ),
    ).toThrow(/receipt/);
  });

  it("fails drafts-only (no official ProjectValue)", () => {
    expect(() =>
      assertOfficialProjectValue(
        { id: "b1", projectId: "aurora", logicalNodeId: "n1", definitionId: "pdef_1", effectiveRevisionId: "drev_1", currentValueId: undefined },
        { currentValueId: "pv_saved", revisionId: "drev_1" },
      ),
    ).toThrow(/official ProjectValue/);
  });

  it("fails a lost value after restart (currentValueId changed)", () => {
    expect(() =>
      assertOfficialProjectValue(
        { id: "b1", projectId: "aurora", logicalNodeId: "n1", definitionId: "pdef_1", effectiveRevisionId: "drev_1", currentValueId: "pv_other" },
        { currentValueId: "pv_saved", revisionId: "drev_1" },
      ),
    ).toThrow(/official ProjectValue/);
  });

  it("does not treat isCurrent=false alone as superseded", () => {
    expect(() =>
      assertJobSuperseded(
        { id: "job_1", candidateId: "cand_1", effective: true, isCurrent: false, currentness: null },
        { jobId: "job_1", candidateId: "cand_1" },
      ),
    ).toThrow(/active-superseded/);
  });
});
