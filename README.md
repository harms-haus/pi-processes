# pi-processes

Process management extension for the [pi Coding Agent](https://github.com/earendil-works/pi-coding-agent). Provides tools to spawn, monitor, kill, and inspect long-running processes (dev servers, watchers, API backends) directly from a pi session.

## Features

- **Debounce-based startup detection** — waits for process output to quiet down before declaring startup complete, giving you the actual boot logs.
- **Output capture** — stdout and stderr are captured with configurable limits (10 MB stdout sliding window, 1 MB stderr).
- **SIGTERM → SIGKILL escalation** — graceful shutdown with automatic force-kill fallback.
- **Log querying** — head, tail, or arbitrary line-range queries against captured logs.
- **Process lifecycle** — start, list, kill, restart, and inspect up to 50 concurrent managed processes.

## Installation

### Recommended — via pi install

```bash
pi install git:github.com/harms-haus/pi-processes
```

That's it. The extension initializes automatically on every pi session start.

### Manual — from source

```bash
git clone https://github.com/harms-haus/pi-processes.git
cd pi-processes
npm install
```

The extension is discovered automatically via the `pi.extensions` field in `package.json`:

```jsonc
// package.json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

No additional configuration is required — the extension initializes on every pi session start.

## Available Tools

### `start_process`

Spawn a long-running process and wait for its startup output to settle.

| Parameter     | Type     | Required | Default | Description                                                                 |
|---------------|----------|----------|---------|-----------------------------------------------------------------------------|
| `name`        | string   | Yes      | —       | Unique identifier for the process.                                          |
| `command`     | string   | Yes      | —       | Shell command to execute.                                                   |
| `start_delay` | number   | No       | `5`     | Seconds of output silence before declaring startup complete.                |

**Returns** `StartupResult`:

```ts
{
  name: string;          // process name
  pid: number;           // OS process ID
  startupTime: number;   // ms from spawn to debounce completion
  maxDelay: number;      // max seconds between consecutive log lines during startup
  logs: string;          // all startup output, joined by newlines
}
```

**Example:**

```
start_process(name="api-server", command="npm run dev", start_delay=3)
```

Output:
```
Process 'api-server' started (PID 12345).
Startup time: 2.4s
Max log delay: 1s

> my-app@1.0.0 dev
> vite
  VITE v5.2.0  ready in 240 ms
  ➜  Local:   http://localhost:5173/
```

---

### `list_processes`

List all active managed processes with their current status.

| Parameter | Type   | Required | Default | Description |
|-----------|--------|----------|---------|-------------|
| *(none)*  | —      | —        | —       | —           |

**Returns** `ListProcessesResult`:

```ts
{
  processes: ProcessInfo[];
  count: number;
}
```

Each `ProcessInfo`:

```ts
{
  name: string;           // unique process name
  pid: number;            // OS process ID
  command: string;        // spawn command
  startTime: number;      // Date.now() at spawn
  running: boolean;       // whether the process is still alive
  uptimeSec: number;      // seconds since start
  logLines: number;       // total captured log lines
  startupComplete: boolean;
}
```

**Example:**

```
list_processes()
```

Output:
```
api-server (PID 12345) | npm run dev | uptime: 342.1s | 128 lines | ready
watcher    (PID 12350) | npx tsc --watch | uptime: 340.5s | 42 lines | starting
```

---

### `kill_process`

Terminate a managed process by name. Sends `SIGTERM` first, then `SIGKILL` after 5 seconds if the process hasn't exited.

| Parameter | Type   | Required | Default | Description              |
|-----------|--------|----------|---------|--------------------------|
| `name`    | string | Yes      | —       | Name of the process to kill. |

**Returns** `KillResult`:

```ts
{
  name: string;         // process name
  pid: number;          // OS process ID
  totalRuntime: number; // total ms from start to kill
}
```

**Example:**

```
kill_process(name="api-server")
```

Output:
```
Process 'api-server' killed (PID 12345). Total runtime: 342.1s
```

---

### `process_logs`

Read captured log output from a managed process. Supports four mutually exclusive query modes: head, tail, or start/end range.

| Parameter | Type   | Required | Default | Description                                         |
|-----------|--------|----------|---------|-----------------------------------------------------|
| `name`    | string | Yes      | —       | Name of the process.                                |
| `head`    | number | No       | —       | Return the first N lines.                           |
| `tail`    | number | No       | —       | Return the last N lines.                            |
| `start`   | number | No       | —       | Start line number (1-based, inclusive).             |
| `end`     | number | No       | —       | End line number (1-based, inclusive).               |

**Constraint:** `head`, `tail`, and `start`/`end` cannot be combined. Specifying both `head` and `tail`, or `head`/`tail` with `start`/`end`, throws an error.

**Returns** `ProcessLogsResult`:

```ts
{
  logs: string;          // formatted log lines
  totalLines: number;    // total lines in the log buffer
  returnedLines: number; // lines returned by this query
}
```

Each log line is formatted as:

```
[lineNum] timestamp [stream] text
```

Where `timestamp` is milliseconds since process start and `stream` is `stdout` or `stderr`.

**Examples:**

```
// First 10 lines
process_logs(name="api-server", head=10)

// Last 5 lines
process_logs(name="api-server", tail=5)

// Lines 20 through 35
process_logs(name="api-server", start=20, end=35)

// All logs
process_logs(name="api-server")
```

---

### `restart_process`

Kill a managed process (if running) and immediately start it again. Reuses the previous command unless a new one is provided.

| Parameter     | Type   | Required | Default           | Description                                         |
|---------------|--------|----------|-------------------|-----------------------------------------------------|
| `name`        | string | Yes      | —                 | Name of the process to restart.                     |
| `command`     | string | No       | previous command  | New shell command to use.                           |
| `start_delay` | number | No       | `5`               | Seconds of output silence before declaring ready.   |

**Returns** `StartupResult` (same as `start_process`).

**Example:**

```
restart_process(name="api-server", command="npm run dev -- --host")
```

Output:
```
Process 'api-server' restarted (PID 12360).
Startup time: 2.1s
Max log delay: 1s

> my-app@1.0.0 dev
> vite --host
  VITE v5.2.0  ready in 210 ms
  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.10:5173/
```

## Use Cases

### Debug / Dev Servers

Start a dev server and get its boot logs immediately, including the listening port:

```
start_process(name="frontend", command="npm run dev", start_delay=3)
start_process(name="backend", command="npx nodemon src/index.ts", start_delay=4)
```

### File Watchers

Run a TypeScript watcher alongside your dev server:

```
start_process(name="tsc-watch", command="npx tsc --watch --preserveWatchOutput")
```

Check logs after making edits:

```
process_logs(name="tsc-watch", tail=20)
```

### API Servers

Start a backend, verify it's ready, then inspect its logs for connection errors:

```
start_process(name="api", command="node server.js")
list_processes()                          // confirm it's "ready"
process_logs(name="api", tail=50)         // check for errors
restart_process(name="api")               // restart after config change
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                     pi Extension API                 │
│  (session_start / session_shutdown / registerTool)   │
└──────────────┬──────────────────────────┬────────────┘
               │                          │
               ▼                          ▼
┌──────────────────────┐    ┌──────────────────────────┐
│    ProcessManager     │    │      Tool Definitions     │
│                      │    │                           │
│  Map<string,         │◄───│  start_process            │
│    ProcessRecord>    │    │  list_processes            │
│                      │    │  kill_process              │
│  start() ────────────┼───►│  process_logs              │
│  kill() ─────────────┼───►│  restart_process           │
│  list()              │    └───────────────────────────┘
│  getLogs()           │
│  restart()           │    ┌──────────────────────────┐
│  shutdown()          │    │    process-logs.ts         │
│                      │    │  (queryLogs helper)        │
└──────────────────────┘    └───────────────────────────┘
```

### Process Lifecycle

1. **Session start** → `ProcessManager` is instantiated.
2. **Tool call** (`start_process`) → `spawn()` creates a child process with piped stdio.
3. **Startup debounce** → each stdout/stderr chunk resets a timer. When output goes quiet for `start_delay` seconds, the tool resolves with boot logs.
4. **Log capture** → lines are appended to an in-memory ring buffer (max 10 000 entries). Stdout is capped at 10 MB (sliding window); stderr keeps the last 512 KB.
5. **Kill** → `SIGTERM` is sent. If the process hasn't exited within 5 seconds, `SIGKILL` is sent.
6. **Session shutdown** → all managed processes are killed and the manager is cleared.

## Configuration Constants

| Constant               | Value         | Description                                        |
|------------------------|---------------|----------------------------------------------------|
| `DEFAULT_START_DELAY`  | `5` seconds   | Default debounce silence period for startup.       |
| `MAX_PROCESSES`        | `50`          | Maximum concurrent managed processes.              |
| `MAX_LOG_ENTRIES`      | `10 000`      | Max log lines retained per process (ring buffer).  |
| `MAX_STDOUT_BYTES`     | `10 MB`       | Max stdout buffer size (sliding window).           |
| `MAX_STDERR_TEXT`      | `1 MB`        | Total stderr text cap.                             |
| `STDERR_KEEP_BYTES`    | `512 KB`      | Bytes retained when stderr exceeds the cap.        |
| `SIGKILL_DELAY_MS`     | `5000` ms     | Grace period after SIGTERM before SIGKILL.         |

## Development

### Prerequisites

- Node.js ≥ 20
- npm

### Scripts

```bash
# Type-check
npm run typecheck

# Lint
npm run lint

# Run tests once
npm run test

# Run tests in watch mode
npm run test:watch
```

### Project Structure

```
src/
├── index.ts              # Extension entry point (lifecycle + tool registration)
├── types.ts              # Shared types, schemas, and constants
├── process-manager.ts    # Core ProcessManager class
├── process-logs.ts       # Log querying utilities (head/tail/range)
└── tools/
    ├── start-process.ts  # start_process tool definition
    ├── list-processes.ts # list_processes tool definition
    ├── kill-process.ts   # kill_process tool definition
    ├── process-logs.ts   # process_logs tool definition
    └── restart-process.ts# restart_process tool definition
```

### Testing

Tests are written with [Vitest](https://vitest.dev/) and placed alongside source files as `*.test.ts`. The `ProcessManager` is designed with an `IProcessManager` interface for dependency injection, making tools straightforward to unit-test in isolation.

```bash
npm run test
```

### Linting

[Biome](https://biomejs.dev/) is used for linting and formatting:

```bash
npm run lint
```

## License

MIT
