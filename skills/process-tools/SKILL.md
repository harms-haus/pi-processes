---
name: process-tools
description: Manage long-running processes (start, stop, restart, inspect logs) via the pi-processes extension.
---

# Process Management Tools

Tools for starting, monitoring, and debugging long-running processes like dev servers, API backends, and file watchers. All processes are managed by a `ProcessManager` that tracks PIDs, captures logs, and provides startup debounce.

## Available Tools

| Tool | Purpose |
|---|---|
| `start_process` | Start a managed process; returns after startup logs settle |
| `list_processes` | Show all active managed processes with status |
| `process_logs` | Read captured log output (head/tail/range) |
| `restart_process` | Kill then re-start a process (same or new command) |
| `kill_process` | Terminate a managed process |

---

## When to Use Each Tool

### `start_process`

Use when the user asks to start a server, watcher, or any long-running command that should persist across tool calls.

**Parameters:** `name` (unique identifier, alphanumeric/hyphen/underscore only, max 64 chars), `command` (shell command), `start_delay` (optional, 1-120 seconds, default 5)

```
start_process(name="dev-server", command="npm run dev")
start_process(name="api", command="python manage.py runserver 8000", start_delay=8)
```

**Key behavior:** The tool does **not** return immediately. It waits until the process produces no new output for `start_delay` seconds (debounce), then returns the captured startup logs. This means you see the full boot sequence in one response.

### `list_processes`

Use to check what's currently running before starting something new, or to verify a process is still alive after an operation.

```
list_processes()
```

Returns name, PID, command, uptime, log line count, and startup status (`ready` vs `starting`).

### `process_logs`

Use to inspect output from a running or recently-killed process. Three mutually exclusive positional modes:

| Mode | Parameters | Example |
|---|---|---|
| **head** | `head=N` | First 20 lines: `process_logs(name="api", head=20)` |
| **tail** | `tail=N` | Last 50 lines: `process_logs(name="api", tail=50)` |
| **range** | `start=N`, `end=M` | Lines 100–120: `process_logs(name="api", start=100, end=120)` |

All positional modes can be combined with **grep filters** (see below). Grep is applied before head/tail/start/end, so you can search the full log and then slice the matching results.

### Grep Parameters

| Parameter | Type | Description |
|---|---|---|
| `grep` | string (optional) | Filter log lines by regex pattern. Applied **before** head/tail/start/end. |
| `grepLiteral` | boolean (optional) | If `true`, treat the grep pattern as a literal string instead of regex. |
| `grepIgnoreCase` | boolean (optional) | If `true`, perform case-insensitive matching. |

### Grep Examples

```
# Find all lines containing "ERROR"
process_logs(name="api", grep="ERROR")

# Last 20 lines matching "error" (case-insensitive)
process_logs(name="api", grep="error", grepIgnoreCase=true, tail=20)

# Literal string match (special chars not interpreted as regex)
process_logs(name="api", grep="Connection refused", grepLiteral=true)

# Regex alternation with head limit
process_logs(name="server", grep="timeout|refused", head=50)
```

### Log Line Format

Log lines are formatted as: `[lineNum] +Nms [stdout|stderr] text`

- `lineNum` — 1-based line number within the process log buffer
- `+Nms` — milliseconds elapsed since the process started
- `[stdout|stderr]` — which stream produced the line
- `text` — the actual log output

Example: `[1] +1000ms [stdout] Server listening on port 3000`

Use `stderr` lines to identify errors. Look for keywords: `Error`, `EADDRINUSE`, `ENOENT`, `TypeError`, `Unhandled`, `FATAL`.

### `restart_process`

Use when a process needs to be reloaded after a config change, dependency install, or code modification. The old process is killed, then a new one is started.

```
restart_process(name="dev-server")
restart_process(name="dev-server", command="npm run dev -- --port 3001")
```

If `command` is omitted, it reuses the original command. The `start_delay` parameter is also optional (1-120 seconds, default 5).

### `kill_process`

Use to permanently stop a process when it's no longer needed or when a restart is not desired.

```
kill_process(name="temp-server")
```

Returns total runtime. The process is gone — use `start_process` to bring it back.

---

## Common Workflows

### Start Server → Check Logs → Debug

```
1. start_process(name="api", command="npm start")
   → Returns startup logs, PID, startup time

2. list_processes()
   → Confirms the process is running, checks uptime

3. process_logs(name="api", tail=30)
   → Inspects recent output for errors or readiness confirmation

4. If errors found:
   → Examine stderr lines
   → Fix the issue in source code
   → restart_process(name="api")
```

### Hot-Reload After Config Change

```
1. Edit config file
2. restart_process(name="dev-server")
3. process_logs(name="dev-server", tail=10)  → verify clean restart
```

### Clean Shutdown

```
1. kill_process(name="temp-worker")
2. list_processes()  → confirm it's gone
```

---

## `start_delay` Tips

The `start_delay` parameter controls how long the tool waits for log silence before returning.

| Scenario | Recommended Delay | Rationale |
|---|---|---|
| Fast scripts (lint, build) | `2–3` | Minimal output, quick finish |
| Node.js dev servers | `5` (default) | Typical boot time |
| Python/Django, Ruby/Rails | `8–12` | Slower initialization, DB migrations |
| Java/Gradle, large monorepos | `15–30` | Long compile + boot cycles |
| Docker containers | `10–20` | Pull + startup time |

**Too short:** The tool returns before the process finishes booting. You'll get partial logs and the process may still be printing to stdout. You can always call `process_logs` to catch up.

**Too long:** You waste time waiting. The process may be ready in 3 seconds but you wait 30.

**Strategy:** Start with the default (5s). If the server clearly hasn't finished starting (check with `process_logs`), increase on the next restart.

---

## Reading Logs for Debugging

Log format per line: `[lineNum] +Nms [stdout|stderr] text`

**Quick triage checklist:**

1. **Check stderr first** — `process_logs(name="api", tail=50)` and look for `[stderr]` lines
2. **Common errors:**
   - `EADDRINUSE` — port already taken; kill the conflicting process or change ports
   - `ENOENT` — missing file or dependency; check paths, run install
   - `TypeError` / `SyntaxError` — code bug in the started application
   - `Cannot find module` — missing dependency; run `npm install` or equivalent
3. **Check startup completeness** — `list_processes()` shows `ready` vs `starting`. If still `starting`, the debounce hasn't completed; the process may still be initializing.

---

## Kill vs Restart

| Use | Reason |
|---|---|
| **restart_process** | Code changed, config updated, need fresh state but same process identity |
| **kill_process** | Process is no longer needed, freeing resources, or a clean slate before a `start_process` with a completely different command |

**Rule of thumb:** Prefer `restart_process` when you want the same process running again. Prefer `kill_process` when you're done with it entirely.
