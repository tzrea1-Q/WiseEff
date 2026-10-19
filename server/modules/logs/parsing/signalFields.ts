import type { ParsingSpec } from "./spec";
import type { FrameReference } from "./frameSpec";

export type SignalField = { path: string; type: "number" | "string" | "boolean"; values?: string[]; unit?: string; extractor: string; decoder?: string };

/** The schema and sentence builder share the decoder's public leaf paths. */
export function listSignalFields(spec?: ParsingSpec, requestedPath?: string): { fields: SignalField[]; truncated: boolean } {
  const fields = new Map<string, SignalField>();
  let truncated = false, work = 0;
  if (!spec) return { fields: [], truncated };
  // ponytail: cap eager picker expansion; use requested-path lookup for exact validation and a lazy picker if larger lists are needed.
  const charge = () => {
    if (!requestedPath && ++work > 16384) truncated = true;
    return !truncated;
  };
  const relevant = (path: string) => path.length <= 256 && (!requestedPath || requestedPath === path || requestedPath.startsWith(`${path}.`));
  for (const extractor of spec.extractors) {
    if (!charge()) break;
    const visited = new Set<string>();
    const visit = (kind: string, id: string, path: string, depth: number) => {
      const key = `${kind}:${id}:${path}:${depth}`;
      if (visited.has(key)) return false;
      visited.add(key); return charge();
    };
    const add = (path: string, type: SignalField["type"], decoder?: string, values?: string[], unit?: string) => {
      if (truncated || !relevant(path) || requestedPath && requestedPath !== path) return;
      const previous = fields.get(path);
      if (!requestedPath && !previous && fields.size >= 4096) { truncated = true; return; }
      fields.set(path, { path, type, extractor: extractor.id, decoder, unit: previous && previous.unit !== unit ? undefined : unit,
        ...(values ? { values: [...new Set([...(previous?.values ?? []), ...values])] } : {}) });
    };
    const scalar = (path: string, type: SignalField["type"], decoder?: string, values?: string[], unit?: string) => {
      add(path, type, decoder, values, unit); add(`${path}.value`, type, decoder, values, unit);
    };
    const register = (id: string, path: string, decoder: string, depth = 1) => {
      if (!relevant(path) || depth > 8 || !visit("register", id, path, depth)) return;
      for (const field of spec.registers?.[id]?.fields ?? []) {
        if (!charge()) return;
        const child = `${path}.fields.${field.name}`;
        scalar(child, "number", decoder, undefined, field.unit);
        if (field.enum) add(`${child}.meaning`, "string", decoder, Object.values(field.enum));
      }
    };
    const reference = (ref: FrameReference, path: string, decoder: string, depth: number) => {
      if (!relevant(path) || depth > 8 || !charge()) return;
      if ("frame" in ref) frame(ref.frame, path, decoder, depth);
      else { scalar(path, "number", decoder); register(ref.register, path, decoder, depth); }
    };
    const frame = (id: string, path: string, decoder: string, depth: number) => {
      if (!relevant(path) || depth > 8 || !visit("frame", id, path, depth)) return;
      for (const field of spec.frames?.[id]?.fields ?? []) {
        if (!charge()) return;
        const child = `${path}.fields.${field.name}`;
        if (!relevant(child)) continue;
        switch (field.type) {
          case "int": case "uint":
            scalar(child, "number", decoder, undefined, field.unit);
            if (field.enum) add(`${child}.meaning`, "string", decoder, Object.values(field.enum));
            if (field.register) register(field.register, child, decoder, depth + 1);
            break;
          case "checksum": scalar(child, "number", decoder); break;
          case "register": reference({ register: field.register }, child, decoder, depth + 1); break;
          case "frame": reference({ frame: field.frame }, child, decoder, depth + 1); break;
          case "repeat": reference({ frame: field.frame }, `${child}.fields.*`, decoder, depth + 1); break;
          case "switch":
            for (const ref of [...Object.values(field.cases), ...(field.default ? [field.default] : [])]) reference(ref, child, decoder, depth + 1);
            break;
          case "tlv": {
            const item = `${child}.fields.*.fields`;
            scalar(`${item}.tag`, "number", decoder); scalar(`${item}.length`, "number", decoder);
            for (const ref of Object.values(field.cases)) reference(ref, `${item}.payload`, decoder, depth + 1);
            break;
          }
        }
      }
    };
    for (const [name, field] of Object.entries(extractor.fields)) {
      if (!charge()) break;
      const path = `${extractor.id}.${name}`;
      if (!relevant(path)) continue;
      const decode = "decode" in field ? field.decode : undefined;
      const decoder = decode ? Object.values(decode)[0] : undefined;
      if (!(decode && "frame" in decode) && !["bytes", "hexbytes", "base64bytes"].includes(field.type)) {
        // String captures are emitted directly; the other scalar captures wrap value.
        const type = ["int", "uint", "float", "hex"].includes(field.type) ? "number" : field.type === "bool" ? "boolean" : "string";
        add(path, type, decoder, field.type === "enum" ? Object.values(field.values) : undefined);
        if (field.type !== "string") add(`${path}.value`, type, decoder);
      }
      if (decode && "frame" in decode) reference(decode, path, decoder!, 1);
      else if (decode && "register" in decode) register(decode.register, path, decoder!);
      else if (decode && "registerMap" in decode) {
        const map = spec.registerMaps?.[decode.registerMap];
        for (const id of new Set([...Object.values(map?.cases ?? {}), ...(map?.default ? [map.default] : [])])) register(id, path, decoder!);
      }
    }
  }
  return { fields: [...fields.values()], truncated };
}
