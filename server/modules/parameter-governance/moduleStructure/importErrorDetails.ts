import { ApiError } from "../../../shared/http/errors";

const ISSUE_LIMIT = 50;
const VALUE_LIMIT = 1000;
type Entry = Record<string, unknown>;
const record = (value: unknown): value is Entry => value !== null && typeof value === "object" && !Array.isArray(value);
const parts = (path: unknown): (string | number)[] => Array.isArray(path)
  ? path.filter((part): part is string | number => typeof part === "string" || typeof part === "number")
  : typeof path === "string" ? path.split(".").filter(Boolean) : [];
function read(value: unknown, path: (string | number)[]): unknown {
  for (const part of path) {
    if (!value || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, part)) return undefined;
    value = (value as Entry)[part];
  }
  return value;
}
function bounded(value: unknown) {
  const serialized = JSON.stringify(value);
  return serialized && serialized.length > VALUE_LIMIT
    ? { value: `${serialized.slice(0, VALUE_LIMIT)}…`, truncated: true } : { value, truncated: false };
}

/** Keep schema branches relevant: a module placement needs moduleRef, not errors for every other kind. */
function* expand(issue: Entry): Generator<Entry> {
  if (issue.code === "unrecognized_keys" && Array.isArray(issue.keys)) {
    for (const key of issue.keys) if (typeof key === "string") yield { ...issue, path: [...parts(issue.path), key],
      message: `不支持字段 ${key}。`, rule: "此对象使用严格字段集合，不接受未知字段。", hint: `删除 ${key} 字段，或按导入指南改为受支持的字段。` };
    return;
  }
  if (issue.code === "invalid_union" && Array.isArray(issue.unionErrors)) {
    const branches = issue.unionErrors.filter(record).map(error => Array.isArray(error.issues) ? error.issues.filter(record) : []);
    const compatible = branches.find(branch => branch.length && !branch.some(item => item.code === "invalid_literal"));
    if (compatible) { for (const child of compatible) yield* expand(child); return; }
    const literals = branches.flatMap(branch => branch.filter(item => item.code === "invalid_literal"));
    if (literals.length && literals.every(item => JSON.stringify(item.path) === JSON.stringify(literals[0].path))) {
      yield { path: literals[0].path, code: "invalid_enum_value", options: [...new Set(literals.map(item => item.expected))] };
      return;
    }
  }
  yield issue;
}

function schemaDescription(issue: Entry): Entry {
  switch (issue.code) {
    case "invalid_type": return { message: issue.received === "undefined" ? "缺少必需字段。" : "字段的数据类型不正确。",
      rule: `类型必须为 ${String(issue.expected)}。`, hint: `按 ${String(issue.expected)} 类型填写此字段；不要使用字符串代替数字、数组或对象。` };
    case "invalid_enum_value": return { message: "字段值不在允许的枚举范围内。", allowedValues: issue.options,
      rule: "只能使用列出的合法枚举值，区分大小写。", hint: "按实际业务含义选择一个允许值；不要自行翻译或缩写枚举值。" };
    case "invalid_literal": return { message: "字段必须使用固定值。", expected: issue.expected,
      rule: `固定值为 ${JSON.stringify(issue.expected)}。`, hint: "恢复此固定值。" };
    case "too_small": case "too_big": {
      const lower = issue.code === "too_small", threshold = lower ? issue.minimum : issue.maximum;
      const measure = issue.type === "array" ? "数组元素数量" : issue.type === "string" ? "字符串长度" : "数值";
      const relation = lower ? (issue.inclusive ? "不少于" : "大于") : (issue.inclusive ? "不超过" : "小于");
      return { message: `${measure}超出允许范围。`, rule: `${measure}必须${relation} ${String(threshold)}。`, hint: "按此范围调整当前字段。" };
    }
    default: return {};
  }
}

/** Enrich existing failures with submitted context only; never query or expose another tenant's data. */
export function enrichModuleStructureError(error: unknown, raw: unknown): unknown {
  if (!(error instanceof ApiError) || (error.code !== "VALIDATION_FAILED" && error.code !== "CONFLICT")) return error;
  const original = Array.isArray(error.details.issues) ? error.details.issues.filter(record)
    : error.details.path !== undefined ? [{ path: error.details.path, message: error.message }] : [];
  if (!original.length) return error;
  const issues: Entry[] = [];
  let truncated = error.details.truncated === true;
  outer: for (const entry of original) for (const issue of expand(entry)) {
    if (issues.length === ISSUE_LIMIT) { truncated = true; break outer; }
    let path = parts(issue.path);
    if (["subjects", "modules", "newDrivers", "source", "counts", "limits", "references"].includes(String(path[0]))) path = ["document", ...path];
    const filePath = path[0] === "document" ? path.slice(1) : null;
    const schema = schemaDescription(issue);
    const described: Entry = { ...issue, ...schema, path: path.join(".") };
    // Zod's received/expected describe types, not the submitted value; domain diagnostics already carry values.
    if (issue.code === "invalid_type") delete described.expected;
    if (!Object.prototype.hasOwnProperty.call(issue, "received") || issue.code === "invalid_type") {
      const value = read(raw, path);
      described.received = value === undefined ? "（字段缺失）"
        : path.length <= 1 && value !== null && typeof value === "object" ? `（${Array.isArray(value) ? "array" : "object"}）` : value;
    }
    if (filePath) {
      const pointerPath = filePath.at(-1) === "length" && Array.isArray(read(raw, path.slice(0, -1))) ? filePath.slice(0, -1) : filePath;
      described.jsonPointer = pointerPath.length ? `/${pointerPath.map(part => String(part).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}` : "";
      const index = Number(filePath[1]);
      if (Number.isInteger(index) && index >= 0 && ["subjects", "modules", "newDrivers"].includes(String(filePath[0]))) {
        const item = read(raw, ["document", filePath[0], index]);
        if (record(item)) {
          const key = filePath[0] === "subjects" ? "subject" : filePath[0] === "newDrivers" ? "newDriver" : "module";
          const keys = key === "subject" ? ["subjectId", "kind", "displayAlias"] : key === "newDriver" ? ["ref", "compatible", "displayAlias"] : ["ref", "sourceId", "name"];
          const supplied = record(issue[key]) ? issue[key] : {};
          described[key] = { index, ...Object.fromEntries(keys.flatMap(name => {
            const value = supplied[name] ?? item[name];
            return value === null || typeof value === "string" ? [[name, bounded(value).value]] : [];
          })) };
        }
      }
    }
    const result: Entry = {};
    for (const key of ["path", "jsonPointer", "code", "message", "rule", "hint", "subject", "module", "newDriver", "expected", "received", "allowedValues", "example"]) {
      if (!Object.prototype.hasOwnProperty.call(described, key)) continue;
      const value = key === "subject" || key === "module" || key === "newDriver" ? { value: described[key], truncated: false } : bounded(described[key]);
      result[key] = value.value;
      if (value.truncated || described[`${key}Truncated`] === true) result[`${key}Truncated`] = true;
    }
    issues.push(result);
  }
  return new ApiError(error.code, error.message, { ...error.details, issues, truncated, issueLimit: ISSUE_LIMIT });
}
