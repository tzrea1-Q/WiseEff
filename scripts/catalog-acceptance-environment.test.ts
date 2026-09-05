import { afterEach, describe, expect, it, vi } from "vitest";

const owned = vi.hoisted(() => ({ load: vi.fn(), verify: vi.fn() }));
vi.mock("../e2e/acceptance/helpers/ownedRuntimeDescriptor", () => ({
  OWNED_ACCEPTANCE_DESCRIPTOR_ENV: "WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR",
  loadOwnedRuntimeDescriptorFromEnv: owned.load,
  verifyOwnedRuntimeOwnership: owned.verify,
}));

import { catalogLaneConnectionString } from "../e2e/acceptance/helpers/catalogEvidence";

const lane = (issue: number) => `postgres://fixture@127.0.0.1:55438/wiseeff_lane_${issue}`;
function environment(url: string, issue?: string) {
  vi.stubEnv("DATABASE_URL", url);
  vi.stubEnv("TEST_DATABASE_URL", url);
  vi.stubEnv("WISEEFF_CATALOG_ACCEPTANCE_ISSUE", issue ?? "");
  vi.stubEnv("WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR", "");
  vi.stubEnv("WISEEFF_ACCEPTANCE_OWNED_RUNTIME", "");
}

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("Catalog acceptance database authorization", () => {
  it.each([810, 819, 820])("accepts only the exact assigned lane %i", async (issue) => {
    environment(lane(issue), String(issue));
    expect(await catalogLaneConnectionString()).toBe(lane(issue));
    expect(owned.verify).not.toHaveBeenCalled();
  });

  it("retains the historical 810 default", async () => {
    environment(lane(810));
    expect(await catalogLaneConnectionString()).toBe(lane(810));
  });

  it.each(["", "815", "819.0", "0819", "819x"])("does not borrow lane 819 under issue %s", async (issue) => {
    environment(lane(819), issue);
    await expect(Promise.resolve().then(() => catalogLaneConnectionString())).rejects.toThrow();
  });

  it.each([
    "postgres://fixture@127.0.0.1:5432/wiseeff",
    "postgres://fixture@127.0.0.1:55438/wiseeff",
    "postgres://fixture@example.test:55438/wiseeff_lane_810",
    "postgres://fixture@127.0.0.1:55439/wiseeff_lane_810",
  ])("rejects shared, external, and wrong-port targets", async (url) => {
    environment(url, "810");
    await expect(Promise.resolve().then(() => catalogLaneConnectionString())).rejects.toThrow();
  });

  it("awaits the existing complete ownership verifier before accepting an owned database", async () => {
    const url = "postgres://fixture@127.0.0.1:55438/wiseeff_acceptance_full_r2_820";
    environment(url, "820");
    vi.stubEnv("WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR", "/fixture/owned-runtime.json");
    const descriptor = { database: { name: "wiseeff_acceptance_full_r2_820" } };
    owned.load.mockReturnValue(descriptor);
    owned.verify.mockResolvedValue(descriptor);
    expect(await catalogLaneConnectionString()).toBe(url);
    expect(owned.verify).toHaveBeenCalledExactlyOnceWith(descriptor, process.env);
  });

  it("propagates ownership failure instead of falling back to a valid-looking lane", async () => {
    environment(lane(819), "819");
    vi.stubEnv("WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR", "/fixture/owned-runtime.json");
    owned.load.mockReturnValue({ database: { name: "wiseeff_lane_819" } });
    owned.verify.mockRejectedValue(new Error("ownership marker mismatch"));
    await expect(Promise.resolve().then(() => catalogLaneConnectionString())).rejects.toThrow("ownership marker mismatch");
  });

  it("rejects a descriptor that verifies a different database", async () => {
    environment(lane(819), "819");
    vi.stubEnv("WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR", "/fixture/owned-runtime.json");
    owned.load.mockReturnValue({ database: { name: "wiseeff_acceptance_full_other" } });
    owned.verify.mockResolvedValue(undefined);
    await expect(catalogLaneConnectionString()).rejects.toThrow(/differs/);
  });

  it("rejects a configured descriptor that cannot be loaded", async () => {
    environment(lane(819), "819");
    vi.stubEnv("WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR", "/fixture/owned-runtime.json");
    owned.load.mockReturnValue(undefined);
    await expect(catalogLaneConnectionString()).rejects.toThrow(/unavailable/);
    expect(owned.verify).not.toHaveBeenCalled();
  });

  it("rejects an owned flag without its verifiable descriptor", async () => {
    environment(lane(810));
    vi.stubEnv("WISEEFF_ACCEPTANCE_OWNED_RUNTIME", "true");
    await expect(Promise.resolve().then(() => catalogLaneConnectionString())).rejects.toThrow(/descriptor/i);
  });
});
