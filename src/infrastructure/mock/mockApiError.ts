import { WiseEffApiError } from "@/infrastructure/http/apiClient";

export function mockApiError(
  code: string,
  message: string,
  details: Record<string, unknown> = {}
): WiseEffApiError {
  return new WiseEffApiError(code, message, details, "mock");
}
