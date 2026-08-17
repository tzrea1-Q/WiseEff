import { z, type ZodTypeAny } from "zod";

type JsonSchema = Record<string, unknown>;

function unwrap(schema: ZodTypeAny): { inner: ZodTypeAny; optional: boolean; nullable: boolean } {
  let inner = schema;
  let optional = false;
  let nullable = false;

  for (let i = 0; i < 8; i += 1) {
    const typeName = inner._def.typeName as string;
    if (typeName === "ZodOptional" || typeName === "ZodDefault") {
      optional = true;
      inner = inner._def.innerType as ZodTypeAny;
      continue;
    }
    if (typeName === "ZodNullable") {
      nullable = true;
      inner = inner._def.innerType as ZodTypeAny;
      continue;
    }
    if (typeName === "ZodEffects") {
      inner = inner._def.schema as ZodTypeAny;
      continue;
    }
    break;
  }

  return { inner, optional, nullable };
}

function withNullable(schema: JsonSchema, nullable: boolean): JsonSchema {
  if (!nullable) {
    return schema;
  }
  if (schema.type) {
    return { ...schema, type: Array.isArray(schema.type) ? [...schema.type, "null"] : [schema.type, "null"] };
  }
  return { anyOf: [schema, { type: "null" }] };
}

function convertInner(schema: ZodTypeAny): JsonSchema {
  const def = schema._def;
  const typeName = def.typeName as string;

  switch (typeName) {
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodNull":
      return { type: "null" };
    case "ZodUnknown":
    case "ZodAny":
      return {};
    case "ZodLiteral":
      return { type: typeof def.value, enum: [def.value] };
    case "ZodEnum":
      return { type: "string", enum: [...def.values] };
    case "ZodArray":
      return { type: "array", items: convert(def.type as ZodTypeAny) };
    case "ZodRecord":
      return { type: "object", additionalProperties: convert((def.valueType ?? z.unknown()) as ZodTypeAny) };
    case "ZodObject": {
      const shape = def.shape() as Record<string, ZodTypeAny>;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, field] of Object.entries(shape)) {
        const unwrapped = unwrap(field);
        properties[key] = withNullable(convertInner(unwrapped.inner), unwrapped.nullable);
        if (!unwrapped.optional) {
          required.push(key);
        }
      }
      return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: def.unknownKeys === "passthrough"
      };
    }
    case "ZodUnion": {
      const options = (def.options as ZodTypeAny[]).map((option) => convert(option));
      return { anyOf: options };
    }
    default:
      return { type: "object" };
  }
}

export function convert(schema: ZodTypeAny): JsonSchema {
  const unwrapped = unwrap(schema);
  return withNullable(convertInner(unwrapped.inner), unwrapped.nullable);
}

export function zodToOpenApiSchema(schema: ZodTypeAny, name: string): JsonSchema {
  return {
    ...convert(schema),
    "x-wiseeff-schema": name
  };
}
