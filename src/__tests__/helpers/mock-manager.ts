import { vi } from "vitest";
import type { ProcessManager } from "../../process-manager.js";
import type { KillResult, LogEntry, ProcessInfo, StartupResult } from "../../types.js";

/** Default mock StartupResult used by createMockManager */
export const defaultStartupResult: StartupResult = {
  name: "dev-server",
  pid: 12345,
  startupTime: 3200,
  maxDelay: 2,
  logs: "Server listening on port 3000\nReady.",
};

/** Default mock KillResult used by createMockManager */
export const defaultKillResult: KillResult = {
  name: "my-server",
  pid: 12345,
  totalRuntime: 5432,
};

/**
 * Create a mock ProcessManager with all methods stubbed as vi.fn().
 *
 * Each method has a sensible default:
 * - start → resolves with defaultStartupResult
 * - kill → resolves with defaultKillResult
 * - restart → resolves with defaultStartupResult
 * - list → returns []
 * - getLogs → returns []
 * - getLogOffset → returns 0
 * - has → returns false
 * - size → returns 0
 * - shutdown → resolve undefined
 * - onProcessCountChange → no-op
 *
 * Pass `overrides` to replace any method or provide a different default.
 */
export function createMockManager(
  overrides?: Partial<{
    start: ProcessManager["start"];
    kill: ProcessManager["kill"];
    restart: ProcessManager["restart"];
    list: ProcessManager["list"];
    getLogs: ProcessManager["getLogs"];
    getLogOffset: ProcessManager["getLogOffset"];
    has: ProcessManager["has"];
    shutdown: ProcessManager["shutdown"];
    onProcessCountChange: ProcessManager["onProcessCountChange"];
    size: number;
  }>,
) {
  const start = vi
    .fn<(...args: any[]) => Promise<StartupResult>>()
    .mockResolvedValue(defaultStartupResult);
  const kill = vi
    .fn<(...args: any[]) => Promise<KillResult>>()
    .mockResolvedValue(defaultKillResult);
  const restart = vi
    .fn<(...args: any[]) => Promise<StartupResult>>()
    .mockResolvedValue(defaultStartupResult);
  const list = vi.fn<() => ProcessInfo[]>().mockReturnValue([]);
  const getLogs = vi.fn<(...args: any[]) => LogEntry[]>().mockReturnValue([]);
  const getLogOffset = vi.fn<(...args: any[]) => number>().mockReturnValue(0);
  const has = vi.fn<(...args: any[]) => boolean>().mockReturnValue(false);
  const shutdown = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const onProcessCountChange = vi.fn<(callback: (count: number) => void) => void>();

  if (overrides?.start) {
    start.mockImplementation(overrides.start as any);
  }
  if (overrides?.kill) {
    kill.mockImplementation(overrides.kill as any);
  }
  if (overrides?.restart) {
    restart.mockImplementation(overrides.restart as any);
  }
  if (overrides?.list) {
    list.mockImplementation(overrides.list);
  }
  if (overrides?.getLogs) {
    getLogs.mockImplementation(overrides.getLogs as any);
  }
  if (overrides?.getLogOffset) {
    getLogOffset.mockImplementation(overrides.getLogOffset as any);
  }
  if (overrides?.has) {
    has.mockImplementation(overrides.has as any);
  }
  if (overrides?.shutdown) {
    shutdown.mockImplementation(overrides.shutdown);
  }
  if (overrides?.onProcessCountChange) {
    onProcessCountChange.mockImplementation(overrides.onProcessCountChange);
  }

  return {
    start,
    kill,
    restart,
    list,
    getLogs,
    getLogOffset,
    has,
    size: overrides?.size ?? 0,
    shutdown,
    onProcessCountChange,
  };
}
