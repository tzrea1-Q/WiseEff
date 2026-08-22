export const PROVISIONAL_SURFACE_DOCUMENTATION =
  "临时 DTS 表面绑定；完成参数定义审阅后可激活。";

export function provisionalSurfaceDescription(propertyKey: string) {
  return `参数「${propertyKey}」由 DTS 表面发现，等待参数定义审阅。`;
}

export function presentProvisionalSurfaceDescription(
  propertyKey: string,
  description: string | null | undefined
) {
  const normalized = description?.trim();
  if (!normalized) return undefined;
  if (normalized === `Provisional surface spec for ${propertyKey}`) {
    return provisionalSurfaceDescription(propertyKey);
  }
  return normalized;
}
