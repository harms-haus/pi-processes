/**
 * Shared types for the pi-processes extension
 */

import { Type } from "typebox";
import type { ChildProcess } from "node:child_process";

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
	/** Whether the process has exited */
	exited: boolean;
	/** Exit code if exited */
	exitCode: number | null;
	/** Resolve function for the startup debounce promise */
	startupResolve: ((value: StartupResult) => void) | null;
	/** Reject function for the startup debounce promise */
	startupReject: ((reason: unknown) => void) | null;
	/** Timer for the debounce silence detection */
	debounceTimer: ReturnType<typeof setTimeout> | null;
	/** Maximum delay between consecutive log lines during startup (ms) */
	maxDelay: number;
	/** Timestamp of last log output (for delay tracking) */
	lastLogTime: number;
	/** Whether kill() is in progress for this process */
	killing?: boolean;
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

/** Default debounce delay for startup detection (seconds) */
export const DEFAULT_START_DELAY = 5;

/** Grace period after SIGTERM before SIGKILL (ms) */
export const SIGKILL_DELAY_MS = 5000;

/** Maximum number of concurrent managed processes */
export const MAX_PROCESSES = 50;

/** Maximum number of log entries retained per process */
export const MAX_LOG_ENTRIES = 10000;

// ── Tool Parameter Schemas (TypeBox) ────────────────────────────────────────

export const StartProcessSchema = Type.Object({
	name: Type.String({
		description: "Unique name to identify this process",
		minLength: 1,
		maxLength: 64,
		pattern: "^[a-zA-Z0-9_-]+$",
	}),
	command: Type.String({
		description: "Shell command to start the process",
		minLength: 1,
		maxLength: 4096,
	}),
	start_delay: Type.Optional(
		Type.Number({
			description:
				"Debounce delay in seconds. Tool returns when no output appears for this duration. Default: 5",
			minimum: 1,
			maximum: 120,
		}),
	),
});

export const KillProcessSchema = Type.Object({
	name: Type.String({
		description: "Name of the process to kill",
		minLength: 1,
		maxLength: 64,
		pattern: "^[a-zA-Z0-9_-]+$",
	}),
});

export const ProcessLogsSchema = Type.Object({
	name: Type.String({
		description: "Name of the process",
		minLength: 1,
		maxLength: 64,
		pattern: "^[a-zA-Z0-9_-]+$",
	}),
	head: Type.Optional(
		Type.Number({ description: "Return the first N lines", minimum: 1 }),
	),
	tail: Type.Optional(
		Type.Number({ description: "Return the last N lines", minimum: 1 }),
	),
	start: Type.Optional(
		Type.Number({
			description: "Start line number (1-based, inclusive)",
			minimum: 1,
		}),
	),
	end: Type.Optional(
		Type.Number({ description: "End line number (1-based, inclusive)", minimum: 1 }),
	),
	grep: Type.Optional(
		Type.String({
			description: "Filter log lines by pattern (regex by default)",
			maxLength: 256,
		}),
	),
	grepLiteral: Type.Optional(
		Type.Boolean({
			description: "Treat grep pattern as literal string instead of regex",
		}),
	),
	grepIgnoreCase: Type.Optional(
		Type.Boolean({ description: "Case-insensitive grep matching" }),
	),
});

export const RestartProcessSchema = Type.Object({
	name: Type.String({
		description: "Name of the process to restart",
		minLength: 1,
		maxLength: 64,
		pattern: "^[a-zA-Z0-9_-]+$",
	}),
	command: Type.Optional(
		Type.String({
			description: "New command to use (defaults to previous command)",
		minLength: 1,
		maxLength: 4096,
		}),
	),
	start_delay: Type.Optional(
		Type.Number({
			description: "Debounce delay in seconds. Default: 5",
			minimum: 1,
			maximum: 120,
		}),
	),
});

export const ListProcessesSchema = Type.Object({});


