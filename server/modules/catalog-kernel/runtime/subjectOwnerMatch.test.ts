import { describe, expect, it } from "vitest";
import {
  CatalogCanonicalKey, CatalogReleaseDigest, CatalogReleaseId, CatalogReleaseVersion, CatalogSubjectId,
} from "../../parameter-catalog-contract";
import {
  DriverCompatible, NormalizedNodeTypeName, type CatalogSubjectDetailSnapshot,
} from "../interface";
import { resolveCatalogSubject } from "./subjectMatch";

const subject = (id: string, kind: "driver" | "node-type", selector: string, owner?: string): CatalogSubjectDetailSnapshot => ({
  id: CatalogSubjectId(id), kind, canonicalKey: CatalogCanonicalKey(selector),
  ...(owner ? { owner: CatalogSubjectId(owner) } : {}),
  membership: {
    release: { id: CatalogReleaseId("release"), version: CatalogReleaseVersion("1.0.0"), digest: CatalogReleaseDigest(`sha256:${"a".repeat(64)}`) },
    lifecycle: "active", tombstone: { kind: "absent" },
    selector: kind === "driver"
      ? { kind: "driver-compatible", values: [DriverCompatible(selector)] }
      : { kind: "node-type-name", value: NormalizedNodeTypeName(selector) },
  },
  aliases: [], definitionCounts: { active: 0, deprecated: 0, retired: 0 },
});

describe("node type owner matching", () => {
  const subjects = [subject("a", "driver", "vendor,a"), subject("b", "driver", "vendor,b"),
    subject("a-child", "node-type", "battery1", "a"), subject("b-child", "node-type", "battery1", "b"),
    subject("standalone", "node-type", "battery1")];
  const match = (own: string[], owner: string[]) => resolveCatalogSubject(subjects, {
    driverCompatibles: own.map(DriverCompatible), ownerContext: owner.map(DriverCompatible),
    nodeTypeFallback: { kind: "present", name: NormalizedNodeTypeName("battery1") },
  });

  it("uses own driver, then the ancestor driver, then standalone", () => {
    expect(match(["vendor,b"], ["vendor,a"])).toMatchObject({ status: "matched", subject: { id: "b" } });
    expect(match([], ["vendor,a"])).toMatchObject({ status: "matched", subject: { id: "a-child" } });
    expect(match([], ["vendor,b"])).toMatchObject({ status: "matched", subject: { id: "b-child" } });
    expect(match([], [])).toMatchObject({ status: "matched", subject: { id: "standalone" } });
    expect(match([], ["vendor,unknown"])).toMatchObject({ status: "matched", subject: { id: "standalone" } });
  });

  it("never matches an owned node without its resolved owner", () => {
    const ownedOnly = subjects.filter((item) => item.owner);
    expect(resolveCatalogSubject(ownedOnly, { driverCompatibles: [], nodeTypeFallback: {
      kind: "present", name: NormalizedNodeTypeName("battery1"),
    } })).toEqual({ status: "unknown", reason: "no-candidate" });
  });
});
