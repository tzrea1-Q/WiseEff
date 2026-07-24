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
export { indentDtsRawValueForWriteback } from "./rawValueWriteback";
export { classifyDtsValue, type ClassifiedDtsValue } from "./valueTyping";
export { resolveDtsConfigSet } from "./configSetResolver";
export { synthesizeDanglingAnchorStub, danglingAnchorLabels } from "./danglingAnchorStub";
export type {
  DtsConfigSetFile,
  DtsConfigSetInput,
  DtsResolutionDiagnostic,
  DtsResolutionDiagnosticCode,
  DtsSourceEffect,
  DtsSourceChainEntry,
  DtsNodeEffect,
  DtsNodeSourceChainEntry,
  DtsEffectiveProperty,
  DtsEffectiveNode,
  DtsEffectiveConfigSet,
  DtsConfigSetResult,
} from "./configSetResolver";
export type {
  DtsDocument,
  DtsDirective,
  DtsNodeCst,
  DtsPropertyCst,
  DtsDeletePropertyCst,
  DtsDeleteNodeCst,
  DtsValueType,
  DtsSpan,
  DtsValue,
} from "./types";
