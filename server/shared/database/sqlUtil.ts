/**
 * Generic SQL helpers shared across module repositories: row timestamp
 * normalization and positional-placeholder condition building.
 */

export function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

export function addCondition(parts: string[], values: unknown[], condition: (placeholder: string) => string, value: unknown) {
  values.push(value);
  parts.push(condition(`$${values.length}`));
}
