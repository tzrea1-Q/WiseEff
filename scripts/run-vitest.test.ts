import { describe, expect, it } from "vitest";
import { buildVitestInvocation } from "./run-vitest";

describe("buildVitestInvocation", () => {
  it("defaults unit tests to mock runtime so local .env API mode does not leak into Vitest", () => {
    const invocation = buildVitestInvocation(["src/App.test.tsx"], {}, "linux");

    expect(invocation.env.VITE_WISEEFF_RUNTIME_MODE).toBe("mock");
    expect(invocation.args).toEqual(["vitest", "run", "src/App.test.tsx"]);
  });

  it("preserves an explicit runtime override for targeted API-mode test runs", () => {
    const invocation = buildVitestInvocation([], { VITE_WISEEFF_RUNTIME_MODE: "api" }, "win32");

    expect(invocation.command).toBe("cmd.exe");
    expect(invocation.args).toEqual(["/d", "/s", "/c", "npx vitest run"]);
    expect(invocation.env.VITE_WISEEFF_RUNTIME_MODE).toBe("api");
  });
});
