import { describe, expect, it } from "vitest";
import { createStartProcessTool } from "../../tools/start-process.js";
import type { StartupResult } from "../../types.js";
import { createMockManager, createMockTheme, executeTool } from "../helpers/index.js";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("createStartProcessTool", () => {
  const mockManager = createMockManager();
  const tool = createStartProcessTool(() => mockManager as any);

  // 1. Tool registration has correct name, label, description
  describe("registration", () => {
    it("has correct name", () => {
      expect(tool.name).toBe("start_process");
    });

    it("has correct label", () => {
      expect(tool.label).toBe("Start Process");
    });

    it("has correct description", () => {
      expect(tool.description).toContain("long-running process");
      expect(tool.description).toContain("startup logs");
    });

    it("has promptSnippet", () => {
      expect(tool.promptSnippet).toBeDefined();
    });

    it("has promptGuidelines", () => {
      expect(tool.promptGuidelines).toBeDefined();
      expect(tool.promptGuidelines!.length).toBeGreaterThan(0);
    });
  });

  // 2. execute() calls manager.start with correct params
  // 3. execute() returns correct content text format
  // 4. execute() returns details with StartupResult shape
  describe("execute()", () => {
    it("calls manager.start with correct params", async () => {
      const params = {
        name: "dev-server",
        command: "npm start",
        start_delay: 3,
      };

      await executeTool(tool, "call-1", params);

      expect(mockManager.start).toHaveBeenCalledWith("dev-server", "npm start", 3);
    });

    it("uses DEFAULT_START_DELAY when start_delay is omitted", async () => {
      const params = {
        name: "dev-server",
        command: "npm start",
      };

      await executeTool(tool, "call-2", params);

      // DEFAULT_START_DELAY is 5
      expect(mockManager.start).toHaveBeenCalledWith("dev-server", "npm start", 5);
    });

    it("returns correct content text format", async () => {
      const params = {
        name: "dev-server",
        command: "npm start",
        start_delay: 3,
      };

      const result = await executeTool(tool, "call-3", params);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Process 'dev-server' started (PID 12345)");
      expect(text).toContain("Startup time: 3.2s");
      expect(text).toContain("Max log delay: 2s");
      expect(text).toContain("Server listening on port 3000");
      expect(text).toContain("Ready.");
    });

    it("returns details with StartupResult shape", async () => {
      const params = {
        name: "dev-server",
        command: "npm start",
      };

      const result = await executeTool(tool, "call-4", params);

      const details = result.details as StartupResult;
      expect(details).toEqual({
        name: "dev-server",
        pid: 12345,
        startupTime: 3200,
        maxDelay: 2,
        logs: "Server listening on port 3000\nReady.",
      });
    });

    it("shows (no output) when logs are empty", async () => {
      const emptyResult: StartupResult = {
        name: "quiet-proc",
        pid: 99999,
        startupTime: 1000,
        maxDelay: 0,
        logs: "",
      };
      mockManager.start.mockResolvedValueOnce(emptyResult);

      const params = { name: "quiet-proc", command: "true" };
      const result = await executeTool(tool, "call-5", params);

      expect((result.content[0] as { type: "text"; text: string }).text).toContain("(no output)");
    });
  });

  // 5. renderCall renders process name
  describe("renderCall()", () => {
    it("renders process name", () => {
      const theme = createMockTheme();
      tool.renderCall!(
        { name: "dev-server", command: "npm start" },
        theme as any,
        undefined as any,
      );

      // theme.fg and theme.bold should have been called
      expect(theme.bold).toHaveBeenCalledWith("start_process ");
      expect(theme.fg).toHaveBeenCalledWith("toolTitle", "**start_process **");
      expect(theme.fg).toHaveBeenCalledWith("accent", "dev-server");
    });
  });

  // 6. renderResult renders success indicator with PID
  describe("renderResult()", () => {
    it("renders success indicator with PID", () => {
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
        toolResult,
        { expanded: false, isPartial: false },
        theme as any,
        undefined as any,
      );

      // Verify theme methods were called with success styling
      expect(theme.bold).toHaveBeenCalledWith("✓ dev-server");
      expect(theme.fg).toHaveBeenCalledWith("success", "**✓ dev-server**");
      expect(theme.fg).toHaveBeenCalledWith("dim", " PID 12345");
      expect(theme.fg).toHaveBeenCalledWith("dim", " | startup 3.2s");
    });
  });
});
