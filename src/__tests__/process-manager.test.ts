import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessManager } from "../process-manager.js";
import {
	DEFAULT_START_DELAY,
	MAX_LOG_ENTRIES,
	MAX_PROCESSES,
	SIGKILL_DELAY_MS,
} from "../types.js";

// ── Mock child_process ──────────────────────────────────────────────────────

const mockSpawn = vi.hoisted(() => vi.fn<(...args: any[]) => ChildProcess>());

vi.mock("node:child_process", () => ({
	spawn: mockSpawn,
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a mock ChildProcess with controllable streams */
function createMockChildProcess(pid?: number): ChildProcess {
	const cp = new EventEmitter() as unknown as ChildProcess;
	Object.defineProperty(cp, "pid", {
		value: pid ?? Math.floor(Math.random() * 50000) + 10000,
		writable: false,
	});
	(cp as any).stdout = new PassThrough();
	(cp as any).stderr = new PassThrough();
	(cp as any).stdin = { end: vi.fn() };
	(cp as any).killed = false;
	(cp as any).kill = vi.fn((signal?: string) => {
		if (!(cp as any).killed) {
			(cp as any).killed = true;
			// Synchronously emit exit so listeners fire immediately
			cp.emit("exit", 0, signal ?? "SIGTERM");
		}
	});
	return cp;
}

/** Create a mock that ignores SIGTERM (requires SIGKILL) */
function createStubbornMockChildProcess(pid?: number): ChildProcess {
	const cp = new EventEmitter() as unknown as ChildProcess;
	Object.defineProperty(cp, "pid", {
		value: pid ?? Math.floor(Math.random() * 50000) + 10000,
		writable: false,
	});
	(cp as any).stdout = new PassThrough();
	(cp as any).stderr = new PassThrough();
	(cp as any).stdin = { end: vi.fn() };
	(cp as any).killed = false;
	(cp as any).kill = vi.fn((signal?: string) => {
		if (signal === "SIGKILL") {
			(cp as any).killed = true;
			cp.emit("exit", null, "SIGKILL");
		}
		// SIGTERM is ignored
	});
	return cp;
}

/**
 * Start a process and resolve the debounce.
 * Returns { result, mockCp }.
 */
async function startAndResolve(
	pm: ProcessManager,
	name: string,
	command: string,
	startDelay = 1,
) {
	const mockCp = createMockChildProcess();
	mockSpawn.mockReturnValue(mockCp);

	const promise = pm.start(name, command, startDelay);
	vi.advanceTimersByTime(startDelay * 1000);
	const result = await promise;
	return { result, mockCp };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ProcessManager", () => {
	let pm: ProcessManager;

	beforeEach(() => {
		vi.useFakeTimers();
		pm = new ProcessManager();
		mockSpawn.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// ── Constructor & Basics ───────────────────────────────────────────────

	describe("constructor", () => {
		it("starts with zero processes", () => {
			expect(pm.size).toBe(0);
		});
	});

	describe("has()", () => {
		it("returns false for non-existent process", () => {
			expect(pm.has("nope")).toBe(false);
		});

		it("returns true after starting a process", async () => {
			await startAndResolve(pm, "test", "echo hi");
			expect(pm.has("test")).toBe(true);
		});
	});

	describe("size", () => {
		it("reflects the number of managed processes", async () => {
			await startAndResolve(pm, "a", "echo a");
			await startAndResolve(pm, "b", "echo b");
			expect(pm.size).toBe(2);
		});
	});

	// ── start() ───────────────────────────────────────────────────────────

	describe("start()", () => {
		it("creates a new process entry", async () => {
			const { result } = await startAndResolve(pm, "test", "echo hello");

			expect(result.name).toBe("test");
			expect(typeof result.pid).toBe("number");
			expect(result.startupTime).toBeGreaterThanOrEqual(0);
			expect(pm.has("test")).toBe(true);
			expect(pm.size).toBe(1);
		});

		it("uses default startDelay when not provided", async () => {
			const mockCp = createMockChildProcess();
			mockSpawn.mockReturnValue(mockCp);

			const promise = pm.start("test", "echo hi");
			// Should not resolve before DEFAULT_START_DELAY seconds
			vi.advanceTimersByTime((DEFAULT_START_DELAY - 1) * 1000);
			// Promise should still be pending - we can't easily check this directly,
			// but let's verify it resolves after the full delay
			vi.advanceTimersByTime(1000);
			const result = await promise;
			expect(result.name).toBe("test");
		});

		it("throws if name already exists", async () => {
			await startAndResolve(pm, "test", "echo hi");

			mockSpawn.mockReturnValue(createMockChildProcess());
			await expect(pm.start("test", "echo again", 1)).rejects.toThrow(
				/already exists/i,
			);
		});

		it("throws if MAX_PROCESSES reached", async () => {
			// Fill up to MAX_PROCESSES
			for (let i = 0; i < MAX_PROCESSES; i++) {
				const cp = createMockChildProcess();
				mockSpawn.mockReturnValue(cp);
				const p = pm.start(`proc-${i}`, "sleep 1", 1);
				vi.advanceTimersByTime(1000);
				await p;
			}

			expect(pm.size).toBe(MAX_PROCESSES);

			mockSpawn.mockReturnValue(createMockChildProcess());
			await expect(pm.start("overflow", "echo x", 1)).rejects.toThrow(
				/maximum/i,
			);
		});

		it("resolves with StartupResult containing startup time", async () => {
			const { result } = await startAndResolve(pm, "test", "echo hi", 1);
			expect(result).toHaveProperty("startupTime");
			expect(typeof result.startupTime).toBe("number");
			expect(result.startupTime).toBeGreaterThanOrEqual(0);
		});

		it("resolves with maxDelay rounded up to nearest second", async () => {
			const mockCp = createMockChildProcess();
			mockSpawn.mockReturnValue(mockCp);

			const promise = pm.start("test", "echo hi", 1);

			// Emit two lines with some gap between them
			mockCp.stdout!.emit("data", Buffer.from("line1\n"));
			vi.advanceTimersByTime(500); // 500ms gap
			mockCp.stdout!.emit("data", Buffer.from("line2\n"));

			vi.advanceTimersByTime(1000);
			const result = await promise;

			// maxDelay should be at least 1 (rounded up from ~500ms)
			expect(result.maxDelay).toBeGreaterThanOrEqual(1);
		});

		it("spawns with shell option and correct stdio", async () => {
			const mockCp = createMockChildProcess();
			mockSpawn.mockReturnValue(mockCp);

			const promise = pm.start("test", "echo hi", 1);
			vi.advanceTimersByTime(1000);
			await promise;

			expect(mockSpawn).toHaveBeenCalledWith(
				"echo hi",
				[],
				expect.objectContaining({
					shell: true,
					stdio: ["pipe", "pipe", "pipe"],
				}),
			);
		});
	});

	// ── kill() ────────────────────────────────────────────────────────────

	describe("kill()", () => {
		it("returns KillResult with correct fields", async () => {
			const { mockCp } = await startAndResolve(pm, "test", "sleep 10");

			// Advance some time to simulate runtime
			vi.advanceTimersByTime(2000);

			const result = await pm.kill("test");

			expect(result.name).toBe("test");
			expect(result.pid).toBe((mockCp as any).pid);
			expect(result.totalRuntime).toBeGreaterThanOrEqual(2000);
		});

		it("throws if process not found", async () => {
			await expect(pm.kill("nonexistent")).rejects.toThrow(/not found/i);
		});

		it("removes process from registry", async () => {
			await startAndResolve(pm, "test", "sleep 10");
			expect(pm.has("test")).toBe(true);

			await pm.kill("test");
			expect(pm.has("test")).toBe(false);
			expect(pm.size).toBe(0);
		});

		it("sends SIGTERM first", async () => {
			const { mockCp } = await startAndResolve(pm, "test", "sleep 10");
			await pm.kill("test");
			expect((mockCp as any).kill).toHaveBeenCalledWith("SIGTERM");
		});

		it("escalates to SIGKILL if process does not exit after SIGKILL_DELAY_MS", async () => {
			const mockCp = createStubbornMockChildProcess();
			mockSpawn.mockReturnValue(mockCp);
			const promise = pm.start("test", "sleep 10", 1);
			vi.advanceTimersByTime(1000);
			await promise;

			const killPromise = pm.kill("test");
			// SIGTERM was sent but ignored
			expect((mockCp as any).kill).toHaveBeenCalledWith("SIGTERM");

			// Advance past SIGKILL delay
			vi.advanceTimersByTime(SIGKILL_DELAY_MS);

			const result = await killPromise;
			expect((mockCp as any).kill).toHaveBeenCalledWith("SIGKILL");
			expect(result.name).toBe("test");
		});

		it("kill() on already-exited process removes from map and returns result", async () => {
			const { mockCp } = await startAndResolve(pm, "test", "sleep 10");

			// Simulate the process exiting on its own
			mockCp.emit("exit", 0, null);
			expect(pm.has("test")).toBe(true); // Still in map until kill or cleanup

			const result = await pm.kill("test");

			expect(result.name).toBe("test");
			expect(typeof result.pid).toBe("number");
			expect(typeof result.totalRuntime).toBe("number");
			expect(pm.has("test")).toBe(false);
			expect(pm.size).toBe(0);
		});

		it("prevents concurrent kill calls on the same process", async () => {
			// Use a stubborn mock so kill() promise stays pending
			const mockCp = createStubbornMockChildProcess();
			mockSpawn.mockReturnValue(mockCp);
			const promise = pm.start("test", "sleep 10", 1);
			vi.advanceTimersByTime(1000);
			await promise;

			// First kill() starts but doesn't resolve (SIGTERM ignored)
			const killPromise = pm.kill("test");

			// Second concurrent kill() should throw immediately
			await expect(pm.kill("test")).rejects.toThrow(
				/already being killed/,
			);

			// Clean up: let SIGKILL resolve the first kill
			vi.advanceTimersByTime(SIGKILL_DELAY_MS);
			const result = await killPromise;
			expect(result.name).toBe("test");
		});
	});

	// ── restart() ─────────────────────────────────────────────────────────

	describe("restart()", () => {
		/** Flush the microtask queue to let internal async ops settle */
		async function flushMicrotasks(times = 10) {
			for (let i = 0; i < times; i++) {
				await Promise.resolve();
			}
		}

		it("kills then starts process", async () => {
			await startAndResolve(pm, "test", "echo v1");

			const cp2 = createMockChildProcess();
			mockSpawn.mockReturnValue(cp2);

			const promise = pm.restart("test", undefined, 1);
			await flushMicrotasks();
			vi.advanceTimersByTime(1000);
			const result = await promise;

			expect(result.name).toBe("test");
			// New process should have been spawned
			expect(mockSpawn).toHaveBeenCalledTimes(2);
			expect(pm.size).toBe(1);
		});

		it("uses new command if provided", async () => {
			await startAndResolve(pm, "test", "echo v1");

			const cp2 = createMockChildProcess();
			mockSpawn.mockReturnValue(cp2);

			const promise = pm.restart("test", "echo v2", 1);
			await flushMicrotasks();
			vi.advanceTimersByTime(1000);
			await promise;

			// Second spawn call should use new command
			expect(mockSpawn).toHaveBeenLastCalledWith(
				"echo v2",
				[],
				expect.anything(),
			);
		});

		it("uses previous command if no command provided", async () => {
			await startAndResolve(pm, "test", "echo original");

			const cp2 = createMockChildProcess();
			mockSpawn.mockReturnValue(cp2);

			const promise = pm.restart("test", undefined, 1);
			await flushMicrotasks();
			vi.advanceTimersByTime(1000);
			await promise;

			expect(mockSpawn).toHaveBeenLastCalledWith(
				"echo original",
				[],
				expect.anything(),
			);
		});

		it("throws when no command provided and no previous command exists", async () => {
			await expect(pm.restart("nonexistent-name")).rejects.toThrow(
				"No command specified and no previous command found for \"nonexistent-name\"",
			);
		});

		it("works on a process that is not yet running", async () => {
			const cp = createMockChildProcess();
			mockSpawn.mockReturnValue(cp);

			// restart on a name that doesn't exist yet - should just start
			const promise = pm.restart("new-proc", "echo hi", 1);
			vi.advanceTimersByTime(1000);
			const result = await promise;

			expect(result.name).toBe("new-proc");
			expect(pm.has("new-proc")).toBe(true);
		});
	});

	// ── Non-zero exit code ────────────────────────────────────────────────

	describe("non-zero exit code", () => {
		it("stores exit code when process exits with code 1", async () => {
			const mockCp = createMockChildProcess();
			mockSpawn.mockReturnValue(mockCp);

			const promise = pm.start("test", "exit 1", 1);
			vi.advanceTimersByTime(1000);
			await promise;

			// Simulate non-zero exit
			mockCp.emit("exit", 1, null);

			const record = (pm as any).processes.get("test");
			expect(record.exited).toBe(true);
			expect(record.exitCode).toBe(1);

			// Also reflected in list() as not running
			const list = pm.list();
			expect(list[0].running).toBe(false);
		});
	});

	// ── shutdown() ────────────────────────────────────────────────────────

	describe("shutdown()", () => {
		it("kills all processes", async () => {
			await startAndResolve(pm, "a", "sleep 10");
			await startAndResolve(pm, "b", "sleep 10");
			await startAndResolve(pm, "c", "sleep 10");

			expect(pm.size).toBe(3);

			await pm.shutdown();

			expect(pm.size).toBe(0);
			expect(pm.has("a")).toBe(false);
			expect(pm.has("b")).toBe(false);
			expect(pm.has("c")).toBe(false);
		});

		it("handles empty process list gracefully", async () => {
			expect(pm.size).toBe(0);
			await expect(pm.shutdown()).resolves.toBeUndefined();
		});

		it("clears processCountCallback during shutdown", async () => {
			const callback = vi.fn();
			pm.onProcessCountChange(callback);

			await startAndResolve(pm, "test", "echo hi");

			await pm.shutdown();

			// After shutdown, the callback should no longer be called
			// This verifies the callback was cleared (since we can't access private property)
			const cp = createMockChildProcess();
			mockSpawn.mockReturnValue(cp);
			const promise = pm.start("test2", "echo hi again", 1);
			vi.advanceTimersByTime(1000);
			await promise;

			// Callback should only be called 4 times:
			// 1. Initial onProcessCountChange call (count=0)
			// 2. After starting first process (count=1)
			// 3. During kill in shutdown (count=0)
			// 4. During shutdown emitProcessCount after clear (count=0)
			// NOT called for second process start because callback was cleared
			expect(callback).toHaveBeenCalledTimes(4);
			expect(callback).toHaveBeenNthCalledWith(1, 0);
			expect(callback).toHaveBeenNthCalledWith(2, 1);
			expect(callback).toHaveBeenNthCalledWith(3, 0);
			expect(callback).toHaveBeenNthCalledWith(4, 0);
		});
	});

	// ── list() ────────────────────────────────────────────────────────────

	describe("list()", () => {
		it("returns empty array when no processes", () => {
			expect(pm.list()).toEqual([]);
		});

		it("returns correct ProcessInfo array", async () => {
			const cp1 = createMockChildProcess();
			const cp2 = createMockChildProcess();
			mockSpawn.mockReturnValueOnce(cp1);
			mockSpawn.mockReturnValueOnce(cp2);

			const p1 = pm.start("alpha", "cmd-a", 1);
			const p2 = pm.start("beta", "cmd-b", 1);
			vi.advanceTimersByTime(1000);
			await Promise.all([p1, p2]);

			const list = pm.list();
			expect(list).toHaveLength(2);

			const alpha = list.find((p) => p.name === "alpha");
			expect(alpha).toBeDefined();
			expect(alpha!.command).toBe("cmd-a");
			expect(alpha!.pid).toBe((cp1 as any).pid);
			expect(alpha!.running).toBe(true);
			expect(typeof alpha!.startTime).toBe("number");

			const beta = list.find((p) => p.name === "beta");
			expect(beta).toBeDefined();
			expect(beta!.command).toBe("cmd-b");
		});

		it("marks exited processes as not running", async () => {
			const mockCp = createMockChildProcess();
			mockSpawn.mockReturnValue(mockCp);

			const promise = pm.start("test", "echo hi", 1);
			vi.advanceTimersByTime(1000);
			await promise;

			// Simulate process exit
			mockCp.emit("exit", 0, null);

			const list = pm.list();
			expect(list[0].running).toBe(false);
		});
	});

	// ── getLogs() ─────────────────────────────────────────────────────────

	describe("getLogs()", () => {
		it("returns empty array for process with no output", async () => {
			await startAndResolve(pm, "test", "sleep 10");
			const logs = pm.getLogs("test");
			expect(logs).toEqual([]);
		});

		it("throws if process not found", () => {
			expect(() => pm.getLogs("nonexistent")).toThrow(/not found/i);
		});

		it("returns LogEntry objects with correct fields", async () => {
			const mockCp = createMockChildProcess();
			mockSpawn.mockReturnValue(mockCp);

			const promise = pm.start("test", "echo hi", 1);
			mockCp.stdout!.emit("data", Buffer.from("hello world\n"));
			vi.advanceTimersByTime(1000);
			await promise;

			const logs = pm.getLogs("test");
			expect(logs).toHaveLength(1);
			expect(logs[0].text).toBe("hello world");
			expect(logs[0].stream).toBe("stdout");
			expect(typeof logs[0].timestamp).toBe("number");
		});
	});

	// ── stdout/stderr data handlers ───────────────────────────────────────

	describe("stdout/stderr data handlers", () => {
		it("creates LogEntry for each stdout line", async () => {
			const mockCp = createMockChildProcess();
			mockSpawn.mockReturnValue(mockCp);

			const promise = pm.start("test", "echo hi", 1);
			mockCp.stdout!.emit("data", Buffer.from("line1\nline2\nline3\n"));
			vi.advanceTimersByTime(1000);
			await promise;

			const logs = pm.getLogs("test");
			expect(logs).toHaveLength(3);
			expect(logs.every((l) => l.stream === "stdout")).toBe(true);
			expect(logs[0].text).toBe("line1");
			expect(logs[1].text).toBe("line2");
			expect(logs[2].text).toBe("line3");
		});

		it("creates LogEntry for each stderr line", async () => {
			const mockCp = createMockChildProcess();
			mockSpawn.mockReturnValue(mockCp);

			const promise = pm.start("test", "cmd", 1);
			mockCp.stderr!.emit("data", Buffer.from("err1\nerr2\n"));
			vi.advanceTimersByTime(1000);
			await promise;

			const logs = pm.getLogs("test");
			expect(logs).toHaveLength(2);
			expect(logs.every((l) => l.stream === "stderr")).toBe(true);
			expect(logs[0].text).toBe("err1");
			expect(logs[1].text).toBe("err2");
		});

		it("handles mixed stdout and stderr output", async () => {
			const mockCp = createMockChildProcess();
			mockSpawn.mockReturnValue(mockCp);

			const promise = pm.start("test", "cmd", 1);
			mockCp.stdout!.emit("data", Buffer.from("out1\n"));
			mockCp.stderr!.emit("data", Buffer.from("err1\n"));
			mockCp.stdout!.emit("data", Buffer.from("out2\n"));
			vi.advanceTimersByTime(1000);
			await promise;

			const logs = pm.getLogs("test");
			expect(logs).toHaveLength(3);
			expect(logs[0]).toMatchObject({ stream: "stdout", text: "out1" });
			expect(logs[1]).toMatchObject({ stream: "stderr", text: "err1" });
			expect(logs[2]).toMatchObject({ stream: "stdout", text: "out2" });
		});

		it("ignores empty lines from trailing newlines", async () => {
			const mockCp = createMockChildProcess();
			mockSpawn.mockReturnValue(mockCp);

			const promise = pm.start("test", "cmd", 1);
			// Double newline should not produce empty log entries
			mockCp.stdout!.emit("data", Buffer.from("hello\n\nworld\n"));
			vi.advanceTimersByTime(1000);
			await promise;

			const logs = pm.getLogs("test");
			expect(logs).toHaveLength(2);
			expect(logs[0].text).toBe("hello");
			expect(logs[1].text).toBe("world");
		});

		it("resets debounce timer on each data event", async () => {
			const mockCp = createMockChildProcess();
			mockSpawn.mockReturnValue(mockCp);

			const promise = pm.start("test", "cmd", 1);

			// Advance 800ms, then emit data (should reset timer)
			vi.advanceTimersByTime(800);
			mockCp.stdout!.emit("data", Buffer.from("line1\n"));

			// Advance another 800ms (total 1600ms since start, but only 800ms since last data)
			vi.advanceTimersByTime(800);

			// Promise should NOT have resolved yet - debounce hasn't fired
			// We can check by verifying the process is still in startup
			// Now advance past the debounce
			vi.advanceTimersByTime(300);
			const result = await promise;
			expect(result.name).toBe("test");
		});
	});

	// ── Log cap ───────────────────────────────────────────────────────────

	describe("log cap", () => {
		it("caps logs array at MAX_LOG_ENTRIES", async () => {
			const mockCp = createMockChildProcess();
			mockSpawn.mockReturnValue(mockCp);

			const promise = pm.start("test", "cmd", 1);

			// Write more than MAX_LOG_ENTRIES lines
			const lines: string[] = [];
			for (let i = 0; i < MAX_LOG_ENTRIES + 100; i++) {
				lines.push(`Line ${i + 1}`);
			}
			mockCp.stdout!.emit("data", Buffer.from(`${lines.join("\n")}\n`));

			vi.advanceTimersByTime(1000);
			await promise;

			const logs = pm.getLogs("test");
			expect(logs.length).toBe(MAX_LOG_ENTRIES);
			// Should keep the latest entries (sliding window)
			expect(logs[0].text).toBe(`Line 101`);
			expect(logs[logs.length - 1].text).toBe(`Line ${MAX_LOG_ENTRIES + 100}`);
		});
	});

	// ── Process exit during startup ───────────────────────────────────────

	describe("process exit during startup", () => {
		it("resolves start promise when process exits before debounce", async () => {
			const mockCp = createMockChildProcess();
			mockSpawn.mockReturnValue(mockCp);

			const promise = pm.start("test", "echo hi", 5);

			// Simulate process exiting before the 5-second debounce
			vi.advanceTimersByTime(1000);
			mockCp.emit("exit", 0, null);

			const result = await promise;
			expect(result.name).toBe("test");
		});
	});

	// ── Spawn error event ──────────────────────────────────────────────────

	describe("spawn error event", () => {
		it("rejects startup promise if spawn emits error event", async () => {
			const mockCp = createMockChildProcess();
			mockSpawn.mockReturnValue(mockCp);

			const promise = pm.start("test", "bad-command", 1);

			// Simulate spawn error (e.g. ENOENT)
			const error = new Error("spawn bad-command ENOENT");
			mockCp.emit("error", error);

			await expect(promise).rejects.toThrow(
				/Failed to spawn process "test": spawn bad-command ENOENT/,
			);

			// Process should be removed from the manager
			expect(pm.has("test")).toBe(false);
			expect(pm.size).toBe(0);
		});

		it("clears debounce timer on spawn error", async () => {
			const mockCp = createMockChildProcess();
			mockSpawn.mockReturnValue(mockCp);

			const promise = pm.start("test", "bad-command", 1);

			// Emit error before debounce fires
			mockCp.emit("error", new Error("spawn failed"));

			await expect(promise).rejects.toThrow(/Failed to spawn process/);

			// Advance timers — the debounce callback should NOT fire
			// (it would try to resolve an already-rejected promise)
			vi.advanceTimersByTime(2000);

			// No additional errors or side effects
			expect(pm.size).toBe(0);
		});

		it("emits process count change on spawn error", async () => {
			const callback = vi.fn();
			pm.onProcessCountChange(callback);
			callback.mockClear();

			const mockCp = createMockChildProcess();
			mockSpawn.mockReturnValue(mockCp);

			const promise = pm.start("test", "bad-command", 1);

			// start() emits count=1 when process is added
			expect(callback).toHaveBeenCalledWith(1);
			callback.mockClear();

			mockCp.emit("error", new Error("spawn failed"));

			await expect(promise).rejects.toThrow(/Failed to spawn process/);

			// Should emit count=0 after cleanup
			expect(callback).toHaveBeenCalledWith(0);
		});
	});

	// ── onProcessCountChange() ────────────────────────────────────────────

	describe("onProcessCountChange()", () => {
		it("emits immediately with current count", () => {
			const callback = vi.fn();
			pm.onProcessCountChange(callback);
			expect(callback).toHaveBeenCalledWith(0);
			expect(callback).toHaveBeenCalledTimes(1);
		});

		it("emits after start", async () => {
			const callback = vi.fn();
			pm.onProcessCountChange(callback);
			callback.mockClear();

			await startAndResolve(pm, "test", "echo hi");

			expect(callback).toHaveBeenCalledWith(1);
		});

		it("emits after kill", async () => {
			const callback = vi.fn();
			pm.onProcessCountChange(callback);
			callback.mockClear();

			await startAndResolve(pm, "test", "sleep 10");
			callback.mockClear();

			await pm.kill("test");

			expect(callback).toHaveBeenCalledWith(0);
		});

		it("emits correct count with multiple processes", async () => {
			const callback = vi.fn();
			pm.onProcessCountChange(callback);
			callback.mockClear();

			await startAndResolve(pm, "a", "cmd-a");
			await startAndResolve(pm, "b", "cmd-b");
			await startAndResolve(pm, "c", "cmd-c");

			expect(callback).toHaveBeenCalledWith(1);
			expect(callback).toHaveBeenCalledWith(2);
			expect(callback).toHaveBeenCalledWith(3);
		});

		it("emits after restart", async () => {
			const callback = vi.fn();
			pm.onProcessCountChange(callback);
			callback.mockClear();

			await startAndResolve(pm, "test", "echo v1");

			const cp2 = createMockChildProcess();
			mockSpawn.mockReturnValue(cp2);

			callback.mockClear();

			const promise = pm.restart("test", undefined, 1);
			// Flush microtasks so kill resolves
			for (let i = 0; i < 10; i++) {await Promise.resolve();}
			vi.advanceTimersByTime(1000);
			await promise;

			// Restart kills (count goes to 0) then starts (count goes to 1)
			expect(callback).toHaveBeenCalledWith(0);
			expect(callback).toHaveBeenCalledWith(1);
		});

		it("emits 0 after shutdown", async () => {
			const callback = vi.fn();
			pm.onProcessCountChange(callback);
			callback.mockClear();

			await startAndResolve(pm, "a", "sleep 10");
			await startAndResolve(pm, "b", "sleep 10");

			callback.mockClear();

			await pm.shutdown();

			expect(callback).toHaveBeenCalledWith(0);
		});

		it("callback can be replaced", async () => {
			const callbackA = vi.fn();
			const callbackB = vi.fn();

			pm.onProcessCountChange(callbackA);
			expect(callbackA).toHaveBeenCalledWith(0);

			pm.onProcessCountChange(callbackB);
			expect(callbackB).toHaveBeenCalledWith(0);

			callbackA.mockClear();
			callbackB.mockClear();

			await startAndResolve(pm, "test", "echo hi");

			// Only the latest callback (B) should fire
			expect(callbackA).not.toHaveBeenCalled();
			expect(callbackB).toHaveBeenCalledWith(1);
		});
	});
});
