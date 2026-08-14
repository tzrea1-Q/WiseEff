import { describe, expect, it } from "vitest";
import { WiseEffApiError } from "./apiClient";
import { NETWORK_ERROR_MESSAGE, presentError, presentErrorMessage } from "./presentError";

const FALLBACK = "操作失败，请稍后重试。";

describe("presentError", () => {
  it("maps network fetch failures to the network message", () => {
    expect(presentError(new TypeError("Failed to fetch"), FALLBACK)).toBe(NETWORK_ERROR_MESSAGE);
    expect(presentError(new TypeError("NetworkError when attempting to fetch a resource."), FALLBACK)).toBe(
      NETWORK_ERROR_MESSAGE
    );
    expect(presentError(new TypeError("Load failed"), FALLBACK)).toBe(NETWORK_ERROR_MESSAGE);
  });

  it("maps known structured API errors by message first", () => {
    const err = new WiseEffApiError("UNAUTHENTICATED", "Username or password is incorrect.", {}, "req-1");
    expect(presentError(err, FALLBACK)).toBe("用户名或密码不正确。");
  });

  it("falls back to the code mapping for unknown English API messages", () => {
    const err = new WiseEffApiError("CONFLICT", "Row version mismatch on parameter update.", {}, "req-2");
    expect(presentError(err, FALLBACK)).toBe("操作与当前状态冲突，请刷新后重试。");
  });

  it("passes through API messages that are already Chinese product copy", () => {
    const err = new WiseEffApiError("VALIDATION_FAILED", "基线名称不能为空。", {}, "req-3");
    expect(presentError(err, FALLBACK)).toBe("基线名称不能为空。");
  });

  it("uses the caller fallback for unmapped codes and messages", () => {
    const err = new WiseEffApiError("INTERNAL_ERROR", "Request failed.", {}, "req-4");
    expect(presentError(err, FALLBACK)).toBe(FALLBACK);
  });

  it("never leaks raw English messages from plain errors", () => {
    expect(presentError(new Error("Something exploded internally"), FALLBACK)).toBe(FALLBACK);
    expect(presentError(new Error("本地账号登录未启用。"), FALLBACK)).toBe("本地账号登录未启用。");
    expect(presentError("boom", FALLBACK)).toBe(FALLBACK);
    expect(presentError(undefined, FALLBACK)).toBe(FALLBACK);
  });
});

describe("presentErrorMessage", () => {
  it("maps the logs unsupported-format backend message", () => {
    expect(presentErrorMessage("Unsupported log format. Supported extensions: .log, .txt, .json.", FALLBACK)).toBe(
      "暂不支持该日志格式，请上传 .log / .txt / .json 文本日志。"
    );
  });

  it("maps release readiness raw errors", () => {
    expect(presentErrorMessage("Release readiness could not load open conflicts.", FALLBACK)).toBe(
      "发布就绪检查暂时不可用：冲突清单加载失败。"
    );
  });

  it("maps topology stale-revision backend messages", () => {
    expect(
      presentErrorMessage("Base config revision is stale for this binding.", FALLBACK)
    ).toBe("配置修订已过期，请刷新拓扑后基于最新修订重试。");
  });

  it("keeps Chinese copy and falls back on unknown English", () => {
    expect(presentErrorMessage("还有未保存的本机会话变更，不能创建基线。", FALLBACK)).toBe(
      "还有未保存的本机会话变更，不能创建基线。"
    );
    expect(presentErrorMessage("mysterious backend words", FALLBACK)).toBe(FALLBACK);
    expect(presentErrorMessage("", FALLBACK)).toBe(FALLBACK);
    expect(presentErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
  });
});
