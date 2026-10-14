import { describe, expect, it } from "vitest";
import { resolveVitestMaxWorkers } from "./vitest-workers";

describe("Vitest lane worker budget", () => {
  it("shares available CPUs between concurrent lanes without exceeding suite ceilings", () => {
    expect(resolveVitestMaxWorkers("frontend", {}, 16)).toBe(4);
    expect(resolveVitestMaxWorkers("server", { WISEEFF_VITEST_LANES: "4" }, 8)).toBe(2);
    expect(resolveVitestMaxWorkers("bridge", { WISEEFF_VITEST_LANES: "3" }, 8)).toBe(2);
    expect(resolveVitestMaxWorkers("frontend", { WISEEFF_VITEST_LANES: "8" }, 2)).toBe(1);
    expect(resolveVitestMaxWorkers("scripts", {}, 16)).toBe(1);
  });

  it("bounds the existing server override by the host's lane budget", () => {
    expect(resolveVitestMaxWorkers("server", { VITEST_SERVER_MAX_WORKERS: "2" }, 16)).toBe(2);
    expect(resolveVitestMaxWorkers("server", { VITEST_SERVER_MAX_WORKERS: "8", WISEEFF_VITEST_LANES: "4" }, 8)).toBe(2);
    expect(resolveVitestMaxWorkers("server", { VITEST_SERVER_MAX_WORKERS: "8" }, 16)).toBe(8);
  });

  it.each(["", "0", "-1", "1.5", "NaN", "Infinity", "2x", "9007199254740992"])(
    "rejects invalid worker scheduling input %j", (value) => {
      expect(() => resolveVitestMaxWorkers("frontend", { WISEEFF_VITEST_LANES: value }, 8)).toThrow("WISEEFF_VITEST_LANES");
      expect(() => resolveVitestMaxWorkers("server", { VITEST_SERVER_MAX_WORKERS: value }, 8)).toThrow("VITEST_SERVER_MAX_WORKERS");
    }
  );
});
