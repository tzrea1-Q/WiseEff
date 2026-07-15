export { lexDts, type DtsToken, type DtsTokenKind } from "./lexer";
export { parseDts } from "./parser";
export {
  resolveDts,
  type ResolvedDts,
  type ResolvedNode,
  type ResolvedProperty,
  type ResolvedPhandleRef,
} from "./resolver";
export { serializeDts } from "./serialize";
export { classifyDtsValue, type ClassifiedDtsValue } from "./valueTyping";
export type {
  DtsDocument,
  DtsDirective,
  DtsNodeCst,
  DtsPropertyCst,
  DtsValueType,
  DtsSpan,
} from "./types";
