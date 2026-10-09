import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../../app/api/client";
import {
  fetchMonitorAlerts,
  fetchMonitorHistory,
  fetchMonitors,
  MAX_MONITOR_HISTORY_LIMIT,
  type MonitorAlertRow,
  type MonitorHistoryRow,
} from "../../../app/api/endpoints";

const REFRESH_MS = 30_000;
const DEFAULT_HISTORY_LIMIT = 50;
const HISTORY_LIMIT_STEP = 50;

function retryAfterDeadline(error: unknown, updatedAt: number): number | null {
  if (!(error instanceof ApiError) || !error.retryAfter) return null;
  const value = error.retryAfter.trim();
  const seconds = Number(value);
  const deadline = Number.isFinite(seconds)
    ? updatedAt + Math.max(0, seconds) * 1_000
    : Date.parse(value);
  return Number.isFinite(deadline) ? deadline : null;
}

function isTerminalFailure(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 404);
}

type QueryStateLike = { state: { error: unknown; errorUpdatedAt: number } };

function isInRetryCooldown(error: unknown, errorUpdatedAt: number): boolean {
  const deadline = retryAfterDeadline(error, errorUpdatedAt);
  return deadline !== null && Date.now() < deadline;
}

function pollingPolicy(query: QueryStateLike): number | false {
  if (isTerminalFailure(query.state.error)) return false;
  if (!query.state.error) return REFRESH_MS;
  const deadline = retryAfterDeadline(query.state.error, query.state.errorUpdatedAt);
  if (deadline === null) return REFRESH_MS;
  return Math.max(REFRESH_MS, deadline - Date.now());
}

function permitsAutomaticRefetch(query: QueryStateLike): boolean {
  return !isTerminalFailure(query.state.error) &&
    !isInRetryCooldown(query.state.error, query.state.errorUpdatedAt);
}

export interface MonitorHistoryBundle {
  monitor: Awaited<ReturnType<typeof fetchMonitors>>[number] | undefined;
  metadataError: unknown;
  metadataIsLoading: boolean;
  metadataLoaded: boolean;
  history: MonitorHistoryRow[] | undefined;
  historyError: unknown;
  historyIsLoading: boolean;
  historyIsFetching: boolean;
  historyLimit: number;
  canLoadMore: boolean;
  loadMoreHistory(): void;
  refetchHistory(): Promise<unknown>;
  alerts: MonitorAlertRow[] | undefined;
  alertsError: unknown;
  alertsIsLoading: boolean;
  refetchAlerts(): Promise<unknown>;
}

/**
 * Detail data uses its own 30 s query cadence and never mounts useMonitors' 10 s
 * polling hook. Each key is monitor-scoped; only history limit transitions for
 * the same monitor can display previous successful rows while fetching/failing.
 */
