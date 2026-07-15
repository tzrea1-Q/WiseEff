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
