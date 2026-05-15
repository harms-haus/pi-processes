import { spawn } from "node:child_process";
import type {
	ProcessRecord,
	LogEntry,
	StartupResult,
	KillResult,
	ProcessInfo,
} from "./types.js";
import {
	DEFAULT_START_DELAY,
	MAX_PROCESSES,
	SIGKILL_DELAY_MS,
	MAX_LOG_ENTRIES,
	MAX_STDOUT_BYTES,
	MAX_STDERR_TEXT,
	STDERR_KEEP_BYTES,
} from "./types.js";

/**
 * Manages spawned child processes with debounce-based startup detection,
 * output capture, and SIGTERM → SIGKILL escalation for killing.
 */
export class ProcessManager {
	private processes: Map<string, ProcessRecord>;

	/** Callback invoked when the process count changes */
	private processCountCallback?: (count: number) => void;

	constructor() {
		this.processes = new Map();
	}

	/** Register a callback to be invoked whenever the managed process count changes */
	onProcessCountChange(callback: (count: number) => void): void {
		this.processCountCallback = callback;
		this.emitProcessCount();
	}

	/** Emit the current process count via the registered callback */
	private emitProcessCount(): void {
		this.processCountCallback?.(this.processes.size);
	}

	/** Get count of managed processes */
	get size(): number {
		return this.processes.size;
	}

	/** Check if a process with the given name exists */
	has(name: string): boolean {
		return this.processes.has(name);
	}

	/** List all active processes */
	list(): ProcessInfo[] {
		const now = Date.now();
		return Array.from(this.processes.values()).map((record) => ({
			name: record.name,
			pid: record.pid,
			command: record.command,
			startTime: record.startTime,
			running: !record.exited,
			uptimeSec: (now - record.startTime) / 1000,
			logLines: record.logs.length,
			startupComplete: record.startupComplete,
		}));
	}

	/** Get logs for a process */
	getLogs(name: string): LogEntry[] {
		const record = this.processes.get(name);
		if (!record) {
			throw new Error(`Process "${name}" not found`);
		}
		return record.logs;
	}

	/**
	 * Start a new process. Returns after startup debounce completes.
	 * @param name - Unique name for the process
	 * @param command - Shell command to execute
	 * @param startDelay - Debounce time in seconds (default: DEFAULT_START_DELAY)
	 * @returns StartupResult with name, pid, startup time, max log delay, logs
	 */
	async start(
		name: string,
		command: string,
		startDelay: number = DEFAULT_START_DELAY,
	): Promise<StartupResult> {
		if (this.processes.has(name)) {
			throw new Error(`Process "${name}" already exists`);
		}
		if (this.processes.size >= MAX_PROCESSES) {
			throw new Error(
				`Maximum number of processes (${MAX_PROCESSES}) reached`,
			);
		}

		const childProcess = spawn(command, [], {
			shell: true,
			stdio: ["pipe", "pipe", "pipe"],
			env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
		});

		const startTime = Date.now();

		const record: ProcessRecord = {
			name,
			process: childProcess,
			pid: childProcess.pid!,
			command,
			startTime,
			startupComplete: false,
			logs: [],
			stdoutChunks: [],
			stdoutBytes: 0,
			stderrText: "",
			exited: false,
			exitCode: null,
			startupResolve: null,
			debounceTimer: null,
			maxDelay: 0,
			lastLogTime: startTime,
		};

		this.processes.set(name, record);
		this.emitProcessCount();

		// Debounce reset function — each output resets the silence timer
		const resetDebounce = () => {
			if (record.debounceTimer !== null) {
				clearTimeout(record.debounceTimer);
			}
			record.debounceTimer = setTimeout(() => {
				if (!record.startupComplete && record.startupResolve) {
					record.startupComplete = true;
					record.startupResolve({
						name,
						pid: record.pid,
						startupTime: Date.now() - startTime,
						maxDelay: Math.ceil(record.maxDelay / 1000),
						logs: record.logs.map((l) => l.text).join("\n"),
					});
				}
			}, startDelay * 1000);
		};

		// Helper to add a log entry and track inter-line delay
		const addLog = (stream: "stdout" | "stderr", text: string) => {
			const now = Date.now();
			const delay = now - record.lastLogTime;
			if (delay > record.maxDelay) {
				record.maxDelay = delay;
			}
			record.lastLogTime = now;

			const entry: LogEntry = {
				timestamp: now - startTime,
				stream,
				text,
			};
			record.logs.push(entry);
			if (record.logs.length > MAX_LOG_ENTRIES) {
				record.logs.shift();
			}
		};

		// Stdout handler
		childProcess.stdout?.on("data", (chunk: Buffer) => {
			// Cap stdout at MAX_STDOUT_BYTES (sliding window)
			record.stdoutChunks.push(chunk);
			record.stdoutBytes += chunk.length;
			while (
				record.stdoutBytes > MAX_STDOUT_BYTES &&
				record.stdoutChunks.length > 0
			) {
				const removed = record.stdoutChunks.shift()!;
				record.stdoutBytes -= removed.length;
			}

			const lines = chunk.toString().split("\n");
			for (const line of lines) {
				if (line !== "") {
					addLog("stdout", line);
				}
			}
			resetDebounce();
		});

		// Stderr handler
		childProcess.stderr?.on("data", (chunk: Buffer) => {
			// Cap stderr at MAX_STDERR_TEXT with sliding window
			record.stderrText += chunk.toString();
			if (record.stderrText.length > MAX_STDERR_TEXT) {
				record.stderrText = record.stderrText.slice(-STDERR_KEEP_BYTES);
			}

			const lines = chunk.toString().split("\n");
			for (const line of lines) {
				if (line !== "") {
					addLog("stderr", line);
				}
			}
			resetDebounce();
		});

		// Exit handler
		childProcess.on("exit", (code) => {
			record.exited = true;
			record.exitCode = code;

			// If startup hasn't completed yet, resolve now
			if (!record.startupComplete && record.startupResolve) {
				clearTimeout(record.debounceTimer!);
				record.startupComplete = true;
				record.startupResolve({
					name,
					pid: record.pid,
					startupTime: Date.now() - startTime,
					maxDelay: Math.ceil(record.maxDelay / 1000),
					logs: record.logs.map((l) => l.text).join("\n"),
				});
			}
		});

		// Create the startup promise
		const startupPromise = new Promise<StartupResult>((resolve) => {
			record.startupResolve = resolve;
		});

		// Start initial debounce timer
		resetDebounce();

		return startupPromise;
	}

