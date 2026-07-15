export type DtsValueType =
  | "u32-array"
  | "bytes"
  | "string-list"
  | "phandle-list"
  | "mixed"
  | "bool"
  | "empty";

export interface DtsSpan {
  start: number;
  end: number;
}

/**
 * Lossless typed DTS value AST. Locked in
 * `docs/exec-plans/active/2026-07-16-parameter-topology-schema-management.md` § Locked domain contracts.
 */
export type DtsValue =
  | { kind: "boolean"; present: true }
  | { kind: "empty" }
  | { kind: "strings"; values: string[] }
  | { kind: "cells"; bits: 8 | 16 | 32 | 64; groups: DtsCell[][] }
  | { kind: "bytes"; values: number[] }
  | { kind: "mixed"; segments: DtsValueSegment[] };

export type DtsCell =
  | { kind: "integer"; raw: string; value: string }
  | { kind: "phandle"; label: string };

export type DtsValueSegment =
  | { kind: "string"; raw: string; value: string }
  | { kind: "cells"; bits: 8 | 16 | 32 | 64; cells: DtsCell[] };

export interface DtsDirective {
  kind: "directive";
  name: string;
  arg?: string;
  unsupported: boolean;
  span: DtsSpan;
}

export interface DtsPropertyCst {
  kind: "property";
  name: string;
  valueType: DtsValueType;
  /**
   * Lossless typed value AST parsed from `rawText` (see `valueAst.ts`). Additive alongside
   * `valueType`/`normalizedValue` so existing consumers are unaffected; optional because
   * hand-built test fixtures may omit it.
   */
  value?: DtsValue;
  rawText: string;
  normalizedValue: string;
  span: DtsSpan;
}

export interface DtsNodeCst {
  kind: "node";
  name: string;
  unitAddress?: string;
  labels: string[];
  refTarget?: string;
  isOverlayRoot: boolean;
  children: Array<DtsNodeCst | DtsPropertyCst>;
  span: DtsSpan;
}

export interface DtsDocument {
  directives: DtsDirective[];
  topLevel: DtsNodeCst[];
  source: string;
}
