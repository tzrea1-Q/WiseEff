import { ApiError } from "../../shared/http/errors";
import { parseCanonicalCompatibleSelector, parseCanonicalNodeName, type CanonicalIdentityFailureReason } from "../parameter-catalog-contract";
import type { UpdateModuleRecognition } from "./recognitionSettings";

const LIMIT = 50;
const messages: Partial<Record<CanonicalIdentityFailureReason, [string, string]>> = {
  "not-string": ["识别标识必须是字符串。", "将标识写成 JSON 字符串；compatibles 使用字符串数组。"],
  empty: ["识别标识不能为空。", "填写实际的 compatible 或节点类型名。"],
  "control-character": ["识别标识包含换行、制表符或其他控制字符。", "删除标识中的控制字符。"],
  "non-ascii": ["识别标识包含非 ASCII 字符。", "使用源码中的 ASCII 标识；中文名称应填写在显示别名中。"],
  "surrounding-whitespace": ["识别标识的开头或结尾包含空格。", "删除标识首尾的空格。"],
  "whitespace-forbidden": ["识别标识存在不允许的空白字符。", "驱动 compatible 仅允许在厂商逗号后保留源码中原有的 ASCII 空格；其他位置不能含空白。多个 compatible 应分别填写为数组元素。"],
  "quoted-source-token": ["识别标识包含额外的源码引号。", "只保留 JSON 字符串自身的引号，删除字符串内容中的额外引号。"],
  "wildcard-forbidden": ["compatible 不支持通配符 *。", "填写完整的实际 compatible；多个匹配值分别填写为数组元素。"],
  "unit-address-present": ["节点类型名包含 @ 单元地址。", "填写不带 @ 及其地址后缀的节点类型名，例如 battery_checker@0 对应 battery_checker。"],
  "length-out-of-range": ["节点类型名超过 31 个字符。", "使用长度不超过 31 个字符的实际节点类型名。"],
};
const rules = {
  compatibles: "每个元素是一个精确 compatible；厂商逗号后可含源码原有的 ASCII 空格（原样保存），其他位置不允许空白、额外引号或通配符；格式：^[A-Za-z0-9][A-Za-z0-9+._/-]*(?:, *[A-Za-z0-9][A-Za-z0-9+._/-]*)?$。",
  nodeTypeName: "使用不含 @ 地址的节点类型名：1–31 个字符，字母开头，后续仅字母、数字及 , . _ + -；根节点 / 也合法。",
};

/** Same acceptance rules as recognition updates, with one diagnostic per offending field/value. */
export function assertRecognitionUpdate(kind: "driver" | "node-type", body: UpdateModuleRecognition): void {
  const issues: Record<string, unknown>[] = [];
  let truncated = false;
  const add = (issue: Record<string, unknown>) => {
    if (issues.length === LIMIT) { truncated = true; return; }
    const serialized = JSON.stringify(issue.received);
    issues.push(serialized && serialized.length > 1000
      ? { ...issue, received: `${serialized.slice(0, 1000)}…`, receivedTruncated: true } : issue);
  };
  const fields = ["compatibles", "driverNature", "instanceCardinality", "nodeTypeName"] as const;
  const allowed = kind === "driver" ? ["compatibles", "driverNature", "instanceCardinality"] : ["nodeTypeName"];
  if (!fields.some(field => body[field] !== undefined)) add({ path: "", code: "empty-update", received: {},
    message: "没有提供可修改的识别字段。", rule: `${kind} 主体可修改的字段：${allowed.join("、")}。`,
    hint: "至少提供一个适用于该主体类型的字段；如果不需要覆盖识别规则，请使用 inherit。",
    example: kind === "driver" ? { compatibles: ["acme,power"] } : { nodeTypeName: "battery_checker" } });
  for (const field of fields) {
    if (body[field] !== undefined && !allowed.includes(field)) add({ path: field, code: "field-not-supported",
      message: `${kind} 主体不支持修改 ${field}。`, received: body[field],
      rule: `${kind} 主体可修改的字段：${allowed.join("、")}。`,
      hint: `从本次覆盖修改中移除 ${field}；不要通过修改主体 kind 来绕过此规则。` });
  }
  const inspect = (value: string, field: "compatibles" | "nodeTypeName", path: string) => {
    const parsed = field === "compatibles" ? parseCanonicalCompatibleSelector(value) : parseCanonicalNodeName(value);
    if (parsed.ok) return;
    const [message, hint] = messages[parsed.error] ?? ["识别标识包含不允许的字符或结构。", "按字段规则填写源码中的实际标识；示例仅用于说明格式，不应直接替换真实标识。"];
    add({ path, code: parsed.error, message, received: value, rule: rules[field], hint,
      example: field === "compatibles" ? "acme,power" : "battery_checker" });
  };
  body.compatibles?.forEach((value, index) => { if (!truncated) inspect(value, "compatibles", `compatibles.${index}`); });
  if (body.nodeTypeName !== undefined) inspect(body.nodeTypeName, "nodeTypeName", "nodeTypeName");
  if (issues.length) throw new ApiError("VALIDATION_FAILED", "识别规则未通过校验，请按字段诊断修复。", {
    reason: "invalid-recognition-rule", issues, truncated, issueLimit: LIMIT,
  });
}
