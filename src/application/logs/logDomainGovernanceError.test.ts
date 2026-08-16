import { describe, expect, it } from "vitest";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { mapLogDomainGovernanceError } from "./logDomainGovernanceError";

function apiError(code: string, message: string, details: Record<string, unknown> = {}) {
  return new WiseEffApiError(code, message, details, "3a59d394-954c-488b-b763-5a19d5d9e58b");
}

describe("mapLogDomainGovernanceError", () => {
  it("maps format-profile validation issues onto the profile field in Chinese", () => {
    const error = apiError("VALIDATION_FAILED", "Log domain format profile is invalid.", {
      issues: [
        "timestampPattern is not a valid regular expression: Invalid regular expression: /([/: Unterminated group",
        "profile: Unrecognized key: 'unknownKey'"
      ]
    });

    expect(mapLogDomainGovernanceError(error)).toEqual({
      field: "profile",
      message: "timestampPattern 不是合法正则表达式。；格式画像含有未支持的字段。"
    });
  });

  it("maps a duplicate domain name onto the name field", () => {
    expect(
      mapLogDomainGovernanceError(
        apiError("CONFLICT", "A log domain with this name already exists in the organization.", { name: "charging-power" })
      )
    ).toEqual({
      field: "name",
      message: "该业务域名称已存在，请换一个名称。"
    });
  });

  it("maps a blank-name validation failure onto the name field", () => {
    expect(mapLogDomainGovernanceError(apiError("VALIDATION_FAILED", "Log domain name must not be blank."))).toEqual({
      field: "name",
      message: "业务域名称不能为空。"
    });
  });

  it("does not map unexpected failures so the generic toast remains", () => {
    expect(mapLogDomainGovernanceError(apiError("INTERNAL_ERROR", "boom"))).toBeNull();
    expect(mapLogDomainGovernanceError(apiError("CONFLICT", "stale row"))).toBeNull();
    expect(mapLogDomainGovernanceError(new Error("network down"))).toBeNull();
  });
});
