import { describe, expect, it, vi } from "vitest";
import type { StartupResult } from "../../types.js";
import { createRestartProcessTool } from "../../tools/restart-process.js";

// ── Mock ProcessManager ──────────────────────────────────────────────────────

function createMockManager() {
  const mockStartupResult: StartupResult = {
    name: "dev-server",
    pid: 12345,
    startupTime: 3200, // 3.2 seconds in ms
    maxDelay: 2, // seconds (rounded up)
    logs: "Server listening on port 3000\nReady.",
  };

  return {
    start: vi.fn(),
    kill: vi.fn(),
    restart: vi.fn().mockResolvedValue(mockStartupResult),
    list: vi.fn(),
    getLogs: vi.fn(),
    get: vi.fn(),
    has: vi.fn(),
    killAll: vi.fn(),
  };
}

// ── Mock Theme ───────────────────────────────────────────────────────────────

function createMockTheme() {
  return {
    fg: vi.fn((_color: string, text: string) => `<${_color}>${text}</${_color}>`),
    bg: vi.fn((_color: string, text: string) => text),
    bold: vi.fn((text: string) => `**${text}**`),
    italic: vi.fn((text: string) => text),
    underline: vi.fn((text: string) => text),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("createRestartProcessTool", () => {
  const mockManager = createMockManager();
  const tool = createRestartProcessTool(() => mockManager as any);

  // 1. Tool registration has correct name, label, description
  describe("registration", () => {
    it("has correct name", () => {
      expect(tool.name).toBe("restart_process");
    });

    it("has correct label", () => {
      expect(tool.label).toBe("Restart Process");
    });

    it("has correct description", () => {
      expect(tool.description).toContain("Restart a managed process");
      expect(tool.description).toContain("Kills the existing process");
    });

    it("has promptSnippet", () => {
      expect(tool.promptSnippet).toBeDefined();
    });

    it("has promptGuidelines", () => {
      expect(tool.promptGuidelines).toBeDefined();
      expect(tool.promptGuidelines!.length).toBeGreaterThan(0);
    });
  });

  // 2. execute() calls manager.restart with correct params (same command)
  // 3. execute() calls manager.restart with new command when provided
  describe("execute()", () => {
    it("calls manager.restart with correct params (same command)", async () => {
      const params = {
        name: "dev-server",
        start_delay: 3,
      };

      await tool.execute("call-1", params as any, undefined, undefined, undefined as any);

      expect(mockManager.restart).toHaveBeenCalledWith(
        "dev-server",
        undefined,
        3,
      );
    });

    it("calls manager.restart with new command when provided", async () => {
      const params = {
        name: "dev-server",
        command: "npm run dev:new",
        start_delay: 3,
      };

      await tool.execute("call-2", params, undefined, undefined, undefined as any);

      expect(mockManager.restart).toHaveBeenCalledWith(
        "dev-server",
        "npm run dev:new",
        3,
      );
    });

    // 4. execute() returns correct content text format
    it("returns correct content text format", async () => {
      const params = {
        name: "dev-server",
        command: "npm start",
        start_delay: 3,
      };

      const result = await tool.execute(
        "call-3",
        params,
        undefined,
        undefined,
        undefined as any,
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Process 'dev-server' restarted (PID 12345)");
      expect(text).toContain("Startup time: 3.2s");
      expect(text).toContain("Max log delay: 2s");
      expect(text).toContain("Server listening on port 3000");
      expect(text).toContain("Ready.");
    });

    // 5. execute() returns details with StartupResult shape
    it("returns details with StartupResult shape", async () => {
      const params = {
        name: "dev-server",
        command: "npm start",
      };

      const result = await tool.execute(
        "call-4",
        params,
        undefined,
        undefined,
        undefined as any,
      );

      const details = result.details as StartupResult;
      expect(details).toEqual({
        name: "dev-server",
        pid: 12345,
        startupTime: 3200,
        maxDelay: 2,
        logs: "Server listening on port 3000\nReady.",
      });
    });

    it("uses DEFAULT_START_DELAY when start_delay is omitted", async () => {
      const params = {
        name: "dev-server",
      };

      await tool.execute("call-5", params as any, undefined, undefined, undefined as any);

      // DEFAULT_START_DELAY is 5
      expect(mockManager.restart).toHaveBeenCalledWith("dev-server", undefined, 5);
    });

    it("shows (no output) when logs are empty", async () => {
      const emptyResult: StartupResult = {
        name: "quiet-proc",
        pid: 99999,
        startupTime: 1000,
        maxDelay: 0,
        logs: "",
      };
      mockManager.restart.mockResolvedValueOnce(emptyResult);

      const params = { name: "quiet-proc" };
      const result = await tool.execute(
        "call-6",
        params as any,
        undefined,
        undefined,
        undefined as any,
      );

      expect((result.content[0] as { type: "text"; text: string }).text).toContain("(no output)");
    });
  });

  // 6. renderCall shows warning color
  describe("renderCall()", () => {
    it("renders process name with warning color", () => {
      const theme = createMockTheme();
      tool.renderCall!(
        { name: "dev-server" },
        theme as any,
        undefined as any,
      );

      expect(theme.bold).toHaveBeenCalledWith("restart_process ");
      expect(theme.fg).toHaveBeenCalledWith("warning", "**restart_process **");
      expect(theme.fg).toHaveBeenCalledWith("accent", "dev-server");
    });
  });

  // 7. renderResult shows restart indicator
  describe("renderResult()", () => {
    it("renders restart indicator with PID", () => {
      const theme = createMockTheme();
      const startupResult: StartupResult = {
        name: "dev-server",
        pid: 12345,
        startupTime: 3200,
        maxDelay: 2,
        logs: "output",
      };

      const toolResult = {
        content: [],
        details: startupResult,
      };

      tool.renderResult!(
        toolResult as any,
        { expanded: false, isPartial: false },
        theme as any,
        undefined as any,
      );

      expect(theme.bold).toHaveBeenCalledWith("↻ dev-server");
      expect(theme.fg).toHaveBeenCalledWith("success", "**↻ dev-server**");
      expect(theme.fg).toHaveBeenCalledWith("dim", " PID 12345 | restarted in 3.2s");
    });
  });
});
