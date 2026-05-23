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
import { openLogDialog } from "./ui/open-log-dialog.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Re-export createLogDialogOverlay for backward compatibility
export { createLogDialogOverlay } from "./ui/open-log-dialog.js";

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
      const mgr = manager;
      if (!mgr) return;
      await openLogDialog(ctx, mgr);
    },
  });
}
