import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type { ConfigRevisionSummary, ValidationRun } from "@/domain/parameter-topology/types";
import { presentError } from "@/infrastructure/http/presentError";

export type ConfigRevisionGateRepository = Pick<
  ParameterTopologyRepository,
  "listConfigRevisions" | "validateRevision"
>;

export type RevisionValidationTone = "ok" | "warn" | "fail";

export type ConfigRevisionGateSnapshot = {
  revisions: ConfigRevisionSummary[];
  loading: boolean;
  error: string;
  selectedRevisionId: string | null;
  validating: boolean;
  lastRun: ValidationRun | null;
  requiresConfirmation: boolean;
  actionError: string;
};

export type ConfigRevisionGateSession = ConfigRevisionGateSnapshot & {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ConfigRevisionGateSnapshot;
  load(
    projectId: string,
    configSetId: string | null,
    repo: Pick<ParameterTopologyRepository, "listConfigRevisions">
  ): Promise<void>;
  select(revisionId: string): void;
  validate(
    projectId: string,
    repo: Pick<ParameterTopologyRepository, "validateRevision">
  ): Promise<ValidationRun | null>;
  clearActionError(): void;
};

function emptySnapshot(): ConfigRevisionGateSnapshot {
  return {
    revisions: [],
    loading: false,
    error: "",
    selectedRevisionId: null,
    validating: false,
    lastRun: null,
    requiresConfirmation: false,
    actionError: ""
  };
}

function latestRevisionId(revisions: ConfigRevisionSummary[]): string | null {
  if (revisions.length === 0) return null;
  return [...revisions].sort((left, right) => right.revisionNumber - left.revisionNumber)[0]?.id ?? null;
}

function requiresConfirmationFrom(run: ValidationRun | null): boolean {
  return Boolean(run?.requiresConfirmation) && run?.status !== "failed";
}

export function presentRevisionValidation(run: ValidationRun | null): {
  tone: RevisionValidationTone;
  summary: string;
} | null {
  if (!run) return null;
  if (run.status === "failed") {
    return { tone: "fail", summary: "修订校验未通过，不能当作已放行。" };
  }
  if (run.requiresConfirmation) {
    return { tone: "warn", summary: "修订校验未硬性通过，发布前需确认该风险。" };
  }
  return { tone: "ok", summary: "修订校验通过。" };
}

export function createConfigRevisionGateSession(): ConfigRevisionGateSession {
  const listeners = new Set<() => void>();
  let revisions: ConfigRevisionSummary[] = [];
  let loading = false;
  let error = "";
  let selectedRevisionId: string | null = null;
  let validating = false;
  let lastRun: ValidationRun | null = null;
  let actionError = "";
  let loadGeneration = 0;
  let emitScheduled = false;
  let cached = emptySnapshot();

  function rebuild(): ConfigRevisionGateSnapshot {
    return {
      revisions,
      loading,
      error,
      selectedRevisionId,
      validating,
      lastRun,
      requiresConfirmation: requiresConfirmationFrom(lastRun),
      actionError
    };
  }

  function emit(): void {
    cached = rebuild();
    if (emitScheduled) return;
    emitScheduled = true;
    queueMicrotask(() => {
      emitScheduled = false;
      cached = rebuild();
      for (const listener of listeners) listener();
    });
  }

  const session: ConfigRevisionGateSession = {
    get revisions() {
      return cached.revisions;
    },
    get loading() {
      return cached.loading;
    },
    get error() {
      return cached.error;
    },
    get selectedRevisionId() {
      return cached.selectedRevisionId;
    },
    get validating() {
      return cached.validating;
    },
    get lastRun() {
      return cached.lastRun;
    },
    get requiresConfirmation() {
      return cached.requiresConfirmation;
    },
    get actionError() {
      return cached.actionError;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return cached;
    },
    async load(projectId, configSetId, repo) {
      const generation = ++loadGeneration;
      if (!configSetId) {
        revisions = [];
        selectedRevisionId = null;
        lastRun = null;
        loading = false;
        error = "";
        actionError = "";
        emit();
        return;
      }
      loading = true;
      error = "";
      actionError = "";
      emit();
      try {
        const items = await repo.listConfigRevisions(projectId, configSetId);
        if (generation !== loadGeneration) return;
        revisions = items.map((item) => ({ ...item }));
        const previousSelected = selectedRevisionId;
        const nextSelected =
          previousSelected && revisions.some((item) => item.id === previousSelected)
            ? previousSelected
            : latestRevisionId(revisions);
        selectedRevisionId = nextSelected;
        if (lastRun && previousSelected !== nextSelected) {
          lastRun = null;
        }
        loading = false;
        emit();
      } catch (caught) {
        if (generation !== loadGeneration) return;
        revisions = [];
        selectedRevisionId = null;
        lastRun = null;
        loading = false;
        error = presentError(caught, "加载配置修订失败，请重试。");
        emit();
      }
    },
    select(revisionId) {
      if (!revisions.some((item) => item.id === revisionId)) {
        return;
      }
      if (selectedRevisionId === revisionId) return;
      selectedRevisionId = revisionId;
      lastRun = null;
      actionError = "";
      emit();
    },
    async validate(projectId, repo) {
      if (!selectedRevisionId) {
        actionError = "请先选择配置修订。";
        emit();
        return null;
      }
      const revisionId = selectedRevisionId;
      validating = true;
      actionError = "";
      emit();
      try {
        const run = await repo.validateRevision(projectId, revisionId);
        lastRun = {
          ...run,
          diagnostics: run.diagnostics ? run.diagnostics.map((item) => ({ ...item })) : undefined
        };
        validating = false;
        emit();
        return lastRun;
      } catch (caught) {
        lastRun = null;
        validating = false;
        actionError = presentError(caught, "修订校验失败，请重试。");
        emit();
        throw caught;
      }
    },
    clearActionError() {
      if (!actionError) return;
      actionError = "";
      emit();
    }
  };

  cached = rebuild();
  return session;
}
