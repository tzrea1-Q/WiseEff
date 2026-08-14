import type { BaseCheckpointSaver, CheckpointTuple } from "@langchain/langgraph-checkpoint";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const DEFAULT_INTERRUPT_DURABILITY_TIMEOUT_MS = 2000;
const DEFAULT_INTERRUPT_DURABILITY_POLL_MS = 10;

function threadCheckpointConfig(threadId: string) {
  return { configurable: { thread_id: threadId } };
}

export function isInterruptCheckpointReadable(tuple: CheckpointTuple | undefined): boolean {
  if (!tuple?.checkpoint) {
    return false;
  }
  const values = tuple.checkpoint.channel_values ?? {};
  return Boolean(values.pendingMutatingCall);
}

function getInterruptDurabilityProbeSaver(connectionString: string): PostgresCheckpointerHandle {
  if (!interruptDurabilityProbe) {
    interruptDurabilityProbe = createPostgresCheckpointerSaver({ connectionString });
  }
  return interruptDurabilityProbe;
}

export async function waitForInterruptCheckpointDurable(options: {
  threadId: string;
  saver: BaseCheckpointSaver;
  connectionString?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<void> {
  const {
    threadId,
    saver,
    connectionString,
    timeoutMs = DEFAULT_INTERRUPT_DURABILITY_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_INTERRUPT_DURABILITY_POLL_MS
  } = options;

  const config = threadCheckpointConfig(threadId);
  const deadline = Date.now() + timeoutMs;
  let durableReader: BaseCheckpointSaver = saver;

  if (connectionString?.trim()) {
    // A second pool (not the writer) so getTuple cannot be satisfied by an
    // in-process cache. Reuse one probe for the process — fromConnString on
    // every HITL would leak pg.Pool instances (PostgresSaver.end() is never
    // called on those one-shots) and re-run setup/migrations on the hot path.
    const probe = getInterruptDurabilityProbeSaver(connectionString.trim());
    await probe.ensureSetup();
    durableReader = probe.saver;
  }

  while (Date.now() < deadline) {
    const tuple = await durableReader.getTuple(config);
    if (isInterruptCheckpointReadable(tuple)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Interrupt checkpoint for thread ${threadId} did not become durable within ${timeoutMs}ms`
  );
}

export type PostgresCheckpointerHandle = {
  saver: PostgresSaver;
  ensureSetup: () => Promise<void>;
};

let sharedPostgresCheckpointer: PostgresCheckpointerHandle | undefined;
let interruptDurabilityProbe: PostgresCheckpointerHandle | undefined;

export function createPostgresCheckpointerSaver(options: {
  connectionString: string;
}): PostgresCheckpointerHandle {
  const saver = PostgresSaver.fromConnString(options.connectionString);
  let hasSetup = false;
  let setupPromise: Promise<void> | undefined;

  return {
    saver,
    async ensureSetup() {
      if (hasSetup) {
        return;
      }
      if (!setupPromise) {
        setupPromise = saver.setup().then(() => {
          hasSetup = true;
        });
      }
      await setupPromise;
    }
  };
}

export function getSharedPostgresCheckpointerSaver(connectionString: string): PostgresCheckpointerHandle {
  if (!sharedPostgresCheckpointer) {
    sharedPostgresCheckpointer = createPostgresCheckpointerSaver({ connectionString });
  }
  return sharedPostgresCheckpointer;
}

export function resetSharedPostgresCheckpointerSaverForTests(): void {
  sharedPostgresCheckpointer = undefined;
  interruptDurabilityProbe = undefined;
}

export async function setupXiaozeCheckpointerTables(options: {
  mode: "memory" | "postgres";
  connectionString?: string;
}): Promise<{ status: "skipped" | "ensured" }> {
  if (options.mode !== "postgres" || !options.connectionString?.trim()) {
    return { status: "skipped" };
  }

  const handle = getSharedPostgresCheckpointerSaver(options.connectionString.trim());
  await handle.ensureSetup();
  return { status: "ensured" };
}
