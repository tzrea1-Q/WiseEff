import type pg from "pg";

import { readProtectedReference } from "./readAdapter";
import { writebackProtectedReference } from "./writebackAdapter";
import type {
  ProtectedReadCommand,
  ProtectedReferenceReadResult,
  ProtectedWritebackCommand,
  ProtectedReferenceWritebackResult,
} from "./dto";

export { readProtectedReference } from "./readAdapter";
export { writebackProtectedReference } from "./writebackAdapter";
export { THREAT_MATRIX } from "./threatMatrix";
export type { ThreatMatrixRow } from "./threatMatrix";
export type {
  ProtectedReadCommand,
  ProtectedReferenceBlock,
  ProtectedReferenceDto,
  ProtectedReferenceReadResult,
  ProtectedReferenceWriteback,
  ProtectedReferenceWritebackResult,
  ProtectedWritebackCommand,
  Result,
} from "./dto";

export type ProtectedWorkflowAdapters = {
  read(command: ProtectedReadCommand): Promise<ProtectedReferenceReadResult>;
  writeback(command: ProtectedWritebackCommand): Promise<ProtectedReferenceWritebackResult>;
};

export const createProtectedWorkflowAdapters = (pool: pg.Pool): ProtectedWorkflowAdapters => ({
  read: (command) => readProtectedReference(pool, command),
  writeback: (command) => writebackProtectedReference(pool, command),
});
