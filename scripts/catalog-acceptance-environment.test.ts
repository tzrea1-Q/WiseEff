import { afterEach, describe, expect, it, vi } from "vitest";

const owned = vi.hoisted(() => ({ load: vi.fn(), verify: vi.fn() }));
vi.mock("../e2e/acceptance/helpers/ownedRuntimeDescriptor", () => ({
  OWNED_ACCEPTANCE_DESCRIPTOR_ENV: "WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR",
  loadOwnedRuntimeDescriptorFromEnv: owned.load,
  verifyOwnedRuntimeOwnership: owned.verify,
}));

import { catalogLaneConnectionString } from "../e2e/acceptance/helpers/catalogEvidence";
import { canonicalLaneConnectionString } from "../e2e/acceptance/helpers/catalogAcceptanceEnvironment";

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
  it.each([
    "?host=127.0.0.1&port=5432",
    "?port=5432",
    "?host=/tmp",
    "?%68ost=example.test",
    "?host=127.0.0.1&host=example.test",
    "?dbname=wiseeff",
    "?options=-csearch_path=public",
    "#ignored-fragment",
  ])("rejects alternate driver connection parameters before ownership checks: %s", async (suffix) => {
    environment(lane(819) + suffix, "819");
    await expect(catalogLaneConnectionString()).rejects.toThrow(/parameters|fragment/i);
    expect(owned.verify).not.toHaveBeenCalled();
  });

  it.each([810, 815, 819, 820, 847, 853])("accepts only the exact assigned lane %i", async (issue) => {
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

  it.each([55438, 5432])("awaits the existing complete ownership verifier before accepting an owned database on port %i", async (port) => {
    const url = `postgres://fixture@127.0.0.1:${port}/wiseeff_acceptance_full_r2_820`;
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

describe.each([898, 905] as const)("Issue %i canonical acceptance database authorization", (issue) => {
  it("preserves the dedicated manual lane", async () => {
    environment(lane(issue));
    expect(await canonicalLaneConnectionString(issue)).toBe(lane(issue));
    expect(owned.verify).not.toHaveBeenCalled();
  });

  it("rejects another port without a descriptor", async () => {
    environment("postgres://fixture@127.0.0.1:5432/wiseeff_acceptance_full_test");
    await expect(canonicalLaneConnectionString(issue)).rejects.toThrow(/55438/);
    expect(owned.verify).not.toHaveBeenCalled();
  });

  it("accepts another port only after ownership verification", async () => {
    const url = "postgres://fixture@127.0.0.1:5432/wiseeff_acceptance_full_test";
    environment(url);
    vi.stubEnv("WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR", "/fixture/owned-runtime.json");
    const descriptor = { database: { name: "wiseeff_acceptance_full_test" } };
    owned.load.mockReturnValue(descriptor);
    owned.verify.mockResolvedValue(descriptor);
    expect(await canonicalLaneConnectionString(issue)).toBe(url);
    expect(owned.verify).toHaveBeenCalledExactlyOnceWith(descriptor, { ...process.env, DATABASE_URL: url });
  });

  it("verifies the effective TEST_DATABASE_URL connection, not a different DATABASE_URL", async () => {
    environment("postgres://fixture@127.0.0.1:5432/wiseeff_acceptance_full_test");
    const url = "postgres://fixture@127.0.0.1:55439/wiseeff_acceptance_full_test";
    vi.stubEnv("TEST_DATABASE_URL", url);
    vi.stubEnv("WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR", "/fixture/owned-runtime.json");
    const descriptor = { database: { name: "wiseeff_acceptance_full_test" } };
    owned.load.mockReturnValue(descriptor);
    owned.verify.mockRejectedValue(new Error("Owned runtime DATABASE_URL identity does not match the descriptor."));
    await expect(canonicalLaneConnectionString(issue)).rejects.toThrow(/identity does not match/);
    expect(owned.load).toHaveBeenCalledExactlyOnceWith({ ...process.env, DATABASE_URL: url });
    expect(owned.verify).toHaveBeenCalledExactlyOnceWith(descriptor, { ...process.env, DATABASE_URL: url });
  });

  it("rejects a different TEST_DATABASE_URL even when DATABASE_URL verifies", async () => {
    environment("postgres://fixture@127.0.0.1:5432/wiseeff_acceptance_full_test");
    vi.stubEnv("TEST_DATABASE_URL", lane(issue));
    vi.stubEnv("WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR", "/fixture/owned-runtime.json");
    owned.load.mockReturnValue({ database: { name: "wiseeff_acceptance_full_test" } });
    owned.verify.mockResolvedValue(undefined);
    await expect(canonicalLaneConnectionString(issue)).rejects.toThrow(/differs/);
  });

  it("does not fall back to the manual lane when ownership fails", async () => {
    environment(lane(issue));
    vi.stubEnv("WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR", "/fixture/owned-runtime.json");
    owned.load.mockReturnValue({ database: { name: `wiseeff_lane_${issue}` } });
    owned.verify.mockRejectedValue(new Error("ownership marker mismatch"));
    await expect(canonicalLaneConnectionString(issue)).rejects.toThrow("ownership marker mismatch");
  });

  it("rejects an unavailable descriptor", async () => {
    environment(lane(issue));
    vi.stubEnv("WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR", "/fixture/owned-runtime.json");
    owned.load.mockReturnValue(undefined);
    await expect(canonicalLaneConnectionString(issue)).rejects.toThrow(/unavailable/);
    expect(owned.verify).not.toHaveBeenCalled();
  });

  it.each([
    "postgres://fixture@example.test:5432/wiseeff_acceptance_full_test",
    "postgres://fixture@127.0.0.1:5432/wiseeff_acceptance_full_test?host=example.test",
    "postgres://fixture@127.0.0.1:5432/wiseeff_acceptance_full_test#fragment",
  ])("rejects unsafe owned connection URLs before verification: %s", async (url) => {
    environment(url);
    vi.stubEnv("WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR", "/fixture/owned-runtime.json");
    await expect(canonicalLaneConnectionString(issue)).rejects.toThrow();
    expect(owned.verify).not.toHaveBeenCalled();
  });

  it("rejects an owned flag without a descriptor", async () => {
    environment(lane(issue));
    vi.stubEnv("WISEEFF_ACCEPTANCE_OWNED_RUNTIME", "true");
    await expect(canonicalLaneConnectionString(issue)).rejects.toThrow(/descriptor/);
  });
});
