import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildUserImportReport } from "./userImportWorkbook";

describe("user import report workbook", () => {
  it("exports a blocked preview as literal text with physical rows and no credentials", () => {
    const firstRow = { row: 2, name: "=HYPERLINK(\"https://example.com\")", username: "alice", title: "+title", roles: ["guest" as const], password: "secret-credential" };
    const bytes = buildUserImportReport({ kind: "preview", organizationName: "=ORG()", preview: {
      organization: { id: "o", name: "Org", status: "active" }, total: 2, privilegedCount: 0, token: null,
      rows: [
        firstRow,
        { row: 5, name: "Bob", username: "bob", title: "", roles: ["guest"] },
      ], errors: [{ row: 5, field: "password", message: "密码不符合要求" }],
    } });
    const book = XLSX.read(bytes, { type: "array", cellFormula: true });
    const sheet = book.Sheets[book.SheetNames[0]];
    const values = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    expect(values).toEqual([
      ["用户导入清单", "预检未通过"], ["操作组织", "=ORG()"],
      ["说明", "请按原始行号修改含凭据的原始模板并重新上传预检；本清单不是可导入的凭据模板。"],
      ["原始行号", "用户名", "姓名", "职务", "状态", "错误字段", "修复建议"],
      ["2", "alice", "=HYPERLINK(\"https://example.com\")", "+title", "未创建：整批校验未通过", "", ""],
      ["5", "bob", "Bob", "", "未创建：需修正", "初始密码", "密码不符合要求"],
    ]);
    for (const [key, cell] of Object.entries(sheet)) if (!key.startsWith("!")) {
      expect(cell.t).toBe("s"); expect(cell.f).toBeUndefined(); expect(cell.l).toBeUndefined();
    }
    expect(JSON.stringify(book)).not.toContain("secret-credential");
  });

  it("never labels a clean preview as a blocked report", () => {
    expect(() => buildUserImportReport({ kind: "preview", organizationName: "Org", preview: {
      organization: { id: "o", name: "Org", status: "active" }, total: 1, privilegedCount: 0, token: "token",
      rows: [{ row: 2, name: "A", username: "alice", title: "", roles: ["guest"] }], errors: [],
    } })).toThrow();
  });

  it("reports 500 committed rows including a deleted user and has no credential column", () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ row: i + 2, userId: `id-${i}`, name: i === 499 ? undefined : `name-${i}`, username: i === 499 ? null : `user-${i}` }));
    const bytes = buildUserImportReport({ kind: "success", organizationName: "Org", receipt: { importId: "batch-1", organizationId: "o", count: 500, rows } });
    const book = XLSX.read(bytes, { type: "array" });
    const sheet = book.Sheets[book.SheetNames[0]];
    const values = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    expect(values.slice(0, 6)).toEqual([
      ["用户导入清单", "创建完成"], ["操作组织", "Org"],
      ["说明", "请按原始行号修改含凭据的原始模板并重新上传预检；本清单不是可导入的凭据模板。"],
      ["批次编号", "batch-1"], ["创建人数", "500"], ["原始行号", "用户名", "姓名", "职务", "状态", "错误字段", "修复建议"],
    ]);
    expect(values).toHaveLength(506);
    expect(values[6]).toEqual(["2", "user-0", "name-0", "", "已创建", "", ""]);
    expect(values[505]).toEqual(["501", "", "用户信息不可用", "", "已创建", "", ""]);
    for (const [key, cell] of Object.entries(sheet)) if (!key.startsWith("!")) {
      expect(cell.t).toBe("s"); expect(cell.f).toBeUndefined(); expect(cell.l).toBeUndefined();
    }
    expect(JSON.stringify(book)).not.toContain("password");
  });

  it("reports an unreadable file without inventing scanned rows", () => {
    const bytes = buildUserImportReport({ kind: "file-error", organizationName: "Org" });
    const book = XLSX.read(bytes, { type: "array" });
    const values = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]], { header: 1 });
    expect(values.slice(3)).toEqual([
      ["原始行号", "用户名", "姓名", "职务", "状态", "错误字段", "修复建议"],
      ["", "", "", "", "文件无法读取，未检查逐行数据", "文件", "请检查原始模板后重新上传预检。"],
    ]);
  });
});
