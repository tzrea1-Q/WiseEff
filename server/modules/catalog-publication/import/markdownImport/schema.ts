export function unwrapArraySchema(schema: Record<string, unknown>) {
  const arrays: Record<string, unknown>[] = [];
  let item = schema;
  while (item.type === "array" && item.items && typeof item.items === "object") {
    arrays.push(item);
    item = item.items as Record<string, unknown>;
  }
  return { arrays, item };
}
