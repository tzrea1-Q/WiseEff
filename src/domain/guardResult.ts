export type DomainGuardFailure = {
  ok: false;
  code: "NOT_FOUND" | "CONFLICT" | "VALIDATION_FAILED" | "FORBIDDEN";
  message: string;
  details: Record<string, unknown>;
};

export type DomainGuardResult = { ok: true } | DomainGuardFailure;
