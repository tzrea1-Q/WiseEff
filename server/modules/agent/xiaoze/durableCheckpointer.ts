import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

export type PostgresCheckpointerHandle = {
  saver: PostgresSaver;
  ensureSetup: () => Promise<void>;
};

let sharedPostgresCheckpointer: PostgresCheckpointerHandle | undefined;

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
