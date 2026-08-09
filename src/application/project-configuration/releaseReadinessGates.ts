import type { DtsReleaseReadiness } from "@/application/ports/DtsStructuredRepository";

export function releaseReadinessAllowsCreate(
  readiness: DtsReleaseReadiness | null,
  localSessionDirty: boolean
) {
  return Boolean(readiness?.available && readiness.canCreateBaseline && !localSessionDirty);
}

export function releaseReadinessAllowsRelease(
  readiness: DtsReleaseReadiness | null,
  localSessionDirty: boolean
) {
  return Boolean(readiness?.available && readiness.canRelease && !localSessionDirty);
}
