import { describe, expect, it } from "vitest";

import { ApiError } from "../../shared/http/errors";
import { rewritePropertyKeyInDtsSource } from "./propertyKeySourceRewrite";

const SOURCE = `/dts-v1/;
/ {
	charger@6e {
		typo_prop = <1>;
	};
};
`;

describe("rewritePropertyKeyInDtsSource (ADR-0034 prepare)", () => {
  it("renames the property and keeps the same raw value", () => {
    const next = rewritePropertyKeyInDtsSource(SOURCE, {
      fromKey: "typo_prop",
      toKey: "corrected_prop",
      nodePath: "/charger@6e",
    });

    expect(next).toContain("corrected_prop = <1>");
    expect(next).not.toContain("typo_prop");
  });

  it("renames only the named node even when another node shares the old key", () => {
    const next = rewritePropertyKeyInDtsSource(
      `/dts-v1/;
/ {
	other {
		typo_prop = <0>;
	};
	charger@6e {
		typo_prop = <1>;
	};
};
`,
      { fromKey: "typo_prop", toKey: "corrected_prop", nodePath: "/charger@6e" },
    );

    expect(next).toContain("corrected_prop = <1>");
    expect(next).toMatch(/other \{[\s\S]*typo_prop = <0>/);
    expect(next).not.toContain("corrected_prop = <0>");
  });

  it("does not rewrite a value that happens to contain the old key", () => {
    const next = rewritePropertyKeyInDtsSource(
      `/dts-v1/;
/ {
	other {
		note = "typo_prop";
	};
	charger@6e {
		typo_prop = <1>;
	};
};
`,
      { fromKey: "typo_prop", toKey: "corrected_prop", nodePath: "/charger@6e" },
    );

    expect(next).toContain('note = "typo_prop"');
    expect(next).toContain("corrected_prop = <1>");
  });

  it("refuses a rewrite without a node path", () => {
    expect(() =>
      rewritePropertyKeyInDtsSource(SOURCE, {
        fromKey: "typo_prop",
        toKey: "corrected_prop",
        nodePath: "   ",
      }),
    ).toThrow(
      expect.objectContaining({
        code: "VALIDATION_FAILED",
        details: expect.objectContaining({ reason: "missing-node-path" }),
      } satisfies Partial<ApiError>),
    );
  });

  it("refuses when the new key already exists on the same node", () => {
    expect(() =>
      rewritePropertyKeyInDtsSource(
        `/dts-v1/;
/ {
	charger@6e {
		typo_prop = <1>;
		corrected_prop = <2>;
	};
};
`,
        { fromKey: "typo_prop", toKey: "corrected_prop", nodePath: "/charger@6e" },
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CONFLICT",
        details: expect.objectContaining({ reason: "conflict" }),
      } satisfies Partial<ApiError>),
    );
  });
});
