/**
 * Opens the process log dialog overlay.
 * Extracted from the extension entry point for testability.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { LogEntry, ProcessInfo, ThemeStyle } from "../types.js";
import type { ProcessManager } from "../process-manager.js";
import { LogDialog } from "./log-dialog.js";
import { formatLogTimestamp } from "./format-timestamp.js";

/**
 * Factory that creates an overlay widget factory for the process log dialog.
 * Extracted for testability.
 */
export function createLogDialogOverlay(
  processes: ProcessInfo[],
  logsByProcess: Map<string, LogEntry[]>,
) {
  return (
    tui: { requestRender: () => void },
    theme: unknown,
    _keybindings: unknown,
    done: (result: { selectedLogs: LogEntry[]; processName: string } | null) => void,
  ) => {
    const dialog = new LogDialog(processes, logsByProcess, theme as ThemeStyle, done);
    dialog.setRequestRender(() => {
      tui.requestRender();
    });
    return dialog;
  };
}

/**
 * Opens the log dialog overlay for viewing and selecting process logs.
 *
 * @param ctx - The extension context (must have UI available)
 * @param manager - The active ProcessManager instance
 */
export async function openLogDialog(ctx: ExtensionContext, manager: ProcessManager): Promise<void> {
  // 1. UI availability check
  if (!ctx.hasUI) {
    return;
  }

  // 2. Process list retrieval
  const processes = manager.list();
  if (processes.length === 0) {
    ctx.ui.notify("No processes running. Start one first.", "info");
    return;
  }

  // 3. Collect logs for all processes
  const logsByProcess = new Map<string, LogEntry[]>();
  for (const proc of processes) {
    logsByProcess.set(proc.name, manager.getLogs(proc.name));
  }

  // 4. Open the overlay dialog
  const factory = createLogDialogOverlay(processes, logsByProcess);

  const result = await ctx.ui.custom<{
    selectedLogs: LogEntry[];
    processName: string;
  } | null>(factory, {
    overlay: true,
    overlayOptions: {
      anchor: "center",
      width: "66%",
      maxHeight: "66%",
    },
  });

  // 5. Insert result text if selection was made
  if (result) {
    const formatted = result.selectedLogs
      .map((entry) => `[${formatLogTimestamp(entry.timestamp)}] [${entry.stream}] ${entry.text}`)
      .join("\n");
    ctx.ui.setEditorText(formatted);
    ctx.ui.notify(
      `Inserted ${result.selectedLogs.length} log lines from ${result.processName}`,
      "info",
    );
  }
}
