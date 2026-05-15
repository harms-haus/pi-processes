/**
 * pi-processes: Process Management Extension for pi
 *
 * Tools:
 *   start_process    — Start a long-running process with startup debounce
 *   list_processes    — List all active managed processes
 *   kill_process      — Kill a running managed process
 *   process_logs      — Read log output from a managed process
 *   restart_process   — Restart a managed process
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ProcessManager } from "./process-manager.js";
import { createStartProcessTool } from "./tools/start-process.js";
import { createListProcessesTool } from "./tools/list-processes.js";
import { createKillProcessTool } from "./tools/kill-process.js";
import { createProcessLogsTool } from "./tools/process-logs.js";
import { createRestartProcessTool } from "./tools/restart-process.js";

export default function (pi: ExtensionAPI) {
  let manager: ProcessManager | null = null;

  const getManager = (): ProcessManager => {
    if (!manager) {
      throw new Error("ProcessManager not initialized. Is the session active?");
    }
    return manager;
  };

  // ── Session lifecycle ───────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    manager = new ProcessManager();
    if (ctx.hasUI) {
      ctx.ui.notify("pi-processes loaded", "info");
    }
  });

  pi.on("session_shutdown", async () => {
    if (manager) {
      await manager.shutdown();
      manager = null;
    }
  });

  // ── Tool registration ───────────────────────────────────────────────
  pi.registerTool(createStartProcessTool(getManager));
  pi.registerTool(createListProcessesTool(getManager));
  pi.registerTool(createKillProcessTool(getManager));
  pi.registerTool(createProcessLogsTool(getManager));
  pi.registerTool(createRestartProcessTool(getManager));
}
