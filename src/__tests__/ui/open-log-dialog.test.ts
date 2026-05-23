import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi, type MockedFunction } from "vitest";
import type { createLogDialogOverlay as CreateLogDialogOverlayFn } from "../../ui/open-log-dialog.js";

import type { LogEntry, ProcessInfo } from "../../types.js";
import type { ProcessManager } from "../../process-manager.js";

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const mockLogDialog = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    setRequestRender: vi.fn(),
    render: vi.fn(),
    handleInput: vi.fn(),
  })),
);
vi.mock("../../ui/log-dialog.js", () => ({
  LogDialog: mockLogDialog,
}));

vi.mock("../../ui/format-timestamp.js", () => ({
  formatLogTimestamp: vi.fn((ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    const millis = String(ms % 1000).padStart(3, "0");
    return `+${hours}:${minutes}:${seconds}.${millis}`;
  }),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a mock ProcessManager */
function createMockManager(
  overrides?: Partial<{ list: ProcessInfo[]; logs: LogEntry[] }>,
): ProcessManager {
  return {
    list: vi.fn().mockReturnValue(overrides?.list ?? []),
    getLogs: vi.fn().mockReturnValue(overrides?.logs ?? []),
  } as unknown as ProcessManager;
}

/** Create a mock ExtensionContext with UI */
function createMockCtx(overrides?: Partial<ExtensionContext>): ExtensionContext {
  return {
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      custom: vi.fn().mockResolvedValue(null),
      setEditorText: vi.fn(),
    },
    hasUI: true,
    cwd: "/test",
    sessionManager: {} as any,
    modelRegistry: {} as any,
    model: undefined,
    isIdle: vi.fn(() => true),
    signal: undefined,
    abort: vi.fn(),
    hasPendingMessages: vi.fn(() => false),
    shutdown: vi.fn(),
    ...overrides,
  } as unknown as ExtensionContext;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("openLogDialog", () => {
  let openLogDialog: (ctx: ExtensionContext, manager: ProcessManager) => Promise<void>;

  beforeEach(async () => {
    const mod = await import("../../ui/open-log-dialog.js");
    openLogDialog = mod.openLogDialog;
  });

  it("returns early when ctx.hasUI is false", async () => {
    const manager = createMockManager();
    const ctx = createMockCtx({ hasUI: false });

    await openLogDialog(ctx, manager);

    expect(manager.list).not.toHaveBeenCalled();
    expect(ctx.ui.custom).not.toHaveBeenCalled();
  });

  it("returns early when no processes are running", async () => {
    const manager = createMockManager({ list: [] });
    const ctx = createMockCtx();

    await openLogDialog(ctx, manager);

    expect(ctx.ui.notify).toHaveBeenCalledWith("No processes running. Start one first.", "info");
    expect(ctx.ui.custom).not.toHaveBeenCalled();
  });

  it("opens overlay with correct options when processes exist", async () => {
    const processes: ProcessInfo[] = [
      {
        name: "dev-server",
        pid: 12345,
        command: "npm run dev",
        startTime: Date.now(),
        running: true,
        uptimeSec: 42,
        logLines: 3,
        startupComplete: true,
      },
    ];
    const manager = createMockManager({ list: processes, logs: [] });
    const ctx = createMockCtx();

    await openLogDialog(ctx, manager);

    expect(ctx.ui.custom).toHaveBeenCalledWith(expect.any(Function), {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "66%",
        maxHeight: "66%",
      },
    });
  });

  it("collects logs for all processes", async () => {
    const processes: ProcessInfo[] = [
      {
        name: "dev-server",
        pid: 12345,
        command: "npm run dev",
        startTime: Date.now(),
        running: true,
        uptimeSec: 42,
        logLines: 3,
        startupComplete: true,
      },
      {
        name: "watcher",
        pid: 12346,
        command: "npm run watch",
        startTime: Date.now(),
        running: true,
        uptimeSec: 10,
        logLines: 1,
        startupComplete: true,
      },
    ];
    const logs: LogEntry[] = [{ timestamp: 1000, stream: "stdout", text: "started" }];
    const manager = createMockManager({ list: processes, logs });
    const ctx = createMockCtx();

    await openLogDialog(ctx, manager);

    expect(manager.getLogs).toHaveBeenCalledWith("dev-server");
    expect(manager.getLogs).toHaveBeenCalledWith("watcher");
  });

  it("inserts formatted logs when overlay returns a selection", async () => {
    const processes: ProcessInfo[] = [
      {
        name: "dev-server",
        pid: 12345,
        command: "npm run dev",
        startTime: Date.now(),
        running: true,
        uptimeSec: 42,
        logLines: 2,
        startupComplete: true,
      },
    ];
    const manager = createMockManager({ list: processes, logs: [] });
    const ctx = createMockCtx();
    const selectedLogs: LogEntry[] = [
      { timestamp: 1000, stream: "stdout", text: "hello" },
      { timestamp: 2500, stream: "stderr", text: "warn" },
    ];
    ctx.ui.custom = vi.fn().mockResolvedValue({
      selectedLogs,
      processName: "dev-server",
    });

    await openLogDialog(ctx, manager);

    expect(ctx.ui.setEditorText).toHaveBeenCalledWith(
      "[+00:00:01.000] [stdout] hello\n[+00:00:02.500] [stderr] warn",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith("Inserted 2 log lines from dev-server", "info");
  });

  it("does nothing when overlay is cancelled (null result)", async () => {
    const processes: ProcessInfo[] = [
      {
        name: "dev-server",
        pid: 12345,
        command: "npm run dev",
        startTime: Date.now(),
        running: true,
        uptimeSec: 42,
        logLines: 0,
        startupComplete: true,
      },
    ];
    const manager = createMockManager({ list: processes, logs: [] });
    const ctx = createMockCtx();
    ctx.ui.custom = vi.fn().mockResolvedValue(null);

    await openLogDialog(ctx, manager);

    expect(ctx.ui.setEditorText).not.toHaveBeenCalled();
    // Only the "No processes" check calls notify, not cancellation
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });
});

// ── createLogDialogOverlay ──────────────────────────────────────────────────

describe("createLogDialogOverlay", () => {
  let createLogDialogOverlay: typeof CreateLogDialogOverlayFn;

  beforeEach(async () => {
    const mod = await import("../../ui/open-log-dialog.js");
    createLogDialogOverlay = mod.createLogDialogOverlay;
  });

  it("creates a LogDialog and wires up requestRender", () => {
    const processes: ProcessInfo[] = [
      {
        name: "dev-server",
        pid: 12345,
        command: "npm run dev",
        startTime: Date.now(),
        running: true,
        uptimeSec: 42,
        logLines: 3,
        startupComplete: true,
      },
    ];
    const logs: LogEntry[] = [
      { timestamp: 1000, stream: "stdout", text: "line 1" },
      { timestamp: 2000, stream: "stderr", text: "line 2" },
      { timestamp: 3000, stream: "stdout", text: "line 3" },
    ];
    const logsByProcess = new Map<string, LogEntry[]>();
    logsByProcess.set("dev-server", logs);

    const factory = createLogDialogOverlay(processes, logsByProcess);

    const mockTui = { requestRender: vi.fn() };
    const mockTheme = {
      fg: vi.fn((_: string, text: string) => text),
      bg: vi.fn((_: string, text: string) => text),
      bold: vi.fn((text: string) => text),
    };
    const mockDone = vi.fn();

    const dialog = factory(mockTui, mockTheme, undefined, mockDone);

    expect(mockLogDialog).toHaveBeenCalledWith(processes, logsByProcess, mockTheme, mockDone);

    expect(dialog).toHaveProperty("render");
    expect(dialog).toHaveProperty("handleInput");
    expect(dialog).toHaveProperty("setRequestRender");

    expect(dialog.setRequestRender).toHaveBeenCalledTimes(1);
    const renderCallback = (dialog.setRequestRender as MockedFunction<any>).mock
      .calls[0][0] as () => void;
    renderCallback();
    expect(mockTui.requestRender).toHaveBeenCalledTimes(1);
  });
});
