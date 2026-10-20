import pg from "pg";
import { describe, expect, it } from "vitest";

import { unwrapMaterializationKernelError } from "./materializeRelease";

describe("permanently erased Catalog identities", () => {
  it("reports the database resurrection guard as an explicit invalid release", () => {
    const error = new pg.DatabaseError("Parameter definition was permanently erased", 0, "ERROR");
    error.code = "55000";
    error.detail = "pdef_erased";
    expect(unwrapMaterializationKernelError(error)).toEqual({
      kind: "invalid-release",
      phase: "install-preflight",
      violations: [{
        code: "schema-invalid",
        location: { kind: "present", value: "pdef_erased" },
        subjectId: { kind: "absent" },
        detail: "definition-permanently-erased",
      }],
    });
  });
});
