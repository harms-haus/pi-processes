/**
 * Shared types for the pi-processes extension
 */

import type { ChildProcess } from "node:child_process";
import { type Static, Type } from "typebox";

// ── Core Types ──────────────────────────────────────────────────────────────

/** A single log line captured from a process */
export interface LogEntry {
	/** Monotonic timestamp (ms since process start) */
	timestamp: number;
	/** Which stream this line came from */
	stream: "stdout" | "stderr";
	/** The text content of the log line (no trailing newline) */
	text: string;
}

/** Tracks a managed process and its state */
export interface ProcessRecord {
	/** Unique name for this process */
	name: string;
	/** The spawned ChildProcess */
	process: ChildProcess;
	/** OS process ID */
	pid: number;
	/** The command string used to spawn */
	command: string;
	/** Date.now() when the process was started */
	startTime: number;
	/** Whether startup debounce has completed */
	startupComplete: boolean;
	/** Accumulated log entries */
	logs: LogEntry[];
	/** Accumulated stdout buffer chunks (for 10MB cap) */
	stdoutChunks: Buffer[];
	/** Total bytes written to stdout (for cap enforcement) */
	stdoutBytes: number;
	/** Sliding stderr window (keep last 512KB) */
	stderrText: string;
	/** Whether the process has exited */
	exited: boolean;
	/** Exit code if exited */
	exitCode: number | null;
	/** Resolve function for the startup debounce promise */
	startupResolve: ((value: StartupResult) => void) | null;
	/** Timer for the debounce silence detection */
	debounceTimer: ReturnType<typeof setTimeout> | null;
	/** Maximum delay between consecutive log lines during startup (ms) */
	maxDelay: number;
	/** Timestamp of last log output (for delay tracking) */
	lastLogTime: number;
}

// ── Result Types ────────────────────────────────────────────────────────────

/** Result returned when a process finishes starting (debounce complete) */
export interface StartupResult {
	/** Process name */
	name: string;
	/** OS process ID */
	pid: number;
	/** Time from spawn to debounce completion (ms) */
	startupTime: number;
	/** Maximum delay between consecutive log lines during startup (ms, rounded up to nearest second) */
	maxDelay: number;
	/** All log output captured during startup */
	logs: string;
}

/** Result returned when a process is killed */
export interface KillResult {
	/** Process name */
	name: string;
	/** Total runtime from start to kill (ms) */
	totalRuntime: number;
	/** PID of the now-dead process */
	pid: number;
}

// ── Process Info ────────────────────────────────────────────────────────────

/** Summary info for a managed process */
export interface ProcessInfo {
	/** Unique name for this process */
	name: string;
	/** OS process ID */
	pid: number;
	/** The command string used to spawn */
	command: string;
	/** Date.now() when the process was started */
	startTime: number;
	/** Whether the process is still running */
	running: boolean;
	/** Seconds since the process was started */
	uptimeSec: number;
	/** Number of captured log lines */
	logLines: number;
	/** Whether startup debounce has completed */
	startupComplete: boolean;
}

// ── Constants ───────────────────────────────────────────────────────────────

/** Maximum stdout buffer size: 10MB */
export const MAX_STDOUT_BYTES = 10 * 1024 * 1024;

/** Maximum stderr text size: 1MB total, keep last 512KB */
export const MAX_STDERR_TEXT = 1024 * 1024;
export const STDERR_KEEP_BYTES = 512 * 1024;

/** Default debounce delay for startup detection (seconds) */
export const DEFAULT_START_DELAY = 5;

/** Grace period after SIGTERM before SIGKILL (ms) */
export const KILL_GRACE_PERIOD_MS = 3000;

/** Alias: grace period after SIGTERM before SIGKILL (ms) */
export const SIGKILL_DELAY_MS = 5000;

/** Maximum number of concurrent managed processes */
export const MAX_PROCESSES = 50;

/** Maximum number of log entries retained per process */
export const MAX_LOG_ENTRIES = 10000;

// ── Tool Parameter Schemas (TypeBox) ────────────────────────────────────────

export const StartProcessSchema = Type.Object({
	name: Type.String({ description: "Unique name to identify this process" }),
	command: Type.String({ description: "Shell command to start the process" }),
	start_delay: Type.Optional(
		Type.Number({
			description:
				"Debounce delay in seconds. Tool returns when no output appears for this duration. Default: 5",
		}),
	),
});

export const ListProcessesSchema = Type.Object({});

export const KillProcessSchema = Type.Object({
	name: Type.String({ description: "Name of the process to kill" }),
});

export const ProcessLogsSchema = Type.Object({
	name: Type.String({ description: "Name of the process" }),
	head: Type.Optional(Type.Number({ description: "Return the first N lines" })),
	tail: Type.Optional(Type.Number({ description: "Return the last N lines" })),
	start: Type.Optional(
		Type.Number({ description: "Start line number (1-based, inclusive)" }),
	),
	end: Type.Optional(
		Type.Number({ description: "End line number (1-based, inclusive)" }),
	),
	grep: Type.Optional(
		Type.String({ description: "Filter log lines by pattern (regex by default)" }),
	),
	grepLiteral: Type.Optional(
		Type.Boolean({
			description:
				"Treat grep pattern as literal string instead of regex",
		}),
	),
	grepIgnoreCase: Type.Optional(
		Type.Boolean({ description: "Case-insensitive grep matching" }),
	),
});

export const RestartProcessSchema = Type.Object({
	name: Type.String({ description: "Name of the process to restart" }),
	command: Type.Optional(
		Type.String({
			description: "New command to use (defaults to previous command)",
		}),
	),
	start_delay: Type.Optional(
		Type.Number({ description: "Debounce delay in seconds. Default: 5" }),
	),
});

export type StartProcessParams = Static<typeof StartProcessSchema>;
export type ListProcessesParams = Static<typeof ListProcessesSchema>;
export type KillProcessParams = Static<typeof KillProcessSchema>;
export type ProcessLogsParams = Static<typeof ProcessLogsSchema>;
export type RestartProcessParams = Static<typeof RestartProcessSchema>;

// ── ProcessManager Interface (for dependency injection in tests) ────────────

/** Public interface for the ProcessManager. Used by tools to interact with processes. */
export interface IProcessManager {
	start(
		name: string,
		command: string,
		startDelay: number,
		signal?: AbortSignal,
	): Promise<StartupResult>;
	kill(name: string): KillResult;
	list(): ProcessInfo[];
	getLogs(name: string): LogEntry[];
	get(name: string): ProcessRecord | undefined;
	has(name: string): boolean;
	killAll(): void;
}
