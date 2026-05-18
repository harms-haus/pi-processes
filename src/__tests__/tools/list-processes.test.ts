import { describe, expect, it } from "vitest";
import { createListProcessesTool } from "../../tools/list-processes.js";
import type { ProcessInfo } from "../../types.js";
import { createMockManager, createMockTheme, executeTool } from "../helpers/index.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Sample ProcessInfo for testing */
function sampleProcess(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    name: "web",
    pid: 12345,
    command: "npm run dev",
    startTime: Date.now() - 60_000,
    running: true,
    uptimeSec: 60,
    logLines: 42,
    startupComplete: true,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("createListProcessesTool", () => {
  it("has correct name and label", () => {
    const manager = createMockManager();
    const tool = createListProcessesTool(() => manager as any);
    expect(tool.name).toBe("list_processes");
    expect(tool.label).toBe("List Processes");
  });

  describe("execute()", () => {
    it('returns "No active processes." when empty', async () => {
      const manager = createMockManager();
      const tool = createListProcessesTool(() => manager as any);
      const result = await executeTool(tool, "call-1", {});

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: "No active processes.",
      });
    });

    it("returns formatted list when processes exist", async () => {
      const processes = [
        sampleProcess({
          name: "web",
          pid: 1001,
          command: "npm run dev",
          uptimeSec: 60,
          logLines: 42,
          startupComplete: true,
        }),
        sampleProcess({
          name: "db",
          pid: 1002,
          command: "postgres",
          uptimeSec: 120,
          logLines: 10,
          startupComplete: false,
        }),
      ];
      const manager = createMockManager({ list: () => processes });
      const tool = createListProcessesTool(() => manager as any);
      const result = await executeTool(tool, "call-1", {});

      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("web (PID 1001)");
      expect(text).toContain("npm run dev");
      expect(text).toContain("uptime: 60.0s");
      expect(text).toContain("42 lines");
      expect(text).toContain("ready");
      expect(text).toContain("db (PID 1002)");
      expect(text).toContain("postgres");
      expect(text).toContain("starting");
    });

    it("returns details with processes array and count", async () => {
      const processes = [sampleProcess({ name: "web" }), sampleProcess({ name: "db" })];
      const manager = createMockManager({ list: () => processes });
      const tool = createListProcessesTool(() => manager as any);
      const result = await executeTool(tool, "call-1", {});

      expect(result.details).toEqual({
        processes,
        count: 2,
      });
    });
  });

  describe("renderResult()", () => {
    it("shows process count", () => {
      const manager = createMockManager();
      const tool = createListProcessesTool(() => manager as any);
      const theme = createMockTheme();

      const mockResult = {
        content: [{ type: "text" as const, text: "test" }],
        details: { processes: [sampleProcess()], count: 1 },
      };

      const component = tool.renderResult!(
        mockResult,
        { expanded: false, isPartial: false },
        theme as any,
        {} as any,
      );

      // Component should be a Container (has children)
      expect(component).toBeDefined();
      // The container should have children - title + spacer + process row
      expect((component as any).children.length).toBeGreaterThanOrEqual(1);
    });

    it("shows only title when no processes", () => {
      const manager = createMockManager();
      const tool = createListProcessesTool(() => manager as any);
      const theme = createMockTheme();

      const mockResult = {
        content: [{ type: "text" as const, text: "No active processes." }],
        details: { processes: [], count: 0 },
      };

      const component = tool.renderResult!(
        mockResult,
        { expanded: false, isPartial: false },
        theme as any,
        {} as any,
      );

      expect(component).toBeDefined();
      // Title only, no spacer or process rows
      expect((component as any).children.length).toBe(1);
    });
  });
});
