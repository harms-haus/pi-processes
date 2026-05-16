import { describe, expect, it } from "vitest";
import { queryLogs } from "../process-logs.js";
import { makeLog, makeLogs } from "./helpers/index.js";

// ── Tests ───────────────────────────────────────────────────────────────────

describe("queryLogs", () => {
	// 1. head(5) returns first 5 lines
	it("head(5) returns first 5 lines", () => {
		const logs = makeLogs(10);
		const result = queryLogs(logs, { head: 5 });

		expect(result.totalLines).toBe(10);
		expect(result.returnedLines).toBe(5);
		expect(result.text).toContain("[1]");
		expect(result.text).toContain("[5]");
		expect(result.text).not.toContain("[6]");
		expect(result.text).toContain("Line 1");
		expect(result.text).toContain("Line 5");
	});

	// 2. head(100) on 10-line log returns all 10
	it("head larger than total returns all lines", () => {
		const logs = makeLogs(10);
		const result = queryLogs(logs, { head: 100 });

		expect(result.totalLines).toBe(10);
		expect(result.returnedLines).toBe(10);
	});

	// 3. tail(3) returns last 3 lines
	it("tail(3) returns last 3 lines", () => {
		const logs = makeLogs(10);
		const result = queryLogs(logs, { tail: 3 });

		expect(result.totalLines).toBe(10);
		expect(result.returnedLines).toBe(3);
		expect(result.text).toContain("[8]");
		expect(result.text).toContain("[10]");
		expect(result.text).not.toContain("[7]");
		expect(result.text).toContain("Line 8");
		expect(result.text).toContain("Line 10");
	});

	// 4. start=2, end=5 returns lines 2-5 (1-indexed)
	it("start=2, end=5 returns lines 2 through 5", () => {
		const logs = makeLogs(10);
		const result = queryLogs(logs, { start: 2, end: 5 });

		expect(result.totalLines).toBe(10);
		expect(result.returnedLines).toBe(4);
		expect(result.text).toContain("[2]");
		expect(result.text).toContain("[5]");
		expect(result.text).not.toContain("[1]");
		expect(result.text).not.toContain("[6]");
	});

	// 5. start=2 with no end returns from line 2 to end
	it("start=2 with no end returns from line 2 to end", () => {
		const logs = makeLogs(10);
		const result = queryLogs(logs, { start: 2 });

		expect(result.totalLines).toBe(10);
		expect(result.returnedLines).toBe(9);
		expect(result.text).toContain("[2]");
		expect(result.text).toContain("[10]");
		expect(result.text).not.toContain("[1]");
	});

	// 6. end=3 with no start returns lines 1-3
	it("end=3 with no start returns lines 1 through 3", () => {
		const logs = makeLogs(10);
		const result = queryLogs(logs, { end: 3 });

		expect(result.totalLines).toBe(10);
		expect(result.returnedLines).toBe(3);
		expect(result.text).toContain("[1]");
		expect(result.text).toContain("[3]");
		expect(result.text).not.toContain("[4]");
	});

	// 7. No options returns all logs
	it("no options returns all logs", () => {
		const logs = makeLogs(10);
		const result = queryLogs(logs, {});

		expect(result.totalLines).toBe(10);
		expect(result.returnedLines).toBe(10);
		expect(result.text).toContain("[1]");
		expect(result.text).toContain("[10]");
	});

	// 8. head + tail combination throws Error
	it("head + tail combination throws Error", () => {
		const logs = makeLogs(10);
		expect(() => queryLogs(logs, { head: 5, tail: 3 })).toThrow(Error);
	});

	it("head + start combination throws Error", () => {
		const logs = makeLogs(10);
		expect(() => queryLogs(logs, { head: 5, start: 2 })).toThrow(Error);
	});

	it("head + end combination throws Error", () => {
		const logs = makeLogs(10);
		expect(() => queryLogs(logs, { head: 5, end: 3 })).toThrow(Error);
	});

	it("tail + start combination throws Error", () => {
		const logs = makeLogs(10);
		expect(() => queryLogs(logs, { tail: 3, start: 2 })).toThrow(Error);
	});

	it("tail + end combination throws Error", () => {
		const logs = makeLogs(10);
		expect(() => queryLogs(logs, { tail: 3, end: 5 })).toThrow(Error);
	});

	// 9. start=0 throws Error (1-indexed)
	it("start=0 throws Error (must be 1-indexed)", () => {
		const logs = makeLogs(10);
		expect(() => queryLogs(logs, { start: 0 })).toThrow(Error);
	});

	it("start negative throws Error", () => {
		const logs = makeLogs(10);
		expect(() => queryLogs(logs, { start: -1 })).toThrow(Error);
	});

	it("end < start throws Error", () => {
		const logs = makeLogs(10);
		expect(() => queryLogs(logs, { start: 5, end: 2 })).toThrow(Error);
	});

	// 10. Empty log array returns empty text
	it("empty log array returns empty result", () => {
		const result = queryLogs([], {});

		expect(result.totalLines).toBe(0);
		expect(result.returnedLines).toBe(0);
		expect(result.text).toBe("");
	});

	it("empty log array with head returns empty result", () => {
		const result = queryLogs([], { head: 5 });

		expect(result.totalLines).toBe(0);
		expect(result.returnedLines).toBe(0);
		expect(result.text).toBe("");
	});

	// 11. Single line log with head(1) returns that line
	it("single line log with head(1) returns that line", () => {
		const logs = [makeLog("Only line")];
		const result = queryLogs(logs, { head: 1 });

		expect(result.totalLines).toBe(1);
		expect(result.returnedLines).toBe(1);
		expect(result.text).toContain("[1]");
		expect(result.text).toContain("Only line");
	});

	// Additional: verify output format
	it("formats lines with line number, timestamp, stream, and text", () => {
		const logs = [makeLog("Hello", "stdout", 1000)];
		const result = queryLogs(logs, {});

		// Should have format: [1] +<timestamp>ms [stdout] Hello
		expect(result.text).toMatch(/^\[1\] \+1000ms \[stdout\] Hello$/);
	});

	it("formats stderr entries correctly", () => {
		const logs = [makeLog("Error!", "stderr", 500)];
		const result = queryLogs(logs, {});

		expect(result.text).toMatch(/^\[1\] \+500ms \[stderr\] Error!$/);
	});

	// Clamp: start beyond total returns empty
	it("start beyond total lines returns empty", () => {
		const logs = makeLogs(5);
		const result = queryLogs(logs, { start: 100 });

		expect(result.totalLines).toBe(5);
		expect(result.returnedLines).toBe(0);
		expect(result.text).toBe("");
	});

	// Clamp: end beyond total returns up to available
	it("end beyond total lines clamps to available", () => {
		const logs = makeLogs(5);
		const result = queryLogs(logs, { start: 3, end: 100 });

		expect(result.totalLines).toBe(5);
		expect(result.returnedLines).toBe(3); // lines 3, 4, 5
		expect(result.text).toContain("[3]");
		expect(result.text).toContain("[5]");
	});

	// ── grep filter tests ─────────────────────────────────────────────────

	it("filters by regex pattern", () => {
		const logs = makeLogs(10);
		const result = queryLogs(logs, { grep: "Line [3-5]" });

		expect(result.totalLines).toBe(10);
		expect(result.returnedLines).toBe(3);
		expect(result.text).toContain("[3]");
		expect(result.text).toContain("[4]");
		expect(result.text).toContain("[5]");
		expect(result.text).not.toContain("[1]");
		expect(result.text).not.toContain("[10]");
	});

	it("grepLiteral escapes regex metacharacters", () => {
		const logs = [makeLog("error.code"), makeLog("errorXcode")];
		const result = queryLogs(logs, { grep: "error.code", grepLiteral: true });

		expect(result.returnedLines).toBe(1);
		expect(result.text).toContain("error.code");
		expect(result.text).not.toContain("errorXcode");
	});

	it("grepIgnoreCase matches case-insensitively", () => {
		const logs = [
			makeLog("Error"),
			makeLog("ERROR"),
			makeLog("error"),
			makeLog("warning"),
		];
		const result = queryLogs(logs, { grep: "error", grepIgnoreCase: true });

		expect(result.returnedLines).toBe(3);
		expect(result.text).toContain("Error");
		expect(result.text).toContain("ERROR");
		expect(result.text).toContain("error");
		expect(result.text).not.toContain("warning");
	});

	it("grep combined with head slices filtered results", () => {
		const logs = makeLogs(10);
		const result = queryLogs(logs, { grep: "Line", head: 3 });

		expect(result.totalLines).toBe(10);
		expect(result.returnedLines).toBe(3);
		expect(result.text).toContain("[1]");
		expect(result.text).toContain("[3]");
		expect(result.text).not.toContain("[4]");
	});

	it("grep combined with tail slices filtered results", () => {
		const logs = makeLogs(10);
		const result = queryLogs(logs, { grep: "Line", tail: 2 });

		expect(result.totalLines).toBe(10);
		expect(result.returnedLines).toBe(2);
		expect(result.text).toContain("[9]");
		expect(result.text).toContain("[10]");
		expect(result.text).not.toContain("[8]");
	});

	it("grep combined with start+end slices filtered results", () => {
		// 10 logs, grep "Line" matches all 10; start=2, end=4 → entries 2-4 (3 results)
		const logs = makeLogs(10);
		const result = queryLogs(logs, { grep: "Line", start: 2, end: 4 });

		expect(result.totalLines).toBe(10);
		expect(result.returnedLines).toBe(3);
		expect(result.text).toContain("[2]");
		expect(result.text).toContain("[4]");
		expect(result.text).not.toContain("[1]");
		expect(result.text).not.toContain("[5]");
	});

	it("grep returns empty when no matches", () => {
		const logs = makeLogs(10);
		const result = queryLogs(logs, { grep: "NOTFOUND" });

		expect(result.totalLines).toBe(10);
		expect(result.returnedLines).toBe(0);
		expect(result.text).toBe("");
	});

	it("grep preserves original line numbers after filtering", () => {
		const logs = makeLogs(10);
		const result = queryLogs(logs, { grep: "Line [257]" });

		expect(result.returnedLines).toBe(3);
		// Should show original line numbers, not renumbered
		expect(result.text).toContain("[2]");
		expect(result.text).toContain("[5]");
		expect(result.text).toContain("[7]");
		// Should NOT show renumbered versions
		expect(result.text).not.toContain("[1]");
		expect(result.text).not.toContain("[3]");
		expect(result.text).not.toContain("[4]");
		expect(result.text).not.toContain("[6]");
	});

	it("grep on empty logs returns empty", () => {
		const result = queryLogs([], { grep: "anything" });

		expect(result.totalLines).toBe(0);
		expect(result.returnedLines).toBe(0);
		expect(result.text).toBe("");
	});

	it("grepLiteral + grepIgnoreCase combined", () => {
		const logs = [
			makeLog("error"),
			makeLog("ERROR"),
			makeLog("erroR"),
			makeLog("failure"),
		];
		const result = queryLogs(logs, {
			grep: "ERROR",
			grepLiteral: true,
			grepIgnoreCase: true,
		});

		expect(result.returnedLines).toBe(3);
		expect(result.text).toContain("error");
		expect(result.text).toContain("ERROR");
		expect(result.text).toContain("erroR");
		expect(result.text).not.toContain("failure");
	});

	it("tail larger than total lines returns all lines", () => {
		const logs = makeLogs(5);
		const result = queryLogs(logs, { tail: 100 });

		expect(result.totalLines).toBe(5);
		expect(result.returnedLines).toBe(5);
		expect(result.text).toContain("[1]");
		expect(result.text).toContain("[5]");
		expect(result.text).toContain("Line 1");
		expect(result.text).toContain("Line 5");
	});

	it("start === end returns exactly 1 line", () => {
		const logs = makeLogs(10);
		const result = queryLogs(logs, { start: 3, end: 3 });

		expect(result.totalLines).toBe(10);
		expect(result.returnedLines).toBe(1);
		expect(result.text).toContain("[3]");
		expect(result.text).toContain("Line 3");
		expect(result.text).not.toContain("[2]");
		expect(result.text).not.toContain("[4]");
	});

	it("throws a friendly error for invalid regex patterns", () => {
		const logs = [makeLog("hello world")];
		expect(() => queryLogs(logs, { grep: "[invalid" })).toThrow(
			'Invalid regex pattern: "[invalid"',
		);
	});
});
