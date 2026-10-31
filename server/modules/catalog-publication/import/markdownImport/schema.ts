export function unwrapArraySchema(schema: Record<string, unknown>) {
  const arrays: Record<string, unknown>[] = [];
  let item = schema;
  while (item.type === "array" && item.items && typeof item.items === "object") {
    arrays.push(item);
    item = item.items as Record<string, unknown>;
  }
  return { arrays, item };
}

export function formatValueType(schema: Record<string, unknown>): string {
  const { arrays, item } = unwrapArraySchema(schema);
  return `${"array<".repeat(arrays.length)}${item.type ?? "mixed"}${">".repeat(arrays.length)}`;
}
