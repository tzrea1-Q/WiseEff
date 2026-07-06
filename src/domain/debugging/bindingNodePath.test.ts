import { describe, expect, it } from "vitest";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import {
  formatDebugAdminBindingSaveError,
  getBindingNodePathValidationError,
  normalizeBindingNodePath
} from "./bindingNodePath";

describe("bindingNodePath", () => {
  it("normalizes and validates absolute node paths", () => {
    expect(normalizeBindingNodePath("  /sys/foo  ")).toBe("/sys/foo");
    expect(getBindingNodePathValidationError("/sys/foo")).toBeNull();
    expect(getBindingNodePathValidationError("")).toBe("节点路径不能为空。");
    expect(getBindingNodePathValidationError("sys/foo")).toBe("节点路径必须以 / 开头。");
  });

  it("maps API validation failures to readable binding errors", () => {
    const error = new WiseEffApiError(
      "VALIDATION_FAILED",
      "Invalid debugging route input.",
      {
        issues: [
          {
            code: "invalid_string",
            validation: { startsWith: "/" },
            message: 'Invalid input: must start with "/"',
            path: ["nodePath"]
          }
        ]
      },
      "req-1"
    );

    expect(formatDebugAdminBindingSaveError(error)).toBe("节点路径必须以 / 开头且不能为空。");
  });
});
