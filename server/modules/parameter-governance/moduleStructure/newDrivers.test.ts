import { describe, expect, it } from "vitest";
import { ApiError } from "../../../shared/http/errors";
import { moduleStructureNewDriverSchema } from "../../contracts/dtoSchemas/moduleStructure";
import { assertNewDriverDestinations, driverDeclarationsDigest, type DriverCreation } from "./newDrivers";
import { enrichModuleStructureError } from "./importErrorDetails";

const driver = { ref: "chip", compatible: "fdw,fm1230_swi", driverNature: "physical-device" as const,
  instanceCardinality: "multiple" as const, placement: { kind: "module" as const, moduleRef: "battery" } };

describe("new driver import identity and diagnostics", () => {
  it("preserves frozen identities when declarations reorder or placement/alias are repaired", () => {
    const second = { ...driver, ref: "second", compatible: "acme,second" };
    expect(driverDeclarationsDigest([driver, second])).toBe(driverDeclarationsDigest([
      { ...second, displayAlias: "Second" }, { ...driver, placement: { kind: "module", moduleRef: "repaired" } },
    ]));
    expect(driverDeclarationsDigest([driver])).not.toBe(driverDeclarationsDigest([{ ...driver, compatible: "acme,different" }]));
    expect(driverDeclarationsDigest([{ ...driver, compatible: "huawei, wireless_aux_tx" }]))
      .not.toBe(driverDeclarationsDigest([{ ...driver, compatible: "huawei,wireless_aux_tx" }]));
    expect(driverDeclarationsDigest([{ ...driver, compatible: "onewire-phy,pl061,gpio" }]))
      .not.toBe(driverDeclarationsDigest([{ ...driver, compatible: "onewire-phy, pl061, gpio" }]));
    expect(driverDeclarationsDigest([driver])).not.toBe(driverDeclarationsDigest([{ ...driver, driverNature: "logical-service" }]));
    expect(driverDeclarationsDigest([driver])).not.toBe(driverDeclarationsDigest([{ ...driver, instanceCardinality: "singleton-per-project" }]));
  });

  it("requires explicit driver facts and reports submitted identity and exact field pointer", () => {
    const submitted = { ref: driver.ref, compatible: driver.compatible, placement: driver.placement };
    const parsed = moduleStructureNewDriverSchema.safeParse(submitted);
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("Expected missing driver facts");
    const failure = enrichModuleStructureError(new ApiError("VALIDATION_FAILED", "Invalid document", {
      issues: parsed.error.issues.map(issue => ({ ...issue, path: ["document", "newDrivers", 0, ...issue.path] })),
    }), { document: { newDrivers: [submitted] } }) as ApiError;
    expect(failure.details.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "document.newDrivers.0.driverNature", jsonPointer: "/newDrivers/0/driverNature",
        received: "（字段缺失）", newDriver: { index: 0, ref: driver.ref, compatible: driver.compatible }, hint: expect.any(String) }),
      expect.objectContaining({ path: "document.newDrivers.0.instanceCardinality", jsonPointer: "/newDrivers/0/instanceCardinality" }),
    ]));
  });

  it.each(["missing", "deleted", "technical"])("rejects a %s destination before publication", state => {
    const creation: DriverCreation = { phase: "required", drivers: [driver] };
    try {
      assertNewDriverDestinations(creation, new Map(state === "missing" ? [] : [["battery", "battery-id"]]),
        new Set(state === "technical" ? [] : ["battery-id"]), new Set(), new Set(state === "deleted" ? ["battery-id"] : []));
      throw new Error("Expected destination error");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const enriched = enrichModuleStructureError(error, { document: { newDrivers: [driver] } }) as ApiError;
      expect(enriched.details.issues).toEqual([expect.objectContaining({
        jsonPointer: "/newDrivers/0/placement/moduleRef", received: "battery", newDriver: expect.objectContaining({ ref: "chip" }),
      })]);
    }
  });

  it("accepts new business module refs and does not replay already applied placement", () => {
    expect(() => assertNewDriverDestinations({ phase: "required", drivers: [driver] }, new Map([["battery", "battery"]]),
      new Set(), new Set(["battery"]), new Set())).not.toThrow();
    expect(() => assertNewDriverDestinations({ phase: "applied", drivers: [driver] }, new Map(), new Set(), new Set(), new Set())).not.toThrow();
  });
});
