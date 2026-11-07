/** The current organization overlay is a separate, fixed inventory from page projections. */
export type OrganizationRecognitionQuery = "rules-schema" | "owners-schema" | "rules" | "owners";

export function classifyOrganizationRecognitionQuery(sql: string): OrganizationRecognitionQuery | undefined {
  const normalized = sql.replace(/\s+/g, " ").trim();
  if (normalized === "select to_regclass('public.registration_recognition_rules') is not null as available") return "rules-schema";
  if (normalized.startsWith("select exists ( select 1 from pg_catalog.pg_attribute ")
    && normalized.includes("attrelid = 'parameter_catalog.organization_subject_registrations'::regclass")
    && normalized.includes("attname = 'owner_subject_id' and not attisdropped")) return "owners-schema";
  if (normalized.startsWith("select effective.module_id, effective.subject_id as canonical_subject_id, rule.compatibles,")
    && normalized.includes("from public.registration_recognition_rules rule")) return "rules";
  if (normalized.startsWith("select subject_id,owner_subject_id from parameter_catalog.organization_subject_registrations ")) return "owners";
  return undefined;
}
