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
