import type { LogEntry } from "./types.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface LogQueryOptions {
  /** Return N lines from the start */
  head?: number;
  /** Return N lines from the end */
  tail?: number;
  /** Return lines from start (1-indexed, inclusive) */
  start?: number;
  /** Return lines to end (1-indexed, inclusive) */
  end?: number;
  /** Filter log lines matching a pattern */
  grep?: string;
  /** Treat grep pattern as a literal string (escape regex metacharacters) */
  grepLiteral?: boolean;
  /** Case-insensitive grep matching */
  grepIgnoreCase?: boolean;
}

interface LogQueryResult {
  /** The queried log lines as formatted text */
  text: string;
  /** Total number of lines in the full log */
  totalLines: number;
  /** Number of lines returned */
  returnedLines: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Escape special regex metacharacters in a string for use in RegExp constructor */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatLine(entry: LogEntry, lineNum: number): string {
  return `[${lineNum}] +${entry.timestamp}ms [${entry.stream}] ${entry.text}`;
}

/** Validate that option combinations are legal, throwing on conflicts. */
function validateOptions(options: LogQueryOptions): void {
  const { head, tail, start, end } = options;
  const hasHead = head !== undefined;
  const hasTail = tail !== undefined;
  const hasStart = start !== undefined;
  const hasEnd = end !== undefined;

  const conflicts: [boolean, boolean, string][] = [
    [hasHead, hasTail, "Cannot specify both head and tail"],
    [hasHead, hasStart, "Cannot specify both head and start"],
    [hasHead, hasEnd, "Cannot specify both head and end"],
    [hasTail, hasStart, "Cannot specify both tail and start"],
    [hasTail, hasEnd, "Cannot specify both tail and end"],
  ];
  for (const [a, b, msg] of conflicts) {
    if (a && b) throw new Error(msg);
  }

  if (hasStart && start < 1) {
    throw new Error("start must be >= 1");
  }
  if (hasStart && hasEnd && end < start) {
    throw new Error("end must be >= start");
  }
}

/** Filter log entries by grep pattern if provided, otherwise return all. */
function filterByGrep(
  logs: LogEntry[],
  grep: string | undefined,
  grepLiteral: boolean | undefined,
  grepIgnoreCase: boolean | undefined,
): Array<{ entry: LogEntry; originalIndex: number }> {
  if (!grep) {
    return logs.map((entry, originalIndex) => ({ entry, originalIndex }));
  }
  const flags = grepIgnoreCase ? "i" : "";
  let regex: RegExp;
  try {
    regex = grepLiteral
      ? new RegExp(escapeRegex(grep), flags)
      : new RegExp(grep, flags);
  } catch {
    throw new Error(`Invalid regex pattern: "${grep}"`);
  }
  const result: Array<{ entry: LogEntry; originalIndex: number }> = [];
  for (let i = 0; i < logs.length; i++) {
    if (regex.test(logs[i].text)) {
      result.push({ entry: logs[i], originalIndex: i });
    }
  }
  return result;
}

/** Compute the [sliceStart, sliceEnd) range on the filtered array. */
function computeSliceRange(
  filteredCount: number,
  options: LogQueryOptions,
): [number, number] {
  const { head, tail, start, end } = options;
  const hasHead = head !== undefined;
  const hasTail = tail !== undefined;
  const hasStart = start !== undefined;
  const hasEnd = end !== undefined;

  if (hasHead) {
    return [0, Math.min(head, filteredCount)];
  }
  if (hasTail) {
    const count = Math.min(tail, filteredCount);
    return [filteredCount - count, filteredCount];
  }
  if (hasStart || hasEnd) {
    let sliceStart = hasStart ? start - 1 : 0;
    let sliceEnd = hasEnd ? Math.min(end, filteredCount) : filteredCount;
    sliceStart = Math.max(sliceStart, 0);
    if (sliceStart >= filteredCount) {
      sliceStart = filteredCount;
      sliceEnd = filteredCount;
    }
    if (sliceEnd < sliceStart) {
      sliceEnd = sliceStart;
    }
    return [sliceStart, sliceEnd];
  }
  // No options → return all
  return [0, filteredCount];
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Query log entries from a process's log buffer.
 * @param logs - Array of LogEntry objects
 * @param options - Query mode (head/tail/start+end)
 * @returns Formatted log text and metadata
 */
export function queryLogs(logs: LogEntry[], options: LogQueryOptions): LogQueryResult {
  const totalLines = logs.length;

  validateOptions(options);

  const filteredLogs = filterByGrep(
    logs,
    options.grep,
    options.grepLiteral,
    options.grepIgnoreCase,
  );
  const filteredCount = filteredLogs.length;

  const [sliceStart, sliceEnd] = computeSliceRange(filteredCount, options);

  const count = sliceEnd - sliceStart;
  const parts = new Array<string>(count);
  for (let i = 0; i < count; i++) {
    const { entry, originalIndex } = filteredLogs[sliceStart + i];
    parts[i] = formatLine(entry, originalIndex + 1);
  }

  return {
    text: parts.join("\n"),
    totalLines,
    returnedLines: count,
  };
}