export function useMonitorHistory(monitorId: number): MonitorHistoryBundle {
  const [historyLimitState, setHistoryLimitState] = useState({
    monitorId,
    limit: DEFAULT_HISTORY_LIMIT,
  });
  const [cooldownTimerTick, setCooldownTimerTick] = useState(0);
  const historyLimit = historyLimitState.monitorId === monitorId
    ? historyLimitState.limit
    : DEFAULT_HISTORY_LIMIT;
  const previousSuccessfulHistory = useRef<{
    monitorId: number;
    rows: MonitorHistoryRow[] | undefined;
  }>({ monitorId, rows: undefined });
  if (previousSuccessfulHistory.current.monitorId !== monitorId) {
    previousSuccessfulHistory.current = { monitorId, rows: undefined };
  }
  const metadataQuery = useQuery({
    queryKey: ["monitor-history", "metadata", monitorId],
    queryFn: fetchMonitors,
    retry: false,
    retryOnMount: false,
    staleTime: REFRESH_MS,
    refetchInterval: (query) => pollingPolicy(query),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: permitsAutomaticRefetch,
    refetchOnMount: permitsAutomaticRefetch,
    refetchOnReconnect: permitsAutomaticRefetch,
    select: (monitors) => monitors.find((monitor) => monitor.id === monitorId),
    enabled: Number.isInteger(monitorId) && monitorId > 0,
  });
  const historyQuery = useQuery({
    queryKey: ["monitor-history", "rows", monitorId, historyLimit],
    queryFn: () => fetchMonitorHistory(monitorId, historyLimit),
    retry: false,
    retryOnMount: false,
    staleTime: REFRESH_MS,
    refetchInterval: (query) => pollingPolicy(query),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: permitsAutomaticRefetch,
    refetchOnMount: permitsAutomaticRefetch,
    refetchOnReconnect: permitsAutomaticRefetch,
    enabled: Number.isInteger(monitorId) && monitorId > 0,
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      const previousSameMonitor = Array.isArray(previousKey) &&
        previousKey[0] === "monitor-history" && previousKey[1] === "rows" &&
        previousKey[2] === monitorId;
      return previousSameMonitor
        ? previousData ?? previousSuccessfulHistory.current.rows
        : undefined;
    },
  });
  const alertsQuery = useQuery({
    queryKey: ["monitor-history", "alerts", monitorId],
    queryFn: () => fetchMonitorAlerts(monitorId),
    retry: false,
    retryOnMount: false,
    staleTime: REFRESH_MS,
    refetchInterval: (query) => pollingPolicy(query),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: permitsAutomaticRefetch,
    refetchOnMount: permitsAutomaticRefetch,
    refetchOnReconnect: permitsAutomaticRefetch,
    enabled: Number.isInteger(monitorId) && monitorId > 0,
  });

  if (historyQuery.data && !historyQuery.isPlaceholderData) {
    previousSuccessfulHistory.current = { monitorId, rows: historyQuery.data };
  }
  const visibleHistory = historyQuery.data ?? previousSuccessfulHistory.current.rows;
  const historyRetryDeadline = retryAfterDeadline(
    historyQuery.error,
    historyQuery.errorUpdatedAt,
  );

  useEffect(() => {
    if (historyRetryDeadline === null) return;
    const delay = historyRetryDeadline - Date.now();
    if (delay <= 0) return;
    const timer = window.setTimeout(() => {
      setCooldownTimerTick((tick) => tick + 1);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [cooldownTimerTick, historyRetryDeadline]);

  const loadMoreHistory = useCallback(() => {
    if (
      isTerminalFailure(historyQuery.error) ||
      isInRetryCooldown(historyQuery.error, historyQuery.errorUpdatedAt)
    ) return;
    setHistoryLimitState((previous) => {
      const currentLimit = previous.monitorId === monitorId
        ? previous.limit
        : DEFAULT_HISTORY_LIMIT;
      return {
        monitorId,
        limit: Math.min(MAX_MONITOR_HISTORY_LIMIT, currentLimit + HISTORY_LIMIT_STEP),
      };
    });
  }, [historyQuery.error, historyQuery.errorUpdatedAt, monitorId]);
  const refetchHistory = useCallback(async () => {
    if (isTerminalFailure(historyQuery.error) || isInRetryCooldown(historyQuery.error, historyQuery.errorUpdatedAt)) return historyQuery;
    return historyQuery.refetch();
  }, [historyQuery]);
  const refetchAlerts = useCallback(async () => {
    if (isTerminalFailure(alertsQuery.error) || isInRetryCooldown(alertsQuery.error, alertsQuery.errorUpdatedAt)) return alertsQuery;
    return alertsQuery.refetch();
  }, [alertsQuery]);

  return {
    monitor: metadataQuery.data,
    metadataError: metadataQuery.error,
    metadataIsLoading: metadataQuery.isLoading,
    metadataLoaded: metadataQuery.isSuccess,
    history: visibleHistory,
    historyError: historyQuery.error,
    historyIsLoading: historyQuery.isLoading,
    historyIsFetching: historyQuery.isFetching,
    historyLimit,
    canLoadMore: historyLimit < MAX_MONITOR_HISTORY_LIMIT &&
      !isTerminalFailure(historyQuery.error) &&
      !isInRetryCooldown(historyQuery.error, historyQuery.errorUpdatedAt),
    loadMoreHistory,
    refetchHistory,
    alerts: alertsQuery.data,
    alertsError: alertsQuery.error,
    alertsIsLoading: alertsQuery.isLoading,
    refetchAlerts,
  };
}
