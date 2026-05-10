import { describe, expect, it } from "vitest";
import { getContextQuery } from "./App";

describe("getContextQuery", () => {
  it("返回 logId 字段", () => {
    const query = getContextQuery("?logId=log-active&project=aurora");

    expect(query.logId).toBe("log-active");
    expect(query.projectId).toBe("aurora");
  });

  it("无 logId 时返回空字符串", () => {
    const query = getContextQuery("?project=aurora");

    expect(query.logId).toBe("");
  });
});
