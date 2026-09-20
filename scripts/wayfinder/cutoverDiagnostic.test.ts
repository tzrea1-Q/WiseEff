import { describe, expect, it } from "vitest";

import { writeSanitizedCutoverOutput } from "./cutoverDiagnostic";

describe("cutover diagnostic sanitization", () => {
  it("redacts postgres URLs from inspect/plan JSON", () => {
    const output = writeSanitizedCutoverOutput({
      ok: false,
      error: {
        detail: "connect postgres://wiseeff:secret-pass@127.0.0.1:55438/wiseeff_t33a",
      },
    });
    expect(output).not.toContain("secret-pass");
    expect(output).toContain("[REDACTED_DATABASE_URL]");
  });
});
