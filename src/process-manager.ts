import { spawn, type ChildProcess } from "node:child_process";
import {
  DEFAULT_START_DELAY,
  MAX_LOG_ENTRIES,
  MAX_LOG_LINE_BYTES,
  MAX_PROCESSES,
  SIGKILL_DELAY_MS,
} from "./types.js";
import type { KillResult, LogEntry, ProcessInfo, ProcessRecord, StartupResult } from "./types.js";

/** Time to wait after SIGKILL before force-resolving the kill promise (ms). */
const KILL_FORCE_RESOLVE_MS = 5000;

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
    return [...this.processes.values()].map((record) => ({
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

  /** Get the number of log entries that have been trimmed from the front due to MAX_LOG_ENTRIES */
  getLogOffset(name: string): number {
    const record = this.processes.get(name);
    if (!record) {
      throw new Error(`Process "${name}" not found`);
    }
    return record.logOffset;
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
    this.validateStart(name);
    const { childProcess, record } = this.spawnProcess(name, command);
    this.processes.set(name, record);
    this.emitProcessCount();

    const addLog = this.createAddLog(record);
    const resetDebounce = () => {
      this.resetDebounce(record, startDelay);
    };

    this.setupStreamHandler(childProcess, "stdout", record, addLog, resetDebounce);
    this.setupStreamHandler(childProcess, "stderr", record, addLog, resetDebounce);
    this.setupErrorHandler(record, childProcess);
    this.setupExitHandler(record, childProcess);

    return this.createStartupPromise(record, startDelay);
  }

  /** Validate that a new process can be started with the given name */
  private validateStart(name: string): void {
    if (this.processes.has(name)) {
      throw new Error(`Process "${name}" already exists`);
    }
    if (this.processes.size >= MAX_PROCESSES) {
      throw new Error(`Maximum number of processes (${MAX_PROCESSES}) reached`);
    }
  }

  /** Spawn a child process and create its ProcessRecord */
  private spawnProcess(
    name: string,
    command: string,
  ): { childProcess: ChildProcess; record: ProcessRecord } {
    const childProcess = spawn(command, [], {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      // Forward full parent environment to child processes
      env: { ...(process.env as Record<string, string>) },
    });

    if (childProcess.pid === undefined) {
      throw new Error(`Failed to spawn process "${name}": child process has no pid`);
    }

    const startTime = Date.now();

    const record: ProcessRecord = {
      name,
      process: childProcess,
      pid: childProcess.pid,
      command,
      startTime,
      startupComplete: false,
      logs: [],
      exited: false,
      startupResolve: null,
      startupReject: null,
      debounceTimer: null,
      maxDelay: 0,
      lastLogTime: startTime,
      exitTime: null,
      logOffset: 0,
      pendingStdout: "",
      pendingStderr: "",
    };

    return { childProcess, record };
  }

  /** Create the addLog helper closure that tracks inter-line delay and appends entries */
  private createAddLog(record: ProcessRecord): (stream: "stdout" | "stderr", text: string) => void {
    return (stream: "stdout" | "stderr", text: string) => {
      const now = Date.now();
      const delay = now - record.lastLogTime;
      if (delay > record.maxDelay) {
        record.maxDelay = delay;
      }
      record.lastLogTime = now;

      // Truncate excessively long lines to prevent unbounded memory growth
      if (text.length > MAX_LOG_LINE_BYTES) {
        text = text.slice(0, MAX_LOG_LINE_BYTES) + "...";
      }

      const entry: LogEntry = {
        timestamp: now - record.startTime,
        stream,
        text,
      };
      record.logs.push(entry);
      if (record.logs.length > MAX_LOG_ENTRIES) {
        record.logs.shift();
        record.logOffset++;
      }
    };
  }

  /** Handle a data chunk with proper line buffering for partial lines at chunk boundaries */
  private handleChunk(
    chunk: Buffer,
    stream: "stdout" | "stderr",
    record: ProcessRecord,
    addLog: (stream: "stdout" | "stderr", text: string) => void,
    resetDebounce: () => void,
  ): void {
    const pendingField =
      stream === "stdout" ? ("pendingStdout" as const) : ("pendingStderr" as const);

    // Cap the pending buffer to prevent unbounded growth when no newlines arrive
    if (record[pendingField].length > MAX_LOG_LINE_BYTES) {
      addLog(stream, record[pendingField].slice(0, MAX_LOG_LINE_BYTES) + "...");
      record[pendingField] = "";
    }

    const data = record[pendingField] + chunk.toString();
    const parts = data.split("\n");
    // Last element is the incomplete remainder (or empty string if chunk ended with \n)
    record[pendingField] = parts.pop() ?? "";
    for (const line of parts) {
      if (line !== "") {
        addLog(stream, line);
      }
    }
    resetDebounce();
  }

  /** Reset the startup debounce timer — each output event calls this */
  private resetDebounce(record: ProcessRecord, startDelay: number): void {
    if (record.startupComplete) return;
    if (record.debounceTimer !== null) {
      clearTimeout(record.debounceTimer);
    }
    record.debounceTimer = setTimeout(() => {
      if (!record.startupComplete && record.startupResolve) {
        record.startupComplete = true;
        record.startupResolve(this.buildStartupResult(record));
        record.startupResolve = null;
        record.startupReject = null;
      }
    }, startDelay * 1000);
  }

  /** Attach stdout/stderr data handler */
  private setupStreamHandler(
    childProcess: ChildProcess,
    stream: "stdout" | "stderr",
    record: ProcessRecord,
    addLog: (stream: "stdout" | "stderr", text: string) => void,
    resetDebounce: () => void,
  ): void {
    childProcess[stream]?.on("data", (chunk: Buffer) => {
      this.handleChunk(chunk, stream, record, addLog, resetDebounce);
    });
  }

  /** Properly clean up all listeners and streams for a process record */
  private cleanupRecord(record: ProcessRecord): void {
    // 1. Clear debounce timer
    if (record.debounceTimer !== null) {
      clearTimeout(record.debounceTimer);
      record.debounceTimer = null;
    }

    // 2. Null out startup promise handles (fixes M5)
    record.startupResolve = null;
    record.startupReject = null;

    // 3. Remove listeners from streams, then destroy (guard for null'd process)
    if (record.process) {
      if (record.process.stdout) {
        record.process.stdout.removeAllListeners();
        record.process.stdout.destroy();
      }
      if (record.process.stderr) {
        record.process.stderr.removeAllListeners();
        record.process.stderr.destroy();
      }

      // 4. Remove all listeners from child process itself
      record.process.removeAllListeners();
    }
  }

  /** Attach error handler — fires if spawn itself fails (ENOENT, EACCES, etc.) */
  private setupErrorHandler(record: ProcessRecord, childProcess: ChildProcess): void {
    childProcess.on("error", (err: Error) => {
      // Clear debounce timer
      if (record.debounceTimer !== null) {
        clearTimeout(record.debounceTimer);
        record.debounceTimer = null;
      }

      if (!record.startupComplete && record.startupReject) {
        // Error during startup — reject the startup promise
        record.startupComplete = true;
        record.startupReject(new Error(`Failed to spawn process "${record.name}": ${err.message}`));
        record.startupReject = null;
        record.startupResolve = null;
      } else {
        // Error AFTER startup — log warning instead of silently swallowing
        console.warn(`Process "${record.name}" error after startup: ${err.message}`);
      }

      // Always clean up and remove from map
      this.cleanupRecord(record);
      this.processes.delete(record.name);
      this.emitProcessCount();
    });
  }

  /** Attach exit handler — resolves startup if it hasn't completed yet */
  private setupExitHandler(record: ProcessRecord, childProcess: ChildProcess): void {
    childProcess.on("exit", (_code) => {
      // Set exitTime BEFORE exited so kill() sees consistent state
      record.exitTime = Date.now();
      record.exited = true;

      // If startup hasn't completed yet, resolve now
      if (!record.startupComplete && record.startupResolve) {
        if (record.debounceTimer !== null) {
          clearTimeout(record.debounceTimer);
        }
        record.startupComplete = true;
        record.startupResolve(this.buildStartupResult(record));
        record.startupResolve = null;
        record.startupReject = null;
      }

      // Light cleanup: detach listeners and release OS process handle.
      // Record stays in map so logs remain accessible via getLogs().
      if (record.debounceTimer !== null) {
        clearTimeout(record.debounceTimer);
        record.debounceTimer = null;
      }
      record.startupResolve = null;
      record.startupReject = null;

      if (childProcess.stdout) {
        childProcess.stdout.removeAllListeners();
        childProcess.stdout.destroy();
      }
      if (childProcess.stderr) {
        childProcess.stderr.removeAllListeners();
        childProcess.stderr.destroy();
      }
      childProcess.removeAllListeners();

      // Release OS process handle (safe because record.exited is already true)
      record.process = null;
    });
  }

  /** Build the startup result object with timing and log information */
  private buildStartupResult(record: ProcessRecord): StartupResult {
    return {
      name: record.name,
      pid: record.pid,
      startupTime: Date.now() - record.startTime,
      maxDelay: Math.ceil(record.maxDelay / 1000),
      logs: record.logs.map((l) => l.text).join("\n"),
    };
  }

  /** Create the startup promise and start the initial debounce timer */
  private createStartupPromise(record: ProcessRecord, startDelay: number): Promise<StartupResult> {
    const startupPromise = new Promise<StartupResult>((resolve, reject) => {
      record.startupResolve = resolve;
      record.startupReject = reject;
    });

    // Start initial debounce timer
    this.resetDebounce(record, startDelay);

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

    if (record.killing) {
      throw new Error(`Process "${name}" is already being killed`);
    }

    // If already exited naturally, just remove the record — record.process may be null
    if (record.exited) {
      this.processes.delete(name);
      this.emitProcessCount();
      return {
        name,
        pid: record.pid,
        totalRuntime: (record.exitTime ?? Date.now()) - record.startTime,
      };
    }

    // After the exited guard above, process should be non-null
    const proc = record.process;
    if (!proc) {
      throw new Error(`Process "${name}" has already been cleaned up`);
    }

    return new Promise<KillResult>((resolve) => {
      let resolved = false;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(sigkillTimer);
        clearTimeout(forceResolveTimer);
        proc.removeListener("exit", onExit);
        this.cleanupRecord(record);
        this.processes.delete(name);
        this.emitProcessCount();
        resolve({
          name,
          pid: record.pid,
          totalRuntime: (record.exitTime ?? Date.now()) - record.startTime,
        });
      };

      const onExit = () => {
        finish();
      };

      // SIGKILL escalation timer
      const sigkillTimer = setTimeout(() => {
        proc.kill("SIGKILL");
      }, SIGKILL_DELAY_MS);

      // Force-resolve timer for uninterruptible (D-state) processes
      const forceResolveTimer = setTimeout(() => {
        if (resolved) return;
        console.warn(
          `Process "${name}" (PID ${record.pid}) did not exit after SIGKILL. Force-resolving kill promise.`,
        );
        finish();
      }, SIGKILL_DELAY_MS + KILL_FORCE_RESOLVE_MS);

      // Register exit listener BEFORE checking record.exited to avoid TOCTOU race
      proc.once("exit", onExit);

      // If already exited between the initial check and listener registration, resolve now
      if (record.exited) {
        finish();
        return;
      }

      record.killing = true;

      // Send SIGTERM
      proc.kill("SIGTERM");
    });
  }

  /**
   * Restart a process: kill if running, then start with same or new command.
   * @param name - Process name
   * @param command - New command (defaults to previous command)
   * @param startDelay - Debounce time (default: DEFAULT_START_DELAY)
   * @returns StartupResult
   */
  async restart(name: string, command?: string, startDelay?: number): Promise<StartupResult> {
    const record = this.processes.get(name);
    const previousCommand = record?.command;

    if (record) {
      await this.kill(name);
    }

    const cmd = command ?? previousCommand;
    if (!cmd) {
      throw new Error(`No command specified and no previous command found for "${name}"`);
    }

    return this.start(name, cmd, startDelay);
  }

  /** Clean up all managed processes (call on session shutdown) */
  async shutdown(): Promise<void> {
    const names = [...this.processes.keys()];
    await Promise.allSettled(names.map((name) => this.kill(name)));
    for (const record of this.processes.values()) {
      this.cleanupRecord(record);
    }
    this.processes.clear();
    this.emitProcessCount();
    this.processCountCallback = undefined;
  }
}
