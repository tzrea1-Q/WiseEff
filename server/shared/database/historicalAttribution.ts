/** Only repository-owned aliases/column names may be passed to this SQL fragment. */
export function historicalActorSql(rowAlias: string, actorColumn: string): string {
  const identity = `${rowAlias}.historical_attribution->'actors'->'${actorColumn}'`;
  return `(case when ${identity}->>'source' = 'legacy-current'
    then (${identity}->>'name') || '（迁移时名称）' else ${identity}->>'name' end)`;
}
