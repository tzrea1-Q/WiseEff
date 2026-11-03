import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../shared/database/client";
import { findOwnedSourceSuspension, loadOwnedProjectValueSourcePin, readOwnedCurrentBinding, readOwnedProjectValueIdentity } from "../parameter-bindings/values";
import { filterPreviouslySuspendedSourceBindings } from "./sourceManagedScope";

vi.mock("../parameter-bindings/values", () => ({
  loadOwnedProjectValueSourcePin: vi.fn(), readOwnedCurrentBinding: vi.fn(), readOwnedProjectValueIdentity: vi.fn(),
  findOwnedSourceSuspension: vi.fn(),
}));

const scope = { organizationId: "org", projectId: "project", configSetId: "set", baseConfigRevisionId: "current-config" };
const entry = { bindingId: "binding", oldValueId: "value", sourcePinId: "pin", sourceOccurrenceId: "occurrence",
  definitionId: "definition", effectiveRevisionId: "definition-revision", catalogReleaseId: "catalog", valueDigest: "digest" };
const pin = { ...scope, configRevisionId: "historical-config", sourcePinId: entry.sourcePinId, sourceOccurrenceId: entry.sourceOccurrenceId,
  definitionId: entry.definitionId, fileId: "file", fileVersionId: "version", format: "dts", valueState: "present" };
const binding = { id: entry.bindingId, currentValueId: entry.oldValueId, sourceOccurrenceId: entry.sourceOccurrenceId,
  definitionId: entry.definitionId, effectiveRevisionId: entry.effectiveRevisionId, catalogReleaseId: entry.catalogReleaseId,
  registrationId: "registration", subjectId: "subject" };

describe("receipt-proven source suspension filtering", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadOwnedProjectValueSourcePin).mockResolvedValue(pin as never);
    vi.mocked(readOwnedCurrentBinding).mockResolvedValue({ status: "current", binding } as never);
    vi.mocked(readOwnedProjectValueIdentity).mockResolvedValue({ value: { valueDigest: entry.valueDigest } } as never);
  });

  function database(approved: boolean) {
    const query = vi.mocked(findOwnedSourceSuspension).mockResolvedValue(approved ? "approved-exclusion" : null);
    return { db: { query: vi.fn() } as unknown as Queryable, query };
  }

  it("excludes exact historical ownership only when its approved receipt exists", async () => {
    const { db, query } = database(true);
    expect(await filterPreviouslySuspendedSourceBindings(db, scope, [entry])).toEqual([]);
    expect(query).toHaveBeenCalledWith(db, { ...scope, identity: { ...entry, registrationId: "registration", subjectId: "subject",
      configRevisionId: "historical-config", fileId: "file", fileVersionId: "version", format: "dts" } });
  });

  it("keeps unexplained stale history for the caller's existing refusal", async () => {
    const { db } = database(false);
    expect(await filterPreviouslySuspendedSourceBindings(db, scope, [entry])).toEqual([entry]);
  });

  it.each([
    ["same config", { ...pin, configRevisionId: scope.baseConfigRevisionId }],
    ["foreign config set", { ...pin, configSetId: "foreign" }],
    ["different source pin", { ...pin, sourcePinId: "other-pin" }],
    ["different occurrence", { ...pin, sourceOccurrenceId: "other-occurrence" }],
    ["deleted value", { ...pin, valueState: "deleted" }],
  ])("cannot hide a %s entry even with a prior approved request", async (_label, sourcePin) => {
    const { db, query } = database(true);
    vi.mocked(loadOwnedProjectValueSourcePin).mockResolvedValue(sourcePin as never);
    expect(await filterPreviouslySuspendedSourceBindings(db, scope, [entry])).toEqual([entry]);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ["value", { ...binding, currentValueId: "new-value" }],
    ["definition", { ...binding, definitionId: "other-definition" }],
    ["revision", { ...binding, effectiveRevisionId: "other-revision" }],
    ["release", { ...binding, catalogReleaseId: "other-release" }],
  ])("does not suppress a changed current %s identity", async (_label, current) => {
    const { db, query } = database(true);
    vi.mocked(readOwnedCurrentBinding).mockResolvedValue({ status: "current", binding: current } as never);
    expect(await filterPreviouslySuspendedSourceBindings(db, scope, [entry])).toEqual([entry]);
    expect(query).not.toHaveBeenCalled();
  });

  it("does not suppress a changed exact value digest", async () => {
    const { db, query } = database(true);
    vi.mocked(readOwnedProjectValueIdentity).mockResolvedValue({ value: { valueDigest: "changed" } } as never);
    expect(await filterPreviouslySuspendedSourceBindings(db, scope, [entry])).toEqual([entry]);
    expect(query).not.toHaveBeenCalled();
  });
});
