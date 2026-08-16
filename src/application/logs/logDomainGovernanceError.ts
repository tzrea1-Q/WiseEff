import { WiseEffApiError } from "@/infrastructure/http/apiClient";

export type LogDomainGovernanceField = "name" | "profile";

export type LogDomainGovernanceFieldError = {
  field: LogDomainGovernanceField;
  message: string;
};

function presentFormatProfileIssue(issue: string): string {
  const regexField = issue.match(/^(\S+) is not a valid regular expression/);
  if (regexField) {
    return `${regexField[1]} 不是合法正则表达式。`;
  }
  if (/unrecognized key/i.test(issue)) {
    return "格式画像含有未支持的字段。";
  }
  if (/startPattern is required/i.test(issue)) {
    return "multiline.mode 为 start-pattern 时必须填写 startPattern。";
  }
  const pathPrefix = issue.match(/^([\w.[\]]+):\s+/);
  if (pathPrefix) {
    return `${pathPrefix[1]} 未通过校验。`;
  }
  return "格式画像未通过校验。";
}

function presentFormatProfileIssues(issues: string[]): string {
  const unique = [...new Set(issues.map(presentFormatProfileIssue))];
  return unique.join("；");
}

function readIssueStrings(details: Record<string, unknown>): string[] {
  if (!Array.isArray(details.issues)) {
    return [];
  }
  return details.issues.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

/**
 * Maps domain create/update API failures onto a form field. Returns null for
 * unexpected errors so the log runtime keeps the generic toast.
 */
export function mapLogDomainGovernanceError(error: unknown): LogDomainGovernanceFieldError | null {
  if (!(error instanceof WiseEffApiError)) {
    return null;
  }

  if (error.code === "CONFLICT" && typeof error.details.name === "string") {
    return { field: "name", message: "该业务域名称已存在，请换一个名称。" };
  }

  if (error.code !== "VALIDATION_FAILED") {
    return null;
  }

  if (/name must not be blank/i.test(error.message)) {
    return { field: "name", message: "业务域名称不能为空。" };
  }

  const issues = readIssueStrings(error.details);
  if (issues.length > 0 || /format profile/i.test(error.message)) {
    return {
      field: "profile",
      message: issues.length > 0 ? presentFormatProfileIssues(issues) : "格式画像未通过校验。"
    };
  }

  return null;
}
