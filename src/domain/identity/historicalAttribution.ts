/** Event-time labels are separate from the live account used for authorization. */
export type HistoricalIdentity = {
  id: string | null;
  name: string | null;
  source: "recorded" | "legacy-current" | "unknown";
};

export type HistoricalAttribution = {
  organization: HistoricalIdentity;
  actors: Record<string, HistoricalIdentity>;
};

export function historicalIdentityLabel(identity: HistoricalIdentity | undefined): string {
  if (!identity?.name) return "历史署名未记录";
  return identity.source === "legacy-current" ? `${identity.name}（迁移时名称）` : identity.name;
}
