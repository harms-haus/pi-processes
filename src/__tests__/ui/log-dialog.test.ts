import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogDialog } from "../../ui/log-dialog.js";
import { createMockTheme, makeLog, makeLogs } from "../helpers/index.js";
import type { LogEntry, ProcessInfo } from "../../types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a ProcessInfo for testing. */
function makeProcess(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    name: "test-proc",
    pid: 12345,
    command: "echo hello",
    startTime: Date.now(),
    running: true,
    uptimeSec: 10,
    logLines: 5,
    startupComplete: true,
    ...overrides,
  };
}

// Terminal escape sequences for keyboard input simulation.
// These are the standard legacy sequences that matchesKey() recognizes.
const KEYS = {
  tab: "\t",
  shiftTab: "\x1b[Z",
  up: "\x1b[A",
  down: "\x1b[B",
  shiftUp: "\x1b[a",
  shiftDown: "\x1b[b",
  escape: "\x1b",
  // xterm modifyOtherKeys format for Ctrl+Enter: ESC[27;5;13~
  ctrlEnter: "\x1b[27;5;13~",
} as const;

// ── Tests ───────────────────────────────────────────────────────────────────

describe("LogDialog", () => {
  let theme: ReturnType<typeof createMockTheme>;
  let onDone: ReturnType<typeof vi.fn>;
  let renderFn: ReturnType<typeof vi.fn>;

  function createDialog(
    processes: ProcessInfo[] = [],
    logsByProcess: Map<string, LogEntry[]> = new Map(),
  ): LogDialog {
    const dialog = new LogDialog(processes, logsByProcess, theme, onDone);
    dialog.setRequestRender(renderFn);
    dialog.setContentHeight(20);
    return dialog;
  }

  beforeEach(() => {
    theme = createMockTheme();
    onDone = vi.fn();
    renderFn = vi.fn();
  });

  // ── render() ─────────────────────────────────────────────────────────

  describe("render", () => {
    it("shows 'No processes running' when no processes", () => {
      const dialog = createDialog();
      const lines = dialog.render(80);

      // Tab bar should show "No processes running"
      expect(lines[0]).toContain("No processes running");
    });

    it("renders tab bar with single process", () => {
      const proc = makeProcess({ name: "dev-server" });
      const dialog = createDialog([proc]);
      const lines = dialog.render(80);

      // Tab bar should show the process name
      expect(lines[0]).toContain("dev-server");
    });

    it("renders tab bar with multiple processes, highlighting active", () => {
      const proc1 = makeProcess({ name: "dev-server" });
      const proc2 = makeProcess({ name: "watcher" });
      const dialog = createDialog([proc1, proc2]);
      const lines = dialog.render(80);

      // First tab should be bold+accent (active), second should be muted
      expect(lines[0]).toContain("dev-server");
      expect(lines[0]).toContain("watcher");

      // Check that bold was applied to the active process name
      expect(theme.bold).toHaveBeenCalledWith("dev-server");
      expect(theme.fg).toHaveBeenCalledWith("accent", "**dev-server**");
      expect(theme.fg).toHaveBeenCalledWith("muted", "watcher");
    });

    it("shows 'No logs yet' for process with no logs", () => {
      const proc = makeProcess({ name: "dev-server" });
      const dialog = createDialog([proc], new Map());
      const lines = dialog.render(80);

      // Content area should show "No logs yet"
      const contentLines = lines.filter((l) => l.includes("No logs yet"));
      expect(contentLines.length).toBeGreaterThanOrEqual(1);
    });

    it("renders log lines with timestamps and stream labels", () => {
      const proc = makeProcess({ name: "dev-server" });
      const logs = new Map<string, LogEntry[]>([
        ["dev-server", [makeLog("Hello world", "stdout", 1000)]],
      ]);
      const dialog = createDialog([proc], logs);
      const lines = dialog.render(80);

      // Should contain the timestamp format
      expect(lines.some((l) => l.includes("+00:00:01.000"))).toBe(true);
      // Should contain the log text
      expect(lines.some((l) => l.includes("Hello world"))).toBe(true);
      // Stream label should be present via theme.fg("success", "[stdout]")
      expect(theme.fg).toHaveBeenCalledWith("success", "[stdout]");
    });

    it("renders stderr stream label with error color", () => {
      const proc = makeProcess({ name: "dev-server" });
      const logs = new Map<string, LogEntry[]>([["dev-server", [makeLog("Oops", "stderr", 500)]]]);
      const dialog = createDialog([proc], logs);
      dialog.render(80);

      expect(theme.fg).toHaveBeenCalledWith("error", "[stderr]");
    });

    it("highlights selected log line", () => {
      const proc = makeProcess({ name: "dev-server" });
      const entries = [makeLog("Line A"), makeLog("Line B"), makeLog("Line C")];
      const logs = new Map<string, LogEntry[]>([["dev-server", entries]]);
      const dialog = createDialog([proc], logs);
      const lines = dialog.render(80);

      // The selected line (index 0) should have "▶ " prefix
      expect(lines.some((l) => l.includes("▶"))).toBe(true);
      // Non-selected lines should have "  " prefix
      expect(lines.some((l) => l.includes("  "))).toBe(true);

      // The selected line should have bg("toolPendingBg", ...) applied
      expect(theme.bg).toHaveBeenCalledWith("toolPendingBg", expect.any(String));
    });

    it("shows scroll indicators when logs overflow viewport", () => {
      const proc = makeProcess({ name: "dev-server" });
      // Create more logs than viewport can hold
      const entries = makeLogs(30);
      const logs = new Map<string, LogEntry[]>([["dev-server", entries]]);
      const dialog = createDialog([proc], logs);
      dialog.setContentHeight(5);

      // Move selection past viewport to force scroll
      for (let i = 0; i < 10; i++) {
        dialog.handleInput(KEYS.down);
      }

      const lines = dialog.render(80);

      // Should have scroll indicator(s)
      const hasScrollIndicator = lines.some(
        (l) => l.includes("more above") || l.includes("more below"),
      );
      expect(hasScrollIndicator).toBe(true);
    });

    it("shows 'Start a process first' in content when no processes", () => {
      const dialog = createDialog();
      const lines = dialog.render(80);

      // Content should say "Start a process first" when no processes
      expect(lines.some((l) => l.includes("Start a process first"))).toBe(true);
    });

    it("renders diagnostics footer with colored status dot", () => {
      const proc = makeProcess({ name: "dev-server", running: true });
      const dialog = createDialog([proc]);
      const lines = dialog.render(80);

      // Diagnostics should show process name, PID, uptime, etc.
      const diagLine = lines.find((l) => l.includes("dev-server") && l.includes("PID"));
      expect(diagLine).toBeDefined();

      // Running process should have green dot
      expect(theme.fg).toHaveBeenCalledWith("success", "●");
      expect(theme.fg).toHaveBeenCalledWith("accent", "dev-server");
    });

    it("renders diagnostics with red dot for stopped process", () => {
      const proc = makeProcess({ name: "dev-server", running: false });
      const dialog = createDialog([proc]);
      dialog.render(80);

      expect(theme.fg).toHaveBeenCalledWith("error", "●");
    });

    it("renders help bar with keybinding hints", () => {
      const dialog = createDialog();
      // Use wide width so mock theme tags don't cause truncation
      const lines = dialog.render(200);

      // Help bar should contain key hints
      const helpLine = lines[lines.length - 1];
      expect(helpLine).toContain("[Tab]");
      expect(helpLine).toContain("[Esc]");
      expect(helpLine).toContain("Ctrl+Enter");
    });

    it("truncates lines to fit width", () => {
      const proc = makeProcess({ name: "dev-server" });
      const longText = "A".repeat(200);
      const logs = new Map<string, LogEntry[]>([["dev-server", [makeLog(longText, "stdout", 0)]]]);
      const dialog = createDialog([proc], logs);
      const lines = dialog.render(40);

      // The rendered lines should be shorter than the raw log text
      // (truncateToWidth trims to the given width, though mock theme
      // tags may add extra characters beyond the visual width)
      for (const line of lines) {
        expect(line.length).toBeLessThan(longText.length);
      }
    });
  });

  // ── handleInput() ────────────────────────────────────────────────────

  describe("handleInput", () => {
    it("switches to next tab on Tab", () => {
      const proc1 = makeProcess({ name: "alpha" });
      const proc2 = makeProcess({ name: "beta" });
      const logs = new Map<string, LogEntry[]>([
        ["alpha", [makeLog("Alpha log")]],
        ["beta", [makeLog("Beta log")]],
      ]);
      const dialog = createDialog([proc1, proc2], logs);

      dialog.handleInput(KEYS.tab);

      dialog.render(80);
      // "beta" should now be bold (active)
      expect(theme.bold).toHaveBeenCalledWith("beta");
    });

    it("switches to previous tab on Shift+Tab", () => {
      const proc1 = makeProcess({ name: "alpha" });
      const proc2 = makeProcess({ name: "beta" });
      const logs = new Map<string, LogEntry[]>([
        ["alpha", [makeLog("Alpha log")]],
        ["beta", [makeLog("Beta log")]],
      ]);
      const dialog = createDialog([proc1, proc2], logs);

      // Go to second tab first
      dialog.handleInput(KEYS.tab);
      // Then go back with Shift+Tab
      dialog.handleInput(KEYS.shiftTab);

      dialog.render(80);
      // "alpha" should be active again (bold)
      expect(theme.bold).toHaveBeenCalledWith("alpha");
    });

    it("moves selection down on Down arrow", () => {
      const proc = makeProcess({ name: "dev-server" });
      const entries = [makeLog("Line 1"), makeLog("Line 2"), makeLog("Line 3")];
      const logs = new Map<string, LogEntry[]>([["dev-server", entries]]);
      const dialog = createDialog([proc], logs);

      dialog.handleInput(KEYS.down);
      dialog.render(80);

      // After pressing down, the cursor "▶" should be at index 1
      // So the bg("toolPendingBg") should have been called for line at index 1
      expect(theme.bg).toHaveBeenCalledWith("toolPendingBg", expect.stringContaining("Line 2"));
    });

    it("moves selection up on Up arrow", () => {
      const proc = makeProcess({ name: "dev-server" });
      const entries = [makeLog("Line 1"), makeLog("Line 2"), makeLog("Line 3")];
      const logs = new Map<string, LogEntry[]>([["dev-server", entries]]);
      const dialog = createDialog([proc], logs);

      // Move down twice then up once
      dialog.handleInput(KEYS.down);
      dialog.handleInput(KEYS.down);
      dialog.handleInput(KEYS.up);
      dialog.render(80);

      // Cursor should be at index 1 (Line 2)
      expect(theme.bg).toHaveBeenCalledWith("toolPendingBg", expect.stringContaining("Line 2"));
    });

    it("extends selection down on Shift+Down", () => {
      const proc = makeProcess({ name: "dev-server" });
      const entries = [makeLog("Line 1"), makeLog("Line 2"), makeLog("Line 3")];
      const logs = new Map<string, LogEntry[]>([["dev-server", entries]]);
      const dialog = createDialog([proc], logs);

      dialog.handleInput(KEYS.shiftDown);
      dialog.render(80);

      // Both index 0 and 1 should be selected (in the bg call)
      // Line 1 should be selected (it's the anchor at 0)
      // Line 2 should be selected (it's the new position at 1)
      const bgCalls = theme.bg.mock.calls.filter((c) => c[0] === "toolPendingBg");
      expect(bgCalls.length).toBeGreaterThanOrEqual(2);
    });

    it("extends selection up on Shift+Up", () => {
      const proc = makeProcess({ name: "dev-server" });
      const entries = [makeLog("Line 1"), makeLog("Line 2"), makeLog("Line 3")];
      const logs = new Map<string, LogEntry[]>([["dev-server", entries]]);
      const dialog = createDialog([proc], logs);

      // Move to index 2
      dialog.handleInput(KEYS.down);
      dialog.handleInput(KEYS.down);
      // Now extend selection up
      dialog.handleInput(KEYS.shiftUp);
      dialog.render(80);

      // Should have a multi-line selection (index 1 and 2)
      const bgCalls = theme.bg.mock.calls.filter((c) => c[0] === "toolPendingBg");
      expect(bgCalls.length).toBeGreaterThanOrEqual(2);
    });

    it("calls onDone(null) on Escape", () => {
      const proc = makeProcess({ name: "dev-server" });
      const dialog = createDialog([proc]);

      dialog.handleInput(KEYS.escape);

      expect(onDone).toHaveBeenCalledWith(null);
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("calls onDone with selected logs on Ctrl+Enter", () => {
      const proc = makeProcess({ name: "dev-server" });
      const entries = [makeLog("Line 1"), makeLog("Line 2")];
      const logs = new Map<string, LogEntry[]>([["dev-server", entries]]);
      const dialog = createDialog([proc], logs);

      dialog.handleInput(KEYS.ctrlEnter);

      expect(onDone).toHaveBeenCalledTimes(1);
      const result = onDone.mock.calls[0][0];
      expect(result.processName).toBe("dev-server");
      expect(result.selectedLogs).toHaveLength(1);
      expect(result.selectedLogs[0].text).toBe("Line 1");
    });

    it("calls onDone with multi-selected logs on Ctrl+Enter", () => {
      const proc = makeProcess({ name: "dev-server" });
      const entries = [makeLog("Line 1"), makeLog("Line 2"), makeLog("Line 3")];
      const logs = new Map<string, LogEntry[]>([["dev-server", entries]]);
      const dialog = createDialog([proc], logs);

      // Extend selection to include lines 1 and 2
      dialog.handleInput(KEYS.shiftDown);
      dialog.handleInput(KEYS.ctrlEnter);

      expect(onDone).toHaveBeenCalledTimes(1);
      const result = onDone.mock.calls[0][0];
      expect(result.processName).toBe("dev-server");
      expect(result.selectedLogs).toHaveLength(2);
      expect(result.selectedLogs[0].text).toBe("Line 1");
      expect(result.selectedLogs[1].text).toBe("Line 2");
    });

    it("does not call onDone on Ctrl+Enter when no logs", () => {
      const proc = makeProcess({ name: "dev-server" });
      const dialog = createDialog([proc], new Map());

      dialog.handleInput(KEYS.ctrlEnter);

      expect(onDone).not.toHaveBeenCalled();
    });

    it("wraps tab index on Tab at last process", () => {
      const proc1 = makeProcess({ name: "alpha" });
      const proc2 = makeProcess({ name: "beta" });
      const logs = new Map<string, LogEntry[]>([
        ["alpha", [makeLog("Alpha log")]],
        ["beta", [makeLog("Beta log")]],
      ]);
      const dialog = createDialog([proc1, proc2], logs);

      // Currently at alpha (index 0). Tab to beta (index 1). Tab again wraps to alpha (index 0).
      dialog.handleInput(KEYS.tab);
      dialog.handleInput(KEYS.tab);

      dialog.render(80);
      // alpha should be active (bold) again after wrapping
      expect(theme.bold).toHaveBeenCalledWith("alpha");
    });

    it("wraps tab index on Shift+Tab at first process", () => {
      const proc1 = makeProcess({ name: "alpha" });
      const proc2 = makeProcess({ name: "beta" });
      const logs = new Map<string, LogEntry[]>([
        ["alpha", [makeLog("Alpha log")]],
        ["beta", [makeLog("Beta log")]],
      ]);
      const dialog = createDialog([proc1, proc2], logs);

      // Currently at alpha (index 0). Shift+Tab wraps to beta (index 1).
      dialog.handleInput(KEYS.shiftTab);

      dialog.render(80);
      expect(theme.bold).toHaveBeenCalledWith("beta");
    });

    it("resets selection on tab change", () => {
      const proc1 = makeProcess({ name: "alpha" });
      const proc2 = makeProcess({ name: "beta" });
      const logs = new Map<string, LogEntry[]>([
        ["alpha", [makeLog("A1"), makeLog("A2"), makeLog("A3")]],
        ["beta", [makeLog("B1"), makeLog("B2")]],
      ]);
      const dialog = createDialog([proc1, proc2], logs);

      // Move selection down a couple times on alpha
      dialog.handleInput(KEYS.down);
      dialog.handleInput(KEYS.down);

      // Switch to beta
      dialog.handleInput(KEYS.tab);
      dialog.render(80);

      // Selection should be reset to index 0 on beta
      // The cursor "▶" should be on "B1"
      expect(theme.bg).toHaveBeenCalledWith("toolPendingBg", expect.stringContaining("B1"));
    });

    it("clamps selection at bottom boundary", () => {
      const proc = makeProcess({ name: "dev-server" });
      const entries = [makeLog("Line 1"), makeLog("Line 2")];
      const logs = new Map<string, LogEntry[]>([["dev-server", entries]]);
      const dialog = createDialog([proc], logs);

      // Try to go past the last log
      dialog.handleInput(KEYS.down);
      dialog.handleInput(KEYS.down);
      dialog.handleInput(KEYS.down);

      dialog.render(80);

      // Should still be on the last line
      expect(theme.bg).toHaveBeenCalledWith("toolPendingBg", expect.stringContaining("Line 2"));
    });

    it("clamps selection at top boundary", () => {
      const proc = makeProcess({ name: "dev-server" });
      const entries = [makeLog("Line 1"), makeLog("Line 2")];
      const logs = new Map<string, LogEntry[]>([["dev-server", entries]]);
      const dialog = createDialog([proc], logs);

      // Try to go above the first log
      dialog.handleInput(KEYS.up);
      dialog.render(80);

      // Should still be on the first line
      expect(theme.bg).toHaveBeenCalledWith("toolPendingBg", expect.stringContaining("Line 1"));
    });

    it("does not switch tab when only one process on Tab", () => {
      const proc = makeProcess({ name: "only" });
      const logs = new Map<string, LogEntry[]>([["only", [makeLog("Log")]]]);
      const dialog = createDialog([proc], logs);

      dialog.handleInput(KEYS.tab);
      dialog.render(80);

      // Should still be on "only" (bold called for "only" only)
      const boldCalls = theme.bold.mock.calls.map((c) => c[0]);
      expect(boldCalls).toEqual(["only"]);
    });

    it("clears multi-selection on plain navigation", () => {
      const proc = makeProcess({ name: "dev-server" });
      const entries = [makeLog("Line 1"), makeLog("Line 2"), makeLog("Line 3")];
      const logs = new Map<string, LogEntry[]>([["dev-server", entries]]);
      const dialog = createDialog([proc], logs);

      // Start multi-select
      dialog.handleInput(KEYS.shiftDown);
      // Switch to plain navigation — should clear anchor
      dialog.handleInput(KEYS.down);

      dialog.render(80);

      // After clearing multi-select and moving to index 2, only Line 3 should be highlighted
      const bgCalls = theme.bg.mock.calls.filter((c) => c[0] === "toolPendingBg");
      // Only the last render pass matters — check that Line 3 is selected
      expect(bgCalls.some((c) => c[1].includes("Line 3"))).toBe(true);
    });

    it("calls requestRender after handling input", () => {
      const proc = makeProcess({ name: "dev-server" });
      const dialog = createDialog([proc]);

      dialog.handleInput(KEYS.down);
      expect(renderFn).toHaveBeenCalled();
    });
  });

  // ── setRequestRender / setContentHeight / invalidate ──────────────────

  describe("component interface", () => {
    it("setRequestRender stores the callback", () => {
      const proc = makeProcess({ name: "dev-server" });
      const dialog = new LogDialog([proc], new Map(), theme, onDone);
      const myRender = vi.fn();
      dialog.setRequestRender(myRender);
      dialog.setContentHeight(20);

      dialog.handleInput(KEYS.down);
      expect(myRender).toHaveBeenCalled();
    });

    it("invalidate() does not throw", () => {
      const dialog = createDialog();
      expect(() => { dialog.invalidate(); }).not.toThrow();
    });

    it("setContentHeight adjusts viewport", () => {
      const proc = makeProcess({ name: "dev-server" });
      const entries = makeLogs(50);
      const logs = new Map<string, LogEntry[]>([["dev-server", entries]]);
      const dialog = createDialog([proc], logs);

      // Set a small content height
      dialog.setContentHeight(3);

      // Move selection past the small viewport
      for (let i = 0; i < 10; i++) {
        dialog.handleInput(KEYS.down);
      }

      const lines = dialog.render(80);

      // With viewport of 3, there should be a scroll indicator
      const hasScrollIndicator = lines.some(
        (l) => l.includes("more above") || l.includes("more below"),
      );
      expect(hasScrollIndicator).toBe(true);
    });
  });

  // ── Diagnostics ──────────────────────────────────────────────────────

  describe("diagnostics", () => {
    it("shows 'No process selected' when no processes", () => {
      const dialog = createDialog();
      const lines = dialog.render(80);

      expect(lines.some((l) => l.includes("No process selected"))).toBe(true);
    });

    it("shows viewport range when logs are present", () => {
      const proc = makeProcess({ name: "dev-server" });
      const entries = makeLogs(10);
      const logs = new Map<string, LogEntry[]>([["dev-server", entries]]);
      const dialog = createDialog([proc], logs);

      // Use wide width so mock theme tags don't cause truncation
      const lines = dialog.render(200);

      // With viewport of 20 and 10 logs, should show "showing 1-10 of 10"
      expect(lines.some((l) => l.includes("showing") && l.includes("of 10"))).toBe(true);
    });

    it("shows running/exited status in diagnostics", () => {
      const proc = makeProcess({ name: "dev-server", running: true });
      const dialog = createDialog([proc]);
      // Use wide width so mock theme tags don't cause truncation
      const lines = dialog.render(200);

      expect(lines.some((l) => l.includes("status: running"))).toBe(true);
    });
  });
});
