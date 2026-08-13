import { describe, expect, it } from "vitest";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { toUserErrorMessage } from "./userErrorMessage";

function apiError(code: string, message = "Operator prose.", details: Record<string, unknown> = {}) {
  return new WiseEffApiError(code, message, details, "3a59d394-954c-488b-b763-5a19d5d9e58b");
}

describe("toUserErrorMessage", () => {
  it("maps every documented server code to Chinese copy with a request id suffix", () => {
    const codes = [
      "UNAUTHENTICATED",
      "FORBIDDEN",
      "NOT_FOUND",
      "VALIDATION_FAILED",
      "CONFLICT",
      "APPROVAL_REQUIRED",
      "INVALID_APPROVAL_STATE",
      "DEVICE_UNAVAILABLE",
      "PROTOCOL_UNSUPPORTED",
      "DEBUG_BINDING_NOT_CONFIGURED",
      "DEBUG_BINDING_DISABLED",
      "GONE",
      "INTERNAL_ERROR"
    ];
    for (const code of codes) {
      const message = toUserErrorMessage(apiError(code));
      expect(message, code).toMatch(/[\u4e00-\u9fff]/);
      expect(message, code).not.toContain("Operator prose.");
      expect(message, code).toContain("请求编号 3a59d394");
    }
  });

  it("prefers sharper copy for known details.reason values", () => {
    expect(toUserErrorMessage(apiError("VALIDATION_FAILED", "cell count must be 3", { reason: "schema-failure" }))).toContain(
      "不符合参数结构要求"
    );
  });

  it("keeps the server text for unknown codes but stays reportable", () => {
    const message = toUserErrorMessage(apiError("SOMETHING_NEW", "Brand new failure."));
    expect(message).toContain("Brand new failure.");
    expect(message).toContain("请求编号 3a59d394");
  });

  it("maps fetch-level network failures to connectivity copy", () => {
    expect(toUserErrorMessage(new TypeError("Failed to fetch"))).toBe("无法连接服务器，请检查网络或稍后重试。");
  });

  it("falls back to the error message, then the provided fallback", () => {
    expect(toUserErrorMessage(new Error("本地错误"))).toBe("本地错误");
    expect(toUserErrorMessage(null, "自定义兜底")).toBe("自定义兜底");
  });
});
