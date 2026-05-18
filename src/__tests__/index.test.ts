import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

import type { ProcessManager } from '../process-manager.js';

// ── Hoisted mock state ──────────────────────────────────────────────────────

const MockProcessManager = vi.hoisted(() => {
  return vi.fn().mockImplementation(() => ({
    onProcessCountChange: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockReturnValue([]),
    getLogs: vi.fn().mockReturnValue([]),
  }));
});

vi.mock('../process-manager.js', () => ({
  ProcessManager: MockProcessManager,
}));

const toolFactoryMocks = vi.hoisted(() => ({
  createStartProcessTool: vi.fn<(gm: () => ProcessManager) => ToolDefinition<any>>(
    (_getManager: () => ProcessManager) => ({ name: 'start_process' }) as ToolDefinition<any>,
  ),
  createListProcessesTool: vi.fn<(gm: () => ProcessManager) => ToolDefinition<any>>(
    (_getManager: () => ProcessManager) => ({ name: 'list_processes' }) as ToolDefinition<any>,
  ),
  createKillProcessTool: vi.fn<(gm: () => ProcessManager) => ToolDefinition<any>>(
    (_getManager: () => ProcessManager) => ({ name: 'kill_process' }) as ToolDefinition<any>,
  ),
  createProcessLogsTool: vi.fn<(gm: () => ProcessManager) => ToolDefinition<any>>(
    (_getManager: () => ProcessManager) => ({ name: 'process_logs' }) as ToolDefinition<any>,
  ),
  createRestartProcessTool: vi.fn<(gm: () => ProcessManager) => ToolDefinition<any>>(
    (_getManager: () => ProcessManager) => ({ name: 'restart_process' }) as ToolDefinition<any>,
  ),
}));

const {
  createStartProcessTool,
  createListProcessesTool,
  createKillProcessTool,
  createProcessLogsTool,
  createRestartProcessTool,
} = toolFactoryMocks;

vi.mock('../tools/start-process.js', () => ({
  createStartProcessTool,
}));
vi.mock('../tools/list-processes.js', () => ({
  createListProcessesTool,
}));
vi.mock('../tools/kill-process.js', () => ({
  createKillProcessTool,
}));
vi.mock('../tools/process-logs.js', () => ({
  createProcessLogsTool,
}));
vi.mock('../tools/restart-process.js', () => ({
  createRestartProcessTool,
}));

const mockLogDialog = vi.hoisted(() => vi.fn());
vi.mock('../ui/log-dialog.js', () => ({
  LogDialog: mockLogDialog,
}));

vi.mock('../ui/format-timestamp.js', () => ({
  formatLogTimestamp: vi.fn((ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    const millis = String(ms % 1000).padStart(3, '0');
    return `+${hours}:${minutes}:${seconds}.${millis}`;
  }),
}));

