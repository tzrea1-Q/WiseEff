import type { DtsImportParseResult, ParseDtsImportInput } from "@/application/ports/ParameterRepository";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * Lightweight mock full-DTS parse for demos/tests.
 * Preserves `@address` in module/sourceNodePath; does not use fragment flat extraction.
 */
export function mockParseDtsImportContent(input: ParseDtsImportInput): DtsImportParseResult {
  const cleaned = stripComments(input.content);
  if (/\/include\//.test(cleaned)) {
    const error = new Error("DTS /include/ 暂不支持，请提供展开后的文件。") as Error & {
      code: string;
      details: { code: string };
    };
    error.code = "VALIDATION_FAILED";
    error.details = { code: "dts-include-unsupported" };
    throw error;
  }

  const rows: DtsImportParseResult["rows"] = [];

  function walk(block: string, pathPrefix: string) {
    let i = 0;
    while (i < block.length) {
      while (i < block.length && /\s/.test(block[i]!)) i += 1;
      if (i >= block.length) break;

      const identMatch = block.slice(i).match(/^([A-Za-z0-9_,@.-]+)/);
      if (!identMatch) {
        i += 1;
        continue;
      }
      const ident = identMatch[1]!;
      i += ident.length;
      while (i < block.length && /\s/.test(block[i]!)) i += 1;

      if (block[i] === "{") {
        let depth = 0;
        const start = i;
        while (i < block.length) {
          if (block[i] === "{") depth += 1;
          else if (block[i] === "}") {
            depth -= 1;
            if (depth === 0) {
              i += 1;
              break;
            }
          }
          i += 1;
        }
        const inner = block.slice(start + 1, i - 1);
        const segment = ident.startsWith("&") ? ident.slice(1) : ident;
        const nextPath = pathPrefix ? `${pathPrefix}/${segment}` : segment === "/" ? "" : segment;
        walk(inner, nextPath);
        continue;
      }

      if (block[i] === "=") {
        i += 1;
        while (i < block.length && /\s/.test(block[i]!)) i += 1;
        let rawText = "";
        if (block[i] === "<") {
          const start = i;
          let depth = 0;
          while (i < block.length) {
            if (block[i] === "<") depth += 1;
            else if (block[i] === ">") {
              depth -= 1;
              if (depth === 0) {
                i += 1;
                break;
              }
            }
            i += 1;
          }
          rawText = block.slice(start, i).trim();
        } else {
          const start = i;
          while (i < block.length && block[i] !== ";") i += 1;
          rawText = block.slice(start, i).trim();
        }
        while (i < block.length && block[i] !== ";") i += 1;
        if (block[i] === ";") i += 1;

        const sourceNodePath = pathPrefix ? `${pathPrefix}/${ident}` : ident;
        const segments = sourceNodePath.split("/").filter(Boolean);
        if (segments.length < 2) continue;
        const name = segments[segments.length - 1]!;
        const module = segments.slice(0, -1).join("/");
        rows.push({
          name,
          module,
          sourceNodePath,
          rawText,
          normalizedValue: rawText,
          valueType: rawText.startsWith("<") ? "u32-array" : rawText.includes('"') ? "string-list" : "mixed"
        });
        continue;
      }

      if (block[i] === ";") {
        i += 1;
        const sourceNodePath = pathPrefix ? `${pathPrefix}/${ident}` : ident;
        const segments = sourceNodePath.split("/").filter(Boolean);
        if (segments.length >= 2) {
          const name = segments[segments.length - 1]!;
          const module = segments.slice(0, -1).join("/");
          rows.push({
            name,
            module,
            sourceNodePath,
            rawText: "",
            normalizedValue: "true",
            valueType: "bool"
          });
        }
        continue;
      }

      i += 1;
    }
  }

  walk(cleaned, "");
  return { format: "dts-full", rows };
}
