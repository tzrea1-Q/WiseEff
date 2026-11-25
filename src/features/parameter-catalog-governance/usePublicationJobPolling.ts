import { useCallback, useRef, useState } from "react";

import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { CatalogPublicationJobResponse } from "@/infrastructure/http/parameterCatalogDtos";

import { publicationJobIsPending } from "./publicationState";

type Poll = { jobId: string; timer?: number; reading: boolean };

export function usePublicationJobPolling(
  catalog: ParameterCatalogRepository,
  onJob: (job: CatalogPublicationJobResponse["item"]) => void,
) {
  const pollRef = useRef<Poll | null>(null);
  const [pollFailure, setPollFailure] = useState<string | null>(null);

  const stopPolling = useCallback(() => {
    window.clearTimeout(pollRef.current?.timer);
    pollRef.current = null;
    setPollFailure(null);
  }, []);
  const pollJob = async (jobId: string) => {
    const poll = pollRef.current;
    if (!poll || poll.jobId !== jobId || poll.reading) return;
    window.clearTimeout(poll.timer);
    poll.reading = true;
    let retry = true;
    try {
      const { item } = await catalog.getPublication(jobId);
      if (pollRef.current !== poll) return;
      setPollFailure(null);
      onJob(item);
      if (!publicationJobIsPending(item)) stopPolling();
    } catch (error) {
      if (pollRef.current !== poll) return;
      const status = error instanceof WiseEffApiError ? error.status : undefined;
      retry = status === undefined || status >= 500 || status === 408 || status === 429;
      setPollFailure(retry
        ? "暂时无法读取发布状态，正在自动重新查询。"
        : "无法读取发布状态，请检查当前会话和访问权限后刷新。");
    } finally {
      poll.reading = false;
      if (pollRef.current === poll && retry) poll.timer = window.setTimeout(() => void pollJob(jobId), 1000);
    }
  };
  const startPolling = (jobId: string) => {
    stopPolling();
    pollRef.current = { jobId, reading: false };
    void pollJob(jobId);
  };
  return { pollJob, startPolling, stopPolling, pollFailure };
}
