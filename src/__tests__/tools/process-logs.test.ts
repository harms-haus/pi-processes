import { describe, expect, it, vi } from 'vitest';
import { createProcessLogsTool } from '../../tools/process-logs.js';
import type { LogEntry } from '../../types.js';
import {
  createMockManager,
  createMockTheme,
  executeTool,
  makeLog,
  makeLogs,
} from '../helpers/index.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a mock ProcessManager whose getLogs returns the given entries */
function mockManager(logs: LogEntry[]) {
  return createMockManager({ getLogs: vi.fn().mockReturnValue(logs) }) as any;
}

/** Render a component to a single string for assertion */
function renderToString(component: { render: (w: number) => string[] }): string {
  return component.render(200).join('\n');
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('createProcessLogsTool', () => {
  const logs = makeLogs(10);

  // 1. Tool registration has correct name, label, description
  it('has correct name, label, and description', () => {
    const tool = createProcessLogsTool(() => mockManager([]));
    expect(tool.name).toBe('process_logs');
    expect(tool.label).toBe('Process Logs');
    expect(tool.description).toContain('Read log output');
  });

  // 2. execute() with head calls queryLogs correctly
  it('execute with head returns first N lines', async () => {
    const manager = mockManager(logs);
    const tool = createProcessLogsTool(() => manager as any);

    const result = await executeTool(tool, 'call-1', {
      name: 'test-proc',
      head: 3,
    });

    expect(manager.getLogs).toHaveBeenCalledWith('test-proc');
    expect((result.details as any).totalLines).toBe(10);
    expect((result.details as any).returnedLines).toBe(3);
    expect(result.content[0].type).toBe('text');
    const text1 = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text1).toContain('[1]');
    expect(text1).toContain('[3]');
    expect(text1).not.toContain('[4]');
  });

  // 3. execute() with tail calls queryLogs correctly
  it('execute with tail returns last N lines', async () => {
    const manager = mockManager(logs);
    const tool = createProcessLogsTool(() => manager as any);

    const result = await executeTool(tool, 'call-2', {
      name: 'test-proc',
      tail: 3,
    });

    expect((result.details as any).totalLines).toBe(10);
    expect((result.details as any).returnedLines).toBe(3);
    const text2 = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text2).toContain('[8]');
    expect(text2).toContain('[10]');
    expect(text2).not.toContain('[7]');
  });

  // 4. execute() with start+end calls queryLogs correctly
  it('execute with start+end returns the correct range', async () => {
    const manager = mockManager(logs);
    const tool = createProcessLogsTool(() => manager as any);

    const result = await executeTool(tool, 'call-3', {
      name: 'test-proc',
      start: 2,
      end: 5,
    });

    expect((result.details as any).totalLines).toBe(10);
    expect((result.details as any).returnedLines).toBe(4);
    const text3 = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text3).toContain('[2]');
    expect(text3).toContain('[5]');
    expect(text3).not.toContain('[1]');
    expect(text3).not.toContain('[6]');
  });

  // 5. execute() throws on head+tail combination
  it('execute throws on head+tail combination', async () => {
    const tool = createProcessLogsTool(() => mockManager(logs) as any);

    await expect(
      executeTool(tool, 'call-4', {
        name: 'test-proc',
        head: 3,
        tail: 3,
      }),
    ).rejects.toThrow('Cannot specify both head and tail');
  });

  // 6. execute() throws on head+start combination
  it('execute throws on head+start combination', async () => {
    const tool = createProcessLogsTool(() => mockManager(logs) as any);

    await expect(
      executeTool(tool, 'call-5', {
        name: 'test-proc',
        head: 3,
        start: 2,
      }),
    ).rejects.toThrow('Cannot specify both head and start');
  });

  // 7. execute() throws on head+end combination
  it('execute throws on head+end combination', async () => {
    const tool = createProcessLogsTool(() => mockManager(logs) as any);

    await expect(
      executeTool(tool, 'call-head-end', {
        name: 'test-proc',
        head: 3,
        end: 5,
      }),
    ).rejects.toThrow('Cannot specify both head and end');
  });

  // 8. execute() throws on tail+start combination
  it('execute throws on tail+start combination', async () => {
    const tool = createProcessLogsTool(() => mockManager(logs) as any);

    await expect(
      executeTool(tool, 'call-tail-start', {
        name: 'test-proc',
        tail: 3,
        start: 2,
      }),
    ).rejects.toThrow('Cannot specify both tail and start');
  });

  // 9. execute() throws on tail+end combination
  it('execute throws on tail+end combination', async () => {
    const tool = createProcessLogsTool(() => mockManager(logs) as any);

    await expect(
      executeTool(tool, 'call-tail-end', {
        name: 'test-proc',
        tail: 3,
        end: 5,
      }),
    ).rejects.toThrow('Cannot specify both tail and end');
  });

  // 10. renderCall shows query mode
  it('renderCall shows query mode for head', () => {
    const tool = createProcessLogsTool(() => mockManager([]) as any);
    const theme = createMockTheme();

    const component = tool.renderCall!({ name: 'myapp', head: 5 }, theme as any, undefined as any);

    const str = renderToString(component);
    expect(str).toContain('process_logs');
    expect(str).toContain('myapp');
    expect(str).toContain('head(5)');
  });

  it('renderCall shows tail mode', () => {
    const tool = createProcessLogsTool(() => mockManager([]) as any);
    const theme = createMockTheme();

    const component = tool.renderCall!({ name: 'myapp', tail: 10 }, theme as any, undefined as any);

    const str = renderToString(component);
    expect(str).toContain('tail(10)');
  });

  it('renderCall shows start-end range mode', () => {
    const tool = createProcessLogsTool(() => mockManager([]) as any);
    const theme = createMockTheme();

    const component = tool.renderCall!(
      { name: 'myapp', start: 5, end: 10 },
      theme as any,
      undefined as any,
    );

    const str = renderToString(component);
    expect(str).toContain('[5-10]');
  });

  it('renderCall shows all mode when no options', () => {
    const tool = createProcessLogsTool(() => mockManager([]) as any);
    const theme = createMockTheme();

    const component = tool.renderCall!({ name: 'myapp' }, theme as any, undefined as any);

    const str = renderToString(component);
    expect(str).toContain('all');
  });

  // 8. renderResult shows line counts
  it('renderResult shows line counts', () => {
    const tool = createProcessLogsTool(() => mockManager([]) as any);
    const theme = createMockTheme();

    const result = {
      content: [{ type: 'text' as const, text: 'some log' }],
      details: { logs: 'some log', totalLines: 42, returnedLines: 10 },
    };

    const component = tool.renderResult!(result, {} as any, theme as any, undefined as any);

    const str = renderToString(component);
    expect(str).toContain('process_logs');
    expect(str).toContain('10/42');
    expect(str).toContain('lines');
  });

  // Additional: execute with empty logs returns "(no logs)"
  it('execute returns (no logs) for empty logs', async () => {
    const tool = createProcessLogsTool(() => mockManager([]) as any);

    const result = await executeTool(tool, 'call-empty', {
      name: 'test-proc',
    });

    expect((result.content[0] as { type: 'text'; text: string }).text).toBe('(no logs)');
  });

  // ── Grep pass-through tests ─────────────────────────────────────────────

  // 1. execute passes grep to queryLogs
  it('execute passes grep to queryLogs', async () => {
    const grepLogs: LogEntry[] = [
      makeLog('hello world'),
      makeLog('error: something failed'),
      makeLog('info: all good'),
      makeLog('error: another failure'),
    ];
    const manager = mockManager(grepLogs);
    const tool = createProcessLogsTool(() => manager as any);

    const result = await executeTool(tool, 'call-grep', {
      name: 'test-proc',
      grep: 'error',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('error: something failed');
    expect(text).toContain('error: another failure');
    expect(text).not.toContain('hello world');
    expect(text).not.toContain('info: all good');
  });

  // 2. execute passes grepLiteral to queryLogs
  it('execute passes grepLiteral to queryLogs', async () => {
    const grepLogs: LogEntry[] = [makeLog('foo.bar'), makeLog('fooXbar')];
    const manager = mockManager(grepLogs);
    const tool = createProcessLogsTool(() => manager as any);

    const result = await executeTool(tool, 'call-grep-literal', {
      name: 'test-proc',
      grep: 'foo.bar',
      grepLiteral: true,
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('foo.bar');
    expect(text).not.toContain('fooXbar');
  });

  // 3. execute passes grepIgnoreCase to queryLogs
  it('execute passes grepIgnoreCase to queryLogs', async () => {
    const grepLogs: LogEntry[] = [
      makeLog('ERROR: critical'),
      makeLog('error: minor'),
      makeLog('info: ok'),
    ];
    const manager = mockManager(grepLogs);
    const tool = createProcessLogsTool(() => manager as any);

    const result = await executeTool(tool, 'call-grep-ignore-case', {
      name: 'test-proc',
      grep: 'ERROR',
      grepIgnoreCase: true,
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('ERROR: critical');
    expect(text).toContain('error: minor');
    expect(text).not.toContain('info: ok');
  });

  // 4. renderCall shows grep pattern
  it('renderCall shows grep pattern', () => {
    const tool = createProcessLogsTool(() => mockManager([]) as any);
    const theme = createMockTheme();

    const component = tool.renderCall!(
      { name: 'myapp', grep: 'error' },
      theme as any,
      undefined as any,
    );

    const str = renderToString(component);
    expect(str).toContain('grep("error")');
  });

  // 5. renderCall shows grep + head
  it('renderCall shows grep + head', () => {
    const tool = createProcessLogsTool(() => mockManager([]) as any);
    const theme = createMockTheme();

    const component = tool.renderCall!(
      { name: 'myapp', grep: 'error', head: 5 },
      theme as any,
      undefined as any,
    );

    const str = renderToString(component);
    expect(str).toContain('grep("error")');
    expect(str).toContain('head(5)');
  });

  // 6. renderCall shows grep + tail
  it('renderCall shows grep + tail', () => {
    const tool = createProcessLogsTool(() => mockManager([]) as any);
    const theme = createMockTheme();

    const component = tool.renderCall!(
      { name: 'myapp', grep: 'warn', tail: 10 },
      theme as any,
      undefined as any,
    );

    const str = renderToString(component);
    expect(str).toContain('grep("warn")');
    expect(str).toContain('tail(10)');
  });
});
