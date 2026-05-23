# pi-processes

Process management extension for the [pi Coding Agent](https://github.com/earendil-works/pi-coding-agent). Provides tools to spawn, monitor, kill, and inspect long-running processes (dev servers, watchers, API backends) directly from a pi session.

## Features

- **Debounce-based startup detection** — waits for process output to quiet down before declaring startup complete, giving you the actual boot logs.
- **Output capture** — stdout and stderr are captured in a single in-memory log buffer (max 10 000 lines, FIFO eviction).
- **SIGTERM → SIGKILL escalation** — graceful shutdown with automatic force-kill fallback.
- **Log querying** — head, tail, or arbitrary line-range queries against captured logs.
- **Process Logs Dialog** — interactive TUI overlay (`Ctrl+Alt+P`) to browse, select, and insert log lines from managed processes.
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

Terminate a managed process by name. Sends `SIGTERM` first, then `SIGKILL` after 5 seconds if the process hasn't exited. If the process has already exited naturally, calling `kill_process` simply removes its record from the manager (no signals are sent).

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

Read captured log output from a managed process. Supports three positional query modes (head, tail, or start/end range) plus optional grep filtering that can be combined with any positional mode.

| Parameter | Type   | Required | Default | Description                                         |
|-----------|--------|----------|---------|-----------------------------------------------------|
| `name`    | string | Yes      | —       | Name of the process.                                |
| `head`    | number | No       | —       | Return the first N lines.                           |
| `tail`    | number | No       | —       | Return the last N lines.                            |
| `start`   | number | No       | —       | Start line number (1-based, inclusive).             |
| `end`     | number | No       | —       | End line number (1-based, inclusive).             |
| `grep`           | string  | No       | —       | Filter log lines by regex pattern.                  |
| `grepLiteral`    | boolean | No       | `false` | Treat grep pattern as a literal string.             |
| `grepIgnoreCase` | boolean | No       | `false` | Case-insensitive grep matching.                     |

**Constraint:** `head`, `tail`, and `start`/`end` are mutually exclusive positional modes — they cannot be combined with each other. The `grep`/`grepLiteral`/`grepIgnoreCase` parameters are independent and can be used with any positional mode or on their own.

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
[lineNum] +Nms [stream] text
```

Where `+Nms` is milliseconds since process start and `stream` is `stdout` or `stderr`.

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

#### Grep Examples

Filter logs by regex pattern:

```
// Find all lines containing "error" (case-insensitive)
process_logs(name="api-server", grep="error", grepIgnoreCase=true)

// Filter for a literal string containing regex metacharacters
process_logs(name="api-server", grep="[WARN]", grepLiteral=true)

// Combine grep with tail — last 5 lines matching "ECONNREFUSED"
process_logs(name="api-server", grep="ECONNREFUSED", tail=5)

// Grep across a line range
process_logs(name="api-server", grep="timeout", start=100, end=200)
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

## Keyboard Shortcuts

| Shortcut | Description |
|----------|-------------|
| `Ctrl+Alt+P` | Open the Process Logs Dialog |

The Process Logs Dialog is a TUI overlay that lets you visually browse, select, and insert log lines from managed processes.

### Dialog Features

- **Tab bar** — Switch between processes with `Tab` / `Shift+Tab`
- **Scrollable log viewport** — Navigate with `↑` / `↓` arrows
- **Multi-select** — Hold `Shift` + `↑` / `↓` to select multiple lines
- **Insert to compose** — Press `Ctrl+Enter` to insert selected logs into the compose box
- **Close** — Press `Esc` to close without inserting
- **Timestamps** — Logs display elapsed time as `+HH:MM:SS.mmm`
- **Diagnostics** — Footer shows process status (● running/exited), PID, uptime, log count
- **Keybinding hints** — Available shortcuts shown at the bottom of the dialog

The dialog requires a UI session (`hasUI`). In headless/RPC mode, the shortcut is a no-op.

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
│  (session_start / session_shutdown /                 │
│   registerTool / registerShortcut)                   │
└──────┬──────────────────────────┬───────────┬────────┘
       │                          │           │
       ▼                          ▼           │
┌──────────────────────┐    ┌────────────┐    │
│    ProcessManager     │    │   Tools     │    │  registerShortcut
│                      │    │             │    │  (Ctrl+Alt+P)
│  Map<string,         │◄───│  start_…    │    │
│    ProcessRecord>    │    │  list_…     │    │
│                      │    │  kill_…     │    │
│  start() ────────────┼───►│  logs       │    │
│  kill() ─────────────┼───►│  restart_…  │    │
│  list()              │    └─────────────┘    │
│  getLogs()           │                        │
│  getLogOffset()      │    ┌──────────────────┐│
│  restart()           │    │  process-logs.ts ││
│  shutdown()          │    │  (queryLogs)     ││
│                      │    │  (queryLogs)     ││
└──────────┬───────────┘    └──────────────────┘│
           │                                     │
           │  getLogs()                          ▼
           │                           ┌──────────────────┐
           └──────────────────────────►│   LogDialog       │
                                       │  (ui/log-dialog)  │
                                       │                   │
                                       │  ┌──────────────┐ │
                                       │  │format-timestamp│ │
                                       │  └──────────────┘ │
                                       └──────────────────┘
```

### Process Lifecycle

1. **Session start** → `ProcessManager` is instantiated.
2. **Tool call** (`start_process`) → `spawn()` creates a child process with piped stdio.
3. **Startup debounce** → each stdout/stderr chunk resets a timer. When output goes quiet for `start_delay` seconds, the tool resolves with boot logs.
4. **Log capture** → lines are appended to an in-memory log buffer (max 10 000 entries). Both stdout and stderr are captured identically; oldest lines are evicted via Array.shift() when the limit is reached.
   Line numbers are **stable across eviction**. When the buffer exceeds `MAX_LOG_ENTRIES`, the oldest entries are discarded, but displayed line numbers reflect the absolute position since process start. For example, after 15 000 lines have been produced, `head=10` would show lines `[5001]`–`[5010]`.
5. **Kill** → `SIGTERM` is sent. If the process hasn't exited within 5 seconds, `SIGKILL` is sent.
6. **Session shutdown** → all managed processes are killed and the manager is cleared.

## Configuration Constants

| Constant               | Value         | Description                                        |
|------------------------|---------------|----------------------------------------------------|
| `DEFAULT_START_DELAY`  | `5` seconds   | Default debounce silence period for startup.       |
| `MAX_PROCESSES`        | `50`          | Maximum concurrent managed processes.              |
| `MAX_LOG_ENTRIES`      | `10 000`      | Max log lines retained per process (FIFO eviction).|
| `SIGKILL_DELAY_MS`     | `5000` ms     | Grace period after SIGTERM before SIGKILL.         |
| `MAX_LOG_LINE_BYTES`   | `8192`        | Maximum byte length for a single log line. Lines exceeding this are truncated with `...` suffix. |
| `KILL_FORCE_RESOLVE_MS`| `5000` ms     | Grace period after SIGKILL before force-resolving the kill promise for uninterruptible processes. |

## Development

### Prerequisites

- Node.js ≥ 20
- npm

### Scripts

| Script                 | Description                                |
|------------------------|--------------------------------------------|
| `npm run typecheck`    | Type-check with `tsc --noEmit`             |
| `npm run lint`         | Lint with ESLint                           |
| `npm run lint:fix`     | Auto-fix ESLint issues                     |
| `npm run format`       | Format code with Prettier                  |
| `npm run format:check` | Check formatting (CI)                      |
| `npm run test`         | Run tests once (Vitest)                    |
| `npm run test:watch`   | Run tests in watch mode                    |
| `npm run test:coverage`| Run tests with v8 coverage (90% thresholds)|

### Project Structure

```
src/
├── index.ts              # Extension entry point
├── types.ts              # Shared types and schemas
├── process-manager.ts    # Core process management
├── process-logs.ts       # Log query helper
├── ui/                   # TUI components
│   ├── format-timestamp.ts # Timestamp formatting
│   ├── log-dialog.ts     # Process logs dialog
│   └── open-log-dialog.ts # Overlay factory & dialog opener
├── tools/                # Tool definitions
│   ├── start-process.ts
│   ├── list-processes.ts
│   ├── kill-process.ts
│   ├── process-logs.ts
│   ├── restart-process.ts
│   └── format-startup-result.ts
└── __tests__/
    ├── index.test.ts
    ├── process-manager.test.ts
    ├── process-logs.test.ts
    ├── helpers/
    │   ├── index.ts
    │   ├── mock-manager.ts
    │   ├── mock-theme.ts
    │   ├── execute-tool.ts
    │   └── make-logs.ts
    ├── tools/
    │   ├── error-propagation.test.ts
    │   ├── format-startup-result.test.ts
    │   ├── start-process.test.ts
    │   ├── kill-process.test.ts
    │   ├── list-processes.test.ts
    │   ├── process-logs.test.ts
    │   └── restart-process.test.ts
    └── ui/
        ├── format-timestamp.test.ts
        └── log-dialog.test.ts
```

### Testing

Tests are written with [Vitest](https://vitest.dev/) and organized in `src/__tests__/` and `src/__tests__/tools/`.

```bash
npm run test
```

### Linting & Formatting

Linting is handled by [ESLint](https://eslint.org/) with [typescript-eslint](https://typescript-eslint.io/) and [eslint-config-prettier](https://github.com/prettier/eslint-config-prettier). Formatting is handled by [Prettier](https://prettier.io/).

```bash
npm run lint          # check for issues
npm run format        # auto-format
npm run format:check  # CI-friendly format check
```

## Publishing

The package is published to npm via a tag-based dry-run workflow (`.github/workflows/publish.yml`). The `engines` field in `package.json` requires Node ≥ 20, and `.nvmrc` pins the development environment to Node 20.

## Dependencies

The extension depends on [`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi-coding-agent) for the extension API and [`@earendil-works/pi-tui`](https://github.com/earendil-works/pi-tui) for TUI rendering components (`Key`, `matchesKey`, `truncateToWidth`, `Container`, `Text`, `Spacer`). Both are declared as peer dependencies.

## Known Limitations

- **Exited processes remain in memory**: Processes that exit naturally are retained in the internal Map (with their logs) until explicitly killed via `kill_process` or `shutdown`. This is intentional to allow log inspection after exit. The Map is capped at 50 processes.
- **Log eviction uses Array.shift()**: The log ring buffer uses `Array.shift()` for eviction when MAX_LOG_ENTRIES is reached, which is O(n) per eviction. For extremely high-throughput processes producing thousands of log lines, this may cause GC pressure.
- **Log line truncation**: Individual log lines exceeding 8,192 bytes (`MAX_LOG_LINE_BYTES`) are truncated to prevent unbounded memory growth. Truncated lines are suffixed with `...`.

## License

MIT