	/**
	 * Kill a running process with SIGTERM → SIGKILL escalation.
	 * @param name - Process name
	 * @returns KillResult with name, pid, total runtime
	 */
	async kill(name: string): Promise<KillResult> {
		const record = this.processes.get(name);
		if (!record) {
			throw new Error(`Process "${name}" not found`);
		}

		if (record.exited) {
			this.processes.delete(name);
			this.emitProcessCount();
			return {
				name,
				pid: record.pid,
				totalRuntime: Date.now() - record.startTime,
			};
		}

		return new Promise<KillResult>((resolve) => {
			// SIGKILL escalation timer
			const sigkillTimer = setTimeout(() => {
				record.process.kill("SIGKILL");
			}, SIGKILL_DELAY_MS);

			// Listen for exit
			const onExit = () => {
				clearTimeout(sigkillTimer);
				record.process.removeListener("exit", onExit);
				this.processes.delete(name);
				this.emitProcessCount();
				resolve({
					name,
					pid: record.pid,
					totalRuntime: Date.now() - record.startTime,
				});
			};

			record.process.on("exit", onExit);

			// Send SIGTERM
			record.process.kill("SIGTERM");
		});
	}

	/**
	 * Restart a process: kill if running, then start with same or new command.
	 * @param name - Process name
	 * @param command - New command (defaults to previous command)
	 * @param startDelay - Debounce time (default: DEFAULT_START_DELAY)
	 * @returns StartupResult
	 */
	async restart(
		name: string,
		command?: string,
		startDelay?: number,
	): Promise<StartupResult> {
		const record = this.processes.get(name);
		const previousCommand = record?.command;

		if (record) {
			await this.kill(name);
		}

		const cmd = command ?? previousCommand;
		if (!cmd) {
			throw new Error(
				`No command specified and no previous command found for "${name}"`,
			);
		}

		return this.start(name, cmd, startDelay);
	}

	/** Clean up all managed processes (call on session shutdown) */
	async shutdown(): Promise<void> {
		const names = Array.from(this.processes.keys());
		await Promise.allSettled(names.map((name) => this.kill(name)));
		this.processes.clear();
		this.emitProcessCount();
	}
}
