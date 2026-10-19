import { registerCaseKey } from "@wiseeff/dto-schemas";
import type { ParsePreview, SkillSpec } from "./types";

type Parsing = NonNullable<SkillSpec["parsing"]>;
type Decoded = ParsePreview["events"][number]["fields"][string];
type Reference = { frame: string } | { register: string };
type Occurrence = { key: string; decoder: Reference; path: string[]; value: Decoded };
const scalar = (value: Decoded | undefined) => value && typeof value === "object" && "value" in value ? value.value : value;

/** Follow actual decoded nodes, never expand a frame definition without a matching value. */
export function decodedOccurrences(spec: Parsing, events: ParsePreview["events"]): Occurrence[] {
  const result: Occurrence[] = [];
  events.forEach((event, eventIndex) => {
    const select = (cases: Record<string, Reference>, value: unknown) => Object.entries(cases).find(([key]) => registerCaseKey(key) === registerCaseKey(String(value)))?.[1];
    const visit = (decoder: Reference, value: Decoded, path: string[], depth: number) => {
      if (depth > 8 || !value || typeof value !== "object" || !("value" in value)) return;
      result.push({ key: `${eventIndex}:${path.join(".")}`, decoder, path, value });
      if (!("frame" in decoder) || !value.fields) return;
      const children = value.fields;
      const at = (path: string) => {
        const [root, ...parts] = path.split(".");
        let current: Decoded | undefined = Object.hasOwn(children, root) ? children[root] : event.fields[root];
        for (const part of parts) current = current && typeof current === "object" && "fields" in current ? current.fields?.[part] : undefined;
        return scalar(current);
      };
      for (const field of spec.frames?.[decoder.frame]?.fields ?? []) {
        const child = children[field.name], nestedPath = [...path, field.name];
        if (child === undefined) continue;
        if ("register" in field && field.register) visit({ register: field.register }, child, nestedPath, depth + 1);
        if (field.type === "frame") visit({ frame: field.frame }, child, nestedPath, depth + 1);
        if (field.type === "switch") {
          const ref = select(field.cases, at(field.on)) ?? field.default;
          if (ref) visit(ref, child, nestedPath, depth + 1);
        }
        if (!child || typeof child !== "object" || !("fields" in child) || !child.fields) continue;
        if (field.type === "repeat") for (const [index, item] of Object.entries(child.fields)) visit({ frame: field.frame }, item, [...nestedPath, index], depth + 1);
        if (field.type === "tlv") for (const [index, item] of Object.entries(child.fields)) {
          if (!item || typeof item !== "object" || !("fields" in item) || !item.fields) continue;
          const ref = select(field.cases, scalar(item.fields.tag));
          if (ref && item.fields.payload !== undefined) visit(ref, item.fields.payload, [...nestedPath, index, "payload"], depth + 1);
        }
      }
    };
    const extractor = spec.extractors.find((item) => item.id === event.extractor);
    for (const [name, value] of Object.entries(event.fields)) {
      const field = extractor?.fields[name];
      if (!field || !("decode" in field) || !field.decode) continue;
      if ("registerMap" in field.decode) {
        const map = spec.registerMaps?.[field.decode.registerMap];
        if (!map) continue;
        const selected = Object.entries(map.cases).find(([key]) => registerCaseKey(key) === registerCaseKey(String(scalar(event.fields[map.selectBy]))))?.[1] ?? map.default;
        if (selected) visit({ register: selected }, value, [name], 1);
      } else visit(field.decode, value, [name], 1);
    }
  });
  return result;
}
