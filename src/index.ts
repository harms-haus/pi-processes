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

import { Key } from "@earendil-works/pi-tui";
import { ProcessManager } from "./process-manager.js";
import { createKillProcessTool } from "./tools/kill-process.js";
import { createListProcessesTool } from "./tools/list-processes.js";
import { createProcessLogsTool } from "./tools/process-logs.js";
import { createRestartProcessTool } from "./tools/restart-process.js";
import { createStartProcessTool } from "./tools/start-process.js";
import { formatLogTimestamp } from "./ui/format-timestamp.js";
import { LogDialog } from "./ui/log-dialog.js";
import type { LogEntry, ThemeStyle } from "./types.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let manager: ProcessManager | null = null;
  let currentCtx: ExtensionContext | null = null;

  const getManager = (): ProcessManager => {
    if (!manager) {
      throw new Error("ProcessManager not initialized. Is the session active?");
    }
    return manager;
  };

  // ── Session lifecycle ───────────────────────────────────────────────
  pi.on("session_start", (_event, ctx) => {
    manager = new ProcessManager();
    currentCtx = ctx;

    const mgr = manager;
    mgr.onProcessCountChange(() => {
      if (currentCtx?.hasUI) {
        const names = mgr
          .list()
          .map((p) => p.name)
          .join(", ");
        currentCtx.ui.setStatus("pi-processes", names ? `p: ${names}` : "");
      }
    });

    if (ctx.hasUI) {
      ctx.ui.notify("pi-processes loaded", "info");
    }
  });

  pi.on("session_shutdown", async () => {
    if (manager) {
      await manager.shutdown();
      manager = null;
    }
    if (currentCtx?.hasUI) {
      currentCtx.ui.setStatus("pi-processes", undefined);
    }
    currentCtx = null;
  });

  // ── Tool registration ───────────────────────────────────────────────
  pi.registerTool(createStartProcessTool(getManager));
  pi.registerTool(createListProcessesTool(getManager));
  pi.registerTool(createKillProcessTool(getManager));
  pi.registerTool(createProcessLogsTool(getManager));
  pi.registerTool(createRestartProcessTool(getManager));

  // ── Shortcut registration ────────────────────────────────────────────
  pi.registerShortcut(Key.ctrlAlt("p"), {
    description: "Show process logs dialog",
    handler: async (ctx) => {
      if (!ctx.hasUI) {
        return;
      }
      const mgr = manager;
      if (!mgr) {
        return;
      }

      const processes = mgr.list();
      if (processes.length === 0) {
        ctx.ui.notify("No processes running. Start one first.", "info");
        return;
      }

      // Collect logs for all processes
      const logsByProcess = new Map<string, LogEntry[]>();
      for (const proc of processes) {
        logsByProcess.set(proc.name, mgr.getLogs(proc.name));
      }

      const result = await ctx.ui.custom<{
        selectedLogs: LogEntry[];
        processName: string;
      } | null>(
        (tui, theme, _keybindings, done) => {
          const dialog = new LogDialog(processes, logsByProcess, theme as ThemeStyle, done);
          dialog.setRequestRender(() => { tui.requestRender(); });
          return dialog;
        },
        {
          overlay: true,
          overlayOptions: {
            anchor: "center",
            width: "66%",
            maxHeight: "66%",
          },
        },
      );

      if (result) {
        const formatted = result.selectedLogs
          .map(
            (entry) => `[${formatLogTimestamp(entry.timestamp)}] [${entry.stream}] ${entry.text}`,
          )
          .join("\n");
        ctx.ui.setEditorText(formatted);
        ctx.ui.notify(
          `Inserted ${result.selectedLogs.length} log lines from ${result.processName}`,
          "info",
        );
      }
    },
  });
}
