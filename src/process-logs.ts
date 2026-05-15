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

export interface LogQueryResult {
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

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Query log entries from a process's log buffer.
 * @param logs - Array of LogEntry objects
 * @param options - Query mode (head/tail/start+end)
 * @returns Formatted log text and metadata
 */
export function queryLogs(
	logs: LogEntry[],
	options: LogQueryOptions,
): LogQueryResult {
	const totalLines = logs.length;
	const { head, tail, start, end, grep, grepLiteral, grepIgnoreCase } = options;

	const hasHead = head !== undefined;
	const hasTail = tail !== undefined;
	const hasStart = start !== undefined;
	const hasEnd = end !== undefined;

	// Validate option combinations
	if (hasHead && hasTail) {
		throw new Error("Cannot specify both head and tail");
	}
	if (hasHead && hasStart) {
		throw new Error("Cannot specify both head and start");
	}
	if (hasHead && hasEnd) {
		throw new Error("Cannot specify both head and end");
	}
	if (hasTail && hasStart) {
		throw new Error("Cannot specify both tail and start");
	}
	if (hasTail && hasEnd) {
		throw new Error("Cannot specify both tail and end");
	}

	// Validate start/end values
	if (hasStart && start < 1) {
		throw new Error("start must be >= 1");
	}
	if (hasStart && hasEnd && end < start) {
		throw new Error("end must be >= start");
	}

	// If grep is provided, filter entries first (before positional slicing)
	let filteredLogs: Array<{ entry: LogEntry; originalIndex: number }>;
	if (grep) {
		const flags = grepIgnoreCase ? "i" : "";
		const regex = grepLiteral
			? new RegExp(escapeRegex(grep), flags)
			: new RegExp(grep, flags);
		filteredLogs = [];
		for (let i = 0; i < logs.length; i++) {
			if (regex.test(logs[i].text)) {
				filteredLogs.push({ entry: logs[i], originalIndex: i });
			}
		}
	} else {
		filteredLogs = logs.map((entry, originalIndex) => ({ entry, originalIndex }));
	}

	const filteredCount = filteredLogs.length;

	// Determine slice range (0-indexed, end exclusive) on filtered array
	let sliceStart = 0;
	let sliceEnd = filteredCount;

	if (hasHead) {
		sliceEnd = Math.min(head, filteredCount);
	} else if (hasTail) {
		const count = Math.min(tail, filteredCount);
		sliceStart = filteredCount - count;
	} else if (hasStart || hasEnd) {
		if (hasStart) {
			sliceStart = start - 1; // convert 1-indexed to 0-indexed
		}
		if (hasEnd) {
			sliceEnd = Math.min(end, filteredCount);
		}
		// Clamp
		sliceStart = Math.max(sliceStart, 0);
		if (sliceStart >= filteredCount) {
			sliceStart = filteredCount;
			sliceEnd = filteredCount;
		}
		if (sliceEnd < sliceStart) {
			sliceEnd = sliceStart;
		}
	}
	// else: no options → return all (sliceStart=0, sliceEnd=filteredCount)

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
