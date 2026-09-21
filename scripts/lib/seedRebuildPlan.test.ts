import { describe, expect, it } from "vitest";
import { confirmSeedRebuildPlan, sealSeedRebuildPlan } from "./seedRebuildPlan";

const input = () => ({
  version: 1 as const,
  scope: "atlas-aurora-nebula" as const,
  organizationId: "org-chargelab",
  actorUserId: "operator",
  candidateSha: "a".repeat(40),
  database: { oid: "44752", name: "wiseeff", serverAddress: "172.20.0.2", serverPort: 5432 },
  seedDigest: `sha256:${"b".repeat(64)}`,
  sourceDigest: `sha256:${"c".repeat(64)}`,
  catalog: { id: "crel_acme_1", digest: `sha256:${"d".repeat(64)}` },
  targets: ["atlas", "aurora", "nebula"],
  inventoryDigest: `sha256:${"e".repeat(64)}`,
});

describe("reviewed deployment seed plan", () => {
  it("requires the operator's exact digest, not a self-consistent replacement plan", () => {
    const original = sealSeedRebuildPlan(input());
    const substituted = sealSeedRebuildPlan({ ...input(), organizationId: "other-org" });
    expect(() => confirmSeedRebuildPlan(substituted, original.digest, input()))
      .toThrow(/confirmation/);
  });

  it.each(["database", "candidateSha", "seedDigest", "sourceDigest", "catalog", "inventoryDigest"] as const)(
    "refuses live %s drift before writes", (key) => {
      const original = sealSeedRebuildPlan(input());
      const live = input();
      if (key === "database") live.database = { ...live.database, oid: "99999" };
      else if (key === "catalog") live.catalog = { ...live.catalog, id: "new-release" };
      else live[key] = key === "candidateSha" ? "f".repeat(40) : `sha256:${"f".repeat(64)}`;
      expect(() => confirmSeedRebuildPlan(original, original.digest, live)).toThrow(/drift/);
    },
  );

  it("rejects changed scope and accepts an unchanged round trip", () => {
    expect(() => sealSeedRebuildPlan({ ...input(), targets: ["atlas", "custom"] })).toThrow(/scope/);
    const plan = sealSeedRebuildPlan(input());
    expect(() => confirmSeedRebuildPlan(JSON.parse(JSON.stringify(plan)), plan.digest, input())).not.toThrow();
    expect(() => confirmSeedRebuildPlan({ ...plan, targets: ["atlas"] }, plan.digest, input())).toThrow();
  });
});
