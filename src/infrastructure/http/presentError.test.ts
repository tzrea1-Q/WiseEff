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

  it("maps local-evaluation auth messages to Chinese product copy", () => {
    expect(presentError(new WiseEffApiError("FORBIDDEN", "Self-registration is disabled.", {}, "req-reg"), FALLBACK)).toBe(
      "当前环境已关闭自助注册，请联系管理员创建账号。"
    );
    expect(
      presentError(new WiseEffApiError("RATE_LIMITED", "Too many authentication attempts. Try again later.", {}, "req-rl"), FALLBACK)
    ).toBe("尝试次数过多，请稍后再试。");
    expect(presentError(new WiseEffApiError("UNAUTHENTICATED", "Current password is incorrect.", {}, "req-pw"), FALLBACK)).toBe(
      "当前密码不正确。"
    );
    expect(
      presentError(
        new WiseEffApiError("VALIDATION_FAILED", "New password must be different from the current password.", {}, "req-same"),
        FALLBACK
      )
    ).toBe("新密码不能与当前密码相同。");
    expect(presentError(new WiseEffApiError("NOT_FOUND", "Local password credential was not found.", {}, "req-cred"), FALLBACK)).toBe(
      "该账号没有本地密码凭据。"
    );
    expect(presentError(new WiseEffApiError("RATE_LIMITED", "Request failed.", {}, "req-code"), FALLBACK)).toBe(
      "尝试次数过多，请稍后再试。"
    );
  });

  it("maps identity-triple CONFLICT details including a deprecated blocker", () => {
    const err = new WiseEffApiError(
      "CONFLICT",
      "A parameter definition already exists for this subject and property key.",
      { parameterSpecId: "spec-deprecated-legacy", lifecycle: "deprecated" },
      "req-identity",
    );
    expect(presentError(err, FALLBACK)).toBe(
      "目标身份已被定义「spec-deprecated-legacy」（已废弃）占用，无法覆盖。",
    );
  });

  it("maps semantic-edit successor CONFLICT details to activate-successor copy", () => {
    const err = new WiseEffApiError(
      "CONFLICT",
      "Semantic fields on an active or deprecated definition must change through activate → successor.",
      { specId: "spec-sc8562-gpio-int", code: "semantic-edit-requires-successor", reason: "semantic-edit-requires-successor" },
      "req-semantic-edit",
    );
    expect(presentError(err, FALLBACK)).toBe(
      "语义字段（取值形状 / 约束 / 单位）不能在已启用或已废弃定义上直接修改，请通过激活后继版本完成切换。",
    );
  });

  it("maps identity-triple CONFLICT details for an active blocker", () => {
    const err = new WiseEffApiError(
      "CONFLICT",
      "A parameter definition already exists for this subject and property key.",
      { parameterSpecId: "spec-mt5788-gpio-int", lifecycle: "active" },
      "req-identity-active",
    );
    expect(presentError(err, FALLBACK)).toBe(
      "目标身份已被定义「spec-mt5788-gpio-int」（已启用）占用，无法覆盖。",
    );
  });
});

describe("presentErrorMessage", () => {
  it("maps the logs unsupported-format backend message", () => {
    expect(presentErrorMessage("Unsupported log format. Supported extensions: .log, .txt, .csv, .json.", FALLBACK)).toBe(
      "暂不支持该日志格式，请上传 .log / .txt / .csv / .json 文本日志。"
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
