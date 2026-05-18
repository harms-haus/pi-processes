import { describe, expect, it } from 'vitest';
import { createKillProcessTool } from '../../tools/kill-process.js';
import {
  createMockManager,
  createMockTheme,
  defaultKillResult,
  executeTool,
} from '../helpers/index.js';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('createKillProcessTool', () => {
  it('has correct name and label', () => {
    const manager = createMockManager();
    const tool = createKillProcessTool(() => manager as any);

    expect(tool.name).toBe('kill_process');
    expect(tool.label).toBe('Kill Process');
  });

  it('execute() calls manager.kill with correct name', async () => {
    const manager = createMockManager();
    const tool = createKillProcessTool(() => manager as any);

    await executeTool(tool, 'call-1', { name: 'my-server' });

    expect(manager.kill).toHaveBeenCalledWith('my-server');
    expect(manager.kill).toHaveBeenCalledTimes(1);
  });

  it('execute() returns formatted text with runtime', async () => {
    const manager = createMockManager();
    const tool = createKillProcessTool(() => manager as any);

    const result = await executeTool(tool, 'call-1', { name: 'my-server' });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    // 5432ms = 5.432s → toFixed(1) = "5.4"
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain("Process 'my-server' killed");
    expect(text).toContain('PID 12345');
    expect(text).toContain('5.4s');
  });

  it('execute() returns details with KillResult shape', async () => {
    const manager = createMockManager();
    const tool = createKillProcessTool(() => manager as any);

    const result = await executeTool(tool, 'call-1', { name: 'my-server' });

    expect(result.details).toEqual(defaultKillResult);
  });

  it('renderCall shows warning color', () => {
    const manager = createMockManager();
    const tool = createKillProcessTool(() => manager as any);
    const theme = createMockTheme();

    const component = tool.renderCall!({ name: 'my-server' }, theme as any, {} as any);

    expect(theme.fg).toHaveBeenCalledWith('warning', expect.stringContaining('kill_process'));
    expect(theme.fg).toHaveBeenCalledWith('accent', 'my-server');
    expect(component).toBeDefined();
  });

  it('renderResult shows error indicator', () => {
    const manager = createMockManager();
    const tool = createKillProcessTool(() => manager as any);
    const theme = createMockTheme();

    const toolResult = {
      content: [{ type: 'text' as const, text: 'killed' }],
      details: {
        name: 'my-server',
        pid: 12345,
        totalRuntime: 5432,
      },
    };

    const component = tool.renderResult!(toolResult, {} as any, theme as any, {} as any);

    expect(theme.fg).toHaveBeenCalledWith('error', expect.stringContaining('✗ my-server'));
    expect(theme.fg).toHaveBeenCalledWith('dim', expect.stringContaining('PID 12345'));
    expect(theme.fg).toHaveBeenCalledWith('dim', expect.stringContaining('5.4s'));
    expect(component).toBeDefined();
  });
});
