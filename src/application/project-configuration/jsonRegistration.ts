export type JsonRegistrationSelection = {
  configurationSchemaId: string;
  mappings: Array<{ definitionId: string; pointer: string | null }>;
  fallbackMappings?: string;
};

export function jsonLeafPaths(text: string): Array<{ pointer: string; preview: string }> {
  const result: Array<{ pointer: string; preview: string }> = [];
  const visit = (value: unknown, pointer: string) => {
    const entries = value && typeof value === "object" ? Object.entries(value) : [];
    if (!entries.length) {
      const preview = JSON.stringify(value);
      result.push({ pointer, preview: preview.length > 100 ? preview.slice(0, 100) + "…" : preview });
    } else for (const [key, child] of entries) visit(child, `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`);
  };
  visit(JSON.parse(text.replace(/^\ufeff/, "")) as unknown, "");
  return result;
}
