import { spawn, type ChildProcess } from "node:child_process";
import { DEFAULT_START_DELAY, MAX_LOG_ENTRIES, MAX_PROCESSES, SIGKILL_DELAY_MS } from "./types.js";
import type { KillResult, LogEntry, ProcessInfo, ProcessRecord, StartupResult } from "./types.js";

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
    const resetDebounce = () => { this.resetDebounce(record, startDelay); };

    this.setupStreamHandler(childProcess, "stdout", addLog, resetDebounce);
    this.setupStreamHandler(childProcess, "stderr", addLog, resetDebounce);
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

      const entry: LogEntry = {
        timestamp: now - record.startTime,
        stream,
        text,
      };
      record.logs.push(entry);
      if (record.logs.length > MAX_LOG_ENTRIES) {
        record.logs.shift();
      }
    };
  }

  /** Parse a data chunk into individual non-empty lines and add them as log entries */
  private parseChunk(
    chunk: Buffer,
    stream: "stdout" | "stderr",
    addLog: (stream: "stdout" | "stderr", text: string) => void,
  ): void {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      if (line !== "") {
        addLog(stream, line);
      }
    }
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
      }
    }, startDelay * 1000);
  }

  /** Attach stdout/stderr data handler */
  private setupStreamHandler(
    childProcess: ChildProcess,
    stream: "stdout" | "stderr",
    addLog: (stream: "stdout" | "stderr", text: string) => void,
    resetDebounce: () => void,
  ): void {
    childProcess[stream]?.on("data", (chunk: Buffer) => {
      this.parseChunk(chunk, stream, addLog);
      resetDebounce();
    });
  }

  /** Attach error handler — fires if spawn itself fails (ENOENT, EACCES, etc.) */
  private setupErrorHandler(record: ProcessRecord, childProcess: ChildProcess): void {
    childProcess.on("error", (err) => {
      if (record.debounceTimer !== null) {
        clearTimeout(record.debounceTimer);
        record.debounceTimer = null;
      }
      this.processes.delete(record.name);
      this.emitProcessCount();

      if (record.startupReject) {
        record.startupReject(new Error(`Failed to spawn process "${record.name}": ${err.message}`));
      }
    });
  }

  /** Attach exit handler — resolves startup if it hasn't completed yet */
  private setupExitHandler(record: ProcessRecord, childProcess: ChildProcess): void {
    childProcess.on("exit", (_code) => {
      record.exited = true;

      // If startup hasn't completed yet, resolve now
      if (!record.startupComplete && record.startupResolve) {
        if (record.debounceTimer !== null) {
          clearTimeout(record.debounceTimer);
        }
        record.startupComplete = true;
        record.startupResolve(this.buildStartupResult(record));
      }
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

    if (record.exited) {
      this.processes.delete(name);
      this.emitProcessCount();
      return {
        name,
        pid: record.pid,
        totalRuntime: Date.now() - record.startTime,
      };
    }

    if (record.killing) {
      throw new Error(`Process "${name}" is already being killed`);
    }
    record.killing = true;

    return new Promise<KillResult>((resolve) => {
      // SIGKILL escalation timer
      const sigkillTimer = setTimeout(() => {
        record.process.kill("SIGKILL");
      }, SIGKILL_DELAY_MS);

      // Listen for exit
      const onExit = () => {
        clearTimeout(sigkillTimer);
        this.processes.delete(name);
        this.emitProcessCount();
        resolve({
          name,
          pid: record.pid,
          totalRuntime: Date.now() - record.startTime,
        });
      };

      record.process.once("exit", onExit);

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
    this.processes.clear();
    this.emitProcessCount();
    this.processCountCallback = undefined;
  }
}
