import { describe, expect, it, vi } from "vitest";
import type { LogEntry } from "../../types.js";
import { createProcessLogsTool } from "../../tools/process-logs.js";
import type { ProcessManager } from "../../process-manager.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeLog(
	text: string,
	stream: "stdout" | "stderr" = "stdout",
	offsetMs = 0,
): LogEntry {
	return { timestamp: offsetMs, text, stream };
}

function makeLogs(count: number): LogEntry[] {
	return Array.from({ length: count }, (_, i) =>
		makeLog(`Line ${i + 1}`, "stdout", i * 1000),
	);
}

/** Create a mock ProcessManager whose getLogs returns the given entries */
function mockManager(logs: LogEntry[]): ProcessManager {
	return {
		getLogs: vi.fn().mockReturnValue(logs),
	} as unknown as ProcessManager;
}

/** Create a mock theme that concatenates the tag and text for easy assertions */
function mockTheme() {
	return {
		fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
		bold: (text: string) => `<bold>${text}</bold>`,
	};
}

/** Render a component to a single string for assertion */
function renderToString(component: { render: (w: number) => string[] }): string {
	return component.render(200).join("\n");
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("createProcessLogsTool", () => {
	const logs = makeLogs(10);

	// 1. Tool registration has correct name, label, description
	it("has correct name, label, and description", () => {
		const tool = createProcessLogsTool(() => mockManager([]));
		expect(tool.name).toBe("process_logs");
		expect(tool.label).toBe("Process Logs");
		expect(tool.description).toContain("Read log output");
	});

	// 2. execute() with head calls queryLogs correctly
	it("execute with head returns first N lines", async () => {
		const manager = mockManager(logs);
		const tool = createProcessLogsTool(() => manager);

		const result = await tool.execute(
			"call-1",
			{ name: "test-proc", head: 3 },
			undefined,
			undefined,
			undefined as any,
		);

		expect(manager.getLogs).toHaveBeenCalledWith("test-proc");
		expect(result.details.totalLines).toBe(10);
		expect(result.details.returnedLines).toBe(3);
		expect(result.content[0].type).toBe("text");
		const text1 = (result.content[0] as { type: "text"; text: string }).text;
		expect(text1).toContain("[1]");
		expect(text1).toContain("[3]");
		expect(text1).not.toContain("[4]");
	});

	// 3. execute() with tail calls queryLogs correctly
	it("execute with tail returns last N lines", async () => {
		const manager = mockManager(logs);
		const tool = createProcessLogsTool(() => manager);

		const result = await tool.execute(
			"call-2",
			{ name: "test-proc", tail: 3 },
			undefined,
			undefined,
			undefined as any,
		);

		expect(result.details.totalLines).toBe(10);
		expect(result.details.returnedLines).toBe(3);
		const text2 = (result.content[0] as { type: "text"; text: string }).text;
		expect(text2).toContain("[8]");
		expect(text2).toContain("[10]");
		expect(text2).not.toContain("[7]");
	});

	// 4. execute() with start+end calls queryLogs correctly
	it("execute with start+end returns the correct range", async () => {
		const manager = mockManager(logs);
		const tool = createProcessLogsTool(() => manager);

		const result = await tool.execute(
			"call-3",
			{ name: "test-proc", start: 2, end: 5 },
			undefined,
			undefined,
			undefined as any,
		);

		expect(result.details.totalLines).toBe(10);
		expect(result.details.returnedLines).toBe(4);
		const text3 = (result.content[0] as { type: "text"; text: string }).text;
		expect(text3).toContain("[2]");
		expect(text3).toContain("[5]");
		expect(text3).not.toContain("[1]");
		expect(text3).not.toContain("[6]");
	});

	// 5. execute() throws on head+tail combination
	it("execute throws on head+tail combination", async () => {
		const tool = createProcessLogsTool(() => mockManager(logs));

		await expect(
			tool.execute(
				"call-4",
				{ name: "test-proc", head: 3, tail: 3 },
				undefined,
				undefined,
				undefined as any,
			),
		).rejects.toThrow("mutually exclusive");
	});

	// 6. execute() throws on head+start combination
	it("execute throws on head+start combination", async () => {
		const tool = createProcessLogsTool(() => mockManager(logs));

		await expect(
			tool.execute(
				"call-5",
				{ name: "test-proc", head: 3, start: 2 },
				undefined,
				undefined,
				undefined as any,
			),
		).rejects.toThrow("mutually exclusive");
	});

	// 7. renderCall shows query mode
	it("renderCall shows query mode for head", () => {
		const tool = createProcessLogsTool(() => mockManager([]));
		const theme = mockTheme();

		const component = tool.renderCall!(
			{ name: "myapp", head: 5 },
			theme as any,
			undefined as any,
		);

		const str = renderToString(component);
		expect(str).toContain("process_logs");
		expect(str).toContain("myapp");
		expect(str).toContain("head(5)");
	});

	it("renderCall shows tail mode", () => {
		const tool = createProcessLogsTool(() => mockManager([]));
		const theme = mockTheme();

		const component = tool.renderCall!(
			{ name: "myapp", tail: 10 },
			theme as any,
			undefined as any,
		);

		const str = renderToString(component);
		expect(str).toContain("tail(10)");
	});

	it("renderCall shows start-end range mode", () => {
		const tool = createProcessLogsTool(() => mockManager([]));
		const theme = mockTheme();

		const component = tool.renderCall!(
			{ name: "myapp", start: 5, end: 10 },
			theme as any,
			undefined as any,
		);

		const str = renderToString(component);
		expect(str).toContain("[5-10]");
	});

	it("renderCall shows all mode when no options", () => {
		const tool = createProcessLogsTool(() => mockManager([]));
		const theme = mockTheme();

		const component = tool.renderCall!(
			{ name: "myapp" },
			theme as any,
			undefined as any,
		);

		const str = renderToString(component);
		expect(str).toContain("all");
	});

	// 8. renderResult shows line counts
	it("renderResult shows line counts", () => {
		const tool = createProcessLogsTool(() => mockManager([]));
		const theme = mockTheme();

		const result = {
			content: [{ type: "text" as const, text: "some log" }],
			details: { logs: "some log", totalLines: 42, returnedLines: 10 },
		};

		const component = tool.renderResult!(
			result,
			{} as any,
			theme as any,
			undefined as any,
		);

		const str = renderToString(component);
		expect(str).toContain("process_logs");
		expect(str).toContain("10/42");
		expect(str).toContain("lines");
	});

	// Additional: execute with empty logs returns "(no logs)"
	it("execute returns (no logs) for empty logs", async () => {
		const tool = createProcessLogsTool(() => mockManager([]));

		const result = await tool.execute(
			"call-empty",
			{ name: "test-proc" },
			undefined,
			undefined,
			undefined as any,
		);

		expect((result.content[0] as { type: "text"; text: string }).text).toBe("(no logs)");
	});
});
