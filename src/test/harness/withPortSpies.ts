import { vi } from "vitest";

/**
 * Wrap every function on a port object with `vi.fn` so tests can assert
 * call traffic while keeping the original implementation.
 *
 * `overrides` replace individual methods after wrapping (typically a
 * `vi.fn().mockResolvedValue(...)` or a failure stub).
 */
export function withPortSpies<T extends object>(port: T, overrides: Partial<T> = {}): T {
  const spied = { ...port };
  for (const key of Object.keys(port) as Array<keyof T>) {
    const value = port[key];
    if (typeof value === "function") {
      spied[key] = vi.fn(value as (...args: never[]) => unknown) as T[keyof T];
    }
  }
  return { ...spied, ...overrides };
}
