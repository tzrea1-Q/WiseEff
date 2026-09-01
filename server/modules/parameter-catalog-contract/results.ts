import type { CatalogInstallMode, CatalogVerificationCheckCode } from "./enums";
import type {
  CatalogEventTime,
  CatalogMaterializationFingerprint,
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogReleaseVersion,
  MaintenanceAttemptId
} from "./ids";

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export type OptionalValue<T> =
  | { readonly kind: "present"; readonly value: T }
  | { readonly kind: "absent" };

export interface CatalogReleaseIdentity {
  readonly id: CatalogReleaseId;
  readonly version: CatalogReleaseVersion;
  readonly digest: CatalogReleaseDigest;
}

export interface CatalogReleasePin {
  readonly id: CatalogReleaseId;
  readonly digest: CatalogReleaseDigest;
}

export interface CatalogReleaseCounts {
  readonly subjects: number;
  readonly subjectMemberships: number;
  readonly aliases: number;
  readonly aliasMemberships: number;
  readonly definitions: number;
  readonly definitionRevisions: number;
}

export type InstallResult =
  | {
      readonly status: "installed";
      readonly mode: CatalogInstallMode;
      readonly previous: CatalogReleasePin | null;
      readonly current: CatalogReleaseIdentity;
      readonly materializationFingerprint: CatalogMaterializationFingerprint;
      readonly counts: CatalogReleaseCounts;
    }
  | {
      readonly status: "already-current";
      readonly current: CatalogReleaseIdentity;
      readonly materializationFingerprint: CatalogMaterializationFingerprint;
      readonly counts: CatalogReleaseCounts;
    };

export interface SwitchBackResult {
  readonly status: "switched-back";
  readonly maintenanceAttemptId: MaintenanceAttemptId;
  readonly previousCurrent: CatalogReleaseIdentity;
  readonly current: CatalogReleaseIdentity;
  readonly materializationFingerprint: CatalogMaterializationFingerprint;
}

export interface CatalogVerificationCheck {
  readonly code: CatalogVerificationCheckCode;
  readonly status: "passed";
}

export interface VerificationResult {
  readonly status: "verified";
  readonly release: CatalogReleaseIdentity;
  readonly materializationFingerprint: CatalogMaterializationFingerprint;
  readonly verifiedAt: CatalogEventTime;
  readonly checks: readonly CatalogVerificationCheck[];
  readonly counts: CatalogReleaseCounts;
}

export type ContractJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ContractJsonValue[]
  | { readonly [key: string]: ContractJsonValue };

const serializationTypeError = (reason: string): never => {
  throw new TypeError(`Contract serialization rejected ${reason}`);
};

const indent = (depth: number): string => "  ".repeat(depth);

const serializeRuntimeValue = (
  value: unknown,
  depth: number,
  activeObjects: Set<object>
): string => {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number": {
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        return serializationTypeError("a number that JSON would coerce");
      }
      return JSON.stringify(value);
    }
    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      return serializationTypeError(`non-JSON value type ${typeof value}`);
  }

  if (activeObjects.has(value)) {
    return serializationTypeError("a cyclic object graph");
  }
  activeObjects.add(value);

  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        return serializationTypeError("a non-plain array");
      }

      const ownKeys = Reflect.ownKeys(value);
      if (
        ownKeys.length !== value.length + 1 ||
        ownKeys.some((key) => typeof key !== "string")
      ) {
        return serializationTypeError("an array with unsupported own properties");
      }

      const serializedItems: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          return serializationTypeError("a sparse array");
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          return serializationTypeError("an array with a non-data element");
        }
        serializedItems.push(
          `${indent(depth + 1)}${serializeRuntimeValue(
            descriptor.value,
            depth + 1,
            activeObjects
          )}`
        );
      }

      if (serializedItems.length === 0) {
        return "[]";
      }
      return `[\n${serializedItems.join(",\n")}\n${indent(depth)}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return serializationTypeError("a non-plain object");
    }

    const entries = Reflect.ownKeys(value).map((key): readonly [string, unknown] => {
      if (typeof key !== "string") {
        return serializationTypeError("an object with a symbol key");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        return serializationTypeError("an object with a hidden or accessor property");
      }
      return [key, descriptor.value];
    });
    entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

    if (entries.length === 0) {
      return "{}";
    }
    const serializedEntries = entries.map(
      ([key, entryValue]) =>
        `${indent(depth + 1)}${JSON.stringify(key)}: ${serializeRuntimeValue(
          entryValue,
          depth + 1,
          activeObjects
        )}`
    );
    return `{\n${serializedEntries.join(",\n")}\n${indent(depth)}}`;
  } finally {
    activeObjects.delete(value);
  }
};

export const serializeContract = (value: ContractJsonValue): string =>
  `${serializeRuntimeValue(value, 0, new Set())}\n`;
