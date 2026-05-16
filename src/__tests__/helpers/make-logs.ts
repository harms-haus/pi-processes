import type { LogEntry } from "../../types.js";

/**
 * Create a single LogEntry for testing.
 *
 * @param text      - Log line text
 * @param stream    - "stdout" (default) or "stderr"
 * @param offsetMs  - Timestamp offset in ms (default 0)
 */
export function makeLog(
	text: string,
	stream: "stdout" | "stderr" = "stdout",
	offsetMs = 0,
): LogEntry {
	return { timestamp: offsetMs, text, stream };
}

/**
 * Build an array of N sequential log entries: "Line 1", "Line 2", …
 * Each entry has an offset of i*1000 ms.
 */
export function makeLogs(count: number): LogEntry[] {
	return Array.from({ length: count }, (_, i) =>
		makeLog(`Line ${i + 1}`, "stdout", i * 1000),
	);
}
