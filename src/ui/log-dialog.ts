import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { formatLogTimestamp } from "./format-timestamp.js";
import type { LogEntry, ProcessInfo, ThemeStyle } from "../types.js";

/**
 * Dialog component for browsing process logs with tab-based process switching,
 * scrollable log viewing, and multi-select log insertion.
 */
export class LogDialog {
  private activeTabIndex: number = 0;
  private selectedIndex: number = 0;
  private selectionAnchor: number | null = null;
  private viewportOffset: number = 0;
  private requestRenderFn?: () => void;
  private contentHeight: number = 20;

  constructor(
    private processes: ProcessInfo[],
    private logsByProcess: Map<string, LogEntry[]>,
    private theme: ThemeStyle,
    private onDone: (result: { selectedLogs: LogEntry[]; processName: string } | null) => void,
  ) {}

  /**
   * Set the render callback used to trigger a re-render of the TUI.
   */
  setRequestRender(fn: () => void): void {
    this.requestRenderFn = fn;
  }

  private requestRender(): void {
    this.requestRenderFn?.();
  }

  // ── Active Process Helpers ───────────────────────────────────────────

  private get activeProcess(): ProcessInfo | null {
    return this.processes[this.activeTabIndex] ?? null;
  }

  private get activeLogs(): LogEntry[] {
    const proc = this.activeProcess;
    if (!proc) {
      return [];
    }
    return this.logsByProcess.get(proc.name) ?? [];
  }

  // ── Selection ────────────────────────────────────────────────────────

  /** Get the range of selected log indices (inclusive start, inclusive end). */
  private getSelectionRange(): { start: number; end: number } | null {
    const logs = this.activeLogs;
    if (logs.length === 0) {
      return null;
    }
    if (this.selectionAnchor !== null) {
      return {
        start: Math.min(this.selectionAnchor, this.selectedIndex),
        end: Math.max(this.selectionAnchor, this.selectedIndex),
      };
    }
    return { start: this.selectedIndex, end: this.selectedIndex };
  }

  /** Get the selected log entries (single or multi-select range). */
  private getSelectedLogs(): LogEntry[] {
    const range = this.getSelectionRange();
    if (!range) {
      return [];
    }
    return this.activeLogs.slice(range.start, range.end + 1);
  }

  // ── Viewport ─────────────────────────────────────────────────────────

  /** Clamp viewportOffset so selectedIndex is visible. */
  private clampViewport(viewportHeight: number): void {
    if (viewportHeight <= 0) {
      return;
    }
    if (this.selectedIndex < this.viewportOffset) {
      this.viewportOffset = this.selectedIndex;
    }
    if (this.selectedIndex >= this.viewportOffset + viewportHeight) {
      this.viewportOffset = this.selectedIndex - viewportHeight + 1;
    }
    // Clamp to valid range
    const maxOffset = Math.max(0, this.activeLogs.length - viewportHeight);
    this.viewportOffset = Math.max(0, Math.min(this.viewportOffset, maxOffset));
  }

  // ── Rendering ────────────────────────────────────────────────────────

  render(width: number): string[] {
    const lines: string[] = [];

    // 1. Tab bar
    lines.push(this.renderTabBar(width));

    // 2. Log content (with scroll indicators)
    const contentLines = this.renderContent(width);
    lines.push(...contentLines);

    // 3. Diagnostics footer
    lines.push(this.renderDiagnostics(width));

    // 4. Keybinding help bar
    lines.push(this.renderHelpBar(width));

    return lines;
  }

  // ── Tab Bar ──────────────────────────────────────────────────────────

  private renderTabBar(width: number): string {
    if (this.processes.length === 0) {
      return truncateToWidth(this.theme.fg("dim", "No processes running"), width);
    }

    const parts: string[] = [];
    for (let i = 0; i < this.processes.length; i++) {
      const name = this.processes[i].name;
      if (i === this.activeTabIndex) {
        parts.push(this.theme.fg("accent", this.theme.bold(name)));
      } else {
        parts.push(this.theme.fg("muted", name));
      }
    }

    const separator = " │ ";
    const joined = parts.join(separator);
    return truncateToWidth(joined, width);
  }

  // ── Content Area ─────────────────────────────────────────────────────

  /**
   * Set the available content height for the log viewport.
   * Must be called before render() or whenever the layout changes.
   */
  setContentHeight(height: number): void {
    this.contentHeight = height;
  }

  private renderContent(width: number): string[] {
    const lines: string[] = [];
    const logs = this.activeLogs;

    if (this.processes.length === 0) {
      lines.push(truncateToWidth(this.theme.fg("dim", "Start a process first"), width));
      return lines;
    }

    if (logs.length === 0) {
      lines.push(truncateToWidth(this.theme.fg("dim", "No logs yet"), width));
      return lines;
    }

    const viewportHeight = Math.max(1, this.contentHeight);
    this.clampViewport(viewportHeight);

    // Scroll indicator above
    if (this.viewportOffset > 0) {
      const above = this.viewportOffset;
      lines.push(truncateToWidth(this.theme.fg("dim", `↑ ${above} more above`), width));
    }

    // Log lines
    const endIdx = Math.min(this.viewportOffset + viewportHeight, logs.length);
    for (let i = this.viewportOffset; i < endIdx; i++) {
      lines.push(this.renderLogLine(logs[i], i, width));
    }

    // Scroll indicator below
    if (endIdx < logs.length) {
      const below = logs.length - endIdx;
      lines.push(truncateToWidth(this.theme.fg("dim", `↓ ${below} more below`), width));
    }

    return lines;
  }

