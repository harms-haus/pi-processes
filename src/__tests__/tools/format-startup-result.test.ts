import { describe, expect, it } from 'vitest';
import { formatStartupResult } from '../../tools/format-startup-result.js';
import type { StartupResult } from '../../types.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<StartupResult> = {}): StartupResult {
  return {
    name: 'my-server',
    pid: 12345,
    startupTime: 1500,
    maxDelay: 3,
    logs: 'Server listening on port 3000',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('formatStartupResult', () => {
  it("formats output with 'started' verb and typical values including logs", () => {
    const result = makeResult();
    const output = formatStartupResult('started', result);

    expect(output).toContain("Process 'my-server' started");
    expect(output).toContain('PID 12345');
    expect(output).toContain('1.5s');
    expect(output).toContain('3s');
    expect(output).toContain('Server listening on port 3000');
  });

  it("formats output with 'restarted' verb and typical values including logs", () => {
    const result = makeResult();
    const output = formatStartupResult('restarted', result);

    expect(output).toContain("Process 'my-server' restarted");
    expect(output).toContain('PID 12345');
    expect(output).toContain('1.5s');
    expect(output).toContain('3s');
    expect(output).toContain('Server listening on port 3000');
  });

  it("shows '(no output)' when logs is an empty string", () => {
    const result = makeResult({ logs: '' });
    const output = formatStartupResult('started', result);

    expect(output).toContain('(no output)');
  });

  it('includes PID in the output', () => {
    const result = makeResult({ pid: 98765 });
    const output = formatStartupResult('started', result);

    expect(output).toContain('PID 98765');
  });

  it('formats startup time as seconds with 1 decimal place', () => {
    const result = makeResult({ startupTime: 2345 });
    const output = formatStartupResult('started', result);

    expect(output).toContain('2.3s');
  });

  it("includes maxDelay with 's' suffix", () => {
    const result = makeResult({ maxDelay: 7 });
    const output = formatStartupResult('started', result);

    expect(output).toContain('7s');
  });
});
