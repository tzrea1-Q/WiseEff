type JsonSchema = boolean | Readonly<Record<string, unknown>>;
type JsonObject = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is JsonObject =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

const pointer = (root: JsonSchema, fragment: string): JsonSchema | undefined => {
  if (fragment === "" || fragment === "#") return root;
  const path = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const value = path
    .split("/")
    .slice(1)
    .map((token) => token.replace(/~1/gu, "/").replace(/~0/gu, "~"))
    .reduce<unknown>((current, token) => {
      if (!isRecord(current)) return undefined;
      return current[token];
    }, root);
  return typeof value === "boolean" || isRecord(value) ? value : undefined;
};

const equalJson = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((entry, index) => equalJson(entry, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    equalJson(leftKeys, rightKeys) &&
    leftKeys.every((key) => equalJson(left[key], right[key]))
  );
};

const matchesType = (value: unknown, type: string): boolean => {
  switch (type) {
    case "null":
      return value === null;
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype;
    case "string":
      return typeof value === "string";
    case "integer":
      return Number.isSafeInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    default:
      return false;
  }
};

export const validateJsonSchema = (
  value: unknown,
  schema: JsonSchema,
  root: JsonSchema,
  registry: ReadonlyMap<string, JsonSchema>,
): boolean => {
  if (schema === true) return true;
  if (schema === false) return false;

  const reference = schema.$ref;
  if (typeof reference === "string") {
    if (reference.startsWith("#")) {
      const target = pointer(root, reference);
      return target !== undefined && validateJsonSchema(value, target, root, registry);
    }
    const [id, fragment = ""] = reference.split("#", 2);
    const referencedRoot = registry.get(id);
    const target = referencedRoot && pointer(referencedRoot, fragment);
    return (
      referencedRoot !== undefined &&
      target !== undefined &&
      validateJsonSchema(value, target, referencedRoot, registry)
    );
  }

  if (schema.const !== undefined && !equalJson(value, schema.const)) return false;
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => equalJson(value, entry))) {
    return false;
  }
  if (typeof schema.type === "string" && !matchesType(value, schema.type)) {
    return false;
  }

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter(
      (candidate): candidate is JsonSchema =>
        typeof candidate === "boolean" || isRecord(candidate),
    ).filter((candidate) => validateJsonSchema(value, candidate, root, registry));
    if (matches.length !== 1) return false;
  }
  if (Array.isArray(schema.allOf)) {
    for (const candidate of schema.allOf) {
      if (
        (typeof candidate !== "boolean" && !isRecord(candidate)) ||
        !validateJsonSchema(value, candidate, root, registry)
      ) {
        return false;
      }
    }
  }
  if (schema.not !== undefined) {
    if (
      (typeof schema.not !== "boolean" && !isRecord(schema.not)) ||
      validateJsonSchema(value, schema.not, root, registry)
    ) {
      return false;
    }
  }
  if (schema.if !== undefined) {
    if (typeof schema.if !== "boolean" && !isRecord(schema.if)) return false;
    const condition = validateJsonSchema(value, schema.if, root, registry);
    const branch = condition ? schema.then : schema.else;
    if (branch !== undefined) {
      if (
        (typeof branch !== "boolean" && !isRecord(branch)) ||
        !validateJsonSchema(value, branch, root, registry)
      ) {
        return false;
      }
    }
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      return false;
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
      return false;
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return false;
    if (typeof schema.maximum === "number" && value > schema.maximum) return false;
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      return false;
    }
    if (schema.uniqueItems === true) {
      for (let left = 0; left < value.length; left += 1) {
        for (let right = left + 1; right < value.length; right += 1) {
          if (equalJson(value[left], value[right])) return false;
        }
      }
    }
    if (schema.items !== undefined) {
      if (typeof schema.items !== "boolean" && !isRecord(schema.items)) return false;
      if (!value.every((entry) => validateJsonSchema(entry, schema.items as JsonSchema, root, registry))) {
        return false;
      }
    }
    if (schema.contains !== undefined) {
      if (typeof schema.contains !== "boolean" && !isRecord(schema.contains)) return false;
      const matching = value.filter((entry) =>
        validateJsonSchema(entry, schema.contains as JsonSchema, root, registry),
      ).length;
      const minimum = typeof schema.minContains === "number" ? schema.minContains : 1;
      if (matching < minimum) return false;
    }
  }

  if (isRecord(value)) {
    const required = Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === "string")
      : [];
    if (required.some((key) => !Object.hasOwn(value, key))) return false;
    const properties = isRecord(schema.properties) ? schema.properties : {};
    if (
      schema.additionalProperties === false &&
      Object.keys(value).some((key) => !Object.hasOwn(properties, key))
    ) {
      return false;
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!Object.hasOwn(value, key)) continue;
      if (
        (typeof propertySchema !== "boolean" && !isRecord(propertySchema)) ||
        !validateJsonSchema(value[key], propertySchema, root, registry)
      ) {
        return false;
      }
    }
  }

  return true;
};