  private renderLogLine(entry: LogEntry, index: number, width: number): string {
    const range = this.getSelectionRange();
    const isSelected = range !== null && index >= range.start && index <= range.end;
    const isCursor = index === this.selectedIndex;

    // Build the line content
    const prefix = isCursor ? "▶ " : "  ";
    const timestamp = formatLogTimestamp(entry.timestamp);
    const streamLabel =
      entry.stream === "stdout"
        ? this.theme.fg("success", "[stdout]")
        : this.theme.fg("error", "[stderr]");

    const rawLine = `${prefix}${timestamp} ${streamLabel} ${entry.text}`;

    if (isSelected) {
      return truncateToWidth(this.theme.bg("toolPendingBg", rawLine), width);
    }

    return truncateToWidth(rawLine, width);
  }

  // ── Diagnostics Footer ───────────────────────────────────────────────

  private renderDiagnostics(width: number): string {
    const proc = this.activeProcess;
    const logs = this.activeLogs;

    if (!proc) {
      return truncateToWidth(this.theme.fg("dim", "No process selected"), width);
    }

    // Status dot
    const dot = proc.running ? this.theme.fg("success", "●") : this.theme.fg("error", "●");

    const name = this.theme.fg("accent", proc.name);
    const pidInfo = this.theme.fg("dim", `PID ${proc.pid}`);
    const uptime = this.theme.fg("dim", `uptime: ${Math.floor(proc.uptimeSec)}s`);
    const logCount = this.theme.fg("dim", `logs: ${logs.length}`);
    const status = this.theme.fg("dim", `status: ${proc.running ? "running" : "exited"}`);

    // Showing range
    let rangeText = "";
    if (logs.length > 0) {
      const effectiveHeight = Math.max(1, this.contentHeight);
      const endIdx = Math.min(this.viewportOffset + effectiveHeight, logs.length);
      rangeText = this.theme.fg(
        "dim",
        `showing ${this.viewportOffset + 1}-${endIdx} of ${logs.length}`,
      );
    }

    const parts = [`${dot} ${name}`, pidInfo, uptime, logCount, status];
    if (rangeText) {
      parts.push(rangeText);
    }

    const line = parts.join(" │ ");
    return truncateToWidth(line, width);
  }

  // ── Help Bar ─────────────────────────────────────────────────────────

  private renderHelpBar(width: number): string {
    const text =
      "[Tab] [⇧Tab] switch │ [↑↓] navigate │ [⇧↑⇧↓] select │ [Ctrl+Enter] insert │ [Esc] close";
    return truncateToWidth(this.theme.fg("dim", text), width);
  }

  // ── Input Handling ───────────────────────────────────────────────────

  handleInput(data: string): void {
    // Tab switching
    if (matchesKey(data, Key.tab)) {
      if (this.processes.length > 1) {
        this.activeTabIndex = (this.activeTabIndex + 1) % this.processes.length;
        this.onTabChange();
      }
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.shift("tab"))) {
      if (this.processes.length > 1) {
        this.activeTabIndex =
          (this.activeTabIndex - 1 + this.processes.length) % this.processes.length;
        this.onTabChange();
      }
      this.requestRender();
      return;
    }

    // Navigation
    if (matchesKey(data, Key.up)) {
      this.moveSelection(-1, false);
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.down)) {
      this.moveSelection(1, false);
      this.requestRender();
      return;
    }

    // Multi-select
    if (matchesKey(data, Key.shift("up"))) {
      if (this.selectionAnchor === null) {
        this.selectionAnchor = this.selectedIndex;
      }
      this.moveSelection(-1, true);
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.shift("down"))) {
      if (this.selectionAnchor === null) {
        this.selectionAnchor = this.selectedIndex;
      }
      this.moveSelection(1, true);
      this.requestRender();
      return;
    }

    // Insert selected logs
    if (matchesKey(data, Key.ctrl("enter"))) {
      const logs = this.getSelectedLogs();
      const proc = this.activeProcess;
      if (logs.length > 0 && proc) {
        this.onDone({ selectedLogs: logs, processName: proc.name });
      }
      return;
    }

    // Cancel
    if (matchesKey(data, Key.escape)) {
      this.onDone(null);
      return;
    }
  }

  private moveSelection(delta: number, isMultiSelect: boolean): void {
    const logs = this.activeLogs;
    if (logs.length === 0) {
      return;
    }

    if (!isMultiSelect) {
      this.selectionAnchor = null;
    }

    this.selectedIndex = Math.max(0, Math.min(logs.length - 1, this.selectedIndex + delta));
  }

  private onTabChange(): void {
    this.selectedIndex = 0;
    this.selectionAnchor = null;
    this.viewportOffset = 0;
  }

  // ── Component Interface ──────────────────────────────────────────────

  invalidate(): void {
    // Clear any cached render state — nothing to cache for now
  }
}
