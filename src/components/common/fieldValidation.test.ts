import { describe, expect, it } from "vitest";
import { shouldShowFieldError } from "./fieldValidation";

describe("shouldShowFieldError", () => {
  it("hides errors until the field is touched or submit is attempted", () => {
    expect(shouldShowFieldError("模块名称不能为空")).toBe(false);
    expect(shouldShowFieldError("模块名称不能为空", { touched: true })).toBe(true);
    expect(shouldShowFieldError("模块名称不能为空", { submitted: true })).toBe(true);
    expect(shouldShowFieldError(null, { touched: true })).toBe(false);
  });
});