vi.mock('@earendil-works/pi-tui', () => ({
  Key: {
    ctrlAlt: (key: string) => `ctrl+alt+${key}`,
  },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a minimal mock ExtensionAPI that captures event handlers and tools */
function createMockAPI(): {
  api: ExtensionAPI;
  handlers: Map<string, (...args: any[]) => any>;
  tools: ToolDefinition<any>[];
  shortcuts: Array<{ key: string; options: any }>;
} {
  const handlers = new Map<string, (...args: any[]) => any>();
  const tools: ToolDefinition<any>[] = [];
  const shortcuts: Array<{ key: string; options: any }> = [];

  const api = {
    on: vi.fn((event: string, handler: (...args: any[]) => any) => {
      handlers.set(event, handler);
    }),
    registerTool: vi.fn((tool: ToolDefinition<any>) => {
      tools.push(tool);
    }),
    registerShortcut: vi.fn((key: string, options: any) => {
      shortcuts.push({ key, options });
    }),
  } as unknown as ExtensionAPI;

  return { api, handlers, tools, shortcuts };
}

/** Create a mock ExtensionContext */
function createMockCtx(overrides?: Partial<ExtensionContext>): ExtensionContext {
  return {
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      custom: vi.fn().mockResolvedValue(null),
      setEditorText: vi.fn(),
    },
    hasUI: true,
    cwd: '/test',
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

describe('index (extension entry point)', () => {
  // Re-import the module for each test so the closure state is fresh.
  let extension: (pi: ExtensionAPI) => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../index.js');
    extension = mod.default;
  });

  // 1. session_start handler
  describe('session_start handler', () => {
    it('creates a ProcessManager and registers it', async () => {
      const { api, handlers } = createMockAPI();
      extension(api);

      const ctx = createMockCtx();
      const handler = handlers.get('session_start')!;
      await handler({}, ctx);

      expect(MockProcessManager).toHaveBeenCalledTimes(1);
    });

    it('wires up onProcessCountChange callback', async () => {
      const { api, handlers } = createMockAPI();
      extension(api);

      const ctx = createMockCtx();
      const handler = handlers.get('session_start')!;
      await handler({}, ctx);

      const instance = MockProcessManager.mock.results[0].value;
      expect(instance.onProcessCountChange).toHaveBeenCalledTimes(1);
    });

    it('calls ctx.ui.notify when hasUI is true', async () => {
      const { api, handlers } = createMockAPI();
      extension(api);

      const ctx = createMockCtx({ hasUI: true });
      const handler = handlers.get('session_start')!;
      await handler({}, ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith('pi-processes loaded', 'info');
    });

    it('does not call ctx.ui.notify when hasUI is false', async () => {
      const { api, handlers } = createMockAPI();
      extension(api);

      const ctx = createMockCtx({ hasUI: false });
      const handler = handlers.get('session_start')!;
      await handler({}, ctx);

      expect(ctx.ui.notify).not.toHaveBeenCalled();
    });
  });

  // 2. session_shutdown handler
  describe('session_shutdown handler', () => {
    it('calls manager.shutdown() and clears state', async () => {
      const { api, handlers } = createMockAPI();
      extension(api);

      // First start a session to create a manager
      const startHandler = handlers.get('session_start')!;
      await startHandler({}, createMockCtx());

      const instance = MockProcessManager.mock.results[0].value;

      // Now trigger shutdown
      const shutdownHandler = handlers.get('session_shutdown')!;
      await shutdownHandler({});

      expect(instance.shutdown).toHaveBeenCalledTimes(1);
    });

    it('clears status on shutdown when hasUI is true', async () => {
      const { api, handlers } = createMockAPI();
      extension(api);

      const ctx = createMockCtx({ hasUI: true });
      const startHandler = handlers.get('session_start')!;
      await startHandler({}, ctx);

      const shutdownHandler = handlers.get('session_shutdown')!;
      await shutdownHandler({});

      expect(ctx.ui.setStatus).toHaveBeenCalledWith('pi-processes', undefined);
    });

    it('skips clearing status when hasUI is false (currentCtx null)', async () => {
      const { api, handlers } = createMockAPI();
      extension(api);

      const ctx = createMockCtx({ hasUI: false });
      const startHandler = handlers.get('session_start')!;
      await startHandler({}, ctx);

      const shutdownHandler = handlers.get('session_shutdown')!;
      await shutdownHandler({});

      // ctx.ui.setStatus was never called because hasUI is false
      expect(ctx.ui.setStatus).not.toHaveBeenCalled();
    });

    it('is safe when no session was started', async () => {
      const { api, handlers } = createMockAPI();
      extension(api);

      const shutdownHandler = handlers.get('session_shutdown')!;
      // Should not throw even without a prior session_start
      await expect(shutdownHandler({})).resolves.toBeUndefined();
    });
  });

  // 3. getManager() throws when manager is null
  describe('getManager()', () => {
    it('throws when called before session_start', async () => {
      const { api } = createMockAPI();
      extension(api);

      // The tool factories receive a getManager function.
      // Find the one passed to createStartProcessTool
      expect(createStartProcessTool).toHaveBeenCalledTimes(1);
      const getManager = (createStartProcessTool as MockedFunction<any>).mock
        .calls[0][0] as () => ProcessManager;

      expect(() => getManager()).toThrow('ProcessManager not initialized');
    });

    it('returns the manager after session_start', async () => {
      const { api, handlers } = createMockAPI();
      extension(api);

      const ctx = createMockCtx();
      const handler = handlers.get('session_start')!;
      await handler({}, ctx);

      const getManager = (createStartProcessTool as MockedFunction<any>).mock
        .calls[0][0] as () => ProcessManager;
      const manager = getManager();
      expect(manager).toBeDefined();
    });

    it('throws again after session_shutdown', async () => {
      const { api, handlers } = createMockAPI();
      extension(api);

      const ctx = createMockCtx();
      const startHandler = handlers.get('session_start')!;
      await startHandler({}, ctx);

      const shutdownHandler = handlers.get('session_shutdown')!;
      await shutdownHandler({});

      const getManager = (createStartProcessTool as MockedFunction<any>).mock
        .calls[0][0] as () => ProcessManager;
      expect(() => getManager()).toThrow('ProcessManager not initialized');
    });
  });

  // 4. Process count callback
  describe('onProcessCountChange callback', () => {
    it('calls setStatus with process names when hasUI is true', async () => {
      const { api, handlers } = createMockAPI();
      extension(api);

      const ctx = createMockCtx({ hasUI: true });
      const handler = handlers.get('session_start')!;
      await handler({}, ctx);

      // Grab the callback registered via onProcessCountChange
      const instance = MockProcessManager.mock.results[0].value;
      const callback = instance.onProcessCountChange.mock.calls[0][0] as () => void;

      // Make list() return some processes
      instance.list.mockReturnValue([{ name: 'dev-server' }, { name: 'watcher' }]);

      callback();

      expect(ctx.ui.setStatus).toHaveBeenCalledWith('pi-processes', 'p: dev-server, watcher');
    });

    it('calls setStatus with empty string when no processes', async () => {
      const { api, handlers } = createMockAPI();
      extension(api);

      const ctx = createMockCtx({ hasUI: true });
      const handler = handlers.get('session_start')!;
      await handler({}, ctx);

      const instance = MockProcessManager.mock.results[0].value;
      const callback = instance.onProcessCountChange.mock.calls[0][0] as () => void;

      instance.list.mockReturnValue([]);

      callback();

      expect(ctx.ui.setStatus).toHaveBeenCalledWith('pi-processes', '');
    });

    it('skips setStatus when hasUI is false', async () => {
      const { api, handlers } = createMockAPI();
      extension(api);

      const ctx = createMockCtx({ hasUI: false });
      const handler = handlers.get('session_start')!;
      await handler({}, ctx);

      const instance = MockProcessManager.mock.results[0].value;
      const callback = instance.onProcessCountChange.mock.calls[0][0] as () => void;

      instance.list.mockReturnValue([{ name: 'dev-server' }]);

      callback();

      expect(ctx.ui.setStatus).not.toHaveBeenCalled();
    });
  });

  // 5. Tool registration
  describe('tool registration', () => {
    it('registers all 5 tools', () => {
      const { api, tools } = createMockAPI();
      extension(api);

      expect(api.registerTool).toHaveBeenCalledTimes(5);
      expect(tools).toHaveLength(5);
    });

    it('registers tools with correct names', () => {
      const { api, tools } = createMockAPI();
      extension(api);

      const names = tools.map((t) => t.name);
      expect(names).toContain('start_process');
      expect(names).toContain('list_processes');
      expect(names).toContain('kill_process');
      expect(names).toContain('process_logs');
      expect(names).toContain('restart_process');
    });

    it('passes getManager to each tool factory', () => {
      const { api } = createMockAPI();
      extension(api);

      // Each factory was called exactly once with a function argument
      expect(createStartProcessTool).toHaveBeenCalledTimes(1);
      expect(createListProcessesTool).toHaveBeenCalledTimes(1);
      expect(createKillProcessTool).toHaveBeenCalledTimes(1);
      expect(createProcessLogsTool).toHaveBeenCalledTimes(1);
      expect(createRestartProcessTool).toHaveBeenCalledTimes(1);

      for (const factory of [
        createStartProcessTool,
        createListProcessesTool,
        createKillProcessTool,
        createProcessLogsTool,
        createRestartProcessTool,
      ]) {
        expect(typeof (factory as MockedFunction<any>).mock.calls[0][0]).toBe('function');
      }
    });
  });

  // 6. Shortcut registration
  describe('shortcut registration', () => {
    it('registers a Ctrl+Alt+P shortcut', async () => {
      const { api } = createMockAPI();
      extension(api);

      expect(api.registerShortcut).toHaveBeenCalledWith(
        'ctrl+alt+p',
        expect.objectContaining({ description: expect.any(String) }),
      );
    });

    it('shortcut handler returns early when hasUI is false', async () => {
      const { api, shortcuts } = createMockAPI();
      extension(api);
      const handler = shortcuts[0].options.handler;
      const ctx = createMockCtx({ hasUI: false });
      await handler(ctx);
      expect(ctx.ui.custom).not.toHaveBeenCalled();
    });

    it('shortcut handler returns early when manager is null', async () => {
      const { api, shortcuts } = createMockAPI();
      extension(api);
      const handler = shortcuts[0].options.handler;
      const ctx = createMockCtx();
      await handler(ctx);
      expect(ctx.ui.custom).not.toHaveBeenCalled();
    });

    it('notifies when no processes are running', async () => {
      const { api, shortcuts, handlers } = createMockAPI();
      extension(api);
      const startHandler = handlers.get('session_start')!;
      await startHandler({}, createMockCtx());
      const instance = MockProcessManager.mock.results[0].value;
      instance.list.mockReturnValue([]);

      const handler = shortcuts[0].options.handler;
      const ctx = createMockCtx();
      await handler(ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith('No processes running. Start one first.', 'info');
    });

    it('opens overlay with correct options', async () => {
      const { api, shortcuts, handlers } = createMockAPI();
      extension(api);
      const startHandler = handlers.get('session_start')!;
      await startHandler({}, createMockCtx());
      const instance = MockProcessManager.mock.results[0].value;
      instance.list.mockReturnValue([{ name: 'dev-server', pid: 12345 }]);
      instance.getLogs.mockReturnValue([]);

      const handler = shortcuts[0].options.handler;
      const ctx = createMockCtx();
      await handler(ctx);

      expect(ctx.ui.custom).toHaveBeenCalledWith(expect.any(Function), {
        overlay: true,
        overlayOptions: {
          anchor: 'center',
          width: '66%',
          maxHeight: '66%',
        },
      });
    });

    it('inserts formatted logs on result', async () => {
      const { api, shortcuts, handlers } = createMockAPI();
      extension(api);
      const startHandler = handlers.get('session_start')!;
      await startHandler({}, createMockCtx());
      const instance = MockProcessManager.mock.results[0].value;
      instance.list.mockReturnValue([{ name: 'dev-server' }]);
      instance.getLogs.mockReturnValue([]);

      const selectedLogs = [{ timestamp: 1000, stream: 'stdout', text: 'hello' }];
      const ctx = createMockCtx();
      ctx.ui.custom = vi.fn().mockResolvedValue({ selectedLogs, processName: 'dev-server' });

      const handler = shortcuts[0].options.handler;
      await handler(ctx);

      expect(ctx.ui.setEditorText).toHaveBeenCalledWith('[+00:00:01.000] [stdout] hello');
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('1 log lines'), 'info');
    });

    it('does nothing when dialog is cancelled (null result)', async () => {
      const { api, shortcuts, handlers } = createMockAPI();
      extension(api);
      const startHandler = handlers.get('session_start')!;
      await startHandler({}, createMockCtx());
      const instance = MockProcessManager.mock.results[0].value;
      instance.list.mockReturnValue([{ name: 'dev-server' }]);
      instance.getLogs.mockReturnValue([]);

      const ctx = createMockCtx();
      ctx.ui.custom = vi.fn().mockResolvedValue(null);

      const handler = shortcuts[0].options.handler;
      await handler(ctx);

      expect(ctx.ui.setEditorText).not.toHaveBeenCalled();
    });
  });
});
